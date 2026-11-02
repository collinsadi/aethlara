package agent

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"html"
	"log/slog"
	"strings"
	"time"

	"github.com/collinsadi/aethlara/internal/agent/sources"
	"github.com/collinsadi/aethlara/internal/ai"
	"github.com/collinsadi/aethlara/internal/job"
	"github.com/collinsadi/aethlara/internal/logger"
	"github.com/collinsadi/aethlara/internal/prompts"
)

const staleLeadAge = 21 * 24 * time.Hour

// Start launches the scheduler and inbox triage workers. They stop when ctx
// is cancelled; call Wait to block until they have.
func (s *Service) Start(ctx context.Context) {
	s.wg.Add(1)
	go func() {
		defer s.wg.Done()
		s.triageLoop(ctx)
	}()
	if !s.cfg.AgentSchedulerEnabled {
		slog.Warn("agent: scheduler disabled (AGENT_SCHEDULER_ENABLED=false); runs only start manually")
		return
	}
	s.wg.Add(1)
	go func() {
		defer s.wg.Done()
		s.schedulerLoop(ctx)
	}()
}

// Wait blocks until background workers (and in-flight runs) finish.
func (s *Service) Wait() { s.wg.Wait() }

func (s *Service) runTimeout() time.Duration {
	if m := s.cfg.AgentRunTimeoutMinutes; m > 0 {
		return time.Duration(m) * time.Minute
	}
	return 30 * time.Minute
}

func (s *Service) schedulerLoop(ctx context.Context) {
	// Runs left "running" by a crash or restart can never finish now.
	if n, err := s.repo.FailStaleRuns(ctx, time.Now().Add(time.Minute)); err == nil && n > 0 {
		slog.Warn("agent: closed interrupted runs", "count", n)
	}

	interval := time.Duration(s.cfg.AgentSchedulerIntervalSec) * time.Second
	if interval < 10*time.Second {
		interval = time.Minute
	}
	ticker := time.NewTicker(interval)
	defer ticker.Stop()
	for {
		s.dispatchDue(ctx)
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
		}
	}
}

// dispatchDue starts runs for every due profile while run slots are free.
func (s *Service) dispatchDue(ctx context.Context) {
	for ctx.Err() == nil {
		select {
		case s.runSem <- struct{}{}:
		default:
			return // all slots busy; try again next tick
		}
		userID, err := s.repo.ClaimDueProfile(ctx)
		if err != nil || userID == "" {
			<-s.runSem
			if err != nil {
				slog.Error("agent: claim due profile failed", "error", err)
			}
			return
		}
		run, err := s.repo.StartRun(ctx, userID, "schedule")
		if err != nil {
			<-s.runSem
			if !errors.Is(err, ErrRunInProgress) {
				slog.Error("agent: start scheduled run failed", "user_id", userID, "error", err)
			}
			continue
		}
		s.wg.Add(1)
		go func() {
			defer s.wg.Done()
			defer func() { <-s.runSem }()
			s.execute(ctx, run)
		}()
	}
}

// StartManualRun starts a run now ("Run now" in the dashboard or extension).
func (s *Service) StartManualRun(ctx context.Context, userID string) (*Run, error) {
	p, err := s.EnsureProfile(ctx, userID)
	if err != nil {
		return nil, err
	}
	if p.ResumeID == nil {
		return nil, ErrNoResume
	}
	if len(p.SearchPrefs.Titles) == 0 && len(p.SearchPrefs.Keywords) == 0 {
		return nil, fmt.Errorf("%w: add at least one target title or keyword first", ErrInvalidInput)
	}
	run, err := s.repo.StartRun(ctx, userID, "manual")
	if err != nil {
		if errors.Is(err, ErrRunInProgress) {
			return nil, err
		}
		return nil, ErrInternal
	}
	// Detached from the HTTP request; keeps request/user ids for logs.
	bg := context.WithoutCancel(ctx)
	s.wg.Add(1)
	go func() {
		defer s.wg.Done()
		s.runSem <- struct{}{}
		defer func() { <-s.runSem }()
		s.execute(bg, run)
	}()
	return run, nil
}

