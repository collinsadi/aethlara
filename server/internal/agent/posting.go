package agent

import (
	"context"
	"encoding/json"
	"html"
	"net/url"
	"regexp"
	"strings"
	"time"

	"github.com/collinsadi/aethlara/internal/agent/sources"
	"github.com/collinsadi/aethlara/internal/ai"
	"github.com/collinsadi/aethlara/internal/job"
	"github.com/collinsadi/aethlara/internal/logger"
	"github.com/collinsadi/aethlara/internal/prompts"
)

// Posting resolution: many leads arrive with a title, a company and a link
// that is not the posting itself (web search results, careers index pages,
// JavaScript-rendered pages). Before tailoring, the agent tries to recover
// the full posting, cheapest and most reliable source first:
//
//  1. ATS links go straight to the Greenhouse, Lever or Ashby API.
//  2. Pages are fetched and read for JobPosting structured data (JSON-LD),
//     embedded or linked ATS boards, and links whose text names the role.
//  3. The company's board is guessed from its name and site.
//  4. With an Anthropic key, web search looks for the posting's own URL.
//
// Every page fetch goes through job.FetchPage (HTTPS only, SSRF-safe).

const (
	postingResolveTimeout = 90 * time.Second
	// minPostingChars is the shortest description treated as a real posting.
	minPostingChars = 400
	// maxCluePages bounds page fetches per lead (resolution + contact search).
	maxCluePages = 12
	maxClueHTML  = 600 << 10
)

// resolvedPosting is the posting found for a lead.
type resolvedPosting struct {
	Title       string
	Description string
	URL         string
	ApplyURL    string
	ATS         string
	ApplyEmail  string
	Via         string // ats_api | ats_board | json_ld | link | page | guessed_board | web_search
}

// siteClues collects what the agent learned about a company while looking
// for a posting; contact discovery reuses it.
type siteClues struct {
	company string
	pages   []*job.Page
	jobPage map[string]bool // pages that are about jobs (posting, careers)
	domains []string        // the company's own website domains, best first (see addDomain)
	tried   map[string]bool
	boards  map[string]bool
	fetches int
}

func newSiteClues(company string) *siteClues {
	return &siteClues{company: company, jobPage: map[string]bool{}, tried: map[string]bool{}, boards: map[string]bool{}}
}

// addDomain records host's registrable domain as the company's site when
// the domain carries the company's name (lightning.engineering for
// Lightning Labs). Job boards, ATSs and unrelated sites a link or a page's
// structured data points at are ignored, so a planted address can never
// become the company's contact.
func (c *siteClues) addDomain(host string) {
	d := registrableDomain(host)
	if d == "" || isJobHost(d) || !domainMatchesCompany(d, c.company) {
		return
	}
	for _, have := range c.domains {
		if have == d {
			return
		}
	}
	c.domains = append(c.domains, d)
}

func (c *siteClues) addDomainFromURL(raw string) {
	if u, err := url.Parse(raw); err == nil {
		c.addDomain(u.Hostname())
	}
}

// fetchClue fetches an HTTPS page once per lead, within the page budget.
func (s *Service) fetchClue(ctx context.Context, raw string, c *siteClues, aboutJobs bool) *job.Page {
	raw = strings.TrimSpace(raw)
	if strings.HasPrefix(raw, "http://") {
		raw = "https://" + strings.TrimPrefix(raw, "http://")
	}
	if !strings.HasPrefix(raw, "https://") || c.tried[raw] || c.fetches >= maxCluePages || ctx.Err() != nil {
		return nil
	}
	c.tried[raw] = true
	c.fetches++
	page, err := s.fetchPage(ctx, raw)
	if err != nil || page == nil {
		return nil
	}
	if len(page.HTML) > maxClueHTML {
		page.HTML = page.HTML[:maxClueHTML]
	}
	c.tried[page.URL] = true
	c.pages = append(c.pages, page)
	if aboutJobs {
		c.jobPage[page.URL] = true
	}
	c.addDomainFromURL(page.URL)
	return page
}

