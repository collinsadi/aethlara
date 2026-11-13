package agent

import (
	"context"
	"fmt"
	"html"
	"log/slog"
	"strings"
	"time"

	"github.com/collinsadi/aethlara/internal/logger"
)

// Delivery outcomes. Resend reports what happened to every email through
// the same signed webhook as inbound mail. A hard bounce or a spam
// complaint puts the address on the platform-wide suppression list (no
// agent emails it again) and the application is failed or flagged.
// Repeated bounces, or any complaint, pause the user's sending for a while:
// every mailbox shares the sending domain's reputation, and providers start
// filtering a domain whose mail bounces (Resend: keep bounces under 4%) or
// draws complaints (under 0.08%).

const (
	bounceWindow     = 30 * 24 * time.Hour
	bounceMinCount   = 3  // bounces in the window before a pause is considered
	bounceMaxPercent = 10 // pause when more than this share of sent mail bounced
	bouncePause      = 24 * time.Hour
	complaintPause   = 72 * time.Hour
)

// deliveryOutcome maps a Resend webhook event onto a delivery status.
// permanent is true for hard bounces only (they suppress the address).
func deliveryOutcome(ev *resendEvent) (status, detail string, permanent bool) {
	switch ev.Type {
	case "email.delivered":
		return DeliveryDelivered, "", false
	case "email.delivery_delayed":
		return DeliveryDelayed, "", false
	case "email.complained":
		return DeliveryComplained, "the recipient marked the email as spam", false
	case "email.failed":
		if ev.Data.Failed != nil {
			detail = ev.Data.Failed.Reason
		}
		return DeliveryFailed, detail, false
	case "email.suppressed":
		if sp := ev.Data.Suppressed; sp != nil {
			detail = firstNonEmpty(sp.Message, sp.Type)
		}
		return DeliverySuppressed, detail, false
	case "email.bounced":
		b := ev.Data.Bounce
		if b == nil {
			return DeliveryBounced, "", true
		}
		detail = firstNonEmpty(b.Message, b.SubType)
		switch strings.ToLower(b.Type) {
		case "transient", "temporary":
			return DeliveryDelayed, detail, false
		case "permanent":
			return DeliveryBounced, detail, true
		default: // "undetermined": not delivered, but do not suppress on a guess
			return DeliveryBounced, detail, false
		}
	}
	return "", "", false
}

// handleDelivery records one delivery event for an email the agent sent.
func (s *Service) handleDelivery(ctx context.Context, ev *resendEvent) error {
	status, detail, permanent := deliveryOutcome(ev)
	if status == "" || ev.Data.EmailID == "" {
		return nil
	}
	o, err := s.repo.GetOutboxByProvider(ctx, ev.Data.EmailID)
	if err != nil {
		return ErrInternal // Resend retries
	}
	if o == nil {
		return nil // not from the send queue (digests, mail sent before it existed)
	}
	changed, err := s.repo.SetOutboxDelivery(ctx, o.ID, status, detail)
	if err != nil {
		return ErrInternal
	}
	if !changed {
		return nil // a retry, or an older event arriving late
	}
	ctx = context.WithValue(ctx, logger.UserIDKey, o.UserID)
	logger.FromContext(ctx).Info("email delivery update", "component", "agent", "outbox_id", o.ID, "delivery", status)

	switch status {
	case DeliveryBounced:
		if permanent {
			_ = s.repo.Suppress(ctx, o.ToAddress, "bounce", detail, &o.UserID)
		}
		s.deliveryFailed(ctx, o, EventEmailBounced, fmt.Sprintf("the email to %s bounced%s", o.ToAddress, withDetail(detail)))
		s.checkBounceRate(ctx, o.UserID)
	case DeliverySuppressed:
		_ = s.repo.Suppress(ctx, o.ToAddress, "suppressed", detail, &o.UserID)
		s.deliveryFailed(ctx, o, EventAppFailed, fmt.Sprintf("the email provider did not deliver to %s because an earlier email to it bounced or was marked as spam", o.ToAddress))
	case DeliveryFailed:
		s.deliveryFailed(ctx, o, EventAppFailed, fmt.Sprintf("the email provider could not send the email to %s%s", o.ToAddress, withDetail(detail)))
	case DeliveryComplained:
		_ = s.repo.Suppress(ctx, o.ToAddress, "complaint", detail, &o.UserID)
		s.onComplaint(ctx, o)
	}
	return nil
}

