package agent

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"regexp"
	"strings"
	"time"

	"github.com/go-pdf/fpdf"

	"github.com/collinsadi/aethlara/internal/agent/sources"
	"github.com/collinsadi/aethlara/internal/ai"
	"github.com/collinsadi/aethlara/internal/email"
	"github.com/collinsadi/aethlara/internal/job"
	"github.com/collinsadi/aethlara/internal/logger"
	"github.com/collinsadi/aethlara/internal/prompts"
	"github.com/collinsadi/aethlara/pkg/sanitise"
)

const (
	thinDescriptionChars = 800
	maxResumeFileBytes   = 10 << 20
	maxFormFields        = 150
)

// ── Lead decisions ────────────────────────────────────────────────────────────

// DecideLead applies the user's decision to a lead: "approve" queues an
// application for the next run, "dismiss" hides it (cancelling a queued
// application), "reset" brings a dismissed lead back to review.
func (s *Service) DecideLead(ctx context.Context, userID, leadID, decision string) (*Lead, *Application, error) {
	lead, err := s.repo.GetLead(ctx, userID, leadID)
	if err != nil {
		return nil, nil, ErrInternal
	}
	if lead == nil {
		return nil, nil, ErrNotFound
	}

	switch decision {
	case "approve":
		switch lead.Status {
		case LeadApplied:
			return nil, nil, fmt.Errorf("%w: already applied to this job", ErrInvalidInput)
		case LeadApproved, LeadApplying:
			app, _ := s.repo.GetApplicationByLead(ctx, userID, leadID)
			return lead, app, nil
		}
		updated, err := s.repo.SetLeadStatus(ctx, userID, leadID, LeadApproved, nil, true)
		if err != nil || updated == nil {
			return nil, nil, ErrInternal
		}
		app, err := s.repo.QueueApplication(ctx, userID, leadID)
		if err != nil {
			return nil, nil, ErrInternal
		}
		s.event(ctx, Event{UserID: userID, Kind: EventLeadApproved, LeadID: &leadID, ApplicationID: idPtr(app),
			Message: fmt.Sprintf("Queued %s at %s for the next run", lead.Title, lead.Company)})
		return updated, app, nil

	case "dismiss":
		app, _ := s.repo.GetApplicationByLead(ctx, userID, leadID)
		if lead.Status == LeadApplied || (app != nil && (app.Status == AppSubmitted || app.Status == AppInProgress)) {
			return nil, nil, fmt.Errorf("%w: this application is already being submitted", ErrInvalidInput)
		}
		if app != nil && app.Status != AppCancelled {
			if app.Status == AppScheduled {
				if err := s.unschedule(ctx, userID, app); err != nil {
					return nil, nil, err
				}
			}
			app.Status = AppCancelled
			app.ClaimExpiresAt = nil
			if err := s.repo.SaveApplication(ctx, app); err != nil {
				return nil, nil, ErrInternal
			}
		}
		reason := "user"
		updated, err := s.repo.SetLeadStatus(ctx, userID, leadID, LeadDismissed, &reason, true)
		if err != nil {
			return nil, nil, ErrInternal
		}
		return updated, app, nil

	case "reset":
		switch lead.Status {
		case LeadDismissed, LeadExpired:
		case LeadApproved, LeadApplying:
			// Undo an approval while its application is only queued, or its
			// email is still waiting in the send queue.
			app, err := s.repo.GetApplicationByLead(ctx, userID, leadID)
			if err != nil {
				return nil, nil, ErrInternal
			}
			if app != nil {
				switch app.Status {
				case AppQueued, AppCancelled:
				case AppScheduled:
					if err := s.unschedule(ctx, userID, app); err != nil {
						return nil, nil, err
					}
					app.Status = AppCancelled
					if err := s.repo.SaveApplication(ctx, app); err != nil {
						return nil, nil, ErrInternal
					}
				default:
					return nil, nil, fmt.Errorf("%w: the agent already started this application", ErrInvalidInput)
				}
				if err := s.repo.DeleteApplication(ctx, userID, app.ID); err != nil {
					return nil, nil, ErrInternal
				}
			}
		default:
			return lead, nil, nil
		}
		updated, err := s.repo.SetLeadStatus(ctx, userID, leadID, LeadNew, nil, false)
		if err != nil {
			return nil, nil, ErrInternal
		}
		return updated, nil, nil
	}
	return nil, nil, fmt.Errorf("%w: decision must be approve, dismiss or reset", ErrInvalidInput)
}

func idPtr(a *Application) *string {
	if a == nil {
		return nil
	}
	return &a.ID
}

// ── Prepare + schedule (run stage) ────────────────────────────────────────────