// needsResolution reports whether a lead's description is too thin to
// tailor against. Web search leads only carry a one-line summary.
func needsResolution(l *Lead) bool {
	return l.Source == sources.WebSearch || len(strings.TrimSpace(l.Description)) < thinDescriptionChars
}

// resolvePosting looks for the full posting behind a lead. It returns nil
// when nothing better was found; the clues are returned either way.
func (s *Service) resolvePosting(ctx context.Context, userID string, lead *Lead) (*resolvedPosting, *siteClues) {
	ctx, cancel := context.WithTimeout(ctx, postingResolveTimeout)
	defer cancel()
	c := newSiteClues(lead.Company)
	start := []string{lead.URL}
	if lead.ApplyURL != nil && *lead.ApplyURL != "" && *lead.ApplyURL != lead.URL {
		start = append(start, *lead.ApplyURL)
	}
	for _, u := range start {
		c.addDomainFromURL(u)
	}

	if rp := s.resolveFromURLs(ctx, lead, start, c, true); rp != nil {
		return rp, c
	}

	// The company's own board, guessed from its name and website. Guessed
	// boards need a near-exact title (and, on Greenhouse, the same company).
	for _, slug := range sources.GuessBoardSlugs(lead.Company, c.domains) {
		for _, ats := range []string{sources.ATSAshby, sources.ATSGreenhouse, sources.ATSLever} {
			if rp := s.matchOnBoard(ctx, sources.ATSRef{ATS: ats, Slug: slug}, lead, 1, c, true); rp != nil {
				rp.Via = "guessed_board"
				return rp, c
			}
		}
	}

	if s.ai.SupportsWebSearch(ctx, userID) {
		if found := s.searchPostingURL(ctx, userID, lead); found != "" && !c.tried[found] {
			c.addDomainFromURL(found)
			if rp := s.resolveFromURLs(ctx, lead, []string{found}, c, false); rp != nil {
				rp.Via = "web_search"
				return rp, c
			}
		}
	}
	return nil, c
}

func (s *Service) resolveFromURLs(ctx context.Context, lead *Lead, urls []string, c *siteClues, followLinks bool) *resolvedPosting {
	for _, u := range urls {
		if !isHTTPURL(u) || ctx.Err() != nil {
			continue
		}
		if ref, ok := sources.ParseATSURL(u); ok {
			if rp := s.fromATSRef(ctx, ref, lead, c); rp != nil {
				return rp
			}
			continue
		}
		if page := s.fetchClue(ctx, u, c, true); page != nil {
			if rp := s.resolveFromPage(ctx, lead, page, c, followLinks); rp != nil {
				return rp
			}
		}
	}
	return nil
}

// fromATSRef reads a posting link through the ATS API, falling back to a
// title search on its board when the posting is gone or is another role.
func (s *Service) fromATSRef(ctx context.Context, ref sources.ATSRef, lead *Lead, c *siteClues) *resolvedPosting {
	if ref.ID != "" {
		p, err := sources.FetchATSPosting(ctx, s.fetcher, ref)
		if err == nil && p != nil && len(p.Description) >= minPostingChars && sameOrUnknownRole(lead.Title, p.Title) {
			return postingFrom(*p, lead, "ats_api")
		}
	}
	if rp := s.matchOnBoard(ctx, ref.Board(), lead, 2, c, false); rp != nil {
		rp.Via = "ats_board"
		return rp
	}
	return nil
}

