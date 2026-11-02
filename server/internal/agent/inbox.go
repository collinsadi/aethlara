package agent

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"html"
	"log/slog"
	"net/http"
	"regexp"
	"strings"
	"time"

	"github.com/collinsadi/aethlara/internal/agent/sources"
	"github.com/collinsadi/aethlara/internal/ai"
	"github.com/collinsadi/aethlara/internal/email"
	"github.com/collinsadi/aethlara/internal/logger"
	"github.com/collinsadi/aethlara/internal/prompts"
)

const (
	webhookTolerance = 5 * time.Minute
	triageBodyChars  = 8000
	storedBodyChars  = 60000
	maxLinks         = 30
)

type resendEvent struct {
	Type string `json:"type"`
	Data struct {
		EmailID     string   `json:"email_id"`
		From        string   `json:"from"`
		To          []string `json:"to"`
		Cc          []string `json:"cc"`
		ReceivedFor []string `json:"received_for"`
		Subject     string   `json:"subject"`
		CreatedAt   string   `json:"created_at"`
	} `json:"data"`
}

// HandleResendWebhook verifies and ingests one Resend webhook delivery.
// Unknown event types and mail for addresses we do not host are accepted
// (200) and ignored so Resend does not retry them.
func (s *Service) HandleResendWebhook(ctx context.Context, h http.Header, body []byte) error {
	if s.cfg.ResendWebhookSecret == "" || s.cfg.AgentMailDomain == "" {
		return ErrWebhookDisable
	}
	if err := email.VerifyWebhook(s.cfg.ResendWebhookSecret, h, body, webhookTolerance, time.Now()); err != nil {
		return err
	}
	var ev resendEvent
	if err := json.Unmarshal(body, &ev); err != nil {
		return fmt.Errorf("%w: malformed webhook body", ErrInvalidInput)
	}
	if ev.Type != "email.received" || ev.Data.EmailID == "" {
		return nil
	}

	// Which of our users is this for?
	var profiles []*Profile
	seen := map[string]bool{}
	for _, raw := range append(append(append([]string{}, ev.Data.To...), ev.Data.Cc...), ev.Data.ReceivedFor...) {
		addr := strings.ToLower(strings.TrimSpace(raw))
		if i := strings.LastIndexByte(addr, '<'); i >= 0 {
			addr = strings.Trim(addr[i:], "<> ")
		}
		if !strings.HasSuffix(addr, "@"+s.cfg.AgentMailDomain) || seen[addr] {
			continue
		}
		seen[addr] = true
		p, err := s.repo.GetProfileByMailbox(ctx, addr)
		if err != nil {
			return ErrInternal
		}
		if p != nil {
			profiles = append(profiles, p)
		}
	}
	if len(profiles) == 0 {
		slog.Info("agent: inbound mail for unknown mailbox ignored")
		return nil
	}

	full, err := s.mail.GetReceivedEmail(ctx, ev.Data.EmailID)
	if err != nil {
		return fmt.Errorf("fetch received email: %w", err) // Resend retries
	}
	text := ""
	if full.Text != nil {
		text = *full.Text
	}
	if strings.TrimSpace(text) == "" {
		text = sources.HTMLToText(full.HTML)
	}
	links := extractLinks(full.HTML + "\n" + text)
	var attachments json.RawMessage
	if len(full.Attachments) > 0 {
		meta := make([]map[string]any, 0, len(full.Attachments))
		for _, a := range full.Attachments {
			meta = append(meta, map[string]any{"filename": a.Filename, "content_type": a.ContentType, "size": a.Size})
		}
		attachments, _ = json.Marshal(meta)
	}
	received := time.Now()
	if t, err := time.Parse(time.RFC3339Nano, full.CreatedAt); err == nil {
		received = t
	}

	for _, p := range profiles {
		m, err := s.repo.InsertMessage(ctx, Message{
			UserID:      p.UserID,
			Direction:   "inbound",
			ProviderID:  strPtr(full.ID),
			MessageID:   strPtr(full.MessageID),
			FromAddress: full.FromAddress(),
			FromName:    strPtr(full.FromName()),
			ToAddresses: full.To,
			Subject:     clipText(full.Subject, 500),
			TextBody:    clipText(text, storedBodyChars),
			Links:       links,
			Attachments: attachments,
			SenderAuth:  full.SenderAuth(),
			ReceivedAt:  received,
		})
		if err != nil {
			return ErrInternal
		}
		if m != nil {
			s.event(ctx, Event{UserID: p.UserID, Kind: EventMailReceived,
				Message: fmt.Sprintf("New email from %s: %s", firstNonEmpty(deref(m.FromName), m.FromAddress), clipText(m.Subject, 120))})
		}
	}
	s.kickTriage()
	return nil
}

