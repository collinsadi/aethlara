package middleware

import (
	"fmt"
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/collinsadi/aethlara/internal/logger"
	"github.com/collinsadi/aethlara/pkg/response"
)

// RateLimitConfig defines limits for a specific endpoint group.
type RateLimitConfig struct {
	Namespace   string
	Requests    int
	Window      time.Duration
	BurstBuffer int
}

// Predefined limit profiles — endpoints use one of these.
var (
	AuthLimits = RateLimitConfig{
		Namespace: "auth", Requests: 5, Window: 15 * time.Minute,
	}
	OTPLimits = RateLimitConfig{
		Namespace: "otp", Requests: 10, Window: 10 * time.Minute,
	}
	AILimits = RateLimitConfig{
		Namespace: "ai", Requests: 10, Window: time.Hour, BurstBuffer: 2,
	}
	ChatLimits = RateLimitConfig{
		Namespace: "chat", Requests: 30, Window: time.Hour, BurstBuffer: 5,
	}
	APILimits = RateLimitConfig{
		Namespace: "api", Requests: 200, Window: time.Minute, BurstBuffer: 20,
	}
	ExtensionTokenLimits = RateLimitConfig{
		Namespace: "ext_token", Requests: 10, Window: time.Minute,
	}
)

// bucket holds the sliding window state for a single rate limit key.
type bucket struct {
	timestamps []time.Time
	mu         sync.Mutex
	lastAccess time.Time
}

// RateLimiter is a per-key sliding window rate limiter backed by an in-memory
// store with TTL-based cleanup.
type RateLimiter struct {
	buckets sync.Map
	cfg     RateLimitConfig
}

// NewRateLimiter creates a sliding window rate limiter with the given config.
func NewRateLimiter(cfg RateLimitConfig) *RateLimiter {
	rl := &RateLimiter{cfg: cfg}
	go rl.cleanup()
	return rl
}

func (rl *RateLimiter) Allow(key string) (allowed bool, remaining int, resetAt time.Time) {
	now := time.Now()
	windowStart := now.Add(-rl.cfg.Window)

	actual, _ := rl.buckets.LoadOrStore(key, &bucket{lastAccess: now})
	b := actual.(*bucket)

	b.mu.Lock()
	defer b.mu.Unlock()

	b.lastAccess = now

	// Evict timestamps outside the sliding window.
	valid := b.timestamps[:0]
	for _, t := range b.timestamps {
		if t.After(windowStart) {
			valid = append(valid, t)
		}
	}
	b.timestamps = valid

	limit := rl.cfg.Requests + rl.cfg.BurstBuffer
	remaining = limit - len(b.timestamps)

	if len(b.timestamps) >= limit {
		if len(b.timestamps) > 0 {
			resetAt = b.timestamps[0].Add(rl.cfg.Window)
		} else {
			resetAt = now.Add(rl.cfg.Window)
		}
		return false, 0, resetAt
	}

	b.timestamps = append(b.timestamps, now)
	remaining--

	if len(b.timestamps) > 0 {
		resetAt = b.timestamps[0].Add(rl.cfg.Window)
	}
	return true, remaining, resetAt
}

// cleanup removes buckets that have not been accessed in 2× the window.
func (rl *RateLimiter) cleanup() {
	ticker := time.NewTicker(5 * time.Minute)
	defer ticker.Stop()
	for range ticker.C {
		cutoff := time.Now().Add(-2 * rl.cfg.Window)
		rl.buckets.Range(func(key, value interface{}) bool {
			b := value.(*bucket)
			b.mu.Lock()
			stale := b.lastAccess.Before(cutoff)
			b.mu.Unlock()
			if stale {
				rl.buckets.Delete(key)
			}
			return true
		})
	}
}

// Middleware returns an http.Handler middleware for this rate limiter.
func (rl *RateLimiter) Middleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		key := RateLimitKey(r, rl.cfg.Namespace)
		allowed, remaining, resetAt := rl.Allow(key)

		w.Header().Set("X-RateLimit-Limit", fmt.Sprintf("%d", rl.cfg.Requests))
		w.Header().Set("X-RateLimit-Remaining", fmt.Sprintf("%d", remaining))
		w.Header().Set("X-RateLimit-Reset", fmt.Sprintf("%d", resetAt.Unix()))
		w.Header().Set("X-RateLimit-Namespace", rl.cfg.Namespace)

		if !allowed {
			retryAfter := int(time.Until(resetAt).Seconds()) + 1
			w.Header().Set("Retry-After", fmt.Sprintf("%d", retryAfter))

			logger.FromContext(r.Context()).Warn("rate limit exceeded",
				"namespace", rl.cfg.Namespace,
				"key_type", strings.Split(key, ":")[0],
				"reset_at", resetAt,
			)

			response.Error(w, http.StatusTooManyRequests, response.CodeRateLimited,
				"Too many requests. Please slow down.")
			return
		}

		next.ServeHTTP(w, r)
	})
}

// RateLimitKey returns the appropriate key for rate limiting a request.
//
// Strategy:
//   - Authenticated requests: keyed by user ID — fair per-user limits
//   - Unauthenticated requests: keyed by real IP — prevents anonymous abuse
//
// This means User A hitting their limit does NOT affect User B, and a user
// behind a shared IP (office, VPN) is not penalised for others on auth'd endpoints.
func RateLimitKey(r *http.Request, namespace string) string {
	if userID, ok := UserIDFromContext(r.Context()); ok && userID != "" {
		return "user:" + userID + ":" + namespace
	}
	return "ip:" + GetRealIP(r) + ":" + namespace
}