// applyQueued prepares approved applications: find the address to send to
// (a job with none is dropped), tailor the resume, write the email, then
// schedule it in the send queue
// (outbox.go sends it later, paced by schedule.go). Schedules no more than
// the mailbox's daily cap, counting what was sent in the last 24 hours and
// what is already scheduled. Jobs dropped for having no address don't use
// the cap, so the pass keeps going until the cap is reached, the queue is
// empty, or the pass has used half the run's time (discovery needs the rest).
func (s *Service) applyQueued(ctx context.Context, run *Run, p *Profile, resume *ResumeInfo, stats *RunStats) error {
	if n, err := s.repo.RequeueInterrupted(ctx, p.UserID); err == nil && n > 0 {
		slog.Info("agent: re-queued interrupted applications", "count", n)
	}
	if s.agentMail == nil || p.MailboxAddress == nil || *p.MailboxAddress == "" {
		// Nothing can be sent without a mailbox; leave the queue for later
		// rather than dropping jobs whose address was never looked up.
		return nil
	}
	now := time.Now()
	deadline := now.Add(s.runTimeout() / 2)
	limit, _ := s.dailySendCap(ctx, p, now)
	used, err := s.repo.CountSubmittedSince(ctx, p.UserID, now.Add(-24*time.Hour))
	if err != nil {
		return err
	}
	counts, err := s.repo.CountApplicationsByStatus(ctx, p.UserID)
	if err != nil {
		return err
	}
	used += counts[AppScheduled] + counts[AppReady] + counts[AppInProgress]
	budget := limit - used
	if budget <= 0 {
		return nil
	}

	queued, err := s.repo.ApplicationsByStatus(ctx, p.UserID, AppQueued, maxPreparePerPass)
	if err != nil || len(queued) == 0 {
		return err
	}
	user, err := s.repo.GetUserBasics(ctx, p.UserID)
	if err != nil || user == nil {
		return fmt.Errorf("load user: %w", err)
	}
	plan, err := s.loadSendPlan(ctx, p, now)
	if err != nil {
		return fmt.Errorf("load send plan: %w", err)
	}
	// Applications whose posting cannot be read fall back to cold emails,
	// scheduled after the loop so several roles at one company share one
	// email.
	var cold []coldEmailJob
	start := stats.EmailsScheduled
	for i := range queued {
		// Cold emails are counted before grouping (one per application), so
		// the pass never schedules more than the budget.
		if ctx.Err() != nil || time.Now().After(deadline) || stats.EmailsScheduled-start+len(cold) >= budget {
			break
		}
		if err := s.prepareOne(ctx, run, p, user, resume, &queued[i], plan, stats, &cold); errors.Is(err, ai.ErrNoAPIKey) {
			for _, j := range cold {
				j.app.Status = AppQueued
				_ = s.repo.SaveApplication(ctx, j.app)
				_, _ = s.repo.SetLeadStatus(ctx, p.UserID, j.lead.ID, LeadApproved, nil, false)
			}
			return err
		}
	}
	if len(cold) > 0 {
		if err := s.scheduleColdEmails(ctx, run, p, user, resume, cold, plan, stats); err != nil {
			return err
		}
	}
	return ctx.Err()
}

// maxPrepareAttempts bounds retries of transient failures (AI timeouts,
// rate limits, provider errors, malformed AI output) across runs.
const maxPrepareAttempts = 3

// maxPreparePerPass bounds how many queued applications one pass looks at.
const maxPreparePerPass = 30

// transientPrepareError reports failures worth retrying on the next run.
func transientPrepareError(err error) bool {
	if errors.Is(err, job.ErrAIPipelineTimeout) {
		return true
	}
	switch ai.ClassifyError(err) {
	case "timeout", "ai_rate_limited", "ai_overloaded", "ai_server_error", "ai_truncated":
		return true
	}
	// ErrExtraction without an ExtractionError: the model's reply could not
	// be parsed (twice) or the provider failed, not an unreadable posting.
	var ext *job.ExtractionError
	return errors.Is(err, job.ErrExtraction) && !errors.As(err, &ext)
}

