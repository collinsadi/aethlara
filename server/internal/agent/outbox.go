package agent

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"regexp"
	"strings"
	"time"

	"github.com/collinsadi/aethlara/internal/email"
	"github.com/collinsadi/aethlara/internal/job"
	"github.com/collinsadi/aethlara/internal/logger"
)

// The send queue worker. Every outboxTick it takes the emails that are due
// (oldest first, one at a time, skipping users whose sending is paused),
// checks them again, sends them through Resend with an idempotency key and
// marks the applications they carry as submitted. Sending stops while the
// periodic deliverability check reports that the domain cannot send, and
// never exceeds AGENT_MAIL_MAX_PER_HOUR across all mailboxes.

const (
	outboxTick      = 30 * time.Second
	outboxLease     = 5 * time.Minute
	outboxBatch     = 10
	maxSendAttempts = 5
)

// sendBackoff is the wait before retrying a send that failed temporarily.
var sendBackoff = []time.Duration{2 * time.Minute, 10 * time.Minute, 30 * time.Minute, 2 * time.Hour}

func (s *Service) outboxLoop(ctx context.Context) {
	ticker := time.NewTicker(outboxTick)
	defer ticker.Stop()
	for {
		s.sendDue(ctx)
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
		}
	}
}

// sendDue sends what is due, within the hourly cap.
func (s *Service) sendDue(ctx context.Context) {
	if s.agentMail == nil {
		return
	}
	if rep := s.health.Load(); rep != nil && !rep.CanSend {
		if time.Since(s.blockedLogAt) > time.Hour {
			s.blockedLogAt = time.Now()
			slog.Error("agent: sending held: the agent mail domain cannot send (see the deliverability check)", "domain", rep.Domain)
		}
		return
	}
	for range outboxBatch {
		if ctx.Err() != nil {
			return
		}
		if limit := s.cfg.AgentMailMaxPerHour; limit > 0 {
			n, err := s.repo.CountOutboxSentSince(ctx, time.Now().Add(-time.Hour))
			if err != nil || n >= limit {
				return
			}
		}
		o, err := s.repo.ClaimDueOutbox(ctx, outboxLease)
		if err != nil {
			slog.Error("agent: claim due email failed", "error", err)
			return
		}
		if o == nil {
			return
		}
		s.sendOutbox(ctx, o)
	}
}

