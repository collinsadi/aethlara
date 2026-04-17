package middleware

import (
	"context"
	"net/http"
	"strings"

	"github.com/collinsadi/aethlara/internal/config"
	"github.com/collinsadi/aethlara/pkg/response"
	"github.com/collinsadi/aethlara/pkg/tokenutil"
)

const userIDKey contextKey = "user_id"

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

			ctx := context.WithValue(r.Context(), userIDKey, claims.UserID)
			next.ServeHTTP(w, r.WithContext(ctx))
		})
	}
}

func UserIDFromContext(ctx context.Context) (string, bool) {
	id, ok := ctx.Value(userIDKey).(string)
	return id, ok
}
