package job

import (
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"
	"golang.org/x/time/rate"

	"github.com/collinsadi/aethlara/internal/config"
	"github.com/collinsadi/aethlara/internal/middleware"
)

func RegisterRoutes(r chi.Router, h *Handler, cfg *config.Config, aiGate func(http.Handler) http.Handler) {
	// 10/hour per user, burst of 3 per minute
	createLimiter := middleware.NewUserRateLimiter(rate.Every(6*time.Minute), 3)
	// 30/hour per user
	statusLimiter := middleware.NewUserRateLimiter(rate.Every(2*time.Minute), 1)
	// 30/hour per user per job (applied at route level)
	previewLimiter := middleware.NewUserRateLimiter(rate.Every(2*time.Minute), 1)

	r.Route("/jobs", func(r chi.Router) {
		r.Use(middleware.RequireAuth(cfg))

		r.Get("/", h.List)
		r.With(createLimiter.Middleware(), aiGate).Post("/", h.Create)

		r.Route("/{id}", func(r chi.Router) {
			r.Get("/", h.GetByID)
			r.With(statusLimiter.Middleware()).Patch("/status", h.UpdateStatus)
			r.With(previewLimiter.Middleware()).Get("/resume-preview", h.ResumePreview)
			r.Delete("/", h.Delete)
		})
	})
}