// sendOutbox sends one claimed email.
func (s *Service) sendOutbox(parent context.Context, o *OutboxEmail) {
	ctx := context.WithValue(parent, logger.UserIDKey, o.UserID)
	log := logger.FromContext(ctx).With("component", "agent", "operation", "send", "outbox_id", o.ID, "kind", o.Kind)

	apps, err := s.repo.ApplicationsByOutbox(ctx, o.UserID, o.ID)
	if err != nil {
		s.retrySend(ctx, log, o, nil, "the send queue could not be read", err)
		return
	}
	var live []Application
	for _, a := range apps {
		if a.Status == AppScheduled {
			live = append(live, a)
		}
	}
	switch {
	case len(live) == 0:
		_ = s.repo.FinishOutbox(ctx, o.ID, OutboxCancelled, strPtr("no application is waiting for this email"))
		return
	case len(live) < len(apps):
		// Part of a group email was cancelled: it names a role that must not
		// go out. The rest is prepared again on the next run.
		_ = s.repo.FinishOutbox(ctx, o.ID, OutboxCancelled, strPtr("an application in this email was cancelled"))
		_, _ = s.repo.RequeueOutboxApplications(ctx, o.UserID, o.ID, "")
		return
	}

	p, err := s.repo.GetProfile(ctx, o.UserID)
	if err != nil || p == nil {
		s.retrySend(ctx, log, o, live, "your autopilot settings could not be loaded", err)
		return
	}
	// The window may have closed while the server was down, or the user
	// changed it: wait for the next opening instead of mailing at night.
	now := time.Now()
	if w := windowFor(p.ApplySettings); !w.contains(now) {
		at := w.next(now).Add(newSendPlanJitter(windowOpenSpread))
		_ = s.repo.RescheduleOutbox(ctx, o.ID, at, nil, true)
		log.Info("email held until the sending window opens", "send_at", at)
		return
	}
	// Pacing again at send time: overdue emails must not leave in a burst.
	if sent, err := s.repo.SentSince(ctx, o.UserID, now.Add(-planLookback)); err == nil {
		limit, _ := s.dailySendCap(ctx, p, now)
		minGap, maxGap := s.sendGaps()
		gap := minGap + newSendPlanJitter(maxGap-minGap)
		if at := holdUntil(now, windowFor(p.ApplySettings), sent, o.ToAddress, limit, minGap, gap, newSendPlanJitter(windowOpenSpread)); !at.IsZero() {
			_ = s.repo.RescheduleOutbox(ctx, o.ID, at, nil, true)
			log.Info("email held for pacing", "send_at", at)
			return
		}
	} else {
		s.retrySend(ctx, log, o, live, "the send history could not be read", err)
		return
	}
	if why := s.checkRecipient(ctx, o.ToAddress, false); why != "" {
		s.failOutbox(ctx, o, live, fmt.Sprintf("the email to %s was not sent: %s", o.ToAddress, why))
		return
	}

	user, err := s.repo.GetUserBasics(ctx, o.UserID)
	if err != nil || user == nil {
		s.retrySend(ctx, log, o, live, "your account could not be loaded", err)
		return
	}
	var resume *ResumeInfo
	if o.ResumeID != nil {
		resume, _ = s.repo.GetResume(ctx, o.UserID, *o.ResumeID)
	}
	if resume == nil && p.ResumeID != nil {
		resume, _ = s.repo.GetResume(ctx, o.UserID, *p.ResumeID)
	}
	var doc *resumeDoc
	if resume != nil {
		doc = parseResume(resume.ExtractedJSON)
	}
	ident := buildIdentity(p, user, doc)
	data, filename, contentType, err := s.attachment(ctx, o.UserID, o.ResumeJobID, resume, ident)
	if err != nil {
		s.retrySend(ctx, log, o, live, "your resume file could not be loaded from storage", err)
		return
	}

	from, replyTo := s.sender(p, ident)
	text := o.Body + email.SignatureSeparator + strings.Join(signatureLines(ident), "\n")
	providerID, err := s.agentMail.SendMessage(ctx, email.OutboundEmail{
		From:           from,
		To:             []string{o.ToAddress},
		ReplyTo:        []string{replyTo},
		Subject:        o.Subject,
		Text:           text,
		HTML:           email.RenderHTML(o.Subject, text),
		Attachments:    []email.Attachment{{Filename: filename, ContentType: contentType, Content: data}},
		IdempotencyKey: "aethlara-outbox-" + o.ID,
	})
	if err != nil {
		if email.IsPermanent(err) {
			log.Warn("email rejected", "error", logger.TruncateError(err, 300))
			s.failOutbox(ctx, o, live, "the email provider rejected the email to "+o.ToAddress+" ("+logger.TruncateError(err, 160)+")")
			return
		}
		s.retrySend(ctx, log, o, live, "the email could not be sent", err)
		return
	}

	sentAt := time.Now()
	if err := s.repo.MarkOutboxSent(ctx, o.ID, providerID, sentAt); err != nil {
		// The lease runs out and the email is claimed again; the idempotency
		// key keeps Resend from sending a second copy.
		log.Error("email sent but not recorded", "error", err)
		return
	}
	for i := range live {
		s.markAppSent(ctx, o, &live[i], sentAt)
	}
	_, _ = s.repo.InsertMessage(ctx, Message{
		UserID: o.UserID, Direction: "outbound", ProviderID: strPtr(providerID),
		FromAddress: senderAddress(from), ToAddresses: []string{o.ToAddress}, Subject: o.Subject, TextBody: text,
		Category: strPtr("application"), ApplicationID: &live[0].ID, JobID: live[0].JobID,
		TriageStatus: "skipped", ReceivedAt: sentAt,
	})
	log.Info("email sent", "applications", len(live), "attempt", o.Attempts)
}

