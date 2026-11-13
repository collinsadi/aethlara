package agent

import (
	"context"
	"log/slog"
	"time"

	"github.com/collinsadi/aethlara/internal/email"
)

// mailHealthInterval is how often the agent domain's deliverability is
// checked (Resend verification, DKIM, SPF, DMARC, MX, tracking, webhook).
const mailHealthInterval = 6 * time.Hour

func (s *Service) healthLoop(ctx context.Context) {
	if s.cfg.AgentMailDomain == "" || s.agentMail == nil {
		return
	}
	timer := time.NewTimer(10 * time.Second)
	defer timer.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-timer.C:
		}
		s.refreshMailHealth(ctx)
		timer.Reset(mailHealthInterval)
	}
}

// refreshMailHealth runs the deliverability checks and keeps the report
// for the dashboard and the send queue.
func (s *Service) refreshMailHealth(ctx context.Context) *email.HealthReport {
	ctx, cancel := context.WithTimeout(ctx, 90*time.Second)
	defer cancel()
	rep := s.agentMail.CheckDeliverability(ctx, s.cfg.AgentMailDomain, nil)
	s.health.Store(rep)
	for _, c := range rep.Checks {
		if c.Status != email.CheckOK {
			slog.Warn("agent: mail deliverability check not passing", "domain", rep.Domain, "check", c.ID,
				"status", c.Status, "detail", c.Detail)
		}
	}
	if !rep.CanSend {
		slog.Error("agent: the agent mail domain cannot send; scheduled emails are held", "domain", rep.Domain)
	} else if rep.Status == email.CheckOK {
		slog.Info("agent: mail deliverability checks pass", "domain", rep.Domain)
	}
	return rep
}

// MailHealth returns the latest deliverability report (nil before the
// first check or without an agent mail domain).
func (s *Service) MailHealth() *email.HealthReport {
	return s.health.Load()
}
