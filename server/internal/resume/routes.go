package resume

import (
	"net/http"

	"github.com/go-chi/chi/v5"

	"github.com/collinsadi/aethlara/internal/config"
	"github.com/collinsadi/aethlara/internal/middleware"
)

func RegisterRoutes(r chi.Router, h *Handler, cfg *config.Config, aiGate func(http.Handler) http.Handler) {
	uploadLimiter := middleware.NewRateLimiter(middleware.AILimits)
	apiLimiter    := middleware.NewRateLimiter(middleware.APILimits)

	r.Route("/resumes", func(r chi.Router) {
		r.Use(middleware.RequireAuth(cfg))

		r.Get("/", h.List)
		r.Get("/has-active", h.HasActive)
		r.With(uploadLimiter.Middleware, aiGate).Post("/upload", h.Upload)

		r.Route("/{id}", func(r chi.Router) {
			r.Get("/preview-url", h.PreviewURL)
			r.With(apiLimiter.Middleware).Delete("/", h.Delete)
		})
	})
}
