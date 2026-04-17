package settings

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"math/rand/v2"
	"strings"
	"time"
	"unicode"

	"golang.org/x/crypto/bcrypt"

	"github.com/collinsadi/aethlara/internal/ai"
	"github.com/collinsadi/aethlara/internal/apikey"
	"github.com/collinsadi/aethlara/internal/config"
	"github.com/collinsadi/aethlara/internal/email"
	"github.com/collinsadi/aethlara/internal/user"
)

var (
	ErrNotFound       = errors.New("not found")
	ErrNoAPIKey       = errors.New("no API key on file")
	ErrInvalidKey     = errors.New("invalid API key")
	ErrInvalidInput   = errors.New("invalid input")
	ErrOTPExpired     = errors.New("OTP expired")
	ErrOTPInvalid     = errors.New("OTP invalid")
	ErrOTPMaxAttempts = errors.New("too many OTP attempts")
	ErrInternal       = errors.New("internal error")
)

// APIKeyMetadata is the safe DTO returned to clients — never includes the encrypted blob.
type APIKeyMetadata struct {
	ID               string
	Provider         string
	KeyPrefix        string
	Label            *string
	ValidationStatus string
	LastUsedAt       *time.Time
	LastValidatedAt  *time.Time
	CreatedAt        time.Time
}

type UpdateProfileRequest struct {
	FullName string
}

type RequestEmailChangeRequest struct {
	NewEmail string
}

type ConfirmEmailChangeRequest struct {
	NewEmail string
	OTP      string
}

type Service interface {
	SaveAPIKey(ctx context.Context, userID, plainKey string, label *string) (*APIKeyMetadata, error)
	GetAPIKey(ctx context.Context, userID string) (*APIKeyMetadata, error)
	DeleteAPIKey(ctx context.Context, userID string) error
	RevalidateAPIKey(ctx context.Context, userID string) (*APIKeyMetadata, error)
	GetDecryptedKey(ctx context.Context, userID string) (string, error) // implements ai.APIKeyProvider

	UpdateProfile(ctx context.Context, userID string, req UpdateProfileRequest) (*user.User, error)

	RequestEmailChange(ctx context.Context, userID string, req RequestEmailChangeRequest) error
	ConfirmEmailChange(ctx context.Context, userID string, req ConfirmEmailChangeRequest) error
}

type service struct {
	repo      Repository
	userRepo  user.Repository
	apiKeySvc *apikey.Service
	aiClient  *ai.Client
	emailSvc  *email.Client
	cfg       *config.Config
}

func NewService(
	repo Repository,
	userRepo user.Repository,
	apiKeySvc *apikey.Service,
	aiClient *ai.Client,
	emailSvc *email.Client,
	cfg *config.Config,
) Service {
	return &service{
		repo:      repo,
		userRepo:  userRepo,
		apiKeySvc: apiKeySvc,
		aiClient:  aiClient,
		emailSvc:  emailSvc,
		cfg:       cfg,
	}
}

// ── API key ───────────────────────────────────────────────────────────────────

func (s *service) SaveAPIKey(ctx context.Context, userID, plainKey string, label *string) (*APIKeyMetadata, error) {
	if err := s.apiKeySvc.ValidateFormat(plainKey); err != nil {
		return nil, fmt.Errorf("%w: %s", ErrInvalidKey, err)
	}

	// Validate liveness before storing anything.
	if err := s.validateKeyLiveness(ctx, plainKey); err != nil {
		plainKey = ""
		return nil, fmt.Errorf("%w: key was rejected by OpenRouter", ErrInvalidKey)
	}

	// Extract prefix before zeroing the plaintext.
	prefix := s.apiKeySvc.ExtractPrefix(plainKey)

	encrypted, err := s.apiKeySvc.Encrypt(plainKey)
	plainKey = "" // zero from memory as soon as we have the encrypted form

	if err != nil {
		slog.Error("api key encrypt failed", "user_id", userID, "error", err)
		return nil, ErrInternal
	}

	rec, err := s.repo.UpsertAPIKey(ctx, userID, encrypted, prefix, "openrouter", label)
	if err != nil {
		slog.Error("api key upsert failed", "user_id", userID, "error", err)
		return nil, ErrInternal
	}
	return toMetadata(rec), nil
}