// execute performs one run: apply what was approved, discover new leads,
// apply anything auto-approved, expire stale leads, then send the digest.
func (s *Service) execute(parent context.Context, run *Run) {
	ctx, cancel := context.WithTimeout(context.WithValue(parent, logger.UserIDKey, run.UserID), s.runTimeout())
	defer cancel()
	log := logger.FromContext(ctx).With("component", "agent", "run_id", run.ID, "trigger", run.Trigger)
	start := time.Now()
	stats := RunStats{}

	finish := func(status string, errMsg *string) {
		// Use a fresh context: the run context may be cancelled already.
		fctx, fcancel := context.WithTimeout(context.WithoutCancel(parent), 15*time.Second)
		defer fcancel()
		if err := s.repo.FinishRun(fctx, run.ID, status, stats, errMsg); err != nil {
			log.Error("finish run failed", "error", err)
		}
		_ = s.repo.TouchLastRun(fctx, run.UserID, time.Now())
	}
	fail := func(msg string, err error) {
		log.Error("run failed", "error", logger.TruncateError(err, 200), "error_type", ai.ClassifyError(err))
		s.event(context.WithoutCancel(ctx), Event{UserID: run.UserID, RunID: &run.ID, Kind: EventRunFailed, Level: "error", Message: msg})
		finish("failed", &msg)
	}

	p, err := s.EnsureProfile(ctx, run.UserID)
	if err != nil {
		fail("Could not load your autopilot settings.", err)
		return
	}
	if p.ResumeID == nil {
		fail("Upload a resume so the agent can match and apply for you.", ErrNoResume)
		return
	}
	resume, err := s.repo.GetResume(ctx, run.UserID, *p.ResumeID)
	if err != nil || resume == nil || resume.ExtractionStatus != "completed" {
		fail("Your selected resume is missing or still processing.", fmt.Errorf("resume unavailable: %v", err))
		return
	}
	if _, err := s.ai.ActiveProvider(ctx, run.UserID); err != nil {
		fail("Add an Anthropic or OpenRouter API key in Settings so the agent can work.", err)
		return
	}
	s.event(ctx, Event{UserID: run.UserID, RunID: &run.ID, Kind: EventRunStarted, Message: "Autopilot run started"})

	// 1. Apply to everything approved since the last run.
	if err := s.applyQueued(ctx, run, p, resume, &stats); err != nil {
		if errors.Is(err, ai.ErrNoAPIKey) {
			fail("Your AI key stopped working. Update it in Settings.", err)
			return
		}
		log.Warn("apply stage error", "error", logger.TruncateError(err, 200))
	}
	// 2. Find new jobs.
	if err := s.discover(ctx, run, p, resume, &stats); err != nil {
		log.Warn("discover stage error", "error", logger.TruncateError(err, 200))
	}
	// 3. Auto-approved leads go out in the same run.
	if stats.AutoApproved > 0 {
		if err := s.applyQueued(ctx, run, p, resume, &stats); err != nil {
			log.Warn("apply stage (auto-approved) error", "error", logger.TruncateError(err, 200))
		}
	}
	// 4. Housekeeping.
	if n, err := s.repo.ExpireStaleLeads(ctx, run.UserID, time.Now().Add(-staleLeadAge)); err == nil && n > 0 {
		log.Info("expired stale leads", "count", n)
	}

	if ctx.Err() != nil {
		fail("The run took too long and was stopped; it will continue next time.", ctx.Err())
		return
	}

	summary := runSummary(stats)
	s.event(ctx, Event{UserID: run.UserID, RunID: &run.ID, Kind: EventRunFinished, Level: "success", Message: summary})
	finish("completed", nil)
	log.Info("run completed", "latency_ms", time.Since(start).Milliseconds(),
		"new_leads", stats.NewLeads, "prepared", stats.Prepared, "emails_sent", stats.EmailsSent)

	if p.ApplySettings.DigestEmails {
		s.sendDigest(context.WithoutCancel(ctx), p, run, stats)
	}
}

