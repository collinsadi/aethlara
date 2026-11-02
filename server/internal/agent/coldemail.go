package agent

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/url"
	"regexp"
	"strings"
	"time"

	"github.com/collinsadi/aethlara/internal/ai"
	"github.com/collinsadi/aethlara/internal/email"
	"github.com/collinsadi/aethlara/internal/job"
	"github.com/collinsadi/aethlara/internal/logger"
	"github.com/collinsadi/aethlara/internal/prompts"
	"github.com/collinsadi/aethlara/pkg/sanitise"
)

// Cold email fallback: when the agent cannot read a posting (it closed, the
// link was a careers index, web search reported a role that is not listed),
// it emails an address the company publishes, with the original resume.
// Applications to the same address in one run share a single email, and an
// address is emailed at most once per cooldown.

const coldEmailCooldown = 14 * 24 * time.Hour

var errPostingUnreadable = errors.New("posting could not be found or read")

// coldEmailJob is one application handed to the cold email fallback.
type coldEmailJob struct {
	app          *Application
	lead         *Lead
	contact      *contactInfo
	postingFound bool
	reason       string // why applying through the posting failed
}

// coldEmailResult is stored in applications.result for cold emails.
type coldEmailResult struct {
	Kind          string   `json:"kind"` // "cold_email"
	To            string   `json:"to"`
	ContactKind   string   `json:"contact_kind"`
	ContactSource string   `json:"contact_source"`
	Subject       string   `json:"subject"`
	Roles         []string `json:"roles"`
	Reason        string   `json:"reason"`
}

// sendColdEmails sends one email per address for the fallbacks collected
// during a run. Returns ai.ErrNoAPIKey (after re-queueing what is left)
// when the user's AI key stops working.
func (s *Service) sendColdEmails(ctx context.Context, run *Run, p *Profile, user *UserBasics, resume *ResumeInfo, jobs []coldEmailJob, stats *RunStats) error {
	groups := map[string][]coldEmailJob{}
	var order []string
	for _, j := range jobs {
		k := strings.ToLower(j.contact.Email)
		if _, ok := groups[k]; !ok {
			order = append(order, k)
		}
		groups[k] = append(groups[k], j)
	}
	doc := parseResume(resume.ExtractedJSON)
	ident := buildIdentity(p, user, doc)
	for i, addr := range order {
		err := ctx.Err()
		if err == nil {
			err = s.sendColdEmail(ctx, run, p, ident, doc, resume, groups[addr], stats)
		}
		if err != nil {
			// Out of time or no usable key: hand the rest back to the queue.
			for _, rest := range order[i:] {
				for _, j := range groups[rest] {
					j.app.Status = AppQueued
					_ = s.repo.SaveApplication(context.WithoutCancel(ctx), j.app)
					_, _ = s.repo.SetLeadStatus(context.WithoutCancel(ctx), p.UserID, j.lead.ID, LeadApproved, nil, false)
				}
			}
			return err
		}
	}
	return nil
}

