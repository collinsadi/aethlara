package agent

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"regexp"
	"strings"
	"sync"
	"time"
	"unicode"

	"github.com/collinsadi/aethlara/internal/agent/sources"
	"github.com/collinsadi/aethlara/internal/ai"
	"github.com/collinsadi/aethlara/internal/config"
	"github.com/collinsadi/aethlara/internal/email"
	"github.com/collinsadi/aethlara/internal/job"
	"github.com/collinsadi/aethlara/internal/storage"
)

// Service runs the autopilot.
type Service struct {
	repo      *Repository
	jobs      job.Service
	ai        *ai.Client
	mail      *email.Client // platform sender: digests and alerts to the user
	agentMail *email.Client // agent domain: applications and received mail
	r2        *storage.R2Client
	cfg       *config.Config
	fetcher   *sources.Fetcher
	sources   map[string]sources.Source

	// fetchPage and lookupMX reach the internet; tests replace them.
	fetchPage func(ctx context.Context, rawURL string) (*job.Page, error)
	lookupMX  func(ctx context.Context, domain string) bool

	runSem   chan struct{}
	triageCh chan struct{}
	wg       sync.WaitGroup
}

func NewService(repo *Repository, jobs job.Service, aiClient *ai.Client, mail, agentMail *email.Client, r2 *storage.R2Client, cfg *config.Config) *Service {
	fetcher := sources.NewFetcher(time.Duration(cfg.AgentSourceCacheMinutes) * time.Minute)
	maxRuns := cfg.AgentMaxConcurrentRuns
	if maxRuns <= 0 {
		maxRuns = 1
	}
	return &Service{
		repo:      repo,
		jobs:      jobs,
		ai:        aiClient,
		mail:      mail,
		agentMail: agentMail,
		r2:        r2,
		cfg:       cfg,
		fetcher:   fetcher,
		sources:   sources.New(fetcher),
		runSem:    make(chan struct{}, maxRuns),
		triageCh:  make(chan struct{}, 1),
		fetchPage: func(ctx context.Context, rawURL string) (*job.Page, error) {
			return job.FetchPage(ctx, rawURL, cfg)
		},
		lookupMX: hasMX,
	}
}

// ── Defaults ──────────────────────────────────────────────────────────────────

func defaultApplySettings() ApplySettings {
	return ApplySettings{
		AutoSubmit:        true,
		DailyLimit:        15,
		CoverLetters:      true,
		DigestEmails:      true,
		ImportantAlerts:   true,
		ColdEmailFallback: true,
	}
}

func defaultSearchPrefs(d *resumeDoc) SearchPrefs {
	enabled := map[string]bool{}
	for _, info := range sources.Catalog() {
		enabled[info.ID] = sources.DefaultEnabled(info.ID)
	}
	sp := SearchPrefs{
		MaxAgeDays: 30,
		MinScore:   60,
		Sources:    enabled,
		Watchlist:  sources.StarterWatchlist(),
	}
	if d != nil {
		if d.Meta.PrimaryRole != "" {
			sp.Titles = append(sp.Titles, d.Meta.PrimaryRole)
		}
		if len(d.Experience) > 0 && d.Experience[0].Title != "" &&
			!strings.EqualFold(d.Experience[0].Title, d.Meta.PrimaryRole) {
			sp.Titles = append(sp.Titles, d.Experience[0].Title)
		}
		sp.Keywords = capList(d.Skills.Technical, 6)
		switch d.Meta.SeniorityLevel {
		case "junior":
			sp.Seniority = []string{"entry", "mid"}
		case "mid":
			sp.Seniority = []string{"mid", "senior"}
		case "senior", "lead", "principal":
			sp.Seniority = []string{"senior", "lead"}
		}
	}
	return sp
}

func defaultApplicationProfile(user *UserBasics, d *resumeDoc) ApplicationProfile {
	ap := ApplicationProfile{FullName: user.FullName, HowDidYouHear: "Company website"}
	if d != nil {
		ap.Phone = d.Personal.Phone
		ap.LinkedIn = d.Personal.LinkedIn
		ap.GitHub = d.Personal.GitHub
		ap.Portfolio = d.Personal.Portfolio
		if len(d.Experience) > 0 {
			ap.Location = d.Experience[0].Location
		}
		if y := d.Meta.TotalYearsExperience; y > 0 {
			n := int(y + 0.5)
			ap.YearsOfExperience = &n
		}
	}
	return ap
}