func runSummary(st RunStats) string {
	var parts []string
	if st.NewLeads > 0 {
		parts = append(parts, fmt.Sprintf("%d new job%s to review", st.NewLeads, plural(st.NewLeads)))
	}
	if st.EmailsSent > 0 {
		parts = append(parts, fmt.Sprintf("%d application%s emailed", st.EmailsSent, plural(st.EmailsSent)))
	}
	if st.ReadyForBrowser > 0 {
		parts = append(parts, fmt.Sprintf("%d ready for the extension", st.ReadyForBrowser))
	}
	if st.Failed > 0 {
		parts = append(parts, fmt.Sprintf("%d failed", st.Failed))
	}
	if len(parts) == 0 {
		return "Run finished - nothing new this time"
	}
	return "Run finished: " + strings.Join(parts, ", ")
}

// sendDigest emails the user what happened, when anything did.
func (s *Service) sendDigest(ctx context.Context, p *Profile, run *Run, st RunStats) {
	needs, _ := s.repo.ApplicationsByStatus(ctx, p.UserID, AppNeedsInput, 10)
	if st.NewLeads == 0 && st.EmailsSent == 0 && st.ReadyForBrowser == 0 && len(needs) == 0 {
		return
	}
	user, err := s.repo.GetUserBasics(ctx, p.UserID)
	if err != nil || user == nil {
		return
	}
	minScore := 0
	top, _, _ := s.repo.ListLeads(ctx, p.UserID, LeadQuery{Statuses: []string{LeadNew}, MinScore: &minScore, Page: 1, PageSize: 5})

	dash := html.EscapeString(strings.TrimRight(s.cfg.DashboardURL, "/"))
	var b strings.Builder
	b.WriteString(`<p style="font-size:15px;color:#111">` + html.EscapeString(runSummary(st)) + `.</p>`)
	if len(top) > 0 {
		b.WriteString(`<h3 style="font-size:15px;margin:20px 0 8px">Top new matches</h3><table style="width:100%;border-collapse:collapse">`)
		for _, l := range top {
			score := "-"
			if l.MatchScore != nil {
				score = fmt.Sprintf("%d", *l.MatchScore)
			}
			fmt.Fprintf(&b, `<tr><td style="padding:6px 0;font-weight:700;color:#fd3a25;width:44px">%s</td><td style="padding:6px 0;color:#111">%s<br><span style="color:#71717a;font-size:13px">%s</span></td></tr>`,
				score, html.EscapeString(l.Title), html.EscapeString(l.Company))
		}
		b.WriteString(`</table>`)
		fmt.Fprintf(&b, `<p><a href="%s/review" style="display:inline-block;margin-top:12px;background:#09090b;color:#fff;padding:10px 18px;border-radius:999px;text-decoration:none;font-weight:600">Review and approve</a></p>`, dash)
	}
	if len(needs) > 0 {
		b.WriteString(`<h3 style="font-size:15px;margin:20px 0 8px">Waiting on you</h3><ul style="padding-left:18px;color:#111">`)
		for _, a := range needs {
			reason := "review"
			if a.Needs != nil {
				reason = needsLabel(a.Needs.Reason)
			}
			fmt.Fprintf(&b, `<li>%s at %s - %s</li>`, html.EscapeString(a.LeadTitle), html.EscapeString(a.LeadCompany), html.EscapeString(reason))
		}
		fmt.Fprintf(&b, `</ul><p><a href="%s/applications" style="color:#fd3a25;font-weight:600">Open applications</a></p>`, dash)
	}
	subject := "Your job autopilot: " + strings.TrimPrefix(runSummary(st), "Run finished: ")
	if err := s.mail.SendNotification(ctx, user.Email, subject, wrapEmail("Autopilot update", b.String())); err != nil {
		slog.Warn("agent: digest email failed", "user_id", p.UserID, "error", err)
	}
}

