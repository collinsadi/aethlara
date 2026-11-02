package agent

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"net/url"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"
	"unicode"

	"github.com/collinsadi/aethlara/internal/agent/sources"
	"github.com/collinsadi/aethlara/internal/ai"
	"github.com/collinsadi/aethlara/internal/logger"
	"github.com/collinsadi/aethlara/internal/prompts"
)

const (
	scoreBatchSize        = 5
	scoreConcurrency      = 3
	scoringDescChars      = 3500
	sourceTimeout         = 90 * time.Second
	webSearchTimeout      = 4 * time.Minute
	maxPostingsConsidered = 600
)

// aggregatorSources list arbitrary companies' postings, often stale; the
// max-age filter applies to them. ATS boards only list open roles.
var aggregatorSources = map[string]bool{
	sources.Remotive: true, sources.RemoteOK: true, sources.Himalayas: true,
	sources.Jobicy: true, sources.Arbeitnow: true, sources.WebSearch: true,
}

// dedupeKey collapses the same role seen on several sources.
func dedupeKey(company, title string) string {
	norm := func(s string) string {
		var b strings.Builder
		for _, r := range strings.ToLower(s) {
			if unicode.IsLetter(r) || unicode.IsDigit(r) {
				b.WriteRune(r)
			}
		}
		return b.String()
	}
	return norm(company) + "|" + norm(title)
}

type discovered struct {
	posting   sources.Posting
	key       string
	relevance float64
}

