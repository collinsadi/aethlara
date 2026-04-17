package config

import (
	"encoding/hex"
	"fmt"
	"os"
	"strconv"
	"strings"
	"time"

	"github.com/joho/godotenv"
)

type Config struct {
	AppEnv  string
	AppName string
	Port    string
	AppURL  string

	DatabaseURL string

	JWTAccessSecret        string
	JWTRefreshSecret       string
	JWTAccessExpiryMinutes int
	JWTRefreshExpiryDays   int

	OTPExpiryMinutes int
	OTPMaxAttempts   int

	RateLimitRequestsPerMinute int
	RateLimitBurst             int

	BcryptCost         int
	CORSAllowedOrigins []string
	TrustedProxies     []string

	ResendAPIKey     string
	EmailFromAddress string
	EmailFromName    string
	// EmailDevLogOnly skips Resend and logs OTP to stdout (local development only).
	EmailDevLogOnly bool

	// Cloudflare R2
	R2AccountID       string
	R2AccessKeyID     string
	R2SecretAccessKey string
	R2BucketName      string
	R2PublicEndpoint  string

	// OpenRouter AI
	// NOTE: there is no platform-level API key. Every AI call resolves a key
	// from the authenticated user's encrypted record via apikey/settings. If a
	// user has no valid key, the AI gate middleware + service-level check
	// ensure no OpenRouter request is ever made on their behalf.
	OpenRouterBaseURL string
	OpenRouterModel   string

	// API key encryption
	APIKeyEncryptionSecret string // required: 64-char hex (32 bytes)
	APIKeyPreviewLength    int    // chars to show as prefix in UI

	// Resume processing
	ResumeMaxFileSizeMB             int
	ResumePresignedURLExpiryMinutes int
	ResumeMaxActivePerUser          int

	// Web scraping
	ScraperRequestTimeoutSeconds int
	ScraperMaxHTMLBytes          int64
	ScraperUserAgent             string
	AllowedScrapeSchemes         []string

	// Job processing
	JobMaxTextInputBytes int64
	JobAITimeoutSeconds  int
	JobPDFMaxRetries     int

	// PDF
	PDFStoragePrefix string
	PDFTemplate      string

	// Pagination
	DefaultPageSize int
	MaxPageSize     int
}