func (s *Service) prepareOne(ctx context.Context, run *Run, p *Profile, user *UserBasics, resume *ResumeInfo, app *Application, plan *sendPlan, stats *RunStats, cold *[]coldEmailJob) error {
	log := logger.FromContext(ctx).With("component", "agent", "operation", "prepare", "application_id", app.ID)
	lead, err := s.repo.GetLead(ctx, p.UserID, app.LeadID)
	if err != nil || lead == nil {
		return ErrInternal
	}

	fail := func(msg string, cause error) error {
		log.Warn("application prepare failed", "error", logger.TruncateError(cause, 200), "error_type", ai.ClassifyError(cause))
		s.failApplication(ctx, run, p.UserID, app, lead, msg, stats)
		return cause
	}
	// retryLater re-queues the application after a transient failure.
	retryLater := func(msg string, cause error) error {
		app.Attempts++
		if app.Attempts >= maxPrepareAttempts {
			return fail(msg, cause)
		}
		log.Warn("application prepare deferred", "error", logger.TruncateError(cause, 200),
			"error_type", ai.ClassifyError(cause), "attempt", app.Attempts)
		app.Status = AppQueued
		app.LastError = &msg
		_ = s.repo.SaveApplication(ctx, app)
		_, _ = s.repo.SetLeadStatus(ctx, p.UserID, lead.ID, LeadApproved, nil, false)
		s.event(ctx, Event{UserID: p.UserID, RunID: &run.ID, Kind: EventPrepared, Level: "warning",
			LeadID: &lead.ID, ApplicationID: &app.ID,
			Message: fmt.Sprintf("Couldn't prepare %s at %s yet (%s); trying again on the next run", lead.Title, lead.Company, msg)})
		return nil
	}
	var clues *siteClues
	var rcpt *recipient
	// coldEmail hands an application whose posting cannot be read to the
	// cold email fallback: an address the user gave, the one already found,
	// or one the company publishes. With none, the job is dropped.
	coldEmail := func(msg string, cause error) error {
		if !p.ApplySettings.ColdEmailFallback || s.agentMail == nil || p.MailboxAddress == nil || *p.MailboxAddress == "" {
			return fail(msg, cause)
		}
		contact := userContact(app)
		if contact == nil && rcpt != nil {
			contact = &contactInfo{Email: rcpt.Email, Kind: rcpt.Kind, Source: rcpt.Source}
		}
		if contact == nil {
			contact = s.findContact(ctx, p.UserID, lead, clues)
		}
		if contact == nil {
			return s.dropNoEmail(ctx, run, p.UserID, app, lead, msg+", and "+lead.Company+" publishes no email address the agent could find", stats)
		}
		log.Info("posting unreadable, cold email queued", "contact_kind", contact.Kind)
		*cold = append(*cold, coldEmailJob{app: app, lead: lead, contact: contact, reason: msg})
		return nil
	}

	app.Status = AppPreparing
	if err := s.repo.SaveApplication(ctx, app); err != nil {
		return ErrInternal
	}
	_, _ = s.repo.SetLeadStatus(ctx, p.UserID, lead.ID, LeadApplying, nil, false)

	// 1. Make sure we have the full posting.
	description := lead.Description
	if app.JobID == nil && needsResolution(lead) {
		rp, c := s.resolvePosting(ctx, p.UserID, lead)
		clues = c
		if rp != nil {
			s.adoptPosting(ctx, lead, rp)
			description = lead.Description
			log.Info("posting resolved", "via", rp.Via, "chars", len(description))
		} else if len(strings.TrimSpace(description)) < minPostingChars {
			return coldEmail("the posting could not be found or read", errPostingUnreadable)
		}
	}

	// 2. Where to send it, found before any AI is spent on tailoring: a job
	// with no address to email is dropped.
	rcpt, why := s.resolveRecipient(ctx, p, lead, app, clues)
	if rcpt == nil {
		log.Info("no address to send the application to, dropped")
		return s.dropNoEmail(ctx, run, p.UserID, app, lead, why, stats)
	}

	// 3. Tailor (reuse the job if an earlier attempt already created it).
	var tailoredDoc *resumeDoc
	var jobText string
	if app.JobID != nil {
		if tc, err := s.jobs.GetTailoredContext(ctx, *app.JobID, p.UserID); err == nil {
			tailoredDoc = parseTailored(tc.TailoredJSON)
			jobText = jobBrief(tc.ExtractedJobJSON, lead)
			app.UseOriginalResume = tc.Job.PDFR2Key == nil
		} else {
			app.JobID = nil
		}
	}
	if app.JobID == nil {
		res, err := s.jobs.TailorForLead(ctx, p.UserID, job.LeadTailorInput{
			ResumeID: resume.ID, JobURL: lead.URL, Title: lead.Title, Company: lead.Company, Description: description,
		})
		if err != nil {
			var ext *job.ExtractionError
			switch {
			case errors.Is(err, ai.ErrNoAPIKey):
				app.Status = AppQueued
				_ = s.repo.SaveApplication(ctx, app)
				return err
			case errors.As(err, &ext):
				return coldEmail(userFacingError(err), err)
			case transientPrepareError(err):
				return retryLater(userFacingError(err), err)
			}
			return fail(userFacingError(err), err)
		}
		app.JobID = &res.Job.ID
		app.UseOriginalResume = res.PDFKey == ""
		_ = s.repo.SetLeadJob(ctx, lead.ID, res.Job.ID)
		if tc, err := s.jobs.GetTailoredContext(ctx, res.Job.ID, p.UserID); err == nil {
			tailoredDoc = parseTailored(tc.TailoredJSON)
			jobText = jobBrief(tc.ExtractedJobJSON, lead)
		}
		if res.Misaligned {
			s.event(ctx, Event{UserID: p.UserID, RunID: &run.ID, Kind: EventPrepared, Level: "warning",
				LeadID: &lead.ID, ApplicationID: &app.ID,
				Message: fmt.Sprintf("%s at %s scored %d against your resume; applying with your original resume", lead.Title, lead.Company, res.MatchScore)})
		}
		if res.TailorFailed {
			s.event(ctx, Event{UserID: p.UserID, RunID: &run.ID, Kind: EventPrepared, Level: "warning",
				LeadID: &lead.ID, ApplicationID: &app.ID,
				Message: fmt.Sprintf("Couldn't tailor your resume for %s at %s; applying with your original resume", lead.Title, lead.Company)})
		}
	}
	if jobText == "" {
		jobText = jobBrief("", lead)
	}
	if tailoredDoc == nil {
		tailoredDoc = parseResume(resume.ExtractedJSON)
	}

	// 4. The email.
	ident := buildIdentity(p, user, parseResume(resume.ExtractedJSON))
	subject := applicationSubject(lead, ident.FullName)
	if app.CoverLetter == nil || *app.CoverLetter == "" {
		body := ""
		if p.ApplySettings.CoverLetters {
			b, err := s.writeApplicationEmail(ctx, p.UserID, ident, lead, rcpt, subject, jobText, resumeForApplication(tailoredDoc))
			switch {
			case errors.Is(err, ai.ErrNoAPIKey):
				app.Status = AppQueued
				_ = s.repo.SaveApplication(ctx, app)
				return err
			case err != nil:
				log.Warn("application email draft failed, using the template", "error", logger.TruncateError(err, 200))
			default:
				body = b
			}
		}
		if body == "" {
			body = applicationEmailTemplate(ident, parseResume(resume.ExtractedJSON), lead, rcpt.Kind)
		}
		app.CoverLetter = &body
	}

	applyURL := sources.NormalizeApplyURL(firstNonEmpty(deref(lead.ApplyURL), lead.URL))
	app.ApplyURL = &applyURL
	app.ATS = strPtr(firstNonEmpty(deref(lead.ATS), sources.DetectATS(applyURL)))
	app.Channel = ChannelEmail
	app.ApplyEmail = &rcpt.Email
	app.RecipientKind = &rcpt.Kind
	app.RecipientSource = strPtr(rcpt.Source)
	stats.Prepared++

	// The user may have cancelled while we were working.
	if current, err := s.repo.GetApplication(ctx, p.UserID, app.ID); err == nil && current != nil && current.Status == AppCancelled {
		return nil
	}

	// 5. Into the send queue.
	at, err := s.scheduleEmail(ctx, p, plan, resume, []*Application{app}, OutboxApplication, rcpt.Email, subject, *app.CoverLetter)
	if err != nil {
		return err // left "preparing": the next run re-queues it
	}
	stats.EmailsScheduled++
	s.scheduledEvent(ctx, run, p, app, lead, at,
		fmt.Sprintf("%s at %s is ready to email to %s%s", lead.Title, lead.Company, rcpt.Email, recipientNote(rcpt)))
	return nil
}

// recipientNote says where an address came from, for the activity feed.
func recipientNote(r *recipient) string {
	switch r.Kind {
	case RecipientPosting:
		return " (the address in the posting)"
	case RecipientUser:
		return " (the address you gave)"
	}
	if h := hostOf(r.Source); h != "" {
		return " (published on " + h + ")"
	}
	return ""
}

// markSubmitted moves the lead and tracker job to applied.
func (s *Service) markSubmitted(ctx context.Context, userID string, lead *Lead, app *Application) {
	_, _ = s.repo.SetLeadStatus(ctx, userID, lead.ID, LeadApplied, nil, false)
	if app.JobID != nil {
		if _, err := s.jobs.AdvanceStatus(ctx, *app.JobID, userID, "applied"); err != nil {
			slog.Warn("agent: mark job applied failed", "application_id", app.ID, "error", err)
		}
	}
}

