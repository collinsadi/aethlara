package analytics

import (
	"github.com/go-chi/chi/v5"

	"github.com/collinsadi/aethlara/internal/config"
	"github.com/collinsadi/aethlara/internal/middleware"
)

func RegisterRoutes(r chi.Router, h *Handler, cfg *config.Config) {
	dashboardLimiter := middleware.NewRateLimiter(middleware.APILimits)

	r.Route("/analytics", func(r chi.Router) {
		r.Use(middleware.RequireAuth(cfg))
		r.With(dashboardLimiter.Middleware).Get("/dashboard", h.Dashboard)
	})
}
