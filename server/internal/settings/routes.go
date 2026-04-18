package settings

import (
	"github.com/go-chi/chi/v5"

	"github.com/collinsadi/aethlara/internal/config"
	"github.com/collinsadi/aethlara/internal/middleware"
)

func RegisterRoutes(r chi.Router, h *Handler, cfg *config.Config) {
	apiKeyLimiter  := middleware.NewRateLimiter(middleware.APILimits)
	profileLimiter := middleware.NewRateLimiter(middleware.APILimits)
	emailReqLimiter := middleware.NewRateLimiter(middleware.AuthLimits)
	emailConfLimiter := middleware.NewRateLimiter(middleware.OTPLimits)

	r.Route("/settings", func(r chi.Router) {
		r.Use(middleware.RequireAuth(cfg))

		r.With(apiKeyLimiter.Middleware).Post("/api-key", h.SaveAPIKey)
		r.Get("/api-key", h.GetAPIKey)
		r.With(apiKeyLimiter.Middleware).Delete("/api-key", h.DeleteAPIKey)
		r.With(apiKeyLimiter.Middleware).Post("/api-key/validate", h.ValidateAPIKey)

		r.With(profileLimiter.Middleware).Patch("/profile", h.UpdateProfile)

		r.With(emailReqLimiter.Middleware).Post("/email/request-change", h.RequestEmailChange)
		r.With(emailConfLimiter.Middleware).Post("/email/confirm-change", h.ConfirmEmailChange)
	})
}