// matchOnBoard finds the lead's role on one board.
func (s *Service) matchOnBoard(ctx context.Context, board sources.ATSRef, lead *Lead, maxExtra int, c *siteClues, guessed bool) *resolvedPosting {
	key := board.ATS + ":" + strings.ToLower(board.Slug)
	if c.boards[key] || len(c.boards) >= 18 || ctx.Err() != nil {
		return nil
	}
	c.boards[key] = true
	p, err := sources.FindOnBoard(ctx, s.fetcher, board, lead.Title, maxExtra)
	if err != nil || p == nil || len(p.Description) < minPostingChars {
		return nil
	}
	if guessed && board.ATS == sources.ATSGreenhouse {
		if name := sources.GreenhouseBoardName(ctx, s.fetcher, board.Slug); name != "" && !sameCompany(name, lead.Company) {
			return nil
		}
	}
	return postingFrom(*p, lead, "ats_board")
}

func (s *Service) resolveFromPage(ctx context.Context, lead *Lead, page *job.Page, c *siteClues, followLinks bool) *resolvedPosting {
	// 1. Structured data published for search engines.
	postings := jobPostingsFromJSONLD(page.HTML)
	for _, jp := range postings {
		for _, site := range jp.orgSites {
			c.addDomainFromURL(site)
		}
	}
	if i := pickJSONLDPosting(lead.Title, postings); i >= 0 && len(postings[i].description) >= minPostingChars {
		jp := postings[i]
		link := firstNonEmpty(absURL(page.URL, jp.url), page.URL)
		return &resolvedPosting{
			Title: firstNonEmpty(jp.title, lead.Title), Description: clipText(jp.description, 20000),
			URL: link, ApplyURL: link, ATS: sources.DetectATS(link), Via: "json_ld",
		}
	}

	// 2. ATS boards and postings the page embeds or links to.
	refs := sources.FindATSRefs(page.HTML)
	if id := ghJobID(page.URL); id != "" {
		for _, r := range refs {
			if r.ATS == sources.ATSGreenhouse {
				if rp := s.fromATSRef(ctx, sources.ATSRef{ATS: r.ATS, Slug: r.Slug, ID: id}, lead, c); rp != nil {
					return rp
				}
			}
		}
	}
	boardsTried, postingsTried := 0, 0
	for _, r := range refs {
		switch {
		case r.ID == "" && boardsTried < 3:
			boardsTried++
			if rp := s.matchOnBoard(ctx, r, lead, 2, c, false); rp != nil {
				return rp
			}
		case r.ID != "" && postingsTried < 3:
			postingsTried++
			if p, err := sources.FetchATSPosting(ctx, s.fetcher, r); err == nil && p != nil && len(p.Description) >= minPostingChars {
				if ok, _ := sources.SameRole(lead.Title, p.Title, 3); ok {
					return postingFrom(*p, lead, "ats_api")
				}
			}
		}
	}

	// 3. One hop through links whose text names the role.
	if followLinks {
		for _, link := range roleLinks(page, lead.Title, 2) {
			if ref, ok := sources.ParseATSURL(link); ok {
				if rp := s.fromATSRef(ctx, ref, lead, c); rp != nil {
					rp.Via = "link"
					return rp
				}
				continue
			}
			if next := s.fetchClue(ctx, link, c, true); next != nil {
				if rp := s.resolveFromPage(ctx, lead, next, c, false); rp != nil {
					if rp.Via == "page" {
						rp.Via = "link"
					}
					return rp
				}
			}
		}
	}

	// 4. The page itself reads like the posting (not a list of openings).
	text := job.SanitizeText(page.HTML)
	if len(text) >= 1500 && mentionsRole(text, lead.Title) && jobLinkCount(page) < 6 {
		return &resolvedPosting{Title: lead.Title, Description: clipText(text, 20000), URL: page.URL,
			ApplyURL: page.URL, ATS: sources.DetectATS(page.URL), Via: "page"}
	}
	return nil
}

func postingFrom(p sources.Posting, lead *Lead, via string) *resolvedPosting {
	return &resolvedPosting{
		Title: firstNonEmpty(p.Title, lead.Title), Description: clipText(p.Description, 20000),
		URL: firstNonEmpty(p.URL, lead.URL), ApplyURL: firstNonEmpty(p.ApplyURL, p.URL),
		ATS: firstNonEmpty(p.ATS, sources.DetectATS(p.ApplyURL)), ApplyEmail: p.ApplyEmail, Via: via,
	}
}

