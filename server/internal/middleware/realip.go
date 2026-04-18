package middleware

import (
	"context"
	"net"
	"net/http"
	"strings"
)

// trustedProxyCIDRs lists CIDR ranges we trust to set X-Forwarded-For / X-Real-IP.
// Only Nginx and internal Docker network IPs should ever appear here.
var trustedProxyCIDRs = []string{
	"127.0.0.1/32",    // localhost
	"10.0.0.0/8",      // Docker / private class A
	"172.16.0.0/12",   // Docker bridge default range
	"172.20.0.0/16",   // explicit docker-compose subnet
	"192.168.0.0/16",  // private class C
}

var trustedProxyNets []*net.IPNet

func init() {
	for _, cidr := range trustedProxyCIDRs {
		_, network, err := net.ParseCIDR(cidr)
		if err != nil {
			panic("invalid trusted proxy CIDR: " + cidr)
		}
		trustedProxyNets = append(trustedProxyNets, network)
	}
}

func isTrustedProxy(ip net.IP) bool {
	for _, network := range trustedProxyNets {
		if network.Contains(ip) {
			return true
		}
	}
	return false
}

type realIPContextKey struct{}

// RealIP extracts the real client IP and stores it in the request context.
// It only trusts X-Forwarded-For / X-Real-IP headers when the direct
// connection comes from a trusted proxy (Nginx / Docker network).
//
// SECURITY: This prevents clients from spoofing their IP by setting
// X-Forwarded-For themselves. Must be the first middleware in the chain.
func RealIP(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		ip := extractRealIP(r)
		ctx := context.WithValue(r.Context(), realIPContextKey{}, ip)
		next.ServeHTTP(w, r.WithContext(ctx))
	})
}

func extractRealIP(r *http.Request) string {
	remoteIP, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		remoteIP = r.RemoteAddr
	}

	directIP := net.ParseIP(remoteIP)
	if directIP != nil && isTrustedProxy(directIP) {
		// X-Real-IP is set by Nginx as $remote_addr — single IP, more reliable.
		if xRealIP := r.Header.Get("X-Real-IP"); xRealIP != "" {
			if parsed := net.ParseIP(strings.TrimSpace(xRealIP)); parsed != nil {
				return parsed.String()
			}
		}

		// Walk X-Forwarded-For right-to-left; take first untrusted IP.
		// Format: "client, proxy1, proxy2" — leftmost is the original client.
		if xff := r.Header.Get("X-Forwarded-For"); xff != "" {
			ips := strings.Split(xff, ",")
			for i := len(ips) - 1; i >= 0; i-- {
				candidate := strings.TrimSpace(ips[i])
				if parsed := net.ParseIP(candidate); parsed != nil && !isTrustedProxy(parsed) {
					return parsed.String()
				}
			}
			// All IPs in XFF are trusted proxies — take the leftmost.
			if leftmost := strings.TrimSpace(ips[0]); leftmost != "" {
				if parsed := net.ParseIP(leftmost); parsed != nil {
					return parsed.String()
				}
			}
		}
	}

	return remoteIP
}

// GetRealIP retrieves the real client IP from the request context.
// Always use this — never read r.RemoteAddr directly anywhere in the codebase.
func GetRealIP(r *http.Request) string {
	if ip, ok := r.Context().Value(realIPContextKey{}).(string); ok && ip != "" {
		return ip
	}
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		return r.RemoteAddr
	}
	return host
}
