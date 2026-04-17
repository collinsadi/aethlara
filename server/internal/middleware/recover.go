package middleware

import (
	"log/slog"
	"net/http"
	"runtime/debug"

	"github.com/collinsadi/aethlara/pkg/response"
)

func RecoverPanic(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		defer func() {
			if err := recover(); err != nil {
				slog.Error("panic recovered",
					"request_id", GetRequestID(r.Context()),
					"error", err,
					"stack", string(debug.Stack()),
				)
				response.Error(w, http.StatusInternalServerError, response.CodeInternalError, "An unexpected error occurred.")
			}
		}()
		next.ServeHTTP(w, r)
	})
}