// markAppSent moves one application of a sent email to submitted.
func (s *Service) markAppSent(ctx context.Context, o *OutboxEmail, app *Application, at time.Time) {
	lead, err := s.repo.GetLead(ctx, app.UserID, app.LeadID)
	if err != nil || lead == nil {
		return
	}
	if o.Kind == OutboxColdEmail && app.JobID == nil {
		if rec, err := s.jobs.RecordLeadApplication(ctx, app.UserID, job.LeadRecordInput{
			ResumeID: deref(o.ResumeID), JobURL: lead.URL, Title: lead.Title, Company: lead.Company,
			Note: "The posting could not be read, so the agent emailed " + o.ToAddress + " directly.",
		}); err == nil {
			app.JobID = &rec.ID
			_ = s.repo.SetLeadJob(ctx, lead.ID, rec.ID)
		}
	}
	app.Status = AppSubmitted
	app.SubmittedAt = &at
	app.LastError = nil
	app.Needs = nil
	if err := s.repo.SaveApplication(ctx, app); err != nil {
		logger.FromContext(ctx).Error("email sent but application not updated", "component", "agent",
			"application_id", app.ID, "error", err)
		return
	}
	s.markSubmitted(ctx, app.UserID, lead, app)
	msg := fmt.Sprintf("Emailed your application for %s at %s to %s", lead.Title, lead.Company, o.ToAddress)
	if o.Kind == OutboxColdEmail {
		msg = fmt.Sprintf("Couldn't apply to %s at %s through a posting, so emailed %s directly", lead.Title, lead.Company, o.ToAddress)
	}
	s.event(ctx, Event{UserID: app.UserID, Kind: EventEmailSent, Level: "success", LeadID: &lead.ID, ApplicationID: &app.ID, Message: msg})
}

// retrySend puts an email back in the queue after a temporary failure, or
// fails it once it has used its attempts.
func (s *Service) retrySend(ctx context.Context, log *slog.Logger, o *OutboxEmail, live []Application, msg string, cause error) {
	if o.Attempts >= maxSendAttempts {
		log.Warn("email failed for good", "error", logger.TruncateError(cause, 300), "attempts", o.Attempts)
		s.failOutbox(ctx, o, live, fmt.Sprintf("%s (gave up after %d attempts)", msg, o.Attempts))
		return
	}
	wait := sendBackoff[min(max(o.Attempts-1, 0), len(sendBackoff)-1)]
	note := msg
	if cause != nil {
		note += ": " + logger.TruncateError(cause, 200)
	}
	_ = s.repo.RescheduleOutbox(ctx, o.ID, time.Now().Add(wait), &note, false)
	log.Warn("email deferred", "error", logger.TruncateError(cause, 300), "attempt", o.Attempts, "retry_in", wait.String())
}

// failOutbox closes an email that will not be sent and fails its
// applications with msg.
func (s *Service) failOutbox(ctx context.Context, o *OutboxEmail, live []Application, msg string) {
	_ = s.repo.FinishOutbox(ctx, o.ID, OutboxFailed, &msg)
	for i := range live {
		app := &live[i]
		lead, err := s.repo.GetLead(ctx, app.UserID, app.LeadID)
		if err != nil || lead == nil {
			continue
		}
		s.failApplication(ctx, nil, app.UserID, app, lead, msg, &RunStats{})
	}
}