func (s *Service) sendColdEmail(ctx context.Context, run *Run, p *Profile, ident identity, doc *resumeDoc, resume *ResumeInfo, group []coldEmailJob, stats *RunStats) error {
	log := logger.FromContext(ctx).With("component", "agent", "operation", "cold_email")
	first := group[0]
	addr := first.contact.Email
	failAll := func(msg string) error {
		for _, j := range group {
			s.failApplication(ctx, run, p.UserID, j.app, j.lead, msg, stats)
		}
		return nil
	}

	if at, title, err := s.repo.LastColdEmail(ctx, p.UserID, addr, time.Now().Add(-coldEmailCooldown)); err != nil {
		return failAll("the posting could not be read and the email history could not be checked")
	} else if at != nil {
		return failAll(fmt.Sprintf("the posting could not be read, and %s was already emailed on %s about %s; the agent waits two weeks before emailing the same address again",
			addr, at.Format("Jan 2"), title))
	}

	subject, body, err := s.writeColdEmail(ctx, p.UserID, ident, doc, group)
	if err != nil {
		return err // ai.ErrNoAPIKey
	}
	data, filename, contentType, err := s.resumeFile(ctx, p.UserID, &Application{UseOriginalResume: true}, resume, ident)
	if err != nil {
		return failAll("the posting could not be read and your resume file could not be loaded from storage")
	}

	name := strings.TrimSpace(headerUnsafe.ReplaceAllString(ident.FullName, " "))
	mailbox := *p.MailboxAddress
	signature := []string{name}
	for _, v := range []string{ident.Email, ident.Phone, ident.LinkedIn, ident.GitHub, ident.Portfolio} {
		if v != "" {
			signature = append(signature, v)
		}
	}
	text := body + "\n\n--\n" + strings.Join(signature, "\n")

	providerID, err := s.agentMail.SendMessage(ctx, email.OutboundEmail{
		From:        fmt.Sprintf("%s <%s>", name, mailbox),
		To:          []string{addr},
		ReplyTo:     []string{mailbox},
		Subject:     subject,
		Text:        text,
		HTML:        textToHTML(text),
		Attachments: []email.Attachment{{Filename: filename, ContentType: contentType, Content: data}},
	})
	if err != nil {
		log.Warn("cold email send failed", "error", logger.TruncateError(err, 200))
		return failAll("the posting could not be read and the email to " + addr + " could not be sent")
	}

	roles := make([]string, 0, len(group))
	for _, j := range group {
		roles = append(roles, j.lead.Title)
	}
	now := time.Now()
	for _, j := range group {
		if rec, err := s.jobs.RecordLeadApplication(ctx, p.UserID, job.LeadRecordInput{
			ResumeID: resume.ID, JobURL: j.lead.URL, Title: j.lead.Title, Company: j.lead.Company,
			Note: "The posting could not be read, so the agent emailed " + addr + " directly.",
		}); err == nil {
			j.app.JobID = &rec.ID
			_ = s.repo.SetLeadJob(ctx, j.lead.ID, rec.ID)
		}
		result, _ := json.Marshal(coldEmailResult{
			Kind: "cold_email", To: addr, ContactKind: j.contact.Kind, ContactSource: j.contact.Source,
			Subject: subject, Roles: roles, Reason: j.reason,
		})
		j.app.Channel = ChannelColdEmail
		j.app.ApplyEmail = &addr
		j.app.UseOriginalResume = true
		j.app.CoverLetter = &body
		j.app.Result = result
		j.app.Status = AppSubmitted
		j.app.SubmittedAt = &now
		j.app.LastError = nil
		j.app.Needs = nil
		if err := s.repo.SaveApplication(ctx, j.app); err != nil {
			log.Error("cold email recorded send but save failed", "application_id", j.app.ID, "error", logger.TruncateError(err, 200))
			continue
		}
		s.markSubmitted(ctx, p.UserID, j.lead, j.app)
		stats.Prepared++
		stats.EmailsSent++
		s.event(ctx, Event{UserID: p.UserID, RunID: &run.ID, Kind: EventEmailSent, Level: "success",
			LeadID: &j.lead.ID, ApplicationID: &j.app.ID,
			Message: fmt.Sprintf("Couldn't apply to %s at %s through a posting, so emailed %s directly (published on %s)",
				j.lead.Title, j.lead.Company, addr, hostOf(j.contact.Source))})
	}
	_, _ = s.repo.InsertMessage(ctx, Message{
		UserID: p.UserID, Direction: "outbound", ProviderID: strPtr(providerID),
		FromAddress: mailbox, ToAddresses: []string{addr}, Subject: subject, TextBody: text,
		Category: strPtr("application"), ApplicationID: &first.app.ID, JobID: first.app.JobID,
		TriageStatus: "skipped", ReceivedAt: now,
	})
	log.Info("cold email sent", "roles", len(group), "contact_kind", first.contact.Kind)
	return nil
}

// writeColdEmail drafts the email with the user's AI. Any failure other
// than a missing key falls back to a short plain template.
func (s *Service) writeColdEmail(ctx context.Context, userID string, ident identity, doc *resumeDoc, group []coldEmailJob) (string, string, error) {
	first := group[0]
	roles := make([]prompts.ColdEmailRole, 0, len(group))
	for _, j := range group {
		roles = append(roles, prompts.ColdEmailRole{Title: j.lead.Title, PostingFound: j.postingFound, Known: knownAboutRole(j.lead)})
	}
	resp, err := s.ai.Complete(ctx, ai.Request{
		UserID:        userID,
		SystemPrompt:  prompts.ColdEmailSystemPrompt(),
		UserMessage:   prompts.ColdEmailUserMessage(ident.FullName, first.lead.Company, first.contact.Email, recipientKind(first.contact), roles, resumeForApplication(doc)),
		PromptVersion: prompts.ColdEmailV1,
		Stage:         ai.StageColdEmail,
		JSON:          true,
		JSONSchema:    prompts.ColdEmailSchema(),
	})
	if err != nil {
		if errors.Is(err, ai.ErrNoAPIKey) {
			return "", "", err
		}
		logger.FromContext(ctx).Warn("cold email draft failed, using template", "component", "agent", "error", logger.TruncateError(err, 200))
		subject, body := coldEmailTemplate(ident, doc, group)
		return subject, body, nil
	}
	var out struct {
		Subject string `json:"subject"`
		Body    string `json:"body"`
	}
	if json.Unmarshal([]byte(resp.Content), &out) == nil {
		subject := strings.TrimSpace(headerUnsafe.ReplaceAllString(sanitise.ResumeText(out.Subject), " "))
		body := strings.TrimSpace(sanitise.ResumeText(out.Body))
		if coldEmailOK(subject, body) {
			return subject, body, nil
		}
	}
	subject, body := coldEmailTemplate(ident, doc, group)
	return subject, body, nil
}