// ── Lists for the dashboard ───────────────────────────────────────────────────

func (s *Service) ListLeads(ctx context.Context, userID string, q LeadQuery) ([]Lead, int, error) {
	leads, total, err := s.repo.ListLeads(ctx, userID, q)
	if err != nil {
		return nil, 0, ErrInternal
	}
	return leads, total, nil
}

func (s *Service) GetLead(ctx context.Context, userID, id string) (*Lead, *Application, error) {
	l, err := s.repo.GetLead(ctx, userID, id)
	if err != nil {
		return nil, nil, ErrInternal
	}
	if l == nil {
		return nil, nil, ErrNotFound
	}
	app, _ := s.repo.GetApplicationByLead(ctx, userID, id)
	return l, app, nil
}

func (s *Service) ListApplications(ctx context.Context, userID string, statuses []string, page, pageSize int) ([]Application, int, error) {
	apps, total, err := s.repo.ListApplications(ctx, userID, statuses, pageSize, (page-1)*pageSize)
	if err != nil {
		return nil, 0, ErrInternal
	}
	return apps, total, nil
}

func (s *Service) GetApplication(ctx context.Context, userID, id string) (*Application, error) {
	a, err := s.repo.GetApplication(ctx, userID, id)
	if err != nil {
		return nil, ErrInternal
	}
	if a == nil {
		return nil, ErrNotFound
	}
	return a, nil
}

func (s *Service) ListRuns(ctx context.Context, userID string, limit int) ([]Run, error) {
	runs, err := s.repo.ListRuns(ctx, userID, limit)
	if err != nil {
		return nil, ErrInternal
	}
	return runs, nil
}

func (s *Service) GetRun(ctx context.Context, userID, id string) (*Run, error) {
	r, err := s.repo.GetRun(ctx, userID, id)
	if err != nil {
		return nil, ErrInternal
	}
	if r == nil {
		return nil, ErrNotFound
	}
	return r, nil
}

func (s *Service) ListEvents(ctx context.Context, userID string, before int64, limit int) ([]Event, error) {
	ev, err := s.repo.ListEvents(ctx, userID, before, limit)
	if err != nil {
		return nil, ErrInternal
	}
	return ev, nil
}

func (s *Service) ListAnswers(ctx context.Context, userID string) ([]Answer, error) {
	a, err := s.repo.ListAnswers(ctx, userID)
	if err != nil {
		return nil, ErrInternal
	}
	return a, nil
}

func (s *Service) UpsertAnswer(ctx context.Context, userID, question, answer string) (*Answer, error) {
	question, answer = strings.TrimSpace(question), strings.TrimSpace(answer)
	if question == "" || answer == "" || len(question) > 500 || len(answer) > 4000 {
		return nil, fmt.Errorf("%w: question (max 500) and answer (max 4000) are required", ErrInvalidInput)
	}
	a, err := s.repo.UpsertAnswer(ctx, userID, QuestionKey(question), question, answer, "user")
	if err != nil {
		return nil, ErrInternal
	}
	return a, nil
}

func (s *Service) DeleteAnswer(ctx context.Context, userID, id string) error {
	ok, err := s.repo.DeleteAnswer(ctx, userID, id)
	if err != nil {
		return ErrInternal
	}
	if !ok {
		return ErrNotFound
	}
	return nil
}

// ── Manually added leads ──────────────────────────────────────────────────────

// AddLeadRequest adds one posting the user found themselves (dashboard "add
// by URL" or the extension's "send this job to the agent").
type AddLeadRequest struct {
	URL      string
	PageText string // the extension sends the visible page text
	Approve  bool   // queue it right away
	Source   string // "manual" | "extension"
}

type extractedJobDoc struct {
	Valid bool `json:"valid"`
	Job   struct {
		Title          string `json:"title"`
		Company        string `json:"company"`
		Location       string `json:"location"`
		IsRemote       bool   `json:"is_remote"`
		EmploymentType string `json:"employment_type"`
		Summary        string `json:"summary"`
	} `json:"job"`
	Error *struct {
		Reason string `json:"reason"`
	} `json:"error"`
}

