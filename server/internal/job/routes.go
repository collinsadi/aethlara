package job

import (
	"net/http"

	"github.com/go-chi/chi/v5"

	"github.com/collinsadi/aethlara/internal/config"
	"github.com/collinsadi/aethlara/internal/middleware"
)

func RegisterRoutes(r chi.Router, h *Handler, cfg *config.Config, aiGate func(http.Handler) http.Handler) {
	createLimiter   := middleware.NewRateLimiter(middleware.AILimits)
	autofillLimiter := middleware.NewRateLimiter(middleware.AILimits)
	extractLimiter  := middleware.NewRateLimiter(middleware.AILimits)
	apiLimiter      := middleware.NewRateLimiter(middleware.APILimits)

	r.Route("/jobs", func(r chi.Router) {
		r.Use(middleware.RequireAuth(cfg))

		r.Get("/", h.List)
		r.With(createLimiter.Middleware, aiGate).Post("/", h.Create)

		r.With(extractLimiter.Middleware, aiGate).Post("/extract-from-extension", h.ExtractFromExtension)
		r.Post("/confirm-from-extension", h.ConfirmFromExtension)

		r.Route("/{id}", func(r chi.Router) {
			r.Get("/", h.GetByID)
			r.With(apiLimiter.Middleware).Patch("/status", h.UpdateStatus)
			r.With(apiLimiter.Middleware).Get("/resume-preview", h.ResumePreview)
			r.Delete("/", h.Delete)
			r.With(autofillLimiter.Middleware, aiGate).Post("/autofill", h.Autofill)
		})
	})
}