// discover runs every enabled source, filters and scores what is new, and
// stores the results as leads.
func (s *Service) discover(ctx context.Context, run *Run, p *Profile, resume *ResumeInfo, stats *RunStats) error {
	log := logger.FromContext(ctx).With("component", "agent", "operation", "discover", "run_id", run.ID)
	sp := p.SearchPrefs
	q := sources.Query{
		Titles:         sp.Titles,
		Keywords:       sp.Keywords,
		Companies:      sp.Watchlist,
		RemoteOnly:     sp.RemoteOnly,
		PerSourceLimit: 120,
	}
	doc := parseResume(resume.ExtractedJSON)

	// 1. Fetch.
	var (
		mu       sync.Mutex
		postings []sources.Posting
		wg       sync.WaitGroup
	)
	stats.SourceErrors = map[string]string{}
	for id, src := range s.sources {
		if !sp.Sources[id] {
			continue
		}
		stats.SourcesQueried++
		wg.Add(1)
		go func(id string, src sources.Source) {
			defer wg.Done()
			sctx, cancel := context.WithTimeout(ctx, sourceTimeout)
			defer cancel()
			got, err := src.Search(sctx, q)
			mu.Lock()
			defer mu.Unlock()
			if err != nil {
				stats.SourceErrors[id] = logger.TruncateError(err, 160)
				log.Warn("source failed", "source", id, "error", logger.TruncateError(err, 200))
				return
			}
			postings = append(postings, got...)
		}(id, src)
	}
	if sp.Sources[sources.WebSearch] && s.ai.SupportsWebSearch(ctx, p.UserID) {
		stats.SourcesQueried++
		wg.Add(1)
		go func() {
			defer wg.Done()
			got, err := s.webSearchPostings(ctx, p, doc)
			mu.Lock()
			defer mu.Unlock()
			if err != nil {
				stats.SourceErrors[sources.WebSearch] = logger.TruncateError(err, 160)
				log.Warn("web search failed", "error", logger.TruncateError(err, 200), "error_type", ai.ClassifyError(err))
				return
			}
			postings = append(postings, got...)
		}()
	}
	wg.Wait()
	stats.PostingsFetched = len(postings)
	for id, msg := range stats.SourceErrors {
		s.event(ctx, Event{UserID: p.UserID, RunID: &run.ID, Kind: EventSourceError, Level: "warning",
			Message: fmt.Sprintf("%s could not be searched: %s", sourceLabel(id), msg)})
	}

	// 2. Filter + dedupe.
	candidates := s.prefilter(postings, sp)
	keys := make([]string, 0, len(candidates))
	for _, c := range candidates {
		keys = append(keys, c.key)
	}
	existing, err := s.repo.ExistingDedupeKeys(ctx, p.UserID, keys)
	if err != nil {
		return fmt.Errorf("dedupe lookup: %w", err)
	}
	fresh := candidates[:0]
	for _, c := range candidates {
		if !existing[c.key] {
			fresh = append(fresh, c)
		}
	}
	limit := s.cfg.AgentMaxLeadsScoredPerRun
	if limit <= 0 {
		limit = 40
	}
	if len(fresh) > limit {
		fresh = fresh[:limit]
	}

	// 3. Score (new postings + leads whose scoring failed last time).
	retry, _ := s.repo.UnscoredLeads(ctx, p.UserID, 10)
	items := make([]scoreItem, 0, len(fresh)+len(retry))
	for i, c := range fresh {
		items = append(items, scoreItem{id: "p" + strconv.Itoa(i), posting: c.posting})
	}
	for i, l := range retry {
		items = append(items, scoreItem{id: "r" + strconv.Itoa(i), posting: leadPosting(l), leadID: l.ID})
	}
	scores := s.scoreItems(ctx, p, doc, items)
	stats.Scored = len(scores)

	// 4. Store.
	threshold := sp.MinScore
	var newLeads []Lead
	for _, it := range items {
		sc, scored := scores[it.id]
		if it.leadID != "" {
			if scored {
				_ = s.repo.SetLeadScore(ctx, it.leadID, sc)
				if sc.Score < threshold || sc.Dealbreaker != nil {
					reason := dismissReason(sc)
					_, _ = s.repo.SetLeadStatus(ctx, p.UserID, it.leadID, LeadDismissed, &reason, false)
				}
			}
			continue
		}
		lead := leadFromPosting(p.UserID, run.ID, it.posting)
		if scored {
			applyScore(&lead, sc)
			if sc.Score < threshold || sc.Dealbreaker != nil {
				lead.Status = LeadDismissed
				reason := dismissReason(sc)
				lead.DismissReason = &reason
			}
		}
		stored, err := s.repo.InsertLead(ctx, lead)
		if err != nil {
			log.Warn("insert lead failed", "error", logger.TruncateError(err, 200))
			continue
		}
		if stored == nil || stored.Status != LeadNew {
			continue
		}
		stats.NewLeads++
		if stored.MatchScore != nil && *stored.MatchScore >= 85 {
			stats.StrongMatches++
		}
		newLeads = append(newLeads, *stored)
	}

	// 5. Auto-approve when the user opted in.
	if th := p.ApplySettings.AutoApproveScore; th != nil {
		for _, l := range newLeads {
			if l.MatchScore != nil && *l.MatchScore >= *th {
				if _, _, err := s.DecideLead(ctx, p.UserID, l.ID, "approve"); err == nil {
					stats.AutoApproved++
				}
			}
		}
	}

	if stats.NewLeads > 0 {
		msg := fmt.Sprintf("Found %d new job%s to review", stats.NewLeads, plural(stats.NewLeads))
		if stats.StrongMatches > 0 {
			msg += fmt.Sprintf(" (%d strong match%s)", stats.StrongMatches, pluralEs(stats.StrongMatches))
		}
		s.event(ctx, Event{UserID: p.UserID, RunID: &run.ID, Kind: EventLeadsFound, Level: "success", Message: msg})
	}
	log.Info("discovery completed",
		"sources", stats.SourcesQueried, "fetched", stats.PostingsFetched,
		"candidates", len(candidates), "scored", stats.Scored, "new_leads", stats.NewLeads)
	return nil
}

func dismissReason(sc LeadScoreUpdate) string {
	if sc.Dealbreaker != nil {
		return "dealbreaker"
	}
	return "low_score"
}

func sourceLabel(id string) string {
	for _, info := range sources.Catalog() {
		if info.ID == id {
			return info.Label
		}
	}
	return id
}