// ── Profile ───────────────────────────────────────────────────────────────────

// EnsureProfile returns the user's agent profile, creating one with
// defaults derived from their latest resume on first use.
func (s *Service) EnsureProfile(ctx context.Context, userID string) (*Profile, error) {
	p, err := s.repo.GetProfile(ctx, userID)
	if err != nil {
		return nil, ErrInternal
	}
	if p != nil {
		if p.MailboxAddress == nil && s.cfg.AgentMailDomain != "" {
			s.backfillMailbox(ctx, p)
		}
		return p, nil
	}

	user, err := s.repo.GetUserBasics(ctx, userID)
	if err != nil || user == nil {
		return nil, ErrInternal
	}
	resume, err := s.repo.LatestResume(ctx, userID)
	if err != nil {
		return nil, ErrInternal
	}
	var doc *resumeDoc
	var resumeID *string
	if resume != nil {
		doc = parseResume(resume.ExtractedJSON)
		resumeID = &resume.ID
	}

	np := Profile{
		UserID:             userID,
		ResumeID:           resumeID,
		SearchPrefs:        defaultSearchPrefs(doc),
		ApplicationProfile: defaultApplicationProfile(user, doc),
		ApplySettings:      defaultApplySettings(),
		RunIntervalHours:   24,
	}
	for attempt := 0; attempt < 5; attempt++ {
		if s.cfg.AgentMailDomain != "" {
			addr := s.suggestMailbox(user.FullName, attempt)
			np.MailboxAddress = &addr
		}
		created, err := s.repo.CreateProfile(ctx, np)
		if errors.Is(err, ErrMailboxTaken) {
			continue
		}
		if err != nil {
			slog.Error("agent: create profile failed", "user_id", userID, "error", err)
			return nil, ErrInternal
		}
		return created, nil
	}
	return nil, ErrInternal
}

// backfillMailbox gives profiles created before AGENT_MAIL_DOMAIN was set
// their agent address. Best effort: on failure the profile keeps using the
// account email.
func (s *Service) backfillMailbox(ctx context.Context, p *Profile) {
	user, err := s.repo.GetUserBasics(ctx, p.UserID)
	if err != nil || user == nil {
		return
	}
	for attempt := 0; attempt < 5; attempt++ {
		addr := s.suggestMailbox(user.FullName, attempt)
		taken, err := s.repo.MailboxTaken(ctx, addr, p.UserID)
		if err != nil {
			return
		}
		if taken {
			continue
		}
		p.MailboxAddress = &addr
		if updated, err := s.repo.UpdateProfile(ctx, *p); err == nil && updated != nil {
			*p = *updated
		} else {
			p.MailboxAddress = nil
		}
		return
	}
}

// ProfileUpdate is a full replacement of the user-editable profile fields.
// Nil fields are left unchanged.
type ProfileUpdate struct {
	Enabled            *bool
	ResumeID           *string
	MailboxLocalPart   *string
	SearchPrefs        *SearchPrefs
	ApplicationProfile *ApplicationProfile
	// ApplySettingsPatch is a JSON object merged over the current apply
	// settings: keys it omits keep their values, so clients that predate a
	// setting cannot reset it.
	ApplySettingsPatch json.RawMessage
	RunIntervalHours   *int
}

var mailboxLocalRe = regexp.MustCompile(`^[a-z0-9](?:[a-z0-9._-]{0,38}[a-z0-9])?$`)