var hrefRe = regexp.MustCompile(`(?i)(?:href=["']?|\b)(https?://[^\s"'<>]+)`)

func extractLinks(s string) []string {
	seen := map[string]bool{}
	var out []string
	for _, m := range hrefRe.FindAllStringSubmatch(s, -1) {
		u := strings.TrimRight(html.UnescapeString(m[1]), ".,);]")
		if len(u) > 2048 || seen[u] {
			continue
		}
		seen[u] = true
		out = append(out, u)
		if len(out) == maxLinks {
			break
		}
	}
	return out
}

func (s *Service) kickTriage() {
	select {
	case s.triageCh <- struct{}{}:
	default:
	}
}

// triageLoop classifies pending inbound mail as it arrives (and every
// minute as a fallback).
func (s *Service) triageLoop(ctx context.Context) {
	ticker := time.NewTicker(time.Minute)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-s.triageCh:
		case <-ticker.C:
		}
		s.triagePending(ctx)
	}
}

func (s *Service) triagePending(ctx context.Context) {
	msgs, err := s.repo.PendingTriage(ctx, 25)
	if err != nil {
		slog.Error("agent: load pending triage failed", "error", err)
		return
	}
	for i := range msgs {
		if ctx.Err() != nil {
			return
		}
		s.triageOne(ctx, &msgs[i])
	}
}

type importantAlert struct {
	category, subject, summary, action string
}

func (s *Service) triageOne(ctx context.Context, m *Message) {
	log := logger.FromContext(ctx).With("component", "agent", "operation", "triage", "message_id", m.ID)
	apps, _ := s.repo.ApplicationsForMatching(ctx, m.UserID, 40)
	var appLines strings.Builder
	appByID := map[string]AppMatch{}
	for _, a := range apps {
		appByID[a.ApplicationID] = a
		fmt.Fprintf(&appLines, "- id: %s | company: %s | title: %s | status: %s\n", a.ApplicationID, a.Company, a.Title, a.Status)
	}

	from := m.FromAddress
	if m.FromName != nil && *m.FromName != "" {
		from = *m.FromName + " <" + m.FromAddress + ">"
	}
	resp, err := s.ai.Complete(ctx, ai.Request{
		UserID:        m.UserID,
		SystemPrompt:  prompts.EmailTriageSystemPrompt(),
		UserMessage:   prompts.EmailTriageUserMessage(from, m.Subject, m.ReceivedAt.UTC().Format(time.RFC1123), clipText(m.TextBody, triageBodyChars), strings.Join(m.Links, "\n"), appLines.String()),
		PromptVersion: prompts.EmailTriageV1,
		Stage:         ai.StageEmailTriage,
		Tier:          ai.TierFast,
		JSONSchema:    prompts.EmailTriageSchema(),
		CacheSystem:   true,
	})
	if err != nil {
		if errors.Is(err, ai.ErrNoAPIKey) {
			other := prompts.EmailOther
			_ = s.repo.SetMessageTriage(ctx, m.ID, MessageTriageUpdate{Status: "skipped", Category: &other})
			return
		}
		log.Warn("triage failed", "error", logger.TruncateError(err, 200), "error_type", ai.ClassifyError(err))
		_ = s.repo.BumpTriageAttempt(ctx, m.ID)
		return
	}
	var t TriageResult
	if err := json.Unmarshal([]byte(resp.Content), &t); err != nil {
		_ = s.repo.BumpTriageAttempt(ctx, m.ID)
		return
	}

	// Never trust a link or id the model produced unless we gave it to it.
	if t.VerificationLink != nil && !contains(m.Links, *t.VerificationLink) {
		t.VerificationLink = nil
	}
	var matched *AppMatch
	if t.MatchedApplication != nil {
		if a, ok := appByID[*t.MatchedApplication]; ok {
			matched = &a
		} else {
			t.MatchedApplication = nil
		}
	}

	important := false
	switch t.Category {
	case prompts.EmailInterview, prompts.EmailAssessment, prompts.EmailOffer:
		important = true
	case prompts.EmailRecruiter, prompts.EmailRejection, prompts.EmailConfirmation:
		important = t.ActionRequired
	}

	if m.SenderAuth == "fail" {
		important = false // unverified senders never page the user
	}

	upd := MessageTriageUpdate{
		Status: "done", Category: &t.Category, Summary: strPtr(clipText(t.Summary, 400)),
		Extracted: &t, Important: important,
	}
	if matched != nil {
		upd.ApplicationID = &matched.ApplicationID
		upd.JobID = matched.JobID
	}
	if err := s.repo.SetMessageTriage(ctx, m.ID, upd); err != nil {
		log.Warn("save triage failed", "error", err)
		return
	}

	// Spoofed mail (failed SPF/DKIM/DMARC) is kept and labelled, but must
	// not move the tracker or page the user.
	if m.SenderAuth == "fail" {
		log.Info("triage: sender authentication failed; no automatic actions")
		return
	}
	if matched != nil {
		s.applyMailOutcome(ctx, m.UserID, *matched, t.Category)
	}
	if important {
		s.alertImportant(ctx, m.UserID, importantAlert{
			category: t.Category, subject: m.Subject, summary: t.Summary, action: deref(t.Action),
		})
	}
}

