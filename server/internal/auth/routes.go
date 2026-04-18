package auth

import (
	"github.com/go-chi/chi/v5"

	"github.com/collinsadi/aethlara/internal/config"
	"github.com/collinsadi/aethlara/internal/middleware"
)

func RegisterRoutes(r chi.Router, h *Handler, cfg *config.Config) {
	signupLimiter   := middleware.NewRateLimiter(middleware.AuthLimits)
	loginLimiter    := middleware.NewRateLimiter(middleware.AuthLimits)
	verifyLimiter   := middleware.NewRateLimiter(middleware.OTPLimits)
	extTokenLimiter := middleware.NewRateLimiter(middleware.ExtensionTokenLimits)

	r.Route("/auth", func(r chi.Router) {
		r.With(signupLimiter.Middleware).Post("/signup", h.Signup)
		r.With(verifyLimiter.Middleware).Post("/verify-otp", h.VerifyOTP)
		r.With(loginLimiter.Middleware).Post("/login", h.Login)
		r.Post("/refresh", h.Refresh)

		// Pre-auth extension token exchange (strict IP-based rate limit)
		r.With(extTokenLimiter.Middleware).Post("/extension-token/exchange", h.ExchangeExtensionToken)

		// Protected routes
		r.Group(func(r chi.Router) {
			r.Use(middleware.RequireAuth(cfg))
			r.Post("/logout", h.Logout)
			r.Post("/logout-all", h.LogoutAll)
			r.Post("/extension-token", h.GenerateExtensionToken)
		})
	})
}
