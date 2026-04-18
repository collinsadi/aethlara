package chat

import (
	"net/http"

	"github.com/go-chi/chi/v5"

	"github.com/collinsadi/aethlara/internal/config"
	"github.com/collinsadi/aethlara/internal/middleware"
)

// RegisterRoutes wires the chat module into a chi router.
//
// Rate limits (per user ID on authenticated endpoints):
//
//   - POST /chat/sessions/:id/messages  →  ChatLimits (30/hour + burst 5)
//   - POST /chat/sessions               →  APILimits (200/min + burst 20)
func RegisterRoutes(
	r chi.Router,
	h *Handler,
	cfg *config.Config,
	aiGate func(http.Handler) http.Handler,
) {
	sendLimiter    := middleware.NewRateLimiter(middleware.ChatLimits)
	sessionLimiter := middleware.NewRateLimiter(middleware.APILimits)

	r.Route("/chat", func(r chi.Router) {
		r.Use(middleware.RequireAuth(cfg))

		r.Route("/sessions", func(r chi.Router) {
			r.Get("/", h.ListSessions)
			r.With(sessionLimiter.Middleware, aiGate).Post("/", h.CreateOrGetSession)

			r.Route("/{session_id}", func(r chi.Router) {
				r.Get("/messages", h.GetMessages)
				r.With(sendLimiter.Middleware, aiGate).Post("/messages", h.SendMessage)
				r.Delete("/", h.DeleteSession)
			})
		})
	})
}