// adoptPosting replaces a lead's thin description and link with the full
// posting resolvePosting found.
func (s *Service) adoptPosting(ctx context.Context, lead *Lead, rp *resolvedPosting) {
	lead.Description = rp.Description
	if rp.URL != "" {
		lead.URL = rp.URL
	}
	if rp.ApplyURL != "" {
		lead.ApplyURL = strPtr(rp.ApplyURL)
	}
	if rp.ATS != "" {
		lead.ATS = strPtr(rp.ATS)
	}
	if rp.ApplyEmail != "" && (lead.ApplyEmail == nil || *lead.ApplyEmail == "") {
		lead.ApplyEmail = strPtr(rp.ApplyEmail)
	}
	if err := s.repo.UpdateLeadPosting(ctx, lead.ID, rp.Description, rp.URL, rp.ApplyURL, rp.ATS, rp.ApplyEmail); err != nil {
		slog.Warn("agent: saving resolved posting failed", "lead_id", lead.ID, "error", err)
	}
}

func userFacingError(err error) string {
	var ext *job.ExtractionError
	switch {
	case errors.As(err, &ext):
		return "the posting could not be read (" + strings.ToLower(ext.Reason) + ")"
	case errors.Is(err, job.ErrAIPipelineTimeout):
		return "the AI took too long"
	case errors.Is(err, job.ErrExtraction):
		return "the AI returned an unreadable reply"
	case transientPrepareError(err):
		return "the AI provider was busy"
	case errors.Is(err, job.ErrInvalidInput):
		return "the posting or resume is incomplete"
	case errors.Is(err, ai.ErrRefused):
		return "the AI declined to process this posting"
	default:
		return "an unexpected error occurred"
	}
}

func deref(p *string) string {
	if p == nil {
		return ""
	}
	return *p
}

// jobBrief renders the job for application emails and form filling, from
// the extracted job JSON when available.
func jobBrief(extractedJSON string, lead *Lead) string {
	var sb strings.Builder
	fmt.Fprintf(&sb, "Title: %s\nCompany: %s\n", lead.Title, lead.Company)
	if lead.Location != nil {
		fmt.Fprintf(&sb, "Location: %s\n", *lead.Location)
	}
	var ext struct {
		Job struct {
			Summary          string   `json:"summary"`
			Responsibilities []string `json:"responsibilities"`
			RequiredSkills   []string `json:"required_skills"`
			PreferredSkills  []string `json:"preferred_skills"`
			Industry         string   `json:"industry"`
		} `json:"job"`
	}
	if extractedJSON != "" && json.Unmarshal([]byte(extractedJSON), &ext) == nil && ext.Job.Summary != "" {
		fmt.Fprintf(&sb, "Summary: %s\n", ext.Job.Summary)
		if ext.Job.Industry != "" {
			fmt.Fprintf(&sb, "Industry: %s\n", ext.Job.Industry)
		}
		writeList(&sb, "Responsibilities", capList(ext.Job.Responsibilities, 8))
		writeList(&sb, "Required skills", ext.Job.RequiredSkills)
		writeList(&sb, "Preferred skills", ext.Job.PreferredSkills)
		return strings.TrimSpace(sb.String())
	}
	fmt.Fprintf(&sb, "Description:\n%s\n", clipText(lead.Description, 5000))
	return strings.TrimSpace(sb.String())
}

func writeList(sb *strings.Builder, label string, items []string) {
	if len(items) == 0 {
		return
	}
	sb.WriteString(label + ":\n")
	for _, it := range items {
		sb.WriteString("- " + it + "\n")
	}
}

// ── Application emails ────────────────────────────────────────────────────────

var headerUnsafe = regexp.MustCompile(`[\r\n<>"]+`)

var errResumeUnavailable = errors.New("resume file unavailable")

// applicationSubject is the subject of an application email: plain and
// specific, the way a person writes it.
func applicationSubject(lead *Lead, name string) string {
	subject := fmt.Sprintf("Application for %s - %s", strings.TrimSpace(lead.Title), displayName(name))
	return clipText(strings.TrimSpace(headerUnsafe.ReplaceAllString(subject, " ")), 150)
}

// writeApplicationEmail drafts the email body with the user's AI. The draft
// must read like a person's email (applicationEmailOK); otherwise the
// caller uses the plain template.
func (s *Service) writeApplicationEmail(ctx context.Context, userID string, ident identity, lead *Lead, rcpt *recipient, subject, jobText, resumeText string) (string, error) {
	resp, err := s.ai.Complete(ctx, ai.Request{
		UserID:        userID,
		SystemPrompt:  prompts.ApplicationEmailSystemPrompt(),
		UserMessage:   prompts.ApplicationEmailUserMessage(ident.FullName, lead.Company, rcpt.Email, rcpt.Kind, jobText, resumeText),
		PromptVersion: prompts.ApplicationEmailV1,
		Stage:         ai.StageApplicationEmail,
	})
	if err != nil {
		return "", err
	}
	body := strings.TrimSpace(sanitise.ResumeText(resp.Content))
	if issues := applicationEmailIssues(subject, body); len(issues) > 0 {
		return "", fmt.Errorf("draft unusable: %s", strings.Join(issues, ", "))
	}
	return body, nil
}

// applicationEmailIssues lists why a drafted email must not be sent.
func applicationEmailIssues(subject, body string) []string {
	var issues []string
	if n := len(body); n < 350 || n > 2600 {
		issues = append(issues, fmt.Sprintf("length %d", n))
	}
	if placeholderRe.MatchString(body) {
		issues = append(issues, "placeholder text")
	}
	return append(issues, email.Lint(subject, body)...)
}

