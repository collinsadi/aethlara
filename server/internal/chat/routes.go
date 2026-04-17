package chat

import (
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"
	"golang.org/x/time/rate"

	"github.com/collinsadi/aethlara/internal/config"
	"github.com/collinsadi/aethlara/internal/middleware"
)

// RegisterRoutes wires the chat module into a chi router.
//
// Rate limits (per-user, enforced on authenticated endpoints):
//
//   - POST /chat/sessions/:id/messages  →  10/min, 30/hour
//     (the hourly budget is implemented as a second limiter)
//   - POST /chat/sessions               →  20/min (session creation is cheap
//     compared to AI calls but still bounded)
//
// Endpoints that trigger OpenRouter calls additionally run through the AI gate
// middleware which checks the user has a valid API key on file.
func RegisterRoutes(
	r chi.Router,
	h *Handler,
	cfg *config.Config,
	aiGate func(http.Handler) http.Handler,
) {
	// Send-message limiters — ANDed: request must satisfy both.
	sendPerMinute := middleware.NewUserRateLimiter(rate.Every(time.Minute/10), 10) // 10/min, burst 10
	sendPerHour := middleware.NewUserRateLimiter(rate.Every(time.Minute*2), 30)    // 30/hour, burst 30

	// Session create — cheaper, but still per-user throttled.
	sessionCreateLimiter := middleware.NewUserRateLimiter(rate.Every(time.Second*3), 20)

	r.Route("/chat", func(r chi.Router) {
		r.Use(middleware.RequireAuth(cfg))

		r.Route("/sessions", func(r chi.Router) {
			r.Get("/", h.ListSessions)

			// Creating a session does NOT itself call OpenRouter, but the gate
			// is applied so the user gets the consistent 403 before we burn a
			// DB round-trip.
			r.With(sessionCreateLimiter.Middleware(), aiGate).Post("/", h.CreateOrGetSession)

			r.Route("/{session_id}", func(r chi.Router) {
				r.Get("/messages", h.GetMessages)

				r.With(
					sendPerMinute.Middleware(),
					sendPerHour.Middleware(),
					aiGate,
				).Post("/messages", h.SendMessage)

				r.Delete("/", h.DeleteSession)
			})
		})
	})
}