// sameOrUnknownRole accepts a posting a link points at directly unless its
// title is clearly another role.
func sameOrUnknownRole(want, got string) bool {
	if strings.TrimSpace(want) == "" || strings.TrimSpace(got) == "" {
		return true
	}
	if ok, _ := sources.SameRole(want, got, 4); ok {
		return true
	}
	if ok, _ := sources.SameRole(got, want, 4); ok {
		return true
	}
	return sources.RoleOverlap(want, got) >= 0.6
}

// mentionsRole reports whether every word of the title occurs in text.
func mentionsRole(text, title string) bool {
	ok, _ := sources.SameRole(title, text, 1<<30)
	return ok
}

// sameCompany compares company names loosely ("Ondo Finance" ~ "Ondo").
func sameCompany(a, b string) bool {
	na, nb := sources.Tokens(a), sources.Tokens(b)
	if len(na) == 0 || len(nb) == 0 {
		return false
	}
	if len(na) > len(nb) {
		na, nb = nb, na
	}
	have := map[string]bool{}
	for _, t := range nb {
		have[t] = true
	}
	for _, t := range na {
		if !have[t] {
			return false
		}
	}
	return true
}

// ── JSON-LD ───────────────────────────────────────────────────────────────────

var ldJSONRe = regexp.MustCompile(`(?is)<script[^>]+type\s*=\s*["']application/ld\+json["'][^>]*>(.*?)</script>`)

type ldPosting struct {
	title, description, url string
	orgSites                []string
}

// jobPostingsFromJSONLD extracts schema.org JobPosting objects, which most
// careers sites and ATS pages publish for Google Jobs even when the page
// itself is rendered by JavaScript.
func jobPostingsFromJSONLD(pageHTML string) []ldPosting {
	var out []ldPosting
	for _, m := range ldJSONRe.FindAllStringSubmatch(pageHTML, 20) {
		var v any
		if json.Unmarshal([]byte(strings.TrimSpace(m[1])), &v) != nil {
			continue
		}
		walkJSONLD(v, 0, &out)
	}
	return out
}

func walkJSONLD(v any, depth int, out *[]ldPosting) {
	if depth > 4 || len(*out) >= 200 {
		return
	}
	switch t := v.(type) {
	case []any:
		for _, e := range t {
			walkJSONLD(e, depth+1, out)
		}
	case map[string]any:
		if hasLDType(t["@type"], "JobPosting") {
			p := ldPosting{
				title:       sources.CleanText(ldString(t["title"])),
				description: sources.HTMLToText(ldString(t["description"])),
				url:         ldString(t["url"]),
			}
			if org, ok := t["hiringOrganization"].(map[string]any); ok {
				p.orgSites = append(p.orgSites, ldString(org["url"]), ldString(org["sameAs"]))
			}
			*out = append(*out, p)
			return
		}
		for _, k := range []string{"@graph", "itemListElement", "item", "mainEntity"} {
			if child, ok := t[k]; ok {
				walkJSONLD(child, depth+1, out)
			}
		}
	}
}

func hasLDType(v any, want string) bool {
	switch t := v.(type) {
	case string:
		return strings.EqualFold(t, want)
	case []any:
		for _, e := range t {
			if s, ok := e.(string); ok && strings.EqualFold(s, want) {
				return true
			}
		}
	}
	return false
}

func ldString(v any) string {
	switch t := v.(type) {
	case string:
		return strings.TrimSpace(t)
	case []any:
		if len(t) > 0 {
			return ldString(t[0])
		}
	case map[string]any:
		return ldString(t["@id"])
	}
	return ""
}