// applicationEmailTemplate is the email used when cover letters are off or
// the AI draft is unusable.
func applicationEmailTemplate(ident identity, doc *resumeDoc, lead *Lead, recipientKind string) string {
	name := displayName(ident.FullName)
	greeting := "Dear Hiring Team,"
	if recipientKind == RecipientGeneral && strings.TrimSpace(lead.Company) != "" {
		greeting = "Hi " + strings.TrimSpace(lead.Company) + " team,"
	}
	var sb strings.Builder
	sb.WriteString(greeting + "\n\n")
	fmt.Fprintf(&sb, "I would like to apply for the %s role at %s.", strings.TrimSpace(lead.Title), strings.TrimSpace(lead.Company))
	if summary := firstSentence(doc.summary()); summary != "" {
		sb.WriteString(" " + summary)
	}
	sb.WriteString("\n\nMy resume is attached. I would welcome the chance to talk about how I could contribute to the team.")
	if recipientKind == RecipientGeneral || recipientKind == RecipientPerson {
		sb.WriteString(" If you are not the right person for this, I would be grateful if you could pass it on to whoever is hiring for the role.")
	}
	sb.WriteString("\n\nBest regards,\n" + name)
	return sanitise.ResumeText(sb.String())
}

// resumeFile returns the resume to submit for app: the tailored PDF when one
// was produced, otherwise the user's original upload.
func (s *Service) resumeFile(ctx context.Context, userID string, app *Application, resume *ResumeInfo, ident identity) ([]byte, string, string, error) {
	var tailored *string
	if !app.UseOriginalResume {
		tailored = app.JobID
	}
	return s.attachment(ctx, userID, tailored, resume, ident)
}

// attachment loads the resume to attach: the tailored PDF of tailoredJobID
// when there is one, otherwise the original upload.
func (s *Service) attachment(ctx context.Context, userID string, tailoredJobID *string, resume *ResumeInfo, ident identity) ([]byte, string, string, error) {
	base := strings.TrimSpace(ident.FirstName + "_" + ident.LastName)
	base = regexp.MustCompile(`[^A-Za-z0-9_]+`).ReplaceAllString(base, "")
	if base == "" || base == "_" {
		base = "Resume"
	} else {
		base += "_Resume"
	}
	if tailoredJobID != nil {
		if data, err := s.jobs.DownloadPDF(ctx, *tailoredJobID, userID); err == nil {
			return data, base + ".pdf", "application/pdf", nil
		}
	}
	if resume == nil {
		return nil, "", "", fmt.Errorf("%w: no resume on file", errResumeUnavailable)
	}
	data, contentType, err := s.r2.Download(ctx, resume.R2ObjectKey, maxResumeFileBytes)
	if err != nil {
		return nil, "", "", fmt.Errorf("%w: %v", errResumeUnavailable, err)
	}
	ext := map[string]string{"pdf": ".pdf", "docx": ".docx", "doc": ".doc", "md": ".md"}[resume.FileFormat]
	if contentType == "" {
		contentType = map[string]string{
			"pdf": "application/pdf", "md": "text/markdown", "doc": "application/msword",
			"docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
		}[resume.FileFormat]
	}
	return data, base + ext, contentType, nil
}

// ── Extension protocol ────────────────────────────────────────────────────────

// Packet is everything the extension needs to complete one application.
type Packet struct {
	Application *Application
	Lead        *Lead
	Identity    identity
	Profile     ApplicationProfile
	Answers     []Answer
	CoverLetter string
	ResumeName  string
	AutoSubmit  bool
}

// maxClaimAttempts stops an application the extension keeps abandoning
// (crashed tab, hung page) from being retried forever.
const maxClaimAttempts = 5

// ClaimNext leases the next ready browser application to the extension.
func (s *Service) ClaimNext(ctx context.Context, userID string) (*Packet, error) {
	lease := time.Duration(s.cfg.AgentClaimLeaseMinutes) * time.Minute
	if lease <= 0 {
		lease = 15 * time.Minute
	}
	for range 3 {
		app, err := s.repo.ClaimBrowserApplication(ctx, userID, lease)
		if err != nil {
			return nil, ErrInternal
		}
		if app == nil {
			return nil, nil
		}
		if app.Attempts > maxClaimAttempts {
			msg := fmt.Sprintf("the extension could not finish this application after %d attempts", maxClaimAttempts)
			app.Status = AppFailed
			app.LastError = &msg
			app.ClaimExpiresAt = nil
			if err := s.repo.SaveApplication(ctx, app); err != nil {
				return nil, ErrInternal
			}
			_, _ = s.repo.SetLeadStatus(ctx, userID, app.LeadID, LeadFailed, nil, false)
			s.event(ctx, Event{UserID: userID, Kind: EventAppFailed, Level: "error", LeadID: &app.LeadID, ApplicationID: &app.ID,
				Message: fmt.Sprintf("Gave up on %s at %s: %s", app.LeadTitle, app.LeadCompany, msg)})
			continue
		}
		return s.packet(ctx, userID, app)
	}
	return nil, nil
}

// PacketFor returns the packet for an application the extension already holds.
func (s *Service) PacketFor(ctx context.Context, userID, appID string) (*Packet, error) {
	app, err := s.repo.GetApplication(ctx, userID, appID)
	if err != nil {
		return nil, ErrInternal
	}
	if app == nil {
		return nil, ErrNotFound
	}
	return s.packet(ctx, userID, app)
}

