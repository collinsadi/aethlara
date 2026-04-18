package main

import (
	"context"
	"encoding/json"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/go-chi/chi/v5"
	"golang.org/x/time/rate"

	"github.com/collinsadi/aethlara/internal/ai"
	"github.com/collinsadi/aethlara/internal/analytics"
	"github.com/collinsadi/aethlara/internal/apikey"
	"github.com/collinsadi/aethlara/internal/auth"
	"github.com/collinsadi/aethlara/internal/chat"
	"github.com/collinsadi/aethlara/internal/config"
	"github.com/collinsadi/aethlara/internal/database"
	"github.com/collinsadi/aethlara/internal/email"
	"github.com/collinsadi/aethlara/internal/job"
	"github.com/collinsadi/aethlara/internal/logger"
	"github.com/collinsadi/aethlara/internal/middleware"
	"github.com/collinsadi/aethlara/internal/resume"
	"github.com/collinsadi/aethlara/internal/settings"
	"github.com/collinsadi/aethlara/internal/storage"
	"github.com/collinsadi/aethlara/internal/user"
)

const version = "1.0.0"

func main() {
	// Bootstrap the default logger with a conservative production-style
	// configuration so config-load errors are still emitted as JSON. Once
	// APP_ENV is known we replace it with an env-aware logger that also
	// redacts known sensitive fields as a defence-in-depth measure.
	slog.SetDefault(logger.New("production"))

	cfg, err := config.Load()
	if err != nil {
		slog.Error("config load failed", "error", err)
		os.Exit(1)
	}

	slog.SetDefault(logger.New(cfg.AppEnv))

	db, err := database.Connect(cfg.DatabaseURL)
	if err != nil {
		slog.Error("database connect failed", "error", err)
		os.Exit(1)
	}
	defer db.Close()
	slog.Info("database connected")

	ctxMigrate, cancelMigrate := context.WithTimeout(context.Background(), 2*time.Minute)
	defer cancelMigrate()
	if err := database.RunMigrations(ctxMigrate, db.Pool); err != nil {
		slog.Error("database migrations failed", "error", err)
		os.Exit(1)
	}
	slog.Info("database migrations up to date")

	emailClient := email.NewClient(cfg.ResendAPIKey, cfg.EmailFromAddress, cfg.EmailFromName, cfg.AppName, cfg.EmailDevLogOnly)
	if cfg.EmailDevLogOnly {
		slog.Warn("EMAIL_DEV_LOG_ONLY is enabled: OTPs are logged to stdout and not sent via Resend")
	}

	r2Client, err := storage.NewR2Client(
		cfg.R2AccountID,
		cfg.R2AccessKeyID,
		cfg.R2SecretAccessKey,
		cfg.R2BucketName,
		cfg.ResumePresignedURLExpiry(),
	)
	if err != nil {
		slog.Error("r2 client init failed", "error", err)
		os.Exit(1)
	}

	// NOTE: ai.NewClient intentionally takes no fallback API key. Every request
	// resolves a per-user key via the APIKeyProvider wired below.
	aiClient := ai.NewClient(cfg.OpenRouterBaseURL, cfg.OpenRouterModel)

	apiKeySvc, err := apikey.New(cfg.APIKeyEncryptionKey(), cfg.APIKeyPreviewLength)
	if err != nil {
		slog.Error("apikey service init failed", "error", err)
		os.Exit(1)
	}

	// Repositories
	authRepo := auth.NewRepository(db.Pool)
	userRepo := user.NewRepository(db.Pool)
	resumeRepo := resume.NewRepository(db.Pool)
	jobRepo := job.NewRepository(db.Pool)
	analyticsRepo := analytics.NewRepository(db.Pool)
	settingsRepo := settings.NewRepository(db.Pool)
	chatRepo := chat.NewRepository(db.Pool)

	// Services
	authSvc := auth.NewService(authRepo, userRepo, emailClient, cfg)
	userSvc := user.NewService(userRepo)
	resumeSvc := resume.NewService(resumeRepo, r2Client, aiClient, cfg)
	jobSvc := job.NewService(jobRepo, r2Client, aiClient, cfg)
	analyticsSvc := analytics.NewService(analyticsRepo)
	settingsSvc := settings.NewService(settingsRepo, userRepo, apiKeySvc, aiClient, emailClient, cfg)
	chatSvc := chat.NewService(chatRepo, aiClient, cfg)

	// Wire per-user key provider into the AI client after settings service is ready.
	aiClient.SetKeyProvider(settingsSvc)

	// Handlers
	authHandler := auth.NewHandler(authSvc)
	userHandler := user.NewHandler(userSvc)
	resumeHandler := resume.NewHandler(resumeSvc, cfg)
	jobHandler := job.NewHandler(jobSvc, cfg)
	analyticsHandler := analytics.NewHandler(analyticsSvc)
	settingsHandler := settings.NewHandler(settingsSvc)
	chatHandler := chat.NewHandler(chatSvc)

	// Router
	r := chi.NewRouter()

	r.Use(middleware.RequestID)
	r.Use(middleware.Logger)
	r.Use(middleware.RecoverPanic)
	r.Use(middleware.CORS(cfg))
	r.Use(middleware.SecurityHeaders(cfg))

	globalRL := middleware.NewRateLimiter(
		rate.Every(time.Minute/time.Duration(cfg.RateLimitRequestsPerMinute)),
		cfg.RateLimitBurst,
	)
	r.Use(globalRL.Middleware())

	r.Get("/health", healthHandler(db, cfg))

	aiGate := middleware.AIGate(settingsRepo)

	r.Route("/api/v1", func(r chi.Router) {
		auth.RegisterRoutes(r, authHandler, cfg)
		user.RegisterRoutes(r, userHandler, cfg)
		resume.RegisterRoutes(r, resumeHandler, cfg, aiGate)
		job.RegisterRoutes(r, jobHandler, cfg, aiGate)
		analytics.RegisterRoutes(r, analyticsHandler, cfg)
		settings.RegisterRoutes(r, settingsHandler, cfg)
		chat.RegisterRoutes(r, chatHandler, cfg, aiGate)
	})

	srv := &http.Server{
		Addr:         ":" + cfg.Port,
		Handler:      r,
		ReadTimeout:  15 * time.Second,
		WriteTimeout: 180 * time.Second, // extended for dual AI calls in job pipeline
		IdleTimeout:  60 * time.Second,
	}

	cleanupCtx, cancelCleanup := context.WithCancel(context.Background())
	defer cancelCleanup()
	go func() {
		ticker := time.NewTicker(1 * time.Hour)
		defer ticker.Stop()
		for {
			select {
			case <-ticker.C:
				if err := authRepo.CleanupExpired(context.Background()); err != nil {
					slog.Error("cleanup job failed", "error", err)
				} else {
					slog.Info("cleanup job completed")
				}
			case <-cleanupCtx.Done():
				return
			}
		}
	}()

	go func() {
		slog.Info("server starting", "port", cfg.Port, "env", cfg.AppEnv, "version", version)
		if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			slog.Error("server error", "error", err)
			os.Exit(1)
		}
	}()

	quit := make(chan os.Signal, 1)
	signal.Notify(quit, syscall.SIGINT, syscall.SIGTERM)
	<-quit

	slog.Info("shutting down server...")
	shutdownCtx, shutdownCancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer shutdownCancel()

	if err := srv.Shutdown(shutdownCtx); err != nil {
		slog.Error("graceful shutdown failed", "error", err)
		os.Exit(1)
	}
	slog.Info("server stopped")
}

func healthHandler(db *database.DB, cfg *config.Config) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		ctx, cancel := context.WithTimeout(r.Context(), 3*time.Second)
		defer cancel()

		dbStatus := "ok"
		if err := db.Ping(ctx); err != nil {
			dbStatus = "error"
		}

		status := http.StatusOK
		if dbStatus != "ok" {
			status = http.StatusServiceUnavailable
		}

		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(status)
		_ = json.NewEncoder(w).Encode(map[string]string{
			"status":  dbStatus,
			"db":      dbStatus,
			"version": version,
			"env":     cfg.AppEnv,
		})
	}
}