func (s *service) GetAPIKey(ctx context.Context, userID string) (*APIKeyMetadata, error) {
	rec, err := s.repo.GetAPIKeyByUserID(ctx, userID)
	if err != nil {
		return nil, ErrInternal
	}
	if rec == nil {
		return nil, nil
	}
	return toMetadata(rec), nil
}

func (s *service) DeleteAPIKey(ctx context.Context, userID string) error {
	if err := s.repo.DeleteAPIKey(ctx, userID); err != nil {
		return ErrInternal
	}
	slog.Info("api key deleted", "user_id", userID)
	return nil
}

func (s *service) RevalidateAPIKey(ctx context.Context, userID string) (*APIKeyMetadata, error) {
	rec, err := s.repo.GetAPIKeyByUserID(ctx, userID)
	if err != nil {
		return nil, ErrInternal
	}
	if rec == nil {
		return nil, ErrNoAPIKey
	}

	plainKey, err := s.apiKeySvc.Decrypt(rec.EncryptedKey)
	if err != nil {
		slog.Error("api key decrypt failed during revalidation", "user_id", userID)
		return nil, ErrInternal
	}

	validErr := s.validateKeyLiveness(ctx, plainKey)
	plainKey = "" // zero immediately

	status := "valid"
	if validErr != nil {
		status = "invalid"
	}

	if dbErr := s.repo.UpdateAPIKeyValidation(ctx, userID, status, time.Now()); dbErr != nil {
		slog.Warn("api key validation status update failed", "user_id", userID, "error", dbErr)
	}

	updated, err := s.repo.GetAPIKeyByUserID(ctx, userID)
	if err != nil || updated == nil {
		return nil, ErrInternal
	}
	return toMetadata(updated), nil
}

// GetDecryptedKey implements ai.APIKeyProvider.
// Called only from internal/ai/openrouter.go — nowhere else decrypts keys.
// Returns ai.ErrNoAPIKey (the canonical sentinel) when no usable key exists.
func (s *service) GetDecryptedKey(ctx context.Context, userID string) (string, error) {
	rec, err := s.repo.GetAPIKeyByUserID(ctx, userID)
	if err != nil {
		return "", ErrInternal
	}
	if rec == nil {
		return "", ai.ErrNoAPIKey
	}
	// Any non-valid status means no usable key.
	if rec.ValidationStatus != "valid" {
		return "", ai.ErrNoAPIKey
	}

	plainKey, err := s.apiKeySvc.Decrypt(rec.EncryptedKey)
	if err != nil {
		slog.Error("api key decrypt failed", "user_id", userID)
		return "", ErrInternal
	}

	go func() {
		_ = s.repo.UpdateAPIKeyLastUsed(context.Background(), userID, time.Now())
	}()

	return plainKey, nil
}

func (s *service) validateKeyLiveness(ctx context.Context, plainKey string) error {
	testCtx, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()
	_, err := s.aiClient.CompleteWithKey(testCtx, plainKey, ai.Request{
		SystemPrompt:  "Respond with the single word: OK",
		UserMessage:   "OK",
		PromptVersion: "key-validate-v1",
	})
	return err
}

// ── Profile ───────────────────────────────────────────────────────────────────

func (s *service) UpdateProfile(ctx context.Context, userID string, req UpdateProfileRequest) (*user.User, error) {
	name := strings.TrimSpace(req.FullName)
	if err := validateFullName(name); err != nil {
		return nil, fmt.Errorf("%w: %s", ErrInvalidInput, err)
	}

	if err := s.repo.UpdateFullName(ctx, userID, name); err != nil {
		return nil, ErrInternal
	}

	u, err := s.userRepo.GetByID(ctx, userID)
	if err != nil || u == nil {
		return nil, ErrInternal
	}
	return u, nil
}