// prefilter drops postings that cannot fit before any AI is spent on them,
// collapses duplicates and orders the rest by title relevance and recency.
func (s *Service) prefilter(postings []sources.Posting, sp SearchPrefs) []discovered {
	q := sources.Query{Titles: sp.Titles, Keywords: sp.Keywords}
	excludedCompanies := lowerSet(sp.ExcludeCompanies)
	var excludeRes []*regexp.Regexp
	for _, k := range sp.ExcludeKeywords {
		excludeRes = append(excludeRes, regexp.MustCompile(`(?i)\b`+regexp.QuoteMeta(k)+`\b`))
	}
	types := lowerSet(sp.EmploymentTypes)
	cutoff := time.Time{}
	if sp.MaxAgeDays > 0 {
		cutoff = time.Now().AddDate(0, 0, -sp.MaxAgeDays)
	}

	seen := map[string]bool{}
	var out []discovered
	for i, p := range postings {
		if i >= maxPostingsConsidered {
			break
		}
		if p.Title == "" || p.URL == "" || !isHTTPURL(p.URL) {
			continue
		}
		key := dedupeKey(p.Company, p.Title)
		if seen[key] {
			continue
		}
		if companyExcluded(p.Company, excludedCompanies) {
			continue
		}
		if matchesAny(excludeRes, p.Title) || matchesAny(excludeRes, p.Description) {
			continue
		}
		if sp.RemoteOnly && !p.IsRemote {
			continue
		}
		if !sp.RemoteOnly && len(sp.Locations) > 0 && !p.IsRemote && !locationMatches(p.Location, sp.Locations) {
			continue
		}
		if len(types) > 0 && p.EmploymentType != "" && !types[p.EmploymentType] {
			continue
		}
		if aggregatorSources[p.Source] && !cutoff.IsZero() && p.PostedAt != nil && p.PostedAt.Before(cutoff) {
			continue
		}
		relevance := q.TitleScore(p.Title)
		hits := keywordHits(p, sp.Keywords)
		if len(sp.Titles) > 0 && relevance < 0.5 && hits == 0 {
			continue
		}
		relevance += 0.1 * float64(min(hits, 5))
		// Prefer what was searched for specifically (web search costs money)
		// and what the extension can apply to without help.
		if p.Source == sources.WebSearch {
			relevance += 0.25
		}
		if sources.AutoApplySupported(p.ATS) {
			relevance += 0.15
		}
		seen[key] = true
		out = append(out, discovered{posting: p, key: key, relevance: relevance})
	}

	sort.SliceStable(out, func(i, j int) bool {
		if out[i].relevance != out[j].relevance {
			return out[i].relevance > out[j].relevance
		}
		pi, pj := out[i].posting.PostedAt, out[j].posting.PostedAt
		if pi != nil && pj != nil {
			return pi.After(*pj)
		}
		return pi != nil
	})
	return out
}

func lowerSet(v []string) map[string]bool {
	out := make(map[string]bool, len(v))
	for _, s := range v {
		out[strings.ToLower(strings.TrimSpace(s))] = true
	}
	return out
}

func companyExcluded(company string, excluded map[string]bool) bool {
	if len(excluded) == 0 {
		return false
	}
	c := strings.ToLower(strings.TrimSpace(company))
	if excluded[c] {
		return true
	}
	for e := range excluded {
		if e != "" && strings.Contains(c, e) {
			return true
		}
	}
	return false
}

func matchesAny(res []*regexp.Regexp, s string) bool {
	for _, re := range res {
		if re.MatchString(s) {
			return true
		}
	}
	return false
}

func locationMatches(location string, wanted []string) bool {
	l := strings.ToLower(location)
	if l == "" {
		return true // unknown location: let scoring decide
	}
	for _, w := range wanted {
		w = strings.ToLower(strings.TrimSpace(w))
		if w == "" {
			continue
		}
		if w == "remote" && sources.LooksRemote(l) {
			return true
		}
		if strings.Contains(l, w) {
			return true
		}
		// "Lagos, Nigeria" should match a posting in "Nigeria".
		for _, part := range strings.Split(w, ",") {
			if p := strings.TrimSpace(part); len(p) > 2 && strings.Contains(l, p) {
				return true
			}
		}
	}
	return false
}

func keywordHits(p sources.Posting, keywords []string) int {
	if len(keywords) == 0 {
		return 0
	}
	hay := strings.ToLower(p.Title + " " + strings.Join(p.Tags, " ") + " " + p.Description)
	n := 0
	for _, k := range keywords {
		k = strings.ToLower(strings.TrimSpace(k))
		if k == "" {
			continue
		}
		if regexp.MustCompile(`\b` + regexp.QuoteMeta(k) + `\b`).MatchString(hay) {
			n++
		}
	}
	return n
}