func (s *Service) UpdateProfile(ctx context.Context, userID string, u ProfileUpdate) (*Profile, error) {
	p, err := s.EnsureProfile(ctx, userID)
	if err != nil {
		return nil, err
	}

	if u.ResumeID != nil {
		r, err := s.repo.GetResume(ctx, userID, *u.ResumeID)
		if err != nil {
			return nil, ErrInternal
		}
		if r == nil || r.ExtractionStatus != "completed" {
			return nil, fmt.Errorf("%w: resume not found or not processed", ErrInvalidInput)
		}
		p.ResumeID = &r.ID
	}
	if u.MailboxLocalPart != nil {
		if s.cfg.AgentMailDomain == "" {
			return nil, ErrMailboxOff
		}
		local := strings.ToLower(strings.TrimSpace(*u.MailboxLocalPart))
		if !mailboxLocalRe.MatchString(local) {
			return nil, fmt.Errorf("%w: mailbox name must be 1-40 characters of a-z, 0-9, '.', '_' or '-'", ErrInvalidInput)
		}
		addr := local + "@" + s.cfg.AgentMailDomain
		taken, err := s.repo.MailboxTaken(ctx, addr, userID)
		if err != nil {
			return nil, ErrInternal
		}
		if taken {
			return nil, ErrMailboxTaken
		}
		p.MailboxAddress = &addr
	}
	if u.SearchPrefs != nil {
		sp, err := sanitizeSearchPrefs(*u.SearchPrefs)
		if err != nil {
			return nil, err
		}
		p.SearchPrefs = sp
	}
	if u.ApplicationProfile != nil {
		p.ApplicationProfile = sanitizeApplicationProfile(*u.ApplicationProfile)
	}
	if len(u.ApplySettingsPatch) > 0 && string(u.ApplySettingsPatch) != "null" {
		as := p.ApplySettings
		if err := json.Unmarshal(u.ApplySettingsPatch, &as); err != nil {
			return nil, fmt.Errorf("%w: apply_settings must be an object", ErrInvalidInput)
		}
		if as.DailyLimit < 1 || as.DailyLimit > 100 {
			return nil, fmt.Errorf("%w: daily_limit must be between 1 and 100", ErrInvalidInput)
		}
		if as.AutoApproveScore != nil && (*as.AutoApproveScore < 50 || *as.AutoApproveScore > 100) {
			return nil, fmt.Errorf("%w: auto_approve_score must be between 50 and 100", ErrInvalidInput)
		}
		p.ApplySettings = as
	}
	if u.RunIntervalHours != nil {
		h := *u.RunIntervalHours
		if h < 1 || h > 168 {
			return nil, fmt.Errorf("%w: run_interval_hours must be between 1 and 168", ErrInvalidInput)
		}
		if h != p.RunIntervalHours && p.NextRunAt != nil {
			next := time.Now().Add(time.Duration(h) * time.Hour)
			if next.Before(*p.NextRunAt) {
				p.NextRunAt = &next
			}
		}
		p.RunIntervalHours = h
	}
	if u.Enabled != nil {
		if *u.Enabled && !p.Enabled {
			if p.ResumeID == nil {
				return nil, ErrNoResume
			}
			if len(p.SearchPrefs.Titles) == 0 && len(p.SearchPrefs.Keywords) == 0 {
				return nil, fmt.Errorf("%w: add at least one target title or keyword before enabling autopilot", ErrInvalidInput)
			}
			// First scheduled run happens right away.
			now := time.Now()
			p.NextRunAt = &now
		}
		p.Enabled = *u.Enabled
	}

	updated, err := s.repo.UpdateProfile(ctx, *p)
	if errors.Is(err, ErrMailboxTaken) {
		return nil, ErrMailboxTaken
	}
	if err != nil || updated == nil {
		slog.Error("agent: update profile failed", "user_id", userID, "error", err)
		return nil, ErrInternal
	}
	return updated, nil
}

func cleanList(in []string, maxItems, maxLen int) []string {
	seen := map[string]bool{}
	out := make([]string, 0, len(in))
	for _, v := range in {
		v = strings.TrimSpace(v)
		if v == "" || len(v) > maxLen {
			continue
		}
		k := strings.ToLower(v)
		if seen[k] {
			continue
		}
		seen[k] = true
		out = append(out, v)
		if len(out) == maxItems {
			break
		}
	}
	return out
}