func (s *Service) packet(ctx context.Context, userID string, app *Application) (*Packet, error) {
	p, err := s.EnsureProfile(ctx, userID)
	if err != nil {
		return nil, err
	}
	lead, err := s.repo.GetLead(ctx, userID, app.LeadID)
	if err != nil || lead == nil {
		return nil, ErrInternal
	}
	user, err := s.repo.GetUserBasics(ctx, userID)
	if err != nil || user == nil {
		return nil, ErrInternal
	}
	var (
		doc          *resumeDoc
		resumeFormat string
	)
	if p.ResumeID != nil {
		if r, err := s.repo.GetResume(ctx, userID, *p.ResumeID); err == nil && r != nil {
			doc = parseResume(r.ExtractedJSON)
			resumeFormat = r.FileFormat
		}
	}
	answers, _ := s.repo.ListAnswers(ctx, userID)
	ident := buildIdentity(p, user, doc)
	ext := ".pdf"
	if app.UseOriginalResume && resumeFormat != "" {
		ext = map[string]string{"pdf": ".pdf", "docx": ".docx", "doc": ".doc", "md": ".md"}[resumeFormat]
	}
	name := "Resume" + ext
	if ident.FirstName != "" {
		name = regexp.MustCompile(`[^A-Za-z0-9_]+`).ReplaceAllString(ident.FirstName+"_"+ident.LastName, "") + "_Resume" + ext
	}
	return &Packet{
		Application: app,
		Lead:        lead,
		Identity:    ident,
		Profile:     p.ApplicationProfile,
		Answers:     answers,
		CoverLetter: deref(app.CoverLetter),
		ResumeName:  name,
		AutoSubmit:  p.ApplySettings.AutoSubmit,
	}, nil
}

// FormField is one input the extension found on an application page.
type FormField struct {
	FieldID     string   `json:"field_id"`
	Label       string   `json:"label"`
	Type        string   `json:"type"`
	Name        string   `json:"name,omitempty"`
	Placeholder string   `json:"placeholder,omitempty"`
	Required    bool     `json:"required"`
	Options     []string `json:"options,omitempty"`
	Section     string   `json:"section,omitempty"`
	Help        string   `json:"help,omitempty"`
}

// FieldFill is the value to put in one field.
type FieldFill struct {
	FieldID    string  `json:"field_id"`
	Value      *string `json:"value"`
	Confidence string  `json:"confidence"`
}

// FillResult answers one form page.
type FillResult struct {
	Fills   []FieldFill `json:"fills"`
	Missing []Question  `json:"missing"`
}

// FillFields answers the fields of one application page with AI, using the
// application profile, saved answers, tailored resume and cover letter.
func (s *Service) FillFields(ctx context.Context, userID, appID, pageURL string, fields []FormField) (*FillResult, error) {
	if len(fields) == 0 || len(fields) > maxFormFields {
		return nil, fmt.Errorf("%w: fields must contain 1-%d items", ErrInvalidInput, maxFormFields)
	}
	byID := map[string]FormField{}
	for i := range fields {
		f := &fields[i]
		f.FieldID = strings.TrimSpace(f.FieldID)
		if f.FieldID == "" || len(f.FieldID) > 120 {
			return nil, fmt.Errorf("%w: invalid field_id", ErrInvalidInput)
		}
		if _, dup := byID[f.FieldID]; dup {
			return nil, fmt.Errorf("%w: duplicate field_id %s", ErrInvalidInput, f.FieldID)
		}
		f.Label = clipText(f.Label, 500)
		f.Placeholder = clipText(f.Placeholder, 200)
		f.Help = clipText(f.Help, 500)
		f.Section = clipText(f.Section, 200)
		if len(f.Options) > 150 {
			f.Options = f.Options[:150]
		}
		for j := range f.Options {
			f.Options[j] = clipText(f.Options[j], 200)
		}
		byID[f.FieldID] = *f
	}

	pkt, err := s.PacketFor(ctx, userID, appID)
	if err != nil {
		return nil, err
	}
	app := pkt.Application

	var tailored *resumeDoc
	jobText := jobBrief("", pkt.Lead)
	if app.JobID != nil {
		if tc, err := s.jobs.GetTailoredContext(ctx, *app.JobID, userID); err == nil {
			tailored = parseTailored(tc.TailoredJSON)
			jobText = jobBrief(tc.ExtractedJobJSON, pkt.Lead)
		}
	}
	if tailored == nil {
		if p, err := s.repo.GetProfile(ctx, userID); err == nil && p != nil && p.ResumeID != nil {
			if r, err := s.repo.GetResume(ctx, userID, *p.ResumeID); err == nil && r != nil {
				tailored = parseResume(r.ExtractedJSON)
			}
		}
	}

	fieldsJSON, _ := json.Marshal(fields)
	resp, err := s.ai.Complete(ctx, ai.Request{
		UserID:       userID,
		SystemPrompt: prompts.ApplicationFillSystemPrompt(),
		UserMessage: prompts.ApplicationFillUserMessage(
			profileBrief(pkt.Identity, pkt.Profile), answersBrief(pkt.Answers), jobText,
			resumeForApplication(tailored), pkt.CoverLetter, clipText(pageURL, 2048), string(fieldsJSON)),
		PromptVersion: prompts.ApplicationFillV1,
		Stage:         ai.StageApplicationFill,
		JSONSchema:    prompts.ApplicationFillSchema(),
	})
	if err != nil {
		return nil, err
	}
	var raw FillResult
	if err := json.Unmarshal([]byte(resp.Content), &raw); err != nil {
		return nil, fmt.Errorf("parse fills: %w", err)
	}
	return validateFills(raw, byID), nil
}

// validateFills drops values for unknown fields, coerces option answers onto
// the real option text and lists required fields that stay empty.
func validateFills(raw FillResult, fields map[string]FormField) *FillResult {
	out := &FillResult{Fills: []FieldFill{}, Missing: []Question{}}
	answered := map[string]bool{}
	for _, f := range raw.Fills {
		field, ok := fields[f.FieldID]
		if !ok || answered[f.FieldID] {
			continue
		}
		if f.Value != nil {
			v := strings.TrimSpace(sanitise.ResumeText(*f.Value))
			isFileToken := v == prompts.ResumeFileToken || v == prompts.CoverLetterFileToken
			switch {
			case field.Type == "file" && !isFileToken:
				f.Value = nil
			case field.Type != "file" && isFileToken:
				f.Value = nil
			case len(field.Options) > 0 && !isFileToken:
				if matched, ok := matchOptions(v, field.Options); ok {
					f.Value = &matched
				} else {
					f.Value = nil
				}
			default:
				f.Value = &v
			}
		}
		if f.Confidence == "" {
			f.Confidence = "medium"
		}
		answered[f.FieldID] = f.Value != nil
		out.Fills = append(out.Fills, f)
	}

	listed := map[string]bool{}
	for _, m := range raw.Missing {
		if field, ok := fields[m.FieldID]; ok && !answered[m.FieldID] && !listed[m.FieldID] {
			listed[m.FieldID] = true
			out.Missing = append(out.Missing, Question{
				FieldID: m.FieldID, Label: firstNonEmpty(m.Label, field.Label), Type: field.Type, Options: field.Options,
			})
		}
	}
	for id, field := range fields {
		if field.Required && !answered[id] && !listed[id] && field.Type != "file" {
			out.Missing = append(out.Missing, Question{FieldID: id, Label: field.Label, Type: field.Type, Options: field.Options})
		}
	}
	return out
}