func withDetail(detail string) string {
	if detail = strings.TrimSpace(detail); detail == "" {
		return ""
	}
	return " (" + clipText(strings.TrimSuffix(detail, "."), 200) + ")"
}

// deliveryFailed fails the applications an undelivered email carried, so
// the user can give another address or apply another way.
func (s *Service) deliveryFailed(ctx context.Context, o *OutboxEmail, kind, msg string) {
	apps, err := s.repo.ApplicationsByOutbox(ctx, o.UserID, o.ID)
	if err != nil {
		return
	}
	for i := range apps {
		app := &apps[i]
		if app.Status != AppSubmitted {
			continue
		}
		app.Status = AppFailed
		app.LastError = &msg
		if s.repo.SaveApplication(ctx, app) != nil {
			continue
		}
		_, _ = s.repo.SetLeadStatus(ctx, o.UserID, app.LeadID, LeadFailed, nil, false)
		s.event(ctx, Event{UserID: o.UserID, Kind: kind, Level: "error", LeadID: &app.LeadID, ApplicationID: &app.ID,
			Message: fmt.Sprintf("Your application for %s at %s was not delivered: %s. Give the agent another address or apply another way.",
				app.LeadTitle, app.LeadCompany, msg)})
	}
}

// checkBounceRate pauses the user's sending when too much of their recent
// mail bounced: the addresses they are reaching are not real enough.
func (s *Service) checkBounceRate(ctx context.Context, userID string) {
	sent, bounced, _, err := s.repo.DeliveryStats(ctx, userID, time.Now().Add(-bounceWindow))
	if err != nil || bounced < bounceMinCount || bounced*100 <= sent*bounceMaxPercent {
		return
	}
	s.pauseSending(ctx, userID, bouncePause, fmt.Sprintf(
		"Sending paused for 24 hours: %d of your last %d emails bounced. Bouncing addresses are never emailed again, and a domain whose mail keeps bouncing starts landing in spam.",
		bounced, sent))
}

// onComplaint reacts to a recipient marking an application as spam.
func (s *Service) onComplaint(ctx context.Context, o *OutboxEmail) {
	apps, _ := s.repo.ApplicationsByOutbox(ctx, o.UserID, o.ID)
	who := o.ToAddress
	if len(apps) > 0 && apps[0].LeadCompany != "" {
		who = apps[0].LeadCompany + " (" + o.ToAddress + ")"
	}
	for i := range apps {
		a := &apps[i]
		s.event(ctx, Event{UserID: o.UserID, Kind: EventComplaint, Level: "error", LeadID: &a.LeadID, ApplicationID: &a.ID,
			Message: fmt.Sprintf("%s marked your application for %s as spam. The agent won't email %s again.", who, a.LeadTitle, o.ToAddress)})
	}
	s.pauseSending(ctx, o.UserID, complaintPause, fmt.Sprintf(
		"Sending paused for 3 days: %s marked one of your applications as spam. Complaints quickly push a sending domain into spam folders, so the agent slows down.", who))
}

// pauseSending holds the user's scheduled emails for d and tells them why.
func (s *Service) pauseSending(ctx context.Context, userID string, d time.Duration, reason string) {
	extended, err := s.repo.ExtendSendingPause(ctx, userID, time.Now().Add(d), reason)
	if err != nil || !extended {
		return
	}
	s.event(ctx, Event{UserID: userID, Kind: EventSendingPaused, Level: "warning", Message: reason})
	user, err := s.repo.GetUserBasics(ctx, userID)
	if err != nil || user == nil || s.mail == nil {
		return
	}
	body := fmt.Sprintf(`<p style="font-size:15px;color:#111">%s</p>`, html.EscapeString(reason)) +
		`<p style="font-size:15px;color:#111">Scheduled applications wait and go out once the pause ends. You can resume earlier from Applications.</p>` +
		fmt.Sprintf(`<p><a href="%s/applications" style="color:#fd3a25;font-weight:600">Open applications</a></p>`, html.EscapeString(strings.TrimRight(s.cfg.DashboardURL, "/")))
	if err := s.mail.SendNotification(ctx, user.Email, "Your autopilot paused sending", wrapEmail("Sending paused", body)); err != nil {
		slog.Warn("agent: pause notification failed", "user_id", userID, "error", err)
	}
}
