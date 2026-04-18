package middleware

import (
	"log/slog"
	"net/http"
	"time"

	"github.com/collinsadi/aethlara/internal/logger"
)

// statusRecorder captures the HTTP status code written by downstream
// handlers so the access log knows what was served.
type statusRecorder struct {
	http.ResponseWriter
	status int
	wrote  bool
}

func (r *statusRecorder) WriteHeader(code int) {
	if !r.wrote {
		r.status = code
		r.wrote = true
	}
	r.ResponseWriter.WriteHeader(code)
}

func (r *statusRecorder) Write(b []byte) (int, error) {
	if !r.wrote {
		r.status = http.StatusOK
		r.wrote = true
	}
	return r.ResponseWriter.Write(b)
}

// Logger emits one structured access log line per request.
//
// What gets logged (safe):
//   - request_id, user_id (from ctx), method, path, status, latency_ms,
//     remote_addr, user_agent
//
// What is deliberately NEVER logged:
//   - r.URL.RawQuery — may carry tokens or sensitive filter values
//   - the request body — may carry resume text, job text, or API keys
//   - the response body — may carry AI-generated content
//   - the Authorization header or any cookies
func Logger(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		start := time.Now()
		rec := &statusRecorder{ResponseWriter: w, status: http.StatusOK}

		next.ServeHTTP(rec, r)

		logger.FromContext(r.Context()).LogAttrs(r.Context(), slog.LevelInfo,
			"request",
			slog.String("component", "http"),
			slog.String("method", r.Method),
			slog.String("path", r.URL.Path),
			slog.Int("status", rec.status),
			slog.Int64("latency_ms", time.Since(start).Milliseconds()),
			slog.String("remote_addr", GetRealIP(r)),
			slog.String("user_agent", r.UserAgent()),
		)
	})
}
