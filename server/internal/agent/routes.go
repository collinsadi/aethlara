package agent

import (
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"

	"github.com/collinsadi/aethlara/internal/config"
	"github.com/collinsadi/aethlara/internal/middleware"
)

var (
	// agentRunLimits caps manual runs (each one queries every source and
	// scores up to AGENT_MAX_LEADS_SCORED_PER_RUN postings).
	agentRunLimits = middleware.RateLimitConfig{Namespace: "agent_run", Requests: 12, Window: time.Hour}
	// agentLeadLimits caps jobs added by URL / from the extension.
	agentLeadLimits = middleware.RateLimitConfig{Namespace: "agent_lead", Requests: 40, Window: time.Hour, BurstBuffer: 5}
	// agentFillLimits caps AI form fills (one per page of a multi-page form).
	agentFillLimits = middleware.RateLimitConfig{Namespace: "agent_fill", Requests: 150, Window: time.Hour, BurstBuffer: 10}
	// webhookLimits is a per-IP ceiling for the public Resend webhook.
	webhookLimits = middleware.RateLimitConfig{Namespace: "webhook", Requests: 600, Window: time.Minute}
)

func RegisterRoutes(r chi.Router, h *Handler, cfg *config.Config, aiGate func(http.Handler) http.Handler) {
	runLimiter := middleware.NewRateLimiter(agentRunLimits)
	leadLimiter := middleware.NewRateLimiter(agentLeadLimits)
	fillLimiter := middleware.NewRateLimiter(agentFillLimits)
	apiLimiter := middleware.NewRateLimiter(middleware.APILimits)
	webhookLimiter := middleware.NewRateLimiter(webhookLimits)

	// Public: Resend signs deliveries; the handler verifies the signature.
	r.With(webhookLimiter.Middleware).Post("/webhooks/resend", h.ResendWebhook)

	r.Route("/agent", func(r chi.Router) {
		r.Use(middleware.RequireAuth(cfg))
		r.Use(apiLimiter.Middleware)

		r.Get("/overview", h.Overview)
		r.Get("/profile", h.GetProfile)
		r.Put("/profile", h.UpdateProfile)
		r.Get("/sources", h.Sources)

		r.Get("/runs", h.ListRuns)
		r.With(runLimiter.Middleware, aiGate).Post("/runs", h.StartRun)
		r.Get("/runs/{id}", h.GetRun)
		r.Get("/events", h.ListEvents)

		r.Get("/leads", h.ListLeads)
		r.With(leadLimiter.Middleware, aiGate).Post("/leads", h.AddLead)
		r.Post("/leads/decisions", h.DecideLeads)
		r.Get("/leads/{id}", h.GetLead)
		r.Post("/leads/{id}/decision", h.DecideLead)

		r.Get("/applications", h.ListApplications)
		r.Post("/applications/claim", h.ClaimApplication)
		r.Get("/applications/{id}", h.GetApplication)
		r.Get("/applications/{id}/packet", h.GetPacket)
		r.Get("/applications/{id}/resume", h.DownloadResume)
		r.Get("/applications/{id}/cover-letter.pdf", h.DownloadCoverLetter)
		r.With(fillLimiter.Middleware, aiGate).Post("/applications/{id}/fill", h.FillApplication)
		r.Post("/applications/{id}/result", h.ReportResult)
		r.Post("/applications/{id}/answers", h.SaveApplicationAnswers)
		r.Post("/applications/{id}/retry", h.RetryApplication)
		r.Post("/applications/{id}/cancel", h.CancelApplication)

		r.Get("/inbox", h.ListInbox)
		r.Get("/inbox/verifications", h.Verifications)
		r.Get("/inbox/{id}", h.GetMessage)
		r.Post("/inbox/{id}/read", h.MarkMessageRead)

		r.Get("/answers", h.ListAnswers)
		r.Put("/answers", h.UpsertAnswer)
		r.Delete("/answers/{id}", h.DeleteAnswer)
	})
}