func validateFullName(name string) error {
	if len(name) < 2 {
		return fmt.Errorf("must be at least 2 characters")
	}
	if len(name) > 100 {
		return fmt.Errorf("must be 100 characters or fewer")
	}
	for _, r := range name {
		if !unicode.IsLetter(r) && r != ' ' && r != '-' && r != '\'' {
			return fmt.Errorf("must contain only letters, spaces, hyphens, and apostrophes")
		}
	}
	return nil
}

// ── Email change ──────────────────────────────────────────────────────────────

func (s *service) RequestEmailChange(ctx context.Context, userID string, req RequestEmailChangeRequest) error {
	newEmail := strings.ToLower(strings.TrimSpace(req.NewEmail))
	if newEmail == "" {
		return fmt.Errorf("%w: new_email is required", ErrInvalidInput)
	}

	current, err := s.userRepo.GetByID(ctx, userID)
	if err != nil || current == nil {
		return ErrInternal
	}
	if current.Email == newEmail {
		return fmt.Errorf("%w: new email must differ from current email", ErrInvalidInput)
	}

	// Enumeration prevention: identical response if taken.
	existing, _ := s.userRepo.GetByEmail(ctx, newEmail)
	if existing != nil {
		slog.Info("email change requested to taken address", "user_id", userID)
		return nil
	}

	otp := generateOTP()
	hash, err := bcrypt.GenerateFromPassword([]byte(otp), s.cfg.BcryptCost)
	if err != nil {
		return ErrInternal
	}

	_ = s.repo.InvalidateEmailChangeRequests(ctx, userID)

	if err := s.repo.CreateEmailChangeRequest(ctx, userID, newEmail, string(hash), time.Now().Add(10*time.Minute)); err != nil {
		return ErrInternal
	}

	if err := s.emailSvc.SendEmailChangeOTP(ctx, newEmail, otp, 10); err != nil {
		slog.Error("failed to send email change OTP", "user_id", userID, "error", err)
		return ErrInternal
	}
	return nil
}

func (s *service) ConfirmEmailChange(ctx context.Context, userID string, req ConfirmEmailChangeRequest) error {
	newEmail := strings.ToLower(strings.TrimSpace(req.NewEmail))

	pending, err := s.repo.GetPendingEmailChangeRequest(ctx, userID, newEmail)
	if err != nil {
		return ErrInternal
	}
	if pending == nil || time.Now().After(pending.ExpiresAt) {
		return ErrOTPExpired
	}

	attempts, err := s.repo.IncrementEmailChangeAttempts(ctx, pending.ID)
	if err != nil {
		return ErrInternal
	}
	if attempts >= s.cfg.OTPMaxAttempts {
		_ = s.repo.MarkEmailChangeUsed(ctx, pending.ID)
		return ErrOTPMaxAttempts
	}

	if err := bcrypt.CompareHashAndPassword([]byte(pending.OTPHash), []byte(req.OTP)); err != nil {
		return ErrOTPInvalid
	}

	_ = s.repo.MarkEmailChangeUsed(ctx, pending.ID)

	// Capture old email before updating.
	oldEmail := ""
	if current, err := s.userRepo.GetByID(ctx, userID); err == nil && current != nil {
		oldEmail = current.Email
	}

	if err := s.repo.UpdateUserEmail(ctx, userID, newEmail); err != nil {
		return ErrInternal
	}

	// Notify old address asynchronously.
	if oldEmail != "" {
		go func() {
			_ = s.emailSvc.SendEmailChangeNotification(context.Background(), oldEmail)
		}()
	}

	slog.Info("email changed", "user_id", userID)
	return nil
}

func generateOTP() string {
	digits := make([]byte, 6)
	for i := range digits {
		digits[i] = byte('0' + rand.IntN(10))
	}
	return string(digits)
}

func toMetadata(rec *APIKeyRecord) *APIKeyMetadata {
	return &APIKeyMetadata{
		ID:               rec.ID,
		Provider:         rec.Provider,
		KeyPrefix:        rec.KeyPrefix,
		Label:            rec.Label,
		ValidationStatus: rec.ValidationStatus,
		LastUsedAt:       rec.LastUsedAt,
		LastValidatedAt:  rec.LastValidatedAt,
		CreatedAt:        rec.CreatedAt,
	}
}
