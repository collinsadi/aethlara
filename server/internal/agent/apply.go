package agent

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"html"
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
		case LeadApproved:
			// Undo an approval while its application is still only queued.
			app, err := s.repo.GetApplicationByLead(ctx, userID, leadID)
			if err != nil {
				return nil, nil, ErrInternal
			}
			if app != nil {
				if app.Status != AppQueued && app.Status != AppCancelled {
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

// ── Prepare + submit (run stage) ──────────────────────────────────────────────

// applyQueued prepares approved applications: tailor the resume, write the
// cover letter, then either email the application or hand it to the
// extension. Respects the daily limit.
func (s *Service) applyQueued(ctx context.Context, run *Run, p *Profile, resume *ResumeInfo, stats *RunStats) error {
	if n, err := s.repo.RequeueInterrupted(ctx, p.UserID); err == nil && n > 0 {
		slog.Info("agent: re-queued interrupted applications", "count", n)
	}
	used, err := s.repo.CountSubmittedSince(ctx, p.UserID, time.Now().Add(-24*time.Hour))
	if err != nil {
		return err
	}
	counts, err := s.repo.CountApplicationsByStatus(ctx, p.UserID)
	if err != nil {
		return err
	}
	used += counts[AppReady] + counts[AppInProgress]
	budget := p.ApplySettings.DailyLimit - used
	if budget <= 0 {
		return nil
	}

	queued, err := s.repo.ApplicationsByStatus(ctx, p.UserID, AppQueued, budget)
	if err != nil {
		return err
	}
	user, err := s.repo.GetUserBasics(ctx, p.UserID)
	if err != nil || user == nil {
		return fmt.Errorf("load user: %w", err)
	}
	for i := range queued {
		if ctx.Err() != nil {
			return ctx.Err()
		}
		if err := s.prepareOne(ctx, run, p, user, resume, &queued[i], stats); errors.Is(err, ai.ErrNoAPIKey) {
			return err
		}
	}
	return nil
}

func (s *Service) prepareOne(ctx context.Context, run *Run, p *Profile, user *UserBasics, resume *ResumeInfo, app *Application, stats *RunStats) error {
	log := logger.FromContext(ctx).With("component", "agent", "operation", "prepare", "application_id", app.ID)
	lead, err := s.repo.GetLead(ctx, p.UserID, app.LeadID)
	if err != nil || lead == nil {
		return ErrInternal
	}

	fail := func(msg string, cause error) error {
		log.Warn("application prepare failed", "error", logger.TruncateError(cause, 200), "error_type", ai.ClassifyError(cause))
		app.Status = AppFailed
		app.LastError = &msg
		_ = s.repo.SaveApplication(ctx, app)
		_, _ = s.repo.SetLeadStatus(ctx, p.UserID, lead.ID, LeadFailed, nil, false)
		stats.Failed++
		s.event(ctx, Event{UserID: p.UserID, RunID: &run.ID, Kind: EventAppFailed, Level: "error",
			LeadID: &lead.ID, ApplicationID: &app.ID,
			Message: fmt.Sprintf("Could not prepare %s at %s: %s", lead.Title, lead.Company, msg)})
		return cause
	}

	app.Status = AppPreparing
	if err := s.repo.SaveApplication(ctx, app); err != nil {
		return ErrInternal
	}
	_, _ = s.repo.SetLeadStatus(ctx, p.UserID, lead.ID, LeadApplying, nil, false)

	// 1. Make sure we have the full posting.
	description := lead.Description
	if len(description) < thinDescriptionChars && isHTTPURL(lead.URL) {
		if scraped, err := job.ScrapeJob(ctx, lead.URL, s.cfg); err == nil && len(scraped) > len(description) {
			description = clipText(scraped, 20000)
			_ = s.repo.SetLeadDescription(ctx, lead.ID, description)
		}
	}

	// 2. Tailor (reuse the job if an earlier attempt already created it).
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
			if errors.Is(err, ai.ErrNoAPIKey) {
				app.Status = AppQueued
				_ = s.repo.SaveApplication(ctx, app)
				return err
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
	}
	if jobText == "" {
		jobText = jobBrief("", lead)
	}
	if tailoredDoc == nil {
		tailoredDoc = parseResume(resume.ExtractedJSON)
	}

	// 3. Cover letter.
	ident := buildIdentity(p, user, parseResume(resume.ExtractedJSON))
	if p.ApplySettings.CoverLetters && (app.CoverLetter == nil || *app.CoverLetter == "") {
		letter, err := s.writeCoverLetter(ctx, p.UserID, ident.FullName, jobText, resumeForApplication(tailoredDoc))
		if err != nil {
			if errors.Is(err, ai.ErrNoAPIKey) {
				app.Status = AppQueued
				_ = s.repo.SaveApplication(ctx, app)
				return err
			}
			log.Warn("cover letter failed", "error", logger.TruncateError(err, 200))
		} else {
			app.CoverLetter = &letter
		}
	}

	// 4. Channel.
	applyURL := sources.NormalizeApplyURL(firstNonEmpty(deref(lead.ApplyURL), lead.URL))
	app.ApplyURL = &applyURL
	ats := firstNonEmpty(deref(lead.ATS), sources.DetectATS(applyURL))
	app.ATS = strPtr(ats)
	if lead.ApplyEmail != nil && *lead.ApplyEmail != "" {
		app.Channel = ChannelEmail
		app.ApplyEmail = lead.ApplyEmail
	} else {
		app.Channel = ChannelBrowser
	}
	stats.Prepared++

	// The user may have cancelled while we were working.
	if current, err := s.repo.GetApplication(ctx, p.UserID, app.ID); err == nil && current != nil && current.Status == AppCancelled {
		return nil
	}

	if app.Channel == ChannelEmail {
		if err := s.sendEmailApplication(ctx, p, ident, lead, app, resume); err != nil {
			if errors.Is(err, errResumeUnavailable) {
				return fail("your resume file could not be loaded from storage", err)
			}
			return fail("the application email could not be sent", err)
		}
		now := time.Now()
		app.Status = AppSubmitted
		app.SubmittedAt = &now
		if err := s.repo.SaveApplication(ctx, app); err != nil {
			return ErrInternal
		}
		s.markSubmitted(ctx, p.UserID, lead, app)
		stats.EmailsSent++
		s.event(ctx, Event{UserID: p.UserID, RunID: &run.ID, Kind: EventEmailSent, Level: "success",
			LeadID: &lead.ID, ApplicationID: &app.ID,
			Message: fmt.Sprintf("Emailed your application for %s at %s", lead.Title, lead.Company)})
		return nil
	}

	app.Status = AppReady
	app.LastError = nil
	app.Needs = nil
	if err := s.repo.SaveApplication(ctx, app); err != nil {
		return ErrInternal
	}
	stats.ReadyForBrowser++
	s.event(ctx, Event{UserID: p.UserID, RunID: &run.ID, Kind: EventPrepared, Level: "info",
		LeadID: &lead.ID, ApplicationID: &app.ID,
		Message: fmt.Sprintf("%s at %s is ready - the extension will submit it", lead.Title, lead.Company)})
	return nil
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

func userFacingError(err error) string {
	var ext *job.ExtractionError
	switch {
	case errors.As(err, &ext):
		return "the posting could not be read (" + strings.ToLower(ext.Reason) + ")"
	case errors.Is(err, job.ErrAIPipelineTimeout):
		return "the AI took too long; it will be retried"
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

// jobBrief renders the job for cover letters and form filling, from the
// extracted job JSON when available.
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

func (s *Service) writeCoverLetter(ctx context.Context, userID, fullName, jobText, resumeText string) (string, error) {
	resp, err := s.ai.Complete(ctx, ai.Request{
		UserID:        userID,
		SystemPrompt:  prompts.CoverLetterSystemPrompt(),
		UserMessage:   prompts.CoverLetterUserMessage(fullName, jobText, resumeText),
		PromptVersion: prompts.CoverLetterV1,
		Stage:         ai.StageCoverLetter,
	})
	if err != nil {
		return "", err
	}
	letter := strings.TrimSpace(sanitise.ResumeText(resp.Content))
	if len(letter) < 200 {
		return "", fmt.Errorf("cover letter too short")
	}
	return clipText(letter, 6000), nil
}

// ── Email applications ────────────────────────────────────────────────────────

var headerUnsafe = regexp.MustCompile(`[\r\n<>"]+`)

var errResumeUnavailable = errors.New("resume file unavailable")

func (s *Service) sendEmailApplication(ctx context.Context, p *Profile, ident identity, lead *Lead, app *Application, resume *ResumeInfo) error {
	data, filename, contentType, err := s.resumeFile(ctx, p.UserID, app, resume, ident)
	if err != nil {
		return fmt.Errorf("%w: %v", errResumeUnavailable, err)
	}

	name := strings.TrimSpace(headerUnsafe.ReplaceAllString(ident.FullName, " "))
	var from string
	replyTo := ident.Email
	if p.MailboxAddress != nil && *p.MailboxAddress != "" {
		from = fmt.Sprintf("%s <%s>", name, *p.MailboxAddress)
	} else {
		from = fmt.Sprintf("%s via %s <%s>", name, s.cfg.AppName, s.cfg.EmailFromAddress)
	}
	subject := headerUnsafe.ReplaceAllString(fmt.Sprintf("Application for %s - %s", lead.Title, name), " ")

	body := deref(app.CoverLetter)
	if body == "" {
		body = fmt.Sprintf("Dear Hiring Team,\n\nPlease find attached my resume for the %s role at %s. "+
			"I would welcome the chance to discuss how I can contribute.\n\nBest regards,\n%s", lead.Title, lead.Company, name)
	}
	signature := []string{name}
	for _, v := range []string{ident.Email, ident.Phone, ident.LinkedIn, ident.GitHub, ident.Portfolio} {
		if v != "" {
			signature = append(signature, v)
		}
	}
	text := body + "\n\n--\n" + strings.Join(signature, "\n")

	providerID, err := s.agentMail.SendMessage(ctx, email.OutboundEmail{
		From:        from,
		To:          []string{*app.ApplyEmail},
		ReplyTo:     []string{replyTo},
		Subject:     subject,
		Text:        text,
		HTML:        textToHTML(text),
		Attachments: []email.Attachment{{Filename: filename, ContentType: contentType, Content: data}},
	})
	if err != nil {
		return err
	}

	now := time.Now()
	_, _ = s.repo.InsertMessage(ctx, Message{
		UserID: p.UserID, Direction: "outbound", ProviderID: strPtr(providerID),
		FromAddress: replyTo, ToAddresses: []string{*app.ApplyEmail}, Subject: subject, TextBody: text,
		Category: strPtr("application"), ApplicationID: &app.ID, JobID: app.JobID,
		TriageStatus: "skipped", ReceivedAt: now,
	})
	return nil
}

func textToHTML(text string) string {
	var sb strings.Builder
	sb.WriteString(`<div style="font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;font-size:15px;line-height:1.55;color:#111">`)
	for _, para := range strings.Split(text, "\n\n") {
		sb.WriteString("<p>")
		sb.WriteString(strings.ReplaceAll(html.EscapeString(para), "\n", "<br>"))
		sb.WriteString("</p>")
	}
	sb.WriteString("</div>")
	return sb.String()
}

// resumeFile returns the resume to submit: the tailored PDF when one was
// produced, otherwise the user's original upload.
func (s *Service) resumeFile(ctx context.Context, userID string, app *Application, resume *ResumeInfo, ident identity) ([]byte, string, string, error) {
	base := strings.TrimSpace(ident.FirstName + "_" + ident.LastName)
	base = regexp.MustCompile(`[^A-Za-z0-9_]+`).ReplaceAllString(base, "")
	if base == "" || base == "_" {
		base = "Resume"
	} else {
		base += "_Resume"
	}
	if !app.UseOriginalResume && app.JobID != nil {
		if data, err := s.jobs.DownloadPDF(ctx, *app.JobID, userID); err == nil {
			return data, base + ".pdf", "application/pdf", nil
		}
	}
	if resume == nil {
		return nil, "", "", fmt.Errorf("no resume on file")
	}
	data, contentType, err := s.r2.Download(ctx, resume.R2ObjectKey, maxResumeFileBytes)
	if err != nil {
		return nil, "", "", err
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
	var doc *resumeDoc
	if p.ResumeID != nil {
		if r, err := s.repo.GetResume(ctx, userID, *p.ResumeID); err == nil && r != nil {
			doc = parseResume(r.ExtractedJSON)
		}
	}
	answers, _ := s.repo.ListAnswers(ctx, userID)
	ident := buildIdentity(p, user, doc)
	name := "Resume.pdf"
	if ident.FirstName != "" {
		name = regexp.MustCompile(`[^A-Za-z0-9_]+`).ReplaceAllString(ident.FirstName+"_"+ident.LastName, "") + "_Resume.pdf"
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
		app.Status = AppNeedsInput
		app.Needs = &Needs{Reason: reason, Message: clipText(r.Message, 500), Questions: qs, PageURL: clipText(r.PageURL, 2048)}
		if err := s.repo.SaveApplication(ctx, app); err != nil {
			return nil, ErrInternal
		}
		s.event(ctx, Event{UserID: userID, Kind: EventNeedsInput, Level: "warning", LeadID: &lead.ID, ApplicationID: &app.ID,
			Message: fmt.Sprintf("%s at %s needs you: %s", lead.Title, lead.Company, needsLabel(reason))})
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

// SaveAnswers stores answers for future forms and re-queues the application.
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
		app.Status = AppReady
		app.Needs = nil
		if err := s.repo.SaveApplication(ctx, app); err != nil {
			return nil, ErrInternal
		}
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
	if app.JobID != nil && app.Channel == ChannelBrowser {
		app.Status = AppReady
	} else {
		app.Status = AppQueued
	}
	app.LastError = nil
	app.Needs = nil
	app.ClaimExpiresAt = nil
	if err := s.repo.SaveApplication(ctx, app); err != nil {
		return nil, ErrInternal
	}
	_, _ = s.repo.SetLeadStatus(ctx, userID, app.LeadID, LeadApplying, nil, false)
	return app, nil
}

// CancelApplication stops an application that has not been submitted.
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