func isHTTPURL(raw string) bool {
	u, err := url.Parse(raw)
	return err == nil && (u.Scheme == "https" || u.Scheme == "http") && u.Host != ""
}

// ── Scoring ───────────────────────────────────────────────────────────────────

type scoreItem struct {
	id      string
	posting sources.Posting
	leadID  string // set when re-scoring an existing lead
}

type scoreResponse struct {
	Results []struct {
		ID          string   `json:"id"`
		Score       int      `json:"score"`
		Fit         string   `json:"fit"`
		Summary     string   `json:"summary"`
		Pros        []string `json:"pros"`
		Gaps        []string `json:"gaps"`
		Dealbreaker *string  `json:"dealbreaker"`
	} `json:"results"`
}

// scoreItems scores postings in batches on the user's fast model. The system
// prompt (instructions + candidate + preferences) is identical across
// batches, so after the first batch every call reads it from the prompt
// cache. Items whose batch fails are simply absent from the result.
func (s *Service) scoreItems(ctx context.Context, p *Profile, doc *resumeDoc, items []scoreItem) map[string]LeadScoreUpdate {
	out := map[string]LeadScoreUpdate{}
	if len(items) == 0 {
		return out
	}
	system := prompts.LeadScoringSystemPrompt(candidateBrief(doc, p.ApplicationProfile), preferencesBrief(p.SearchPrefs))

	var batches [][]scoreItem
	for i := 0; i < len(items); i += scoreBatchSize {
		batches = append(batches, items[i:min(i+scoreBatchSize, len(items))])
	}

	var mu sync.Mutex
	scoreBatch := func(batch []scoreItem) error {
		leads := make([]prompts.LeadForScoring, 0, len(batch))
		for _, it := range batch {
			leads = append(leads, prompts.LeadForScoring{
				ID: it.id, Title: it.posting.Title, Company: it.posting.Company, Location: it.posting.Location,
				Remote: it.posting.IsRemote, Employment: it.posting.EmploymentType,
				Salary: salaryText(it.posting), Description: clipText(it.posting.Description, scoringDescChars),
			})
		}
		resp, err := s.ai.Complete(ctx, ai.Request{
			UserID:        p.UserID,
			SystemPrompt:  system,
			UserMessage:   prompts.LeadScoringUserMessage(leads),
			PromptVersion: prompts.LeadScoringV1,
			Stage:         ai.StageLeadScoring,
			Tier:          ai.TierFast,
			JSONSchema:    prompts.LeadScoringSchema(),
			CacheSystem:   true,
		})
		if err != nil {
			return err
		}
		var parsed scoreResponse
		if err := json.Unmarshal([]byte(resp.Content), &parsed); err != nil {
			return fmt.Errorf("parse scores: %w", err)
		}
		mu.Lock()
		defer mu.Unlock()
		for _, r := range parsed.Results {
			out[r.ID] = LeadScoreUpdate{
				Score:       clamp(r.Score, 0, 100),
				Fit:         normalizeFit(r.Fit, r.Score),
				Summary:     clipText(r.Summary, 300),
				Pros:        capList(r.Pros, 3),
				Gaps:        capList(r.Gaps, 3),
				Dealbreaker: nonBlank(r.Dealbreaker),
			}
		}
		return nil
	}

	log := logger.FromContext(ctx).With("component", "agent", "operation", "scoreItems")
	// First batch alone so it writes the prompt cache the others then read.
	if err := scoreBatch(batches[0]); err != nil {
		log.Warn("scoring batch failed", "error", logger.TruncateError(err, 200), "error_type", ai.ClassifyError(err))
		if errors.Is(err, ai.ErrNoAPIKey) {
			return out
		}
	}
	sem := make(chan struct{}, scoreConcurrency)
	var wg sync.WaitGroup
	for _, b := range batches[1:] {
		wg.Add(1)
		go func(b []scoreItem) {
			defer wg.Done()
			sem <- struct{}{}
			defer func() { <-sem }()
			if err := scoreBatch(b); err != nil {
				log.Warn("scoring batch failed", "error", logger.TruncateError(err, 200), "error_type", ai.ClassifyError(err))
			}
		}(b)
	}
	wg.Wait()
	return out
}