// AddLead reads, scores and stores a posting the user chose.
func (s *Service) AddLead(ctx context.Context, userID string, req AddLeadRequest) (*Lead, *Application, error) {
	p, err := s.EnsureProfile(ctx, userID)
	if err != nil {
		return nil, nil, err
	}
	if p.ResumeID == nil {
		return nil, nil, ErrNoResume
	}
	resume, err := s.repo.GetResume(ctx, userID, *p.ResumeID)
	if err != nil || resume == nil {
		return nil, nil, ErrNoResume
	}
	if !isHTTPURL(req.URL) || !strings.HasPrefix(req.URL, "https://") {
		return nil, nil, fmt.Errorf("%w: a valid https URL is required", ErrInvalidInput)
	}

	text := strings.TrimSpace(req.PageText)
	if len(text) < 200 {
		scraped, err := job.ScrapeJob(ctx, req.URL, s.cfg)
		if err != nil {
			return nil, nil, fmt.Errorf("%w: could not read that page (%s)", ErrInvalidInput, clipText(err.Error(), 120))
		}
		text = scraped
	}
	text = clipText(text, 30000)

	resp, err := s.ai.Complete(ctx, ai.Request{
		UserID: userID, SystemPrompt: prompts.JobExtractionSystemPrompt(), UserMessage: text,
		PromptVersion: prompts.JobExtractionV1, Stage: ai.StageJobExtraction, Tier: ai.TierFast, JSON: true,
	})
	if err != nil {
		return nil, nil, err
	}
	var ext extractedJobDoc
	if err := json.Unmarshal([]byte(resp.Content), &ext); err != nil || !ext.Valid || ext.Job.Title == "" {
		reason := "that page does not look like a job posting"
		if ext.Error != nil && ext.Error.Reason != "" {
			reason = ext.Error.Reason
		}
		return nil, nil, fmt.Errorf("%w: %s", ErrInvalidInput, reason)
	}

	src := sources.Manual
	if req.Source == sources.Extension {
		src = sources.Extension
	}
	posting := sources.Posting{
		Source: src, SourceLabel: map[string]string{sources.Manual: "Added by you", sources.Extension: "Saved from browser"}[src],
		ExternalID: req.URL, Title: ext.Job.Title, Company: ext.Job.Company, Location: ext.Job.Location,
		IsRemote: ext.Job.IsRemote || sources.LooksRemote(ext.Job.Location), EmploymentType: sources.NormalizeEmploymentType(ext.Job.EmploymentType),
		URL: req.URL, ApplyURL: req.URL, ATS: sources.DetectATS(req.URL), Description: text,
	}

	// Already have it? Return the existing lead.
	key := dedupeKey(posting.Company, posting.Title)
	if existing, _ := s.repo.ExistingDedupeKeys(ctx, userID, []string{key}); existing[key] {
		leads, _, _ := s.repo.ListLeads(ctx, userID, LeadQuery{Search: posting.Title, Page: 1, PageSize: 20})
		for i := range leads {
			if leads[i].DedupeKey == key {
				if req.Approve {
					return s.DecideLead(ctx, userID, leads[i].ID, "approve")
				}
				return &leads[i], nil, nil
			}
		}
	}

	lead := leadFromPosting(userID, "", posting)
	lead.RunID = nil // not found by a run
	scores := s.scoreItems(ctx, p, parseResume(resume.ExtractedJSON), []scoreItem{{id: "p0", posting: posting}})
	if sc, ok := scores["p0"]; ok {
		applyScore(&lead, sc)
	}
	stored, err := s.repo.InsertLead(ctx, lead)
	if err != nil || stored == nil {
		return nil, nil, ErrInternal
	}
	if req.Approve {
		return s.DecideLead(ctx, userID, stored.ID, "approve")
	}
	return stored, nil, nil
}