// scheduleEmail queues one email carrying apps (several only for a cold
// email to one address) at the plan's next slot for to.
func (s *Service) scheduleEmail(ctx context.Context, p *Profile, plan *sendPlan, resume *ResumeInfo, apps []*Application, kind, to, subject, body string) (time.Time, error) {
	at := plan.slot(time.Now(), to)
	o := OutboxEmail{UserID: p.UserID, Kind: kind, ToAddress: to, Subject: subject, Body: body, ScheduledAt: at}
	if resume != nil {
		o.ResumeID = &resume.ID
	}
	if kind == OutboxApplication && len(apps) == 1 && !apps[0].UseOriginalResume && apps[0].JobID != nil {
		o.ResumeJobID = apps[0].JobID
	}
	stored, err := s.repo.InsertOutbox(ctx, o)
	if err != nil || stored == nil {
		return at, ErrInternal
	}
	for _, app := range apps {
		app.OutboxID = &stored.ID
		app.Status = AppScheduled
		app.LastError = nil
		app.Needs = nil
		app.Attempts = 0
		if err := s.repo.SaveApplication(ctx, app); err != nil {
			return at, ErrInternal
		}
	}
	return at, nil
}

// scheduledEvent records that an application's email is queued.
func (s *Service) scheduledEvent(ctx context.Context, run *Run, p *Profile, app *Application, lead *Lead, at time.Time, msg string) {
	var runID *string
	if run != nil {
		runID = &run.ID
	}
	data, _ := json.Marshal(map[string]any{"scheduled_at": at.UTC(), "to": deref(app.ApplyEmail)})
	s.event(ctx, Event{UserID: p.UserID, RunID: runID, Kind: EventScheduled, Level: "info", LeadID: &lead.ID,
		ApplicationID: &app.ID, Data: data, Message: msg + " " + sendTimeText(at, windowFor(p.ApplySettings))})
}

// sendTimeText describes a send time in the user's sending timezone:
// "(sends Mon 17 Nov, 09:14 Africa/Lagos)".
func sendTimeText(at time.Time, w sendWindow) string {
	return "(sends " + at.In(w.loc).Format("Mon 2 Jan, 15:04") + " " + w.loc.String() + ")"
}

// ── Message parts ─────────────────────────────────────────────────────────────

// nameUnsafe matches characters that would need quoting in a From name.
var nameUnsafe = regexp.MustCompile(`[\r\n<>"(),;:\\\[\]@]+`)

func displayName(n string) string {
	n = strings.Join(strings.Fields(nameUnsafe.ReplaceAllString(n, " ")), " ")
	if n == "" {
		return "Applicant"
	}
	return clipText(n, 70)
}

// sender returns the From and Reply-To of the user's emails: their agent
// mailbox, or without one the platform address with replies going to the
// account email.
func (s *Service) sender(p *Profile, ident identity) (from, replyTo string) {
	name := displayName(ident.FullName)
	if p.MailboxAddress != nil && *p.MailboxAddress != "" {
		return fmt.Sprintf("%s <%s>", name, *p.MailboxAddress), *p.MailboxAddress
	}
	return fmt.Sprintf("%s via %s <%s>", name, displayName(s.cfg.AppName), s.cfg.EmailFromAddress), ident.Email
}

func senderAddress(from string) string {
	if i := strings.LastIndexByte(from, '<'); i >= 0 {
		return strings.Trim(from[i:], "<> ")
	}
	return from
}

// signatureLines is the block under the email: name and contact details.
func signatureLines(ident identity) []string {
	lines := []string{displayName(ident.FullName)}
	for _, v := range []string{ident.Email, ident.Phone, ident.LinkedIn, ident.GitHub, ident.Portfolio} {
		if v = strings.TrimSpace(v); v != "" {
			lines = append(lines, v)
		}
	}
	return lines
}

// newSendPlanJitter is a random duration in [0, upTo) outside a plan.
func newSendPlanJitter(upTo time.Duration) time.Duration {
	if upTo <= 0 {
		return 0
	}
	return time.Duration(newRand().Int64N(int64(upTo)))
}
