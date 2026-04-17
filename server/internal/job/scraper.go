package job

import (
	"context"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"regexp"
	"strings"
	"time"

	"github.com/collinsadi/aethlara/internal/config"
)

// privateRanges contains CIDR blocks that must never be scraped (SSRF prevention).
var privateRanges []*net.IPNet

func init() {
	cidrs := []string{
		"127.0.0.0/8",
		"10.0.0.0/8",
		"172.16.0.0/12",
		"192.168.0.0/16",
		"169.254.0.0/16", // link-local / AWS metadata
		"::1/128",
		"fc00::/7",
	}
	for _, cidr := range cidrs {
		_, network, _ := net.ParseCIDR(cidr)
		privateRanges = append(privateRanges, network)
	}
}

func isPrivateIP(ip net.IP) bool {
	for _, network := range privateRanges {
		if network.Contains(ip) {
			return true
		}
	}
	return false
}

// validateSSRF resolves the hostname and rejects any private/internal IPs.
func validateSSRF(ctx context.Context, host string) error {
	ips, err := net.DefaultResolver.LookupHost(ctx, host)
	if err != nil {
		return fmt.Errorf("DNS resolution failed for %q: %w", host, err)
	}
	if len(ips) == 0 {
		return fmt.Errorf("no IPs resolved for %q", host)
	}
	for _, ipStr := range ips {
		ip := net.ParseIP(ipStr)
		if ip == nil {
			continue
		}
		if isPrivateIP(ip) {
			return fmt.Errorf("SSRF: host %q resolves to private IP %s", host, ipStr)
		}
	}
	return nil
}

// ScrapeJob fetches and sanitises the HTML at the given URL.
// It enforces SSRF prevention, size limits, redirect caps, and content type checks.
func ScrapeJob(ctx context.Context, rawURL string, cfg *config.Config) (string, error) {
	parsed, err := url.Parse(rawURL)
	if err != nil {
		return "", fmt.Errorf("invalid URL: %w", err)
	}

	// Scheme must be https
	if parsed.Scheme != "https" {
		return "", fmt.Errorf("only HTTPS URLs are allowed")
	}

	// Block scraping the platform's own domain
	appURL, _ := url.Parse(cfg.AppURL)
	if strings.EqualFold(parsed.Hostname(), appURL.Hostname()) {
		return "", fmt.Errorf("cannot scrape the platform's own domain")
	}

	// Pre-request SSRF check
	if err := validateSSRF(ctx, parsed.Hostname()); err != nil {
		return "", err
	}

	timeout := time.Duration(cfg.ScraperRequestTimeoutSeconds) * time.Second
	maxBytes := cfg.ScraperMaxHTMLBytes
	userAgent := cfg.ScraperUserAgent

	// Custom transport: validates IP at dial time to prevent DNS rebinding
	transport := &http.Transport{
		DialContext: func(dctx context.Context, network, addr string) (net.Conn, error) {
			host, port, err := net.SplitHostPort(addr)
			if err != nil {
				return nil, err
			}
			ips, err := net.DefaultResolver.LookupHost(dctx, host)
			if err != nil {
				return nil, fmt.Errorf("DNS resolution failed: %w", err)
			}
			for _, ipStr := range ips {
				if ip := net.ParseIP(ipStr); ip != nil && isPrivateIP(ip) {
					return nil, fmt.Errorf("SSRF: resolved to private IP %s", ipStr)
				}
			}
			if len(ips) == 0 {
				return nil, fmt.Errorf("no IPs resolved")
			}
			return (&net.Dialer{Timeout: timeout}).DialContext(dctx, network, net.JoinHostPort(ips[0], port))
		},
	}

	redirectCount := 0
	client := &http.Client{
		Timeout:   timeout,
		Transport: transport,
		CheckRedirect: func(req *http.Request, via []*http.Request) error {
			redirectCount++
			if redirectCount > 3 {
				return fmt.Errorf("too many redirects")
			}
			if req.URL.Scheme != "https" {
				return fmt.Errorf("redirect to non-HTTPS URL rejected")
			}
			if err := validateSSRF(req.Context(), req.URL.Hostname()); err != nil {
				return err
			}
			return nil
		},
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, rawURL, nil)
	if err != nil {
		return "", fmt.Errorf("create request: %w", err)
	}
	req.Header.Set("User-Agent", userAgent)
	req.Header.Set("Accept", "text/html")

	resp, err := client.Do(req)
	if err != nil {
		return "", fmt.Errorf("HTTP request failed: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return "", fmt.Errorf("unexpected HTTP status %d", resp.StatusCode)
	}

	ct := resp.Header.Get("Content-Type")
	if !strings.Contains(ct, "text/html") {
		return "", fmt.Errorf("expected text/html content type, got %q", ct)
	}

	// Stream and abort if body exceeds max size
	limited := io.LimitReader(resp.Body, maxBytes+1)
	raw, err := io.ReadAll(limited)
	if err != nil {
		return "", fmt.Errorf("read response body: %w", err)
	}
	if int64(len(raw)) > maxBytes {
		return "", fmt.Errorf("response body exceeds maximum allowed size of %d bytes", maxBytes)
	}

	return sanitizeHTML(string(raw)), nil
}

// --- HTML sanitisation ---

var (
	scriptRe   = regexp.MustCompile(`(?is)<script[^>]*>.*?</script>`)
	styleRe    = regexp.MustCompile(`(?is)<style[^>]*>.*?</style>`)
	svgRe      = regexp.MustCompile(`(?is)<svg[^>]*>.*?</svg>`)
	iframeRe   = regexp.MustCompile(`(?is)<iframe[^>]*>.*?</iframe>`)
	noscriptRe = regexp.MustCompile(`(?is)<noscript[^>]*>.*?</noscript>`)
	tagRe      = regexp.MustCompile(`<[^>]+>`)
	wsRe       = regexp.MustCompile(`[ \t]+`)
)

// sanitizeHTML strips dangerous tags (including their content), removes all
// remaining HTML tags, and collapses whitespace. Safe for feeding to an AI prompt.
func sanitizeHTML(raw string) string {
	raw = scriptRe.ReplaceAllString(raw, "")
	raw = styleRe.ReplaceAllString(raw, "")
	raw = svgRe.ReplaceAllString(raw, "")
	raw = iframeRe.ReplaceAllString(raw, "")
	raw = noscriptRe.ReplaceAllString(raw, "")
	raw = tagRe.ReplaceAllString(raw, " ")
	raw = wsRe.ReplaceAllString(raw, " ")

	// Collapse blank lines
	lines := strings.Split(raw, "\n")
	out := make([]string, 0, len(lines))
	for _, l := range lines {
		if t := strings.TrimSpace(l); t != "" {
			out = append(out, t)
		}
	}
	return strings.Join(out, "\n")
}

// SanitizeText removes HTML tags and trims raw pasted job text.
func SanitizeText(raw string) string {
	return sanitizeHTML(raw)
}
