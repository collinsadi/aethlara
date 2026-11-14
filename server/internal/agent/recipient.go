package agent

import (
	"context"
	"fmt"
	"strings"
)

// Recipients. Every application is an email, so preparing one means
// finding where to send it, best source first:
//  1. an address the user gave for this application,
//  2. the address the posting says to apply to,
//  3. an address the company publishes for hiring (careers@, jobs@ ...) or,
//     failing that, a general one (hello@, contact@ ...), found on its own
//     site or confirmed on a page web search cites (contact.go).
// Each address must look deliverable before it is used: valid, on a domain
// that accepts mail, not a no-reply inbox, not an agent mailbox, and not on
// the suppression list. Mail to addresses that bounce is what gets a
// sending domain blocklisted, so the agent never guesses an address: a job
// with no address to send to is dropped.

// recipient is where an application email goes.
type recipient struct {
	Email  string
	Kind   string // RecipientPosting | RecipientHiring | RecipientGeneral | RecipientPerson | RecipientUser
	Source string // the page the address was published on
}

// dismissNoEmail is the lead's dismiss reason when no address was found.
const dismissNoEmail = "no_email"

// undeliverableLocals are inboxes that never read applications.
var undeliverableLocals = map[string]bool{
	"noreply": true, "no-reply": true, "donotreply": true, "do-not-reply": true, "mailer-daemon": true,
	"postmaster": true, "bounce": true, "bounces": true, "abuse": true, "unsubscribe": true,
}

// checkRecipient returns why address cannot receive an application, "" when
// it can. withMX also requires the domain to publish mail exchangers (skip
// it where a DNS hiccup must not fail an application outright).
func (s *Service) checkRecipient(ctx context.Context, address string, withMX bool) string {
	addr := strings.ToLower(strings.TrimSpace(address))
	if !validEmail(addr) || strings.ContainsAny(addr, " ,;<>\"'()[]\\") {
		return "it is not a valid email address"
	}
	local, domain, _ := strings.Cut(addr, "@")
	if i := strings.IndexByte(local, '+'); i > 0 {
		local = local[:i]
	}
	if undeliverableLocals[local] {
		return "it is a no-reply address"
	}
	if d := s.cfg.AgentMailDomain; d != "" && (domain == d || strings.HasSuffix(domain, "."+d)) {
		return "it is an agent mailbox"
	}
	if reason := s.suppressionReason(ctx, addr); reason != "" {
		return suppressionText(reason)
	}
	if withMX && s.lookupMX != nil && !s.lookupMX(ctx, domain) {
		return domain + " does not accept email (it has no MX record)"
	}
	return ""
}

// suppressionReason is why address is on the do-not-email list ("" if not).
func (s *Service) suppressionReason(ctx context.Context, address string) string {
	if s.repo == nil {
		return ""
	}
	reason, err := s.repo.Suppression(ctx, address)
	if err != nil {
		return ""
	}
	return reason
}

func suppressionText(reason string) string {
	switch reason {
	case "complaint":
		return "an earlier email to it was marked as spam, so no agent emails it again"
	case "bounce":
		return "an earlier email to it bounced, so no agent emails it again"
	default:
		return "it is on the email provider's suppression list"
	}
}

// resolveRecipient finds the address to send an application to. When there
// is none it returns nil and a sentence saying why.
func (s *Service) resolveRecipient(ctx context.Context, p *Profile, lead *Lead, app *Application, clues *siteClues) (*recipient, string) {
	if c := userContact(app); c != nil {
		if why := s.checkRecipient(ctx, c.Email, true); why != "" {
			return nil, fmt.Sprintf("the address you gave (%s) can't be used: %s", c.Email, why)
		}
		return &recipient{Email: c.Email, Kind: RecipientUser}, ""
	}
	var notes []string
	if lead.ApplyEmail != nil && *lead.ApplyEmail != "" {
		addr := strings.ToLower(strings.TrimSpace(*lead.ApplyEmail))
		why := s.checkRecipient(ctx, addr, true)
		if why == "" {
			return &recipient{Email: addr, Kind: RecipientPosting, Source: lead.URL}, ""
		}
		notes = append(notes, fmt.Sprintf("the posting's address %s can't be used (%s)", addr, why))
	}
	if p.MailboxAddress == nil || *p.MailboxAddress == "" {
		notes = append(notes, "the posting gives no email address, and looking one up needs an agent mailbox")
		return nil, strings.Join(notes, "; ")
	}
	if c := s.findContact(ctx, p.UserID, lead, clues); c != nil {
		return &recipient{Email: c.Email, Kind: c.Kind, Source: c.Source}, ""
	}
	notes = append(notes, lead.Company+" doesn't publish an email address for applications on its website or in the posting")
	return nil, strings.Join(notes, "; ")
}