// pickJSONLDPosting chooses the posting for the role: the only one on the
// page when its title fits, otherwise the closest title match.
func pickJSONLDPosting(title string, ps []ldPosting) int {
	if len(ps) == 1 && sameOrUnknownRole(title, ps[0].title) {
		return 0
	}
	best, bestExtra := -1, 3
	for i, p := range ps {
		if ok, extra := sources.SameRole(title, p.title, 2); ok && extra < bestExtra {
			best, bestExtra = i, extra
		}
	}
	return best
}

// ── Links ─────────────────────────────────────────────────────────────────────

var (
	anchorRe   = regexp.MustCompile(`(?is)<a\b[^>]*?\bhref\s*=\s*["']([^"']+)["'][^>]*>(.*?)</a>`)
	tagStripRe = regexp.MustCompile(`<[^>]*>`)
	jobWordRe  = regexp.MustCompile(`(?i)\b(engineer|developer|manager|designer|analyst|scientist|specialist|director|architect|lead|head of|intern|associate|recruiter|consultant)\b`)
)

type pageLink struct{ href, text string }

func pageLinks(page *job.Page) []pageLink {
	var out []pageLink
	for _, m := range anchorRe.FindAllStringSubmatch(page.HTML, 2000) {
		href := absURL(page.URL, html.UnescapeString(strings.TrimSpace(m[1])))
		if href == "" {
			continue
		}
		text := strings.Join(strings.Fields(html.UnescapeString(tagStripRe.ReplaceAllString(m[2], " "))), " ")
		out = append(out, pageLink{href: href, text: text})
	}
	return out
}

// roleLinks returns up to n links whose text names the role, closest first.
func roleLinks(page *job.Page, title string, n int) []string {
	type cand struct {
		href  string
		extra int
	}
	var cs []cand
	seen := map[string]bool{}
	for _, l := range pageLinks(page) {
		if seen[l.href] || l.href == page.URL || len(l.text) > 200 {
			continue
		}
		if ok, extra := sources.SameRole(title, l.text, 4); ok {
			seen[l.href] = true
			cs = append(cs, cand{l.href, extra})
		}
	}
	for i := 1; i < len(cs); i++ { // insertion sort: tiny lists
		for j := i; j > 0 && cs[j].extra < cs[j-1].extra; j-- {
			cs[j], cs[j-1] = cs[j-1], cs[j]
		}
	}
	var out []string
	for _, c := range cs {
		if len(out) == n {
			break
		}
		out = append(out, c.href)
	}
	return out
}

// jobLinkCount counts links that look like openings; an index page has many.
func jobLinkCount(page *job.Page) int {
	n := 0
	for _, l := range pageLinks(page) {
		if len(l.text) < 120 && jobWordRe.MatchString(l.text) {
			n++
		}
	}
	return n
}

func absURL(base, ref string) string {
	ref = strings.TrimSpace(ref)
	if ref == "" || strings.HasPrefix(ref, "#") || strings.HasPrefix(strings.ToLower(ref), "javascript:") || strings.HasPrefix(strings.ToLower(ref), "mailto:") {
		return ""
	}
	b, err := url.Parse(base)
	if err != nil {
		return ""
	}
	r, err := url.Parse(ref)
	if err != nil {
		return ""
	}
	u := b.ResolveReference(r)
	if u.Scheme != "https" && u.Scheme != "http" {
		return ""
	}
	u.Fragment = ""
	return u.String()
}

func ghJobID(raw string) string {
	u, err := url.Parse(raw)
	if err != nil {
		return ""
	}
	id := u.Query().Get("gh_jid")
	for _, r := range id {
		if r < '0' || r > '9' {
			return ""
		}
	}
	return id
}

// ── Domains ───────────────────────────────────────────────────────────────────