// matchOptions maps a model answer onto the field's option text. Multi-select
// answers are " | "-joined.
func matchOptions(v string, options []string) (string, bool) {
	parts := strings.Split(v, " | ")
	matched := make([]string, 0, len(parts))
	for _, part := range parts {
		part = strings.TrimSpace(part)
		found := ""
		for _, o := range options {
			if strings.EqualFold(o, part) {
				found = o
				break
			}
		}
		if found == "" {
			for _, o := range options {
				lo, lp := strings.ToLower(o), strings.ToLower(part)
				if lp != "" && (strings.HasPrefix(lo, lp) || strings.HasPrefix(lp, lo)) {
					found = o
					break
				}
			}
		}
		if found == "" {
			return "", false
		}
		matched = append(matched, found)
	}
	return strings.Join(matched, " | "), len(matched) > 0
}

// ResultReport is what the extension reports after working an application.
type ResultReport struct {
	Status    string // submitted | needs_input | failed | released
	Reason    string
	Message   string
	Questions []Question
	PageURL   string
	FinalURL  string
	Filled    int
}

// ReportResult records the outcome of a browser application attempt.
func (s *Service) ReportResult(ctx context.Context, userID, appID string, r ResultReport) (*Application, error) {
	app, err := s.repo.GetApplication(ctx, userID, appID)
	if err != nil {
		return nil, ErrInternal
	}
	if app == nil {
		return nil, ErrNotFound
	}
	switch {
	case app.Status == AppInProgress, app.Status == AppReady, app.Status == AppNeedsInput:
	case app.Status == AppFailed && r.Status == "submitted": // the user applied by hand
	default:
		return nil, ErrNotClaimable
	}
	lead, err := s.repo.GetLead(ctx, userID, app.LeadID)
	if err != nil || lead == nil {
		return nil, ErrInternal
	}

	result, _ := json.Marshal(map[string]any{
		"filled": r.Filled, "final_url": clipText(r.FinalURL, 2048), "message": clipText(r.Message, 1000),
	})
	app.Result = result
	app.ClaimExpiresAt = nil

	switch r.Status {
	case "submitted":
		now := time.Now()
		app.Status = AppSubmitted
		app.SubmittedAt = &now
		app.Needs = nil
		app.LastError = nil
		if err := s.repo.SaveApplication(ctx, app); err != nil {
			return nil, ErrInternal
		}
		s.markSubmitted(ctx, userID, lead, app)
		s.event(ctx, Event{UserID: userID, Kind: EventSubmitted, Level: "success", LeadID: &lead.ID, ApplicationID: &app.ID,
			Message: fmt.Sprintf("Submitted your application for %s at %s", lead.Title, lead.Company)})
	case "needs_input":
		reason := r.Reason
		switch reason {
		case "missing_answers", "captcha", "login_required", "unsupported_form", "review", "verification":
		default:
			reason = "review"
		}
		qs := r.Questions
		if len(qs) > 40 {
			qs = qs[:40]
		}
		for i := range qs {
			qs[i].Label = clipText(qs[i].Label, 500)
		}
		repeat := app.Status == AppNeedsInput && app.Needs != nil && app.Needs.Reason == reason
		app.Status = AppNeedsInput
		app.Needs = &Needs{Reason: reason, Message: clipText(r.Message, 500), Questions: qs, PageURL: clipText(r.PageURL, 2048)}
		if err := s.repo.SaveApplication(ctx, app); err != nil {
			return nil, ErrInternal
		}
		if !repeat { // results are at-least-once; one "needs you" per episode
			s.event(ctx, Event{UserID: userID, Kind: EventNeedsInput, Level: "warning", LeadID: &lead.ID, ApplicationID: &app.ID,
				Message: fmt.Sprintf("%s at %s needs you: %s", lead.Title, lead.Company, needsLabel(reason))})
		}
	case "failed":
		msg := clipText(firstNonEmpty(r.Message, "the extension could not complete the form"), 500)
		app.Status = AppFailed
		app.LastError = &msg
		if err := s.repo.SaveApplication(ctx, app); err != nil {
			return nil, ErrInternal
		}
		_, _ = s.repo.SetLeadStatus(ctx, userID, lead.ID, LeadFailed, nil, false)
		s.event(ctx, Event{UserID: userID, Kind: EventAppFailed, Level: "error", LeadID: &lead.ID, ApplicationID: &app.ID,
			Message: fmt.Sprintf("Could not submit %s at %s: %s", lead.Title, lead.Company, msg)})
	case "released":
		app.Status = AppReady
		if app.Attempts > 0 {
			app.Attempts-- // handing a claim back is not a failed attempt
		}
		if err := s.repo.SaveApplication(ctx, app); err != nil {
			return nil, ErrInternal
		}
	default:
		return nil, fmt.Errorf("%w: status must be submitted, needs_input, failed or released", ErrInvalidInput)
	}
	return app, nil
}

func needsLabel(reason string) string {
	switch reason {
	case "missing_answers":
		return "a few questions only you can answer"
	case "captcha":
		return "a CAPTCHA to solve"
	case "login_required":
		return "an account sign-in"
	case "verification":
		return "an email verification step"
	case "unsupported_form":
		return "a form the agent cannot fill on its own"
	default:
		return "a quick review before submitting"
	}
}

