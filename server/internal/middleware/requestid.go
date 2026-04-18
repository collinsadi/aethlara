package middleware

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"net/http"

	"github.com/collinsadi/aethlara/internal/logger"
)

// RequestID attaches a stable trace ID to every request. If the caller
// supplied an X-Request-ID header, we honour it (sanitised); otherwise we
// generate a fresh 128-bit hex token. The ID is echoed back on the response
// so clients can correlate logs on both sides.
//
// The ID is stashed on the request context under logger.RequestIDKey so
// any downstream code (handlers, services, log middleware) can retrieve it
// via logger.FromContext(ctx) without re-plumbing.
func RequestID(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		id := r.Header.Get("X-Request-ID")
		if id == "" || len(id) > 128 {
			b := make([]byte, 16)
			_, _ = rand.Read(b)
			id = hex.EncodeToString(b)
		}
		w.Header().Set("X-Request-ID", id)
		ctx := context.WithValue(r.Context(), logger.RequestIDKey, id)
		next.ServeHTTP(w, r.WithContext(ctx))
	})
}

// GetRequestID returns the request trace ID from ctx, or "" if none.
// Retained as a thin wrapper over logger.RequestIDFromContext so existing
// call sites keep working after the key moved into the logger package.
func GetRequestID(ctx context.Context) string {
	return logger.RequestIDFromContext(ctx)
}
