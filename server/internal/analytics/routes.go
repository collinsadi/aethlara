package analytics

import (
	"time"

	"github.com/go-chi/chi/v5"
	"golang.org/x/time/rate"

	"github.com/collinsadi/aethlara/internal/config"
	"github.com/collinsadi/aethlara/internal/middleware"
)

func RegisterRoutes(r chi.Router, h *Handler, cfg *config.Config) {
	// 60 requests per hour per user
	dashboardLimiter := middleware.NewUserRateLimiter(rate.Every(time.Minute), 1)

	r.Route("/analytics", func(r chi.Router) {
		r.Use(middleware.RequireAuth(cfg))
		r.With(dashboardLimiter.Middleware()).Get("/dashboard", h.Dashboard)
	})
}