// jobHostSuffixes are ATS, job board, aggregator and social domains: never
// a company's own website.
var jobHostSuffixes = []string{
	"greenhouse.io", "lever.co", "ashbyhq.com", "workable.com", "smartrecruiters.com", "myworkdayjobs.com",
	"myworkdaysite.com", "bamboohr.com", "recruitee.com", "breezy.hr", "applytojob.com", "teamtailor.com",
	"personio.com", "personio.de", "icims.com", "taleo.net", "jobvite.com", "rippling.com", "dover.com",
	"linkedin.com", "indeed.com", "glassdoor.com", "ziprecruiter.com", "monster.com", "wellfound.com",
	"angel.co", "remoteok.com", "remoteok.io", "remotive.com", "himalayas.app", "jobicy.com", "arbeitnow.com",
	"weworkremotely.com", "workatastartup.com", "ycombinator.com", "builtin.com", "dice.com", "otta.com",
	"welcometothejungle.com", "cryptojobslist.com", "web3.career", "cryptocurrencyjobs.co", "google.com",
	"github.com", "notion.site", "notion.so", "twitter.com", "x.com", "facebook.com", "instagram.com",
	"youtube.com", "medium.com", "crunchbase.com", "wikipedia.org",
}

// domainMatchesCompany reports whether a registrable domain carries the
// company's name: its first label equals the name with spaces removed, or
// starts with one of the name's words ("ondo.finance" ~ "Ondo Finance",
// "coinmarketcap.com" ~ "CoinMarketCap", "proton.ch" ~ "Proton AG").
func domainMatchesCompany(domain, company string) bool {
	label, _, _ := strings.Cut(domain, ".")
	label = strings.ToLower(label)
	words := sources.Tokens(company)
	if len(label) < 2 || len(words) == 0 {
		return false
	}
	if label == strings.Join(words, "") {
		return true
	}
	for _, w := range words {
		if len(w) >= 3 && strings.HasPrefix(label, w) {
			return true
		}
	}
	return false
}

func isJobHost(domain string) bool {
	for _, s := range jobHostSuffixes {
		if domain == s || strings.HasSuffix(domain, "."+s) {
			return true
		}
	}
	return false
}

// registrableDomain approximates the registrable domain of host
// ("careers.acme.co.uk" -> "acme.co.uk") without a public suffix list.
func registrableDomain(host string) string {
	host = strings.TrimSuffix(strings.ToLower(strings.TrimSpace(host)), ".")
	if host == "" || strings.Count(host, ".") == 0 || strings.ContainsAny(host, ":/") {
		return ""
	}
	labels := strings.Split(host, ".")
	n := 2
	if len(labels) >= 3 {
		sld, tld := labels[len(labels)-2], labels[len(labels)-1]
		switch sld {
		case "co", "com", "org", "net", "ac", "gov", "edu", "ltd", "plc", "or", "ne":
			if len(tld) == 2 {
				n = 3
			}
		}
	}
	if len(labels) < n {
		return ""
	}
	return strings.Join(labels[len(labels)-n:], ".")
}

// ── Web search ────────────────────────────────────────────────────────────────

// searchPostingURL asks web search for the posting's own page.
func (s *Service) searchPostingURL(ctx context.Context, userID string, lead *Lead) string {
	resp, err := s.ai.WebSearch(ctx, ai.WebSearchRequest{
		UserID:         userID,
		SystemPrompt:   prompts.PostingSearchSystemPrompt(),
		UserMessage:    prompts.PostingSearchUserMessage(lead.Title, lead.Company, lead.URL),
		PromptVersion:  prompts.PostingSearchV1,
		Stage:          ai.StagePostingSearch,
		MaxSearches:    3,
		BlockedDomains: webSearchBlocked,
		MaxTokens:      2048,
	})
	if err != nil {
		logger.FromContext(ctx).Warn("posting search failed", "component", "agent", "error", logger.TruncateError(err, 200))
		return ""
	}
	raw, ok := ai.ExtractJSON(resp.Content)
	if !ok {
		return ""
	}
	var out struct {
		URL    string `json:"url"`
		Status string `json:"status"`
	}
	if json.Unmarshal([]byte(raw), &out) != nil || out.Status != "open" || !isHTTPURL(out.URL) {
		return ""
	}
	return out.URL
}