func normalizeFit(fit string, score int) string {
	switch fit {
	case "strong", "good", "stretch", "poor":
		return fit
	}
	switch {
	case score >= 85:
		return "strong"
	case score >= 70:
		return "good"
	case score >= 50:
		return "stretch"
	default:
		return "poor"
	}
}

func applyScore(l *Lead, sc LeadScoreUpdate) {
	score := sc.Score
	now := time.Now()
	l.MatchScore = &score
	l.MatchFit = &sc.Fit
	l.MatchSummary = strPtr(sc.Summary)
	l.MatchPros = sc.Pros
	l.MatchGaps = sc.Gaps
	l.Dealbreaker = sc.Dealbreaker
	l.ScoredAt = &now
}

func salaryText(p sources.Posting) string {
	if p.SalaryText != "" {
		return p.SalaryText
	}
	if p.SalaryMin == nil && p.SalaryMax == nil {
		return ""
	}
	cur := p.SalaryCurrency
	if cur == "" {
		cur = "USD"
	}
	switch {
	case p.SalaryMin != nil && p.SalaryMax != nil:
		return fmt.Sprintf("%d - %d %s per year", *p.SalaryMin, *p.SalaryMax, cur)
	case p.SalaryMin != nil:
		return fmt.Sprintf("from %d %s per year", *p.SalaryMin, cur)
	default:
		return fmt.Sprintf("up to %d %s per year", *p.SalaryMax, cur)
	}
}

// ── Lead conversion ───────────────────────────────────────────────────────────

var applyEmailRe = regexp.MustCompile(`(?i)(?:send|email|e-mail|submit|forward|mail)[^.\n]{0,80}?\b([A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,})\b`)

// detectApplyEmail finds an "email your CV to x@y" instruction.
func detectApplyEmail(p sources.Posting) string {
	if strings.HasPrefix(strings.ToLower(p.ApplyURL), "mailto:") {
		addr := strings.TrimPrefix(p.ApplyURL[len("mailto:"):], "//")
		if i := strings.IndexAny(addr, "?&"); i >= 0 {
			addr = addr[:i]
		}
		return strings.ToLower(strings.TrimSpace(addr))
	}
	if sources.AutoApplySupported(p.ATS) {
		return "" // the ATS form is the better channel
	}
	m := applyEmailRe.FindStringSubmatch(p.Description)
	if len(m) == 2 {
		addr := strings.ToLower(m[1])
		for _, bad := range []string{"noreply", "no-reply", "donotreply", "privacy", "example.com"} {
			if strings.Contains(addr, bad) {
				return ""
			}
		}
		return addr
	}
	return ""
}

func leadFromPosting(userID, runID string, p sources.Posting) Lead {
	applyURL := sources.NormalizeApplyURL(firstNonEmpty(p.ApplyURL, p.URL))
	if strings.HasPrefix(strings.ToLower(applyURL), "mailto:") {
		applyURL = p.URL
	}
	ats := p.ATS
	if ats == "" {
		ats = sources.DetectATS(applyURL)
	}
	l := Lead{
		UserID:         userID,
		RunID:          &runID,
		Source:         p.Source,
		SourceLabel:    firstNonEmpty(p.SourceLabel, sourceLabel(p.Source)),
		ExternalID:     strPtr(p.ExternalID),
		DedupeKey:      dedupeKey(p.Company, p.Title),
		Title:          clipText(p.Title, 300),
		Company:        clipText(p.Company, 200),
		Location:       strPtr(clipText(p.Location, 300)),
		IsRemote:       p.IsRemote,
		EmploymentType: strPtr(p.EmploymentType),
		SalaryMin:      p.SalaryMin,
		SalaryMax:      p.SalaryMax,
		SalaryCurrency: strPtr(p.SalaryCurrency),
		SalaryText:     strPtr(clipText(p.SalaryText, 200)),
		URL:            p.URL,
		ApplyURL:       strPtr(applyURL),
		ApplyEmail:     strPtr(detectApplyEmail(p)),
		ATS:            strPtr(ats),
		Description:    p.Description,
		PostedAt:       p.PostedAt,
		Status:         LeadNew,
	}
	return l
}