var placeholderRe = regexp.MustCompile(`\[[^\]]{0,40}\]|\{\{|\}\}|<[A-Za-z ]{2,30}>`)

func coldEmailOK(subject, body string) bool {
	return len(subject) >= 4 && len(subject) <= 150 && len(body) >= 250 && len(body) <= 3500 &&
		!placeholderRe.MatchString(subject) && !placeholderRe.MatchString(body)
}

// coldEmailTemplate is the fallback when the AI draft is unusable.
func coldEmailTemplate(ident identity, doc *resumeDoc, group []coldEmailJob) (string, string) {
	first := group[0]
	name := strings.TrimSpace(ident.FullName)
	titles := make([]string, 0, len(group))
	for _, j := range group {
		titles = append(titles, j.lead.Title)
	}
	roleText := "the " + titles[0] + " role"
	subject := titles[0] + " - " + name
	if len(titles) > 1 {
		roleText = "the " + strings.Join(titles[:len(titles)-1], ", ") + " and " + titles[len(titles)-1] + " roles"
		subject = first.lead.Company + " roles - " + name
	}
	var sb strings.Builder
	fmt.Fprintf(&sb, "Hi %s team,\n\n", first.lead.Company)
	fmt.Fprintf(&sb, "I would like to be considered for %s at %s.", roleText, first.lead.Company)
	if summary := firstSentence(doc.summary()); summary != "" {
		sb.WriteString(" " + summary)
	}
	sb.WriteString("\n\nMy resume is attached. If this is not the right inbox, I would be grateful if you could pass it on to whoever is hiring for the role.\n\n")
	fmt.Fprintf(&sb, "Best regards,\n%s", name)
	return headerUnsafe.ReplaceAllString(subject, " "), sanitise.ResumeText(sb.String())
}

// knownAboutRole summarises what the agent knows about a role whose
// posting it could not read.
func knownAboutRole(l *Lead) string {
	var parts []string
	if d := strings.TrimSpace(l.Description); d != "" {
		parts = append(parts, clipText(d, 900))
	}
	if l.MatchSummary != nil && *l.MatchSummary != "" {
		parts = append(parts, "Why it fits the candidate: "+*l.MatchSummary)
	}
	if len(l.MatchPros) > 0 {
		parts = append(parts, "Strengths: "+strings.Join(capList(l.MatchPros, 4), "; "))
	}
	return clipText(strings.Join(parts, "\n"), 1500)
}

func recipientKind(c *contactInfo) string {
	switch c.Kind {
	case "hiring":
		return "careers or recruiting inbox"
	case "person":
		return "a person at the company"
	default:
		return "general company inbox"
	}
}

func firstSentence(s string) string {
	s = strings.TrimSpace(s)
	if i := strings.IndexAny(s, ".!?"); i > 0 && i < 300 {
		return s[:i+1]
	}
	if len(s) > 0 && len(s) <= 200 {
		return s + "."
	}
	return ""
}

func hostOf(raw string) string {
	u, err := url.Parse(raw)
	if err != nil || u.Host == "" {
		return raw
	}
	return strings.TrimPrefix(u.Host, "www.")
}

// failApplication marks an application failed with a user-facing reason.
func (s *Service) failApplication(ctx context.Context, run *Run, userID string, app *Application, lead *Lead, msg string, stats *RunStats) {
	app.Status = AppFailed
	app.LastError = &msg
	_ = s.repo.SaveApplication(ctx, app)
	_, _ = s.repo.SetLeadStatus(ctx, userID, lead.ID, LeadFailed, nil, false)
	stats.Failed++
	var runID *string
	if run != nil {
		runID = &run.ID
	}
	s.event(ctx, Event{UserID: userID, RunID: runID, Kind: EventAppFailed, Level: "error",
		LeadID: &lead.ID, ApplicationID: &app.ID,
		Message: fmt.Sprintf("Could not apply to %s at %s: %s", lead.Title, lead.Company, msg)})
}
