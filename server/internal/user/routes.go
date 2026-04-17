package user

import (
	"github.com/go-chi/chi/v5"
	"github.com/collinsadi/aethlara/internal/config"
	"github.com/collinsadi/aethlara/internal/middleware"
)

func RegisterRoutes(r chi.Router, h *Handler, cfg *config.Config) {
	r.Route("/user", func(r chi.Router) {
		r.Use(middleware.RequireAuth(cfg))
		r.Get("/me", h.Me)
	})
}