// QA is an answer the user typed for a question the agent could not answer.
type QA struct {
	Question string `json:"question"`
	Answer   string `json:"answer"`
}

var questionNoise = regexp.MustCompile(`[^a-z0-9]+`)

// QuestionKey normalises a question so the same question asked by different
// forms ("Are you authorized to work in the US? *") matches one answer.
func QuestionKey(q string) string {
	k := strings.Trim(questionNoise.ReplaceAllString(strings.ToLower(q), " "), " ")
	if len(k) > 300 {
		k = k[:300]
	}
	return k
}

// SaveAnswers stores answers for later and re-queues the application.
func (s *Service) SaveAnswers(ctx context.Context, userID, appID string, answers []QA) (*Application, error) {
	if len(answers) == 0 || len(answers) > 50 {
		return nil, fmt.Errorf("%w: provide 1-50 answers", ErrInvalidInput)
	}
	app, err := s.repo.GetApplication(ctx, userID, appID)
	if err != nil {
		return nil, ErrInternal
	}
	if app == nil {
		return nil, ErrNotFound
	}
	for _, a := range answers {
		q, ans := strings.TrimSpace(a.Question), strings.TrimSpace(a.Answer)
		if q == "" || ans == "" || len(q) > 500 || len(ans) > 4000 {
			return nil, fmt.Errorf("%w: each answer needs a question (max 500) and answer (max 4000)", ErrInvalidInput)
		}
		if _, err := s.repo.UpsertAnswer(ctx, userID, QuestionKey(q), q, ans, "user"); err != nil {
			return nil, ErrInternal
		}
	}
	if app.Status == AppNeedsInput {
		// Applying is email-only: prepare it again on the next run.
		app.Status = AppQueued
		app.Needs = nil
		app.OutboxID = nil
		if err := s.repo.SaveApplication(ctx, app); err != nil {
			return nil, ErrInternal
		}
		_, _ = s.repo.SetLeadStatus(ctx, userID, app.LeadID, LeadApproved, nil, false)
	}
	return app, nil
}

// RetryApplication puts a failed / stuck application back in the queue.
func (s *Service) RetryApplication(ctx context.Context, userID, appID string) (*Application, error) {
	app, err := s.repo.GetApplication(ctx, userID, appID)
	if err != nil {
		return nil, ErrInternal
	}
	if app == nil {
		return nil, ErrNotFound
	}
	switch app.Status {
	case AppFailed, AppNeedsInput, AppCancelled:
	default:
		return nil, fmt.Errorf("%w: only failed, waiting or cancelled applications can be retried", ErrInvalidInput)
	}
	// Every application is an email now: re-prepare it (the tailored resume
	// and email are reused) and schedule it again.
	app.Status = AppQueued
	app.LastError = nil
	app.Needs = nil
	app.ClaimExpiresAt = nil
	app.OutboxID = nil
	// A manual retry starts a fresh budget for prepare retries and
	// extension claims alike.
	app.Attempts = 0
	if err := s.repo.SaveApplication(ctx, app); err != nil {
		return nil, ErrInternal
	}
	_, _ = s.repo.SetLeadStatus(ctx, userID, app.LeadID, LeadApproved, nil, false)
	return app, nil
}

// CancelApplication stops an application that has not been submitted,
// taking its email out of the send queue.
func (s *Service) CancelApplication(ctx context.Context, userID, appID string) (*Application, error) {
	app, err := s.repo.GetApplication(ctx, userID, appID)
	if err != nil {
		return nil, ErrInternal
	}
	if app == nil {
		return nil, ErrNotFound
	}
	if app.Status == AppSubmitted {
		return nil, fmt.Errorf("%w: this application was already submitted", ErrInvalidInput)
	}
	if app.Status == AppScheduled {
		if err := s.unschedule(ctx, userID, app); err != nil {
			return nil, err
		}
	}
	app.Status = AppCancelled
	app.ClaimExpiresAt = nil
	if err := s.repo.SaveApplication(ctx, app); err != nil {
		return nil, ErrInternal
	}
	reason := "cancelled"
	_, _ = s.repo.SetLeadStatus(ctx, userID, app.LeadID, LeadDismissed, &reason, true)
	return app, nil
}

// ResumeForApplication returns the resume file to upload.
func (s *Service) ResumeForApplication(ctx context.Context, userID, appID string) ([]byte, string, string, error) {
	pkt, err := s.PacketFor(ctx, userID, appID)
	if err != nil {
		return nil, "", "", err
	}
	p, err := s.repo.GetProfile(ctx, userID)
	if err != nil || p == nil {
		return nil, "", "", ErrInternal
	}
	var resume *ResumeInfo
	if p.ResumeID != nil {
		resume, _ = s.repo.GetResume(ctx, userID, *p.ResumeID)
	}
	data, name, ct, err := s.resumeFile(ctx, userID, pkt.Application, resume, pkt.Identity)
	if err != nil {
		return nil, "", "", ErrInternal
	}
	return data, name, ct, nil
}

// CoverLetterPDF renders the application's cover letter as a PDF for forms
// that want a file upload.
func (s *Service) CoverLetterPDF(ctx context.Context, userID, appID string) ([]byte, error) {
	app, err := s.repo.GetApplication(ctx, userID, appID)
	if err != nil {
		return nil, ErrInternal
	}
	if app == nil || app.CoverLetter == nil || *app.CoverLetter == "" {
		return nil, ErrNotFound
	}
	f := fpdf.New("P", "mm", "A4", "")
	f.SetMargins(22, 22, 22)
	f.SetAutoPageBreak(true, 22)
	f.AddPage()
	f.SetFont("Helvetica", "", 11)
	tr := f.UnicodeTranslatorFromDescriptor("")
	for _, para := range strings.Split(sanitise.ResumeText(*app.CoverLetter), "\n\n") {
		f.MultiCell(0, 5.6, tr(para), "", "L", false)
		f.Ln(3)
	}
	var buf bytes.Buffer
	if err := f.Output(&buf); err != nil {
		return nil, ErrInternal
	}
	return buf.Bytes(), nil
}
