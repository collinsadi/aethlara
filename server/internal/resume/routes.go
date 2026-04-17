package resume

import (
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"
	"golang.org/x/time/rate"

	"github.com/collinsadi/aethlara/internal/config"
	"github.com/collinsadi/aethlara/internal/middleware"
)

func RegisterRoutes(r chi.Router, h *Handler, cfg *config.Config, aiGate func(http.Handler) http.Handler) {
	// Per-user rate limiters for mutating endpoints
	uploadLimiter := middleware.NewUserRateLimiter(rate.Every(12*time.Minute), 5) // 5/hour
	deleteLimiter := middleware.NewUserRateLimiter(rate.Every(6*time.Minute), 10) // 10/hour

	r.Route("/resumes", func(r chi.Router) {
		r.Use(middleware.RequireAuth(cfg))

		r.Get("/", h.List)
		r.Get("/has-active", h.HasActive)
		// Upload triggers an AI extraction — gate behind the per-user API key.
		r.With(uploadLimiter.Middleware(), aiGate).Post("/upload", h.Upload)

		r.Route("/{id}", func(r chi.Router) {
			r.Get("/preview-url", h.PreviewURL)
			r.With(deleteLimiter.Middleware()).Delete("/", h.Delete)
		})
	})
}
