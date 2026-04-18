package middleware

import (
	"net/http"
	"strings"

	"github.com/collinsadi/aethlara/internal/config"
)

func corsOriginAllowed(origin string, allowed map[string]struct{}) bool {
	if origin == "" {
		return true
	}
	if _, ok := allowed[origin]; ok {
		return true
	}
	// Extension pages send Origin: chrome-extension://<id> (and similar). No need to
	// list each unpacked/published ID in CORS_ALLOWED_ORIGINS.
	switch {
	case strings.HasPrefix(origin, "chrome-extension://"):
		return true
	case strings.HasPrefix(origin, "moz-extension://"):
		return true
	case strings.HasPrefix(origin, "safari-web-extension://"):
		return true
	default:
		return false
	}
}

func CORS(cfg *config.Config) func(http.Handler) http.Handler {
	allowed := make(map[string]struct{}, len(cfg.CORSAllowedOrigins))
	for _, o := range cfg.CORSAllowedOrigins {
		allowed[o] = struct{}{}
	}

	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			origin := r.Header.Get("Origin")
			if corsOriginAllowed(origin, allowed) && origin != "" {
				h := w.Header()
				h.Set("Access-Control-Allow-Origin", origin)
				h.Set("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS")
				h.Set("Access-Control-Allow-Headers", "Authorization, Content-Type, X-Request-ID, X-Client-Version, Refresh-Token")
				h.Set("Access-Control-Allow-Credentials", "true")
				h.Set("Access-Control-Max-Age", "86400")
				h.Set("Vary", "Origin")
			}

			if r.Method == http.MethodOptions {
				w.WriteHeader(http.StatusNoContent)
				return
			}

			if origin != "" && !corsOriginAllowed(origin, allowed) {
				http.Error(w, "origin not allowed", http.StatusForbidden)
				return
			}

			next.ServeHTTP(w, r)
		})
	}
}