// leadPosting converts a stored lead back for re-scoring.
func leadPosting(l Lead) sources.Posting {
	p := sources.Posting{
		Source: l.Source, Title: l.Title, Company: l.Company, IsRemote: l.IsRemote,
		URL: l.URL, Description: l.Description, SalaryMin: l.SalaryMin, SalaryMax: l.SalaryMax,
	}
	if l.Location != nil {
		p.Location = *l.Location
	}
	if l.EmploymentType != nil {
		p.EmploymentType = *l.EmploymentType
	}
	if l.SalaryText != nil {
		p.SalaryText = *l.SalaryText
	}
	if l.SalaryCurrency != nil {
		p.SalaryCurrency = *l.SalaryCurrency
	}
	return p
}

// ── Web search source ─────────────────────────────────────────────────────────

var webSearchBlocked = []string{"linkedin.com", "indeed.com", "glassdoor.com", "ziprecruiter.com", "monster.com"}

type webPosting struct {
	Title    string  `json:"title"`
	Company  string  `json:"company"`
	Location string  `json:"location"`
	IsRemote bool    `json:"is_remote"`
	URL      string  `json:"url"`
	ApplyURL string  `json:"apply_url"`
	PostedAt *string `json:"posted_at"`
	Summary  string  `json:"summary"`
}

func (s *Service) webSearchPostings(ctx context.Context, p *Profile, doc *resumeDoc) ([]sources.Posting, error) {
	known, _ := s.repo.RecentLeadLabels(ctx, p.UserID, 60)
	wctx, cancel := context.WithTimeout(ctx, webSearchTimeout)
	defer cancel()

	resp, err := s.ai.WebSearch(wctx, ai.WebSearchRequest{
		UserID:         p.UserID,
		SystemPrompt:   prompts.JobSearchSystemPrompt(),
		UserMessage:    prompts.JobSearchUserMessage(preferencesBrief(p.SearchPrefs), candidateBrief(doc, p.ApplicationProfile), strings.Join(known, "\n")),
		PromptVersion:  prompts.JobSearchV1,
		Stage:          ai.StageJobSearch,
		MaxSearches:    6,
		BlockedDomains: webSearchBlocked,
	})
	if err != nil {
		return nil, err
	}
	raw, ok := ai.ExtractJSON(resp.Content)
	if !ok {
		return nil, fmt.Errorf("web search returned no JSON")
	}
	var found []webPosting
	if err := json.Unmarshal([]byte(raw), &found); err != nil {
		return nil, fmt.Errorf("parse web search results: %w", err)
	}

	out := make([]sources.Posting, 0, len(found))
	for _, w := range found {
		if w.Title == "" || !isHTTPURL(w.URL) {
			continue
		}
		applyURL := w.ApplyURL
		if !isHTTPURL(applyURL) {
			applyURL = w.URL
		}
		post := sources.Posting{
			Source:      sources.WebSearch,
			SourceLabel: "Claude web search",
			ExternalID:  w.URL,
			Title:       clipText(w.Title, 300),
			Company:     clipText(w.Company, 200),
			Location:    w.Location,
			IsRemote:    w.IsRemote || sources.LooksRemote(w.Location),
			URL:         w.URL,
			ApplyURL:    applyURL,
			ATS:         sources.DetectATS(applyURL),
			Description: clipText(w.Summary, 2000),
		}
		if w.PostedAt != nil {
			if t, err := time.Parse("2006-01-02", *w.PostedAt); err == nil {
				post.PostedAt = &t
			}
		}
		out = append(out, post)
	}
	slog.Info("agent: web search postings", "count", len(out))
	return out, nil
}

// ── small helpers ─────────────────────────────────────────────────────────────

func clamp(n, lo, hi int) int {
	if n < lo {
		return lo
	}
	if n > hi {
		return hi
	}
	return n
}

func clipText(s string, n int) string {
	s = strings.TrimSpace(s)
	if len(s) <= n {
		return s
	}
	cut := n
	for cut > 0 && (s[cut]&0xC0) == 0x80 {
		cut--
	}
	return s[:cut] + "..."
}

func nonBlank(p *string) *string {
	if p == nil || strings.TrimSpace(*p) == "" {
		return nil
	}
	v := strings.TrimSpace(*p)
	return &v
}

func plural(n int) string {
	if n == 1 {
		return ""
	}
	return "s"
}

func pluralEs(n int) string {
	if n == 1 {
		return ""
	}
	return "es"
}
