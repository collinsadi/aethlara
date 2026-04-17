package middleware

import (
	"net"
	"net/http"
	"strings"
	"sync"
	"time"

	"golang.org/x/time/rate"

	"github.com/collinsadi/aethlara/pkg/response"
)

// ---- shared entry type ----

type limiterEntry struct {
	limiter  *rate.Limiter
	lastSeen time.Time
}

// ---- IP-based rate limiter (global middleware) ----

type RateLimiter struct {
	mu      sync.Mutex
	entries map[string]*limiterEntry
	r       rate.Limit
	b       int
}

// NewRateLimiter creates a per-IP token-bucket rate limiter.
func NewRateLimiter(r rate.Limit, b int) *RateLimiter {
	rl := &RateLimiter{entries: make(map[string]*limiterEntry), r: r, b: b}
	go rl.cleanup()
	return rl
}

func (rl *RateLimiter) getLimiter(key string) *rate.Limiter {
	rl.mu.Lock()
	defer rl.mu.Unlock()
	e, ok := rl.entries[key]
	if !ok {
		e = &limiterEntry{limiter: rate.NewLimiter(rl.r, rl.b)}
		rl.entries[key] = e
	}
	e.lastSeen = time.Now()
	return e.limiter
}

func (rl *RateLimiter) cleanup() {
	ticker := time.NewTicker(10 * time.Minute)
	defer ticker.Stop()
	for range ticker.C {
		rl.mu.Lock()
		for k, e := range rl.entries {
			if time.Since(e.lastSeen) > 1*time.Hour {
				delete(rl.entries, k)
			}
		}
		rl.mu.Unlock()
	}
}

func (rl *RateLimiter) Middleware() func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if !rl.getLimiter(realIP(r)).Allow() {
				w.Header().Set("Retry-After", "60")
				response.Error(w, http.StatusTooManyRequests, response.CodeRateLimited,
					"Too many requests. Please try again later.")
				return
			}
			next.ServeHTTP(w, r)
		})
	}
}

// ---- User-based rate limiter (for authenticated endpoints) ----

// UserRateLimiter enforces per-user-ID rate limits.
// Must be applied after RequireAuth so the user ID is already in context.
type UserRateLimiter struct {
	mu      sync.Mutex
	entries map[string]*limiterEntry
	r       rate.Limit
	b       int
}

// NewUserRateLimiter creates a per-user token-bucket rate limiter.
func NewUserRateLimiter(r rate.Limit, b int) *UserRateLimiter {
	rl := &UserRateLimiter{entries: make(map[string]*limiterEntry), r: r, b: b}
	go rl.userCleanup()
	return rl
}

func (rl *UserRateLimiter) getLimiter(userID string) *rate.Limiter {
	rl.mu.Lock()
	defer rl.mu.Unlock()
	e, ok := rl.entries[userID]
	if !ok {
		e = &limiterEntry{limiter: rate.NewLimiter(rl.r, rl.b)}
		rl.entries[userID] = e
	}
	e.lastSeen = time.Now()
	return e.limiter
}

func (rl *UserRateLimiter) userCleanup() {
	ticker := time.NewTicker(30 * time.Minute)
	defer ticker.Stop()
	for range ticker.C {
		rl.mu.Lock()
		for k, e := range rl.entries {
			if time.Since(e.lastSeen) > 2*time.Hour {
				delete(rl.entries, k)
			}
		}
		rl.mu.Unlock()
	}
}

func (rl *UserRateLimiter) Middleware() func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			userID, ok := UserIDFromContext(r.Context())
			if !ok {
				response.Error(w, http.StatusUnauthorized, response.CodeUnauthorized,
					"Authentication required.")
				return
			}
			if !rl.getLimiter(userID).Allow() {
				w.Header().Set("Retry-After", "60")
				response.Error(w, http.StatusTooManyRequests, response.CodeRateLimited,
					"Too many requests. Please try again later.")
				return
			}
			next.ServeHTTP(w, r)
		})
	}
}

// ---- helpers ----

func realIP(r *http.Request) string {
	if ip := r.Header.Get("X-Real-IP"); ip != "" {
		return ip
	}
	if forwarded := r.Header.Get("X-Forwarded-For"); forwarded != "" {
		return strings.TrimSpace(strings.SplitN(forwarded, ",", 2)[0])
	}
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		return r.RemoteAddr
	}
	return host
}