// userContact is the address the user gave for app, if any.
func userContact(app *Application) *contactInfo {
	if app.RecipientKind == nil || *app.RecipientKind != RecipientUser || app.ApplyEmail == nil || *app.ApplyEmail == "" {
		return nil
	}
	return &contactInfo{Email: strings.ToLower(strings.TrimSpace(*app.ApplyEmail)), Kind: RecipientUser}
}

// dropNoEmail gives up on a job no email can be sent for: the posting gives
// no usable address and the company publishes none. The application is
// cancelled and the lead dismissed (reason no_email), so the job never
// waits on the user.
func (s *Service) dropNoEmail(ctx context.Context, run *Run, userID string, app *Application, lead *Lead, why string, stats *RunStats) error {
	msg := clipText(sentenceCase(why), 500)
	app.Status = AppCancelled
	app.Needs = nil
	app.LastError = &msg
	app.OutboxID = nil
	app.ClaimExpiresAt = nil
	if err := s.repo.SaveApplication(ctx, app); err != nil {
		return ErrInternal
	}
	reason := dismissNoEmail
	_, _ = s.repo.SetLeadStatus(ctx, userID, lead.ID, LeadDismissed, &reason, false)
	stats.Dropped++
	var runID *string
	if run != nil {
		runID = &run.ID
	}
	s.event(ctx, Event{UserID: userID, RunID: runID, Kind: EventAppDropped, Level: "warning", LeadID: &lead.ID, ApplicationID: &app.ID,
		Message: fmt.Sprintf("Dropped %s at %s: no email address to apply to. %s", lead.Title, lead.Company, msg)})
	return nil
}

func sentenceCase(s string) string {
	s = strings.TrimSpace(s)
	if s == "" {
		return s
	}
	s = strings.ToUpper(s[:1]) + s[1:]
	if !strings.HasSuffix(s, ".") {
		s += "."
	}
	return s
}

// SetRecipient makes the agent send an application to an address the user
// chose (the posting has none, the one found bounced, or the user knows the
// recruiter). The next run prepares and schedules it.
func (s *Service) SetRecipient(ctx context.Context, userID, appID, address string) (*Application, error) {
	app, err := s.repo.GetApplication(ctx, userID, appID)
	if err != nil {
		return nil, ErrInternal
	}
	if app == nil {
		return nil, ErrNotFound
	}
	switch app.Status {
	case AppNeedsInput, AppFailed, AppCancelled, AppQueued, AppScheduled:
	default:
		return nil, fmt.Errorf("%w: this application can't be redirected while it is %s", ErrInvalidInput, strings.ReplaceAll(app.Status, "_", " "))
	}
	addr := strings.ToLower(strings.TrimSpace(address))
	if len(addr) > 254 {
		return nil, fmt.Errorf("%w: that address is too long", ErrInvalidInput)
	}
	if why := s.checkRecipient(ctx, addr, true); why != "" {
		return nil, fmt.Errorf("%w: %s can't receive the application: %s", ErrInvalidInput, addr, why)
	}
	if app.Status == AppScheduled {
		if err := s.unschedule(ctx, userID, app); err != nil {
			return nil, err
		}
	}
	app.ApplyEmail = &addr
	app.RecipientKind = strPtr(RecipientUser)
	app.RecipientSource = nil
	app.Status = AppQueued
	app.Needs = nil
	app.LastError = nil
	app.Attempts = 0
	app.OutboxID = nil
	app.ClaimExpiresAt = nil
	if app.Channel == ChannelBrowser {
		app.Channel = ChannelEmail
	}
	if err := s.repo.SaveApplication(ctx, app); err != nil {
		return nil, ErrInternal
	}
	_, _ = s.repo.SetLeadStatus(ctx, userID, app.LeadID, LeadApproved, nil, false)
	return s.repo.GetApplication(ctx, userID, appID)
}

// unschedule takes app's email out of the send queue. Other applications
// the same email covered (a cold email about several roles) go back to the
// queue so the next run writes them a new email.
func (s *Service) unschedule(ctx context.Context, userID string, app *Application) error {
	if app.OutboxID == nil {
		return nil
	}
	ok, err := s.repo.CancelScheduledOutbox(ctx, userID, *app.OutboxID)
	if err != nil {
		return ErrInternal
	}
	if !ok {
		return fmt.Errorf("%w: the email is being sent right now", ErrInvalidInput)
	}
	if _, err := s.repo.RequeueOutboxApplications(ctx, userID, *app.OutboxID, app.ID); err != nil {
		return ErrInternal
	}
	app.OutboxID = nil
	return nil
}