var slugRe = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$`)

func sanitizeSearchPrefs(sp SearchPrefs) (SearchPrefs, error) {
	sp.Titles = cleanList(sp.Titles, 10, 100)
	sp.Keywords = cleanList(sp.Keywords, 20, 60)
	sp.ExcludeKeywords = cleanList(sp.ExcludeKeywords, 30, 60)
	sp.Locations = cleanList(sp.Locations, 15, 100)
	sp.ExcludeCompanies = cleanList(sp.ExcludeCompanies, 100, 100)

	validSeniority := map[string]bool{"entry": true, "mid": true, "senior": true, "lead": true, "executive": true}
	var seniority []string
	for _, v := range cleanList(sp.Seniority, 5, 20) {
		if validSeniority[strings.ToLower(v)] {
			seniority = append(seniority, strings.ToLower(v))
		}
	}
	sp.Seniority = seniority

	validTypes := map[string]bool{"full_time": true, "part_time": true, "contract": true, "freelance": true, "internship": true, "temporary": true}
	var types []string
	for _, v := range cleanList(sp.EmploymentTypes, 6, 20) {
		if validTypes[strings.ToLower(v)] {
			types = append(types, strings.ToLower(v))
		}
	}
	sp.EmploymentTypes = types

	if sp.MinSalary != nil && (*sp.MinSalary < 0 || *sp.MinSalary > 10_000_000) {
		return sp, fmt.Errorf("%w: min_salary out of range", ErrInvalidInput)
	}
	if len(sp.SalaryCurrency) > 3 {
		return sp, fmt.Errorf("%w: salary_currency must be a 3-letter code", ErrInvalidInput)
	}
	sp.SalaryCurrency = strings.ToUpper(sp.SalaryCurrency)
	if sp.MaxAgeDays < 0 || sp.MaxAgeDays > 365 {
		return sp, fmt.Errorf("%w: max_age_days must be between 0 and 365", ErrInvalidInput)
	}
	if sp.MinScore < 0 || sp.MinScore > 100 {
		return sp, fmt.Errorf("%w: min_score must be between 0 and 100", ErrInvalidInput)
	}

	known := map[string]bool{}
	for _, info := range sources.Catalog() {
		known[info.ID] = true
	}
	srcs := map[string]bool{}
	for id, on := range sp.Sources {
		if known[id] {
			srcs[id] = on
		}
	}
	sp.Sources = srcs

	var watch []sources.CompanyRef
	seen := map[string]bool{}
	for _, c := range sp.Watchlist {
		c.ATS = strings.ToLower(strings.TrimSpace(c.ATS))
		c.Slug = strings.TrimSpace(c.Slug)
		c.Name = strings.TrimSpace(c.Name)
		if c.ATS != sources.ATSGreenhouse && c.ATS != sources.ATSLever && c.ATS != sources.ATSAshby {
			return sp, fmt.Errorf("%w: watchlist ats must be greenhouse, lever or ashby", ErrInvalidInput)
		}
		if !slugRe.MatchString(c.Slug) {
			return sp, fmt.Errorf("%w: invalid board slug %q", ErrInvalidInput, c.Slug)
		}
		if len(c.Name) > 100 {
			c.Name = c.Name[:100]
		}
		k := c.ATS + ":" + strings.ToLower(c.Slug)
		if seen[k] {
			continue
		}
		seen[k] = true
		watch = append(watch, c)
		if len(watch) == 200 {
			break
		}
	}
	sp.Watchlist = watch
	return sp, nil
}

func sanitizeApplicationProfile(ap ApplicationProfile) ApplicationProfile {
	trim := func(s *string, n int) {
		*s = strings.TrimSpace(*s)
		if len(*s) > n {
			*s = (*s)[:n]
		}
	}
	for _, f := range []*string{&ap.FullName, &ap.Phone, &ap.Location, &ap.Country, &ap.LinkedIn, &ap.GitHub,
		&ap.Portfolio, &ap.Website, &ap.NoticePeriod, &ap.EarliestStartDate, &ap.SalaryExpectation,
		&ap.Pronouns, &ap.HowDidYouHear, &ap.EEO.Gender, &ap.EEO.Race, &ap.EEO.Veteran, &ap.EEO.Disability,
		&ap.EEO.SexualOrientation} {
		trim(f, 200)
	}
	trim(&ap.WorkAuthorization, 500)
	trim(&ap.AdditionalInfo, 2000)
	if ap.YearsOfExperience != nil && (*ap.YearsOfExperience < 0 || *ap.YearsOfExperience > 60) {
		ap.YearsOfExperience = nil
	}
	return ap
}

// suggestMailbox derives "first.last" from the account name, with a numeric
// suffix on later attempts.
func (s *Service) suggestMailbox(fullName string, attempt int) string {
	var parts []string
	for _, w := range strings.Fields(strings.ToLower(fullName)) {
		var b strings.Builder
		for _, r := range w {
			if r < unicode.MaxASCII && (unicode.IsLetter(r) || unicode.IsDigit(r)) {
				b.WriteRune(r)
			}
		}
		if b.Len() > 0 {
			parts = append(parts, b.String())
		}
		if len(parts) == 2 {
			break
		}
	}
	local := strings.Join(parts, ".")
	if local == "" {
		local = "agent"
	}
	if len(local) > 30 {
		local = local[:30]
	}
	if attempt > 0 {
		local = fmt.Sprintf("%s%d", local, attempt+1)
	}
	return local + "@" + s.cfg.AgentMailDomain
}

// ── Overview ──────────────────────────────────────────────────────────────────

// Setup is the onboarding checklist.
type Setup struct {
	AIProvider         string
	HasAIKey           bool
	WebSearchAvailable bool
	HasResume          bool
	HasPreferences     bool
	MailboxEnabled     bool
	InboundEnabled     bool
	ExtensionConnected bool
}

// Overview is the autopilot home screen.
type Overview struct {
	Profile         *Profile
	Setup           Setup
	Leads           map[string]int
	Applications    map[string]int
	UnreadImportant int
	SubmittedToday  int
	RunningRun      *Run
	LastRun         *Run
	RecentEvents    []Event
}

func (s *Service) Overview(ctx context.Context, userID string) (*Overview, error) {
	p, err := s.EnsureProfile(ctx, userID)
	if err != nil {
		return nil, err
	}
	o := &Overview{Profile: p}

	if provider, err := s.ai.ActiveProvider(ctx, userID); err == nil {
		o.Setup.HasAIKey = true
		o.Setup.AIProvider = string(provider)
		o.Setup.WebSearchAvailable = provider == ai.ProviderAnthropic
	}
	o.Setup.HasResume = p.ResumeID != nil
	o.Setup.HasPreferences = len(p.SearchPrefs.Titles) > 0 || len(p.SearchPrefs.Keywords) > 0
	o.Setup.MailboxEnabled = s.cfg.AgentMailDomain != "" && p.MailboxAddress != nil
	o.Setup.InboundEnabled = o.Setup.MailboxEnabled && s.cfg.ResendWebhookSecret != ""
	o.Setup.ExtensionConnected, _ = s.repo.HasActiveExtensionDevice(ctx, userID)

	if o.Leads, err = s.repo.CountLeadsByStatus(ctx, userID); err != nil {
		return nil, ErrInternal
	}
	if o.Applications, err = s.repo.CountApplicationsByStatus(ctx, userID); err != nil {
		return nil, ErrInternal
	}
	o.UnreadImportant, _ = s.repo.CountUnreadImportant(ctx, userID)
	o.SubmittedToday, _ = s.repo.CountSubmittedSince(ctx, userID, time.Now().Add(-24*time.Hour))
	o.RunningRun, _ = s.repo.GetRunningRun(ctx, userID)
	if runs, err := s.repo.ListRuns(ctx, userID, 2); err == nil {
		for i := range runs {
			if runs[i].Status != "running" {
				o.LastRun = &runs[i]
				break
			}
		}
	}
	o.RecentEvents, _ = s.repo.ListEvents(ctx, userID, 0, 12)
	return o, nil
}

// ── Activity helpers ──────────────────────────────────────────────────────────

func (s *Service) event(ctx context.Context, e Event) {
	if err := s.repo.AddEvent(ctx, e); err != nil {
		slog.Warn("agent: add event failed", "kind", e.Kind, "error", err)
	}
}

func strPtr(s string) *string {
	if s == "" {
		return nil
	}
	return &s
}
