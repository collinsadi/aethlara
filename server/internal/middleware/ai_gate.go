package middleware

import (
	"context"
	"net/http"

	"github.com/collinsadi/aethlara/pkg/response"
)

// APIKeyChecker is satisfied by settings.Repository — declared here to avoid import cycles.
type APIKeyChecker interface {
	HasValidAPIKey(ctx context.Context, userID string) (bool, error)
}

// AIGate blocks requests from users who have no valid API key for their
// active AI provider (OpenRouter or Anthropic). Apply this to every endpoint
// that triggers an AI call.
//
// The gate enforces server-side — the frontend check is UX only.
func AIGate(checker APIKeyChecker) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			userID, ok := UserIDFromContext(r.Context())
			if !ok {
				response.Error(w, http.StatusUnauthorized, response.CodeUnauthorized, "Authentication required.")
				return
			}

			hasKey, err := checker.HasValidAPIKey(r.Context(), userID)
			if err != nil {
				response.Error(w, http.StatusInternalServerError, response.CodeInternalError, "An unexpected error occurred.")
				return
			}
			if !hasKey {
				w.Header().Set("Content-Type", "application/json")
				w.WriteHeader(http.StatusForbidden)
				_, _ = w.Write(APIKeyRequiredBody)
				return
			}

			next.ServeHTTP(w, r)
		})
	}
}

// APIKeyRequiredBody is the 403 API_KEY_REQUIRED envelope shared by the AI
// gate and handlers that hit ai.ErrNoAPIKey mid-request. It carries an
// action so clients can render an inline "Add API Key" CTA.
var APIKeyRequiredBody = []byte(`{"error":{"code":"API_KEY_REQUIRED","message":"An AI provider API key (Anthropic or OpenRouter) is required to use this feature. Add your key in Settings.","action":{"label":"Add API Key","path":"/settings#ai"}}}`)
