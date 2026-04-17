package settings

import (
	"time"

	"github.com/go-chi/chi/v5"
	"golang.org/x/time/rate"

	"github.com/collinsadi/aethlara/internal/config"
	"github.com/collinsadi/aethlara/internal/middleware"
)

func RegisterRoutes(r chi.Router, h *Handler, cfg *config.Config) {
	saveKeyLimiter     := middleware.NewUserRateLimiter(rate.Every(12*time.Minute), 5)  // 5/hour
	deleteKeyLimiter   := middleware.NewUserRateLimiter(rate.Every(12*time.Minute), 5)  // 5/hour
	validateKeyLimiter := middleware.NewUserRateLimiter(rate.Every(200*time.Second), 3) // 3/10 min
	profileLimiter     := middleware.NewUserRateLimiter(rate.Every(6*time.Minute), 10)  // 10/hour
	emailReqLimiter    := middleware.NewUserRateLimiter(rate.Every(20*time.Minute), 3)  // 3/hour
	emailConfLimiter   := middleware.NewUserRateLimiter(rate.Every(60*time.Second), 10) // 10/10 min

	r.Route("/settings", func(r chi.Router) {
		r.Use(middleware.RequireAuth(cfg))

		r.With(saveKeyLimiter.Middleware()).Post("/api-key", h.SaveAPIKey)
		r.Get("/api-key", h.GetAPIKey)
		r.With(deleteKeyLimiter.Middleware()).Delete("/api-key", h.DeleteAPIKey)
		r.With(validateKeyLimiter.Middleware()).Post("/api-key/validate", h.ValidateAPIKey)

		r.With(profileLimiter.Middleware()).Patch("/profile", h.UpdateProfile)

		r.With(emailReqLimiter.Middleware()).Post("/email/request-change", h.RequestEmailChange)
		r.With(emailConfLimiter.Middleware()).Post("/email/confirm-change", h.ConfirmEmailChange)
	})
}
