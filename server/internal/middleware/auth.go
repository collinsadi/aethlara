package middleware

import (
	"context"
	"net/http"
	"strings"

	"github.com/collinsadi/aethlara/internal/config"
	"github.com/collinsadi/aethlara/internal/logger"
	"github.com/collinsadi/aethlara/pkg/response"
	"github.com/collinsadi/aethlara/pkg/tokenutil"
)

// RequireAuth verifies a Bearer access token, stashes the user's UUID on
// the request context under logger.UserIDKey, and then invokes next. The
// decoded claims are intentionally NOT exposed beyond the user ID to
// minimise accidental leakage into log lines.
func RequireAuth(cfg *config.Config) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			authHeader := r.Header.Get("Authorization")
			if authHeader == "" || !strings.HasPrefix(authHeader, "Bearer ") {
				response.Error(w, http.StatusUnauthorized, response.CodeUnauthorized, "Authentication required.")
				return
			}

			tokenStr := strings.TrimPrefix(authHeader, "Bearer ")
			claims, err := tokenutil.ParseAccessToken(tokenStr, cfg.JWTAccessSecret)
			if err != nil {
				response.Error(w, http.StatusUnauthorized, response.CodeTokenInvalid, "Invalid or expired token.")
				return
			}

			ctx := context.WithValue(r.Context(), logger.UserIDKey, claims.UserID)
			next.ServeHTTP(w, r.WithContext(ctx))
		})
	}
}

// UserIDFromContext returns the authenticated user's UUID from ctx along
// with an ok flag. Kept for call-site compatibility with handlers that
// predate the logger package.
func UserIDFromContext(ctx context.Context) (string, bool) {
	id := logger.UserIDFromContext(ctx)
	return id, id != ""
}