func contains(list []string, v string) bool {
	for _, x := range list {
		if x == v {
			return true
		}
	}
	return false
}

// applyMailOutcome moves the tracker forward based on what the email says.
func (s *Service) applyMailOutcome(ctx context.Context, userID string, m AppMatch, category string) {
	target := ""
	switch category {
	case prompts.EmailConfirmation:
		target = "applied"
	case prompts.EmailRejection:
		target = "rejected"
	case prompts.EmailInterview, prompts.EmailAssessment:
		target = "interview"
	case prompts.EmailOffer:
		target = "offer"
	default:
		return
	}

	// A confirmation proves the application went through even if the
	// extension reported otherwise.
	if category == prompts.EmailConfirmation && m.Status != AppSubmitted {
		if app, err := s.repo.GetApplication(ctx, userID, m.ApplicationID); err == nil && app != nil {
			now := time.Now()
			app.Status = AppSubmitted
			app.SubmittedAt = &now
			app.Needs = nil
			app.LastError = nil
			if s.repo.SaveApplication(ctx, app) == nil {
				_, _ = s.repo.SetLeadStatus(ctx, userID, app.LeadID, LeadApplied, nil, false)
			}
		}
	}
	if m.JobID == nil {
		return
	}
	j, err := s.jobs.AdvanceStatus(ctx, *m.JobID, userID, target)
	if err != nil {
		return // already past this stage (e.g. rejected then a late confirmation)
	}
	s.event(ctx, Event{UserID: userID, Kind: EventStatusChanged, Level: levelFor(target), ApplicationID: &m.ApplicationID,
		Message: fmt.Sprintf("%s at %s moved to %s", m.Title, m.Company, strings.ReplaceAll(j.Status, "_", " "))})
}

func levelFor(status string) string {
	switch status {
	case "interview", "offer":
		return "success"
	case "rejected":
		return "warning"
	default:
		return "info"
	}
}

