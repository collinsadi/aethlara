package auth

import (
	"time"

	"github.com/go-chi/chi/v5"
	"golang.org/x/time/rate"

	"github.com/collinsadi/aethlara/internal/config"
	"github.com/collinsadi/aethlara/internal/middleware"
)

func RegisterRoutes(r chi.Router, h *Handler, cfg *config.Config) {
	// Per-endpoint rate limiters (stricter than global)
	signupLimiter    := middleware.NewRateLimiter(rate.Every(3*time.Minute), 5)   // 5 per 15 min
	verifyLimiter    := middleware.NewRateLimiter(rate.Every(time.Minute), 10)    // 10 per 10 min
	loginLimiter     := middleware.NewRateLimiter(rate.Every(3*time.Minute), 5)   // 5 per 15 min
	extTokenLimiter  := middleware.NewRateLimiter(rate.Every(time.Minute), 10)    // 10 per min (pre-auth surface)

	r.Route("/auth", func(r chi.Router) {
		r.With(signupLimiter.Middleware()).Post("/signup", h.Signup)
		r.With(verifyLimiter.Middleware()).Post("/verify-otp", h.VerifyOTP)
		r.With(loginLimiter.Middleware()).Post("/login", h.Login)
		r.Post("/refresh", h.Refresh)

		// Pre-auth extension token exchange (strict IP-based rate limit)
		r.With(extTokenLimiter.Middleware()).Post("/extension-token/exchange", h.ExchangeExtensionToken)

		// Protected routes
		r.Group(func(r chi.Router) {
			r.Use(middleware.RequireAuth(cfg))
			r.Post("/logout", h.Logout)
			r.Post("/logout-all", h.LogoutAll)
			r.Post("/extension-token", h.GenerateExtensionToken)
		})
	})
}