func Load() (*Config, error) {
	_ = godotenv.Load()

	var missing []string

	required := func(key string) string {
		v := os.Getenv(key)
		if v == "" {
			missing = append(missing, key)
		}
		return v
	}

	optional := func(key, fallback string) string {
		v := os.Getenv(key)
		if v == "" {
			return fallback
		}
		return v
	}

	parseInt := func(key string, fallback int) int {
		v := os.Getenv(key)
		if v == "" {
			return fallback
		}
		n, err := strconv.Atoi(v)
		if err != nil {
			missing = append(missing, key+" (must be an integer)")
			return fallback
		}
		return n
	}

	parseBool := func(key string, fallback bool) bool {
		v := strings.ToLower(strings.TrimSpace(os.Getenv(key)))
		if v == "" {
			return fallback
		}
		return v == "1" || v == "true" || v == "yes"
	}

	cfg := &Config{
		AppEnv:                     optional("APP_ENV", "development"),
		AppName:                    optional("APP_NAME", "App"),
		Port:                       optional("PORT", "8080"),
		AppURL:                     optional("APP_URL", "http://localhost:8080"),
		DatabaseURL:                required("DATABASE_URL"),
		JWTAccessSecret:            required("JWT_ACCESS_SECRET"),
		JWTRefreshSecret:           required("JWT_REFRESH_SECRET"),
		JWTAccessExpiryMinutes:     parseInt("JWT_ACCESS_EXPIRY_MINUTES", 15),
		JWTRefreshExpiryDays:       parseInt("JWT_REFRESH_EXPIRY_DAYS", 30),
		OTPExpiryMinutes:           parseInt("OTP_EXPIRY_MINUTES", 10),
		OTPMaxAttempts:             parseInt("OTP_MAX_ATTEMPTS", 5),
		// Global per-IP limiter: defaults allow a typical SPA first paint (many parallel API calls).
		RateLimitRequestsPerMinute: parseInt("RATE_LIMIT_REQUESTS_PER_MINUTE", 120),
		RateLimitBurst:             parseInt("RATE_LIMIT_BURST", 60),
		BcryptCost:                 parseInt("BCRYPT_COST", 12),
		ResendAPIKey:               required("RESEND_API_KEY"),
		EmailFromAddress:           optional("EMAIL_FROM_ADDRESS", "noreply@example.com"),
		EmailFromName:              optional("EMAIL_FROM_NAME", optional("APP_NAME", "App")),
		EmailDevLogOnly:            parseBool("EMAIL_DEV_LOG_ONLY", false),

		R2AccountID:       required("R2_ACCOUNT_ID"),
		R2AccessKeyID:     required("R2_ACCESS_KEY_ID"),
		R2SecretAccessKey: required("R2_SECRET_ACCESS_KEY"),
		R2BucketName:      required("R2_BUCKET_NAME"),
		R2PublicEndpoint:  optional("R2_PUBLIC_ENDPOINT", ""),

		OpenRouterBaseURL: optional("OPENROUTER_BASE_URL", "https://openrouter.ai/api/v1"),
		OpenRouterModel:   optional("OPENROUTER_MODEL", "anthropic/claude-3.5-sonnet"),

		APIKeyEncryptionSecret: required("API_KEY_ENCRYPTION_SECRET"),
		APIKeyPreviewLength:    parseInt("API_KEY_PREVIEW_LENGTH", 18),

		ResumeMaxFileSizeMB:             parseInt("RESUME_MAX_FILE_SIZE_MB", 5),
		ResumePresignedURLExpiryMinutes: parseInt("RESUME_PRESIGNED_URL_EXPIRY_MINUTES", 15),
		ResumeMaxActivePerUser:          parseInt("RESUME_MAX_ACTIVE_PER_USER", 10),

		ScraperRequestTimeoutSeconds: parseInt("SCRAPER_REQUEST_TIMEOUT_SECONDS", 15),
		ScraperMaxHTMLBytes:          int64(parseInt("SCRAPER_MAX_HTML_BYTES", 2097152)),
		ScraperUserAgent:             optional("SCRAPER_USER_AGENT", "Mozilla/5.0 (compatible; JobAI/1.0)"),
		AllowedScrapeSchemes:         splitTrimmed(optional("ALLOWED_SCRAPE_SCHEMES", "https")),

		JobMaxTextInputBytes: int64(parseInt("JOB_MAX_TEXT_INPUT_BYTES", 51200)),
		JobAITimeoutSeconds:  parseInt("JOB_AI_TIMEOUT_SECONDS", 60),
		JobPDFMaxRetries:     parseInt("JOB_PDF_MAX_RETRIES", 3),

		PDFStoragePrefix: optional("PDF_STORAGE_PREFIX", "jobs/resumes/"),
		PDFTemplate:      optional("PDF_TEMPLATE", "minimal"),

		DefaultPageSize: parseInt("DEFAULT_PAGE_SIZE", 20),
		MaxPageSize:     parseInt("MAX_PAGE_SIZE", 100),
	}

	originsStr := optional("CORS_ALLOWED_ORIGINS", "http://localhost:3000")
	cfg.CORSAllowedOrigins = splitTrimmed(originsStr)

	if proxies := os.Getenv("TRUSTED_PROXIES"); proxies != "" {
		cfg.TrustedProxies = splitTrimmed(proxies)
	}

	if len(missing) > 0 {
		return nil, fmt.Errorf("missing required environment variables: %s", strings.Join(missing, ", "))
	}

	// Validate encryption key: must be a 64-char hex string (32 bytes).
	keyBytes, err := hex.DecodeString(cfg.APIKeyEncryptionSecret)
	if err != nil || len(keyBytes) != 32 {
		return nil, fmt.Errorf("API_KEY_ENCRYPTION_SECRET must be a 64-character hex string (32 bytes)")
	}

	return cfg, nil
}

// APIKeyEncryptionKey returns the 32-byte key decoded from the hex config value.
func (c *Config) APIKeyEncryptionKey() []byte {
	b, _ := hex.DecodeString(c.APIKeyEncryptionSecret)
	return b
}

func (c *Config) JWTAccessExpiry() time.Duration {
	return time.Duration(c.JWTAccessExpiryMinutes) * time.Minute
}

func (c *Config) JWTRefreshExpiry() time.Duration {
	return time.Duration(c.JWTRefreshExpiryDays) * 24 * time.Hour
}

func (c *Config) ResumeMaxFileSize() int64 {
	return int64(c.ResumeMaxFileSizeMB) << 20
}

func (c *Config) ResumePresignedURLExpiry() time.Duration {
	return time.Duration(c.ResumePresignedURLExpiryMinutes) * time.Minute
}

func (c *Config) IsProduction() bool {
	return c.AppEnv == "production"
}

func splitTrimmed(s string) []string {
	parts := strings.Split(s, ",")
	out := make([]string, 0, len(parts))
	for _, p := range parts {
		if p = strings.TrimSpace(p); p != "" {
			out = append(out, p)
		}
	}
	return out
}