func (s *Service) alertImportant(ctx context.Context, userID string, a importantAlert) {
	p, err := s.repo.GetProfile(ctx, userID)
	if err != nil || p == nil || !p.ApplySettings.ImportantAlerts {
		return
	}
	user, err := s.repo.GetUserBasics(ctx, userID)
	if err != nil || user == nil {
		return
	}
	label := map[string]string{
		prompts.EmailInterview: "Interview request", prompts.EmailAssessment: "Assessment to complete",
		prompts.EmailOffer: "Offer", prompts.EmailRecruiter: "Recruiter reply",
	}[a.category]
	if label == "" {
		label = "Action needed"
	}
	subject := fmt.Sprintf("%s: %s", label, clipText(a.subject, 120))
	body := fmt.Sprintf(`<p style="font-size:15px;color:#111">%s</p>`, html.EscapeString(a.summary))
	if a.action != "" {
		body += fmt.Sprintf(`<p style="font-size:15px;color:#111"><strong>What to do:</strong> %s</p>`, html.EscapeString(a.action))
	}
	body += fmt.Sprintf(`<p><a href="%s/inbox" style="color:#fd3a25;font-weight:600">Open the agent inbox</a></p>`, html.EscapeString(s.cfg.DashboardURL))
	if err := s.mail.SendNotification(ctx, user.Email, subject, wrapEmail(subject, body)); err != nil {
		slog.Warn("agent: important mail alert failed", "user_id", userID, "error", err)
	}
}

// wrapEmail renders a minimal notification email body.
func wrapEmail(title, inner string) string {
	return `<!DOCTYPE html><html><body style="margin:0;padding:32px;background:#f5f5f5;font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif">` +
		`<div style="max-width:560px;margin:0 auto;background:#fff;border:1px solid #e4e4e7;border-radius:14px;padding:28px">` +
		`<h2 style="margin:0 0 16px;font-size:20px;color:#09090b">` + html.EscapeString(title) + `</h2>` + inner +
		`<p style="margin-top:24px;font-size:12px;color:#71717a">Sent by your Aethlara autopilot.</p></div></body></html>`
}

// ── Inbox queries ─────────────────────────────────────────────────────────────

func (s *Service) ListInbox(ctx context.Context, userID, category string, page, pageSize int) ([]Message, int, error) {
	msgs, total, err := s.repo.ListMessages(ctx, userID, category, pageSize, (page-1)*pageSize)
	if err != nil {
		return nil, 0, ErrInternal
	}
	return msgs, total, nil
}

func (s *Service) GetMessage(ctx context.Context, userID, id string) (*Message, error) {
	m, err := s.repo.GetMessage(ctx, userID, id)
	if err != nil {
		return nil, ErrInternal
	}
	if m == nil {
		return nil, ErrNotFound
	}
	return m, nil
}

func (s *Service) MarkRead(ctx context.Context, userID, id string, read bool) error {
	if err := s.repo.MarkMessageRead(ctx, userID, id, read); err != nil {
		return ErrInternal
	}
	return nil
}

// Verification is a code or link the extension can use to finish an
// application that asked for email verification.
type Verification struct {
	MessageID  string
	From       string
	Subject    string
	Code       *string
	Link       *string
	ReceivedAt time.Time
}

var codeRe = regexp.MustCompile(`\b([A-Z0-9]{6,8}|\d{4,8})\b`)

// RecentVerifications returns verification codes/links received since t.
// Mail not yet triaged is scanned with a simple pattern so the extension
// does not have to wait for the AI.
func (s *Service) RecentVerifications(ctx context.Context, userID string, since time.Time) ([]Verification, error) {
	msgs, err := s.repo.RecentVerifications(ctx, userID, since)
	if err != nil {
		return nil, ErrInternal
	}
	out := []Verification{}
	for _, m := range msgs {
		v := Verification{MessageID: m.ID, From: m.FromAddress, Subject: m.Subject, ReceivedAt: m.ReceivedAt}
		if m.Extracted != nil {
			v.Code, v.Link = m.Extracted.VerificationCode, m.Extracted.VerificationLink
		} else if strings.Contains(strings.ToLower(m.Subject+" "+m.TextBody), "code") {
			if c := codeRe.FindString(m.TextBody); c != "" {
				v.Code = &c
			}
		}
		if v.Code != nil || v.Link != nil {
			out = append(out, v)
		}
	}
	return out, nil
}
