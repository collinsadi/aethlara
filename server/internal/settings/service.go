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
	ErrNotFound        = errors.New("not found")
	ErrNoAPIKey        = errors.New("no API key on file")
	ErrInvalidKey      = errors.New("invalid API key")
	ErrInvalidProvider = errors.New("invalid provider")
	ErrProviderNoKey   = errors.New("no valid key for provider")
	ErrInvalidInput    = errors.New("invalid input")
	ErrOTPExpired      = errors.New("OTP expired")
	ErrOTPInvalid      = errors.New("OTP invalid")
	ErrOTPMaxAttempts  = errors.New("too many OTP attempts")
	ErrInternal        = errors.New("internal error")
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

// SaveAPIKeyRequest is the validated input for storing a provider key.
type SaveAPIKeyRequest struct {
	Provider   ai.Provider
	PlainKey   string
	Label      *string
	MakeActive bool // switch the user's active provider to this one
}

// AISettings describes which provider and models a user's AI calls use.
type AISettings struct {
	Provider            ai.Provider
	SmartModel          *string // user override, nil = server default
	FastModel           *string
	EffectiveSmartModel string
	EffectiveFastModel  string
	Keys                []APIKeyMetadata
}

// UpdateAISettingsRequest changes the active provider and/or model overrides.
// A nil model leaves the override unchanged (or clears it when the provider
// changes); an empty string resets it to the server default.
type UpdateAISettingsRequest struct {
	Provider   ai.Provider
	SmartModel *string
	FastModel  *string
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
	SaveAPIKey(ctx context.Context, userID string, req SaveAPIKeyRequest) (*APIKeyMetadata, error)
	// GetAPIKey returns the key for provider ("" = the active provider).
	GetAPIKey(ctx context.Context, userID string, provider ai.Provider) (*APIKeyMetadata, error)
	ListAPIKeys(ctx context.Context, userID string) ([]APIKeyMetadata, error)
	DeleteAPIKey(ctx context.Context, userID string, provider ai.Provider) error
	RevalidateAPIKey(ctx context.Context, userID string, provider ai.Provider) (*APIKeyMetadata, error)
	GetCredential(ctx context.Context, userID string) (*ai.Credential, error) // implements ai.CredentialProvider

	GetAISettings(ctx context.Context, userID string) (*AISettings, error)
	UpdateAISettings(ctx context.Context, userID string, req UpdateAISettingsRequest) (*AISettings, error)

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

// ── API keys ──────────────────────────────────────────────────────────────────

func (s *service) SaveAPIKey(ctx context.Context, userID string, req SaveAPIKeyRequest) (*APIKeyMetadata, error) {
	plainKey := req.PlainKey
	if err := s.apiKeySvc.ValidateFormat(string(req.Provider), plainKey); err != nil {
		return nil, fmt.Errorf("%w: %s", ErrInvalidKey, err)
	}

	// Validate liveness before storing anything.
	if err := s.aiClient.ValidateKey(ctx, req.Provider, plainKey); err != nil {
		plainKey = ""
		return nil, fmt.Errorf("%w: key was rejected by %s", ErrInvalidKey, req.Provider.Label())
	}

	// Extract prefix before zeroing the plaintext.
	prefix := s.apiKeySvc.ExtractPrefix(plainKey)

	encrypted, err := s.apiKeySvc.Encrypt(plainKey)
	plainKey = "" // zero from memory as soon as we have the encrypted form

	if err != nil {
		slog.Error("api key encrypt failed", "user_id", userID, "error", err)
		return nil, ErrInternal
	}

	rec, err := s.repo.UpsertAPIKey(ctx, userID, encrypted, prefix, string(req.Provider), req.Label)
	if err != nil {
		slog.Error("api key upsert failed", "user_id", userID, "error", err)
		return nil, ErrInternal
	}

	if req.MakeActive {
		if err := s.setActiveProvider(ctx, userID, req.Provider); err != nil {
			slog.Error("set active provider failed", "user_id", userID, "error", err)
			return nil, ErrInternal
		}
	}
	return toMetadata(rec), nil
}

func (s *service) GetAPIKey(ctx context.Context, userID string, provider ai.Provider) (*APIKeyMetadata, error) {
	if provider == "" {
		active, err := s.activeProvider(ctx, userID)
		if err != nil {
			return nil, ErrInternal
		}
		provider = active
	}
	rec, err := s.repo.GetAPIKey(ctx, userID, string(provider))
	if err != nil {
		return nil, ErrInternal
	}
	if rec == nil {
		return nil, nil
	}
	return toMetadata(rec), nil
}

func (s *service) ListAPIKeys(ctx context.Context, userID string) ([]APIKeyMetadata, error) {
	recs, err := s.repo.ListAPIKeys(ctx, userID)
	if err != nil {
		return nil, ErrInternal
	}
	out := make([]APIKeyMetadata, 0, len(recs))
	for i := range recs {
		out = append(out, *toMetadata(&recs[i]))
	}
	return out, nil
}

func (s *service) DeleteAPIKey(ctx context.Context, userID string, provider ai.Provider) error {
	if provider == "" {
		active, err := s.activeProvider(ctx, userID)
		if err != nil {
			return ErrInternal
		}
		provider = active
	}
	if err := s.repo.DeleteAPIKey(ctx, userID, string(provider)); err != nil {
		return ErrInternal
	}
	slog.Info("api key deleted", "user_id", userID, "provider", provider)

	// If the deleted key belonged to the active provider and the user still
	// has a valid key for the other one, switch over so AI keeps working.
	active, err := s.activeProvider(ctx, userID)
	if err == nil && active == provider {
		if recs, err := s.repo.ListAPIKeys(ctx, userID); err == nil {
			for _, rec := range recs {
				if rec.ValidationStatus == "valid" {
					if p, ok := ai.ParseProvider(rec.Provider); ok {
						_ = s.setActiveProvider(ctx, userID, p)
					}
					break
				}
			}
		}
	}
	return nil
}

func (s *service) RevalidateAPIKey(ctx context.Context, userID string, provider ai.Provider) (*APIKeyMetadata, error) {
	if provider == "" {
		active, err := s.activeProvider(ctx, userID)
		if err != nil {
			return nil, ErrInternal
		}
		provider = active
	}
	rec, err := s.repo.GetAPIKey(ctx, userID, string(provider))
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

	validErr := s.aiClient.ValidateKey(ctx, provider, plainKey)
	plainKey = "" // zero immediately

	status := "valid"
	if validErr != nil {
		status = "invalid"
	}

	if dbErr := s.repo.UpdateAPIKeyValidation(ctx, userID, string(provider), status, time.Now()); dbErr != nil {
		slog.Warn("api key validation status update failed", "user_id", userID, "error", dbErr)
	}

	updated, err := s.repo.GetAPIKey(ctx, userID, string(provider))
	if err != nil || updated == nil {
		return nil, ErrInternal
	}
	return toMetadata(updated), nil
}

// GetCredential implements ai.CredentialProvider.
// It is the only place keys are decrypted. Returns ai.ErrNoAPIKey (the
// canonical sentinel) when the active provider has no usable key.
func (s *service) GetCredential(ctx context.Context, userID string) (*ai.Credential, error) {
	prefs, err := s.repo.GetAIPreferences(ctx, userID)
	if err != nil {
		return nil, ErrInternal
	}
	provider := ai.ProviderOpenRouter
	cred := &ai.Credential{}
	if prefs != nil {
		if p, ok := ai.ParseProvider(prefs.Provider); ok {
			provider = p
		}
		if prefs.SmartModel != nil {
			cred.SmartModel = *prefs.SmartModel
		}
		if prefs.FastModel != nil {
			cred.FastModel = *prefs.FastModel
		}
	}
	cred.Provider = provider

	rec, err := s.repo.GetAPIKey(ctx, userID, string(provider))
	if err != nil {
		return nil, ErrInternal
	}
	// Any non-valid status means no usable key.
	if rec == nil || rec.ValidationStatus != "valid" {
		return nil, ai.ErrNoAPIKey
	}

	plainKey, err := s.apiKeySvc.Decrypt(rec.EncryptedKey)
	if err != nil {
		slog.Error("api key decrypt failed", "user_id", userID)
		return nil, ErrInternal
	}
	cred.APIKey = plainKey

	go func() {
		_ = s.repo.UpdateAPIKeyLastUsed(context.Background(), userID, string(provider), time.Now())
	}()

	return cred, nil
}

// ── AI provider / models ──────────────────────────────────────────────────────

func (s *service) GetAISettings(ctx context.Context, userID string) (*AISettings, error) {
	prefs, err := s.repo.GetAIPreferences(ctx, userID)
	if err != nil {
		return nil, ErrInternal
	}
	keys, err := s.ListAPIKeys(ctx, userID)
	if err != nil {
		return nil, err
	}

	out := &AISettings{Provider: ai.ProviderOpenRouter, Keys: keys}
	if prefs != nil {
		if p, ok := ai.ParseProvider(prefs.Provider); ok {
			out.Provider = p
		}
		out.SmartModel = nonEmpty(prefs.SmartModel)
		out.FastModel = nonEmpty(prefs.FastModel)
	}
	smart, fast := s.aiClient.DefaultModels(out.Provider)
	out.EffectiveSmartModel, out.EffectiveFastModel = smart, fast
	if out.SmartModel != nil {
		out.EffectiveSmartModel = *out.SmartModel
	}
	if out.FastModel != nil {
		out.EffectiveFastModel = *out.FastModel
	}
	return out, nil
}

func (s *service) UpdateAISettings(ctx context.Context, userID string, req UpdateAISettingsRequest) (*AISettings, error) {
	if _, ok := ai.ParseProvider(string(req.Provider)); !ok {
		return nil, ErrInvalidProvider
	}
	for _, m := range []*string{req.SmartModel, req.FastModel} {
		if m != nil && !validModelID(*m) {
			return nil, fmt.Errorf("%w: model ids must be 1-100 characters of letters, digits, '.', '-', '_', ':' or '/'", ErrInvalidInput)
		}
	}

	rec, err := s.repo.GetAPIKey(ctx, userID, string(req.Provider))
	if err != nil {
		return nil, ErrInternal
	}
	if rec == nil || rec.ValidationStatus != "valid" {
		return nil, ErrProviderNoKey
	}

	current, err := s.repo.GetAIPreferences(ctx, userID)
	if err != nil {
		return nil, ErrInternal
	}
	next := AIPreferences{UserID: userID, Provider: string(req.Provider)}
	if current != nil && current.Provider == string(req.Provider) {
		// Same provider: keep overrides that weren't mentioned.
		next.SmartModel, next.FastModel = current.SmartModel, current.FastModel
	}
	if req.SmartModel != nil {
		next.SmartModel = nonEmpty(req.SmartModel)
	}
	if req.FastModel != nil {
		next.FastModel = nonEmpty(req.FastModel)
	}
	if err := s.repo.UpsertAIPreferences(ctx, next); err != nil {
		return nil, ErrInternal
	}
	return s.GetAISettings(ctx, userID)
}

func (s *service) activeProvider(ctx context.Context, userID string) (ai.Provider, error) {
	prefs, err := s.repo.GetAIPreferences(ctx, userID)
	if err != nil {
		return "", err
	}
	if prefs != nil {
		if p, ok := ai.ParseProvider(prefs.Provider); ok {
			return p, nil
		}
	}
	return ai.ProviderOpenRouter, nil
}

// setActiveProvider switches provider, clearing model overrides that belong
// to the previous provider (model ids are provider-specific).
func (s *service) setActiveProvider(ctx context.Context, userID string, provider ai.Provider) error {
	current, err := s.repo.GetAIPreferences(ctx, userID)
	if err != nil {
		return err
	}
	if current != nil && current.Provider == string(provider) {
		return nil
	}
	return s.repo.UpsertAIPreferences(ctx, AIPreferences{UserID: userID, Provider: string(provider)})
}

func nonEmpty(p *string) *string {
	if p == nil {
		return nil
	}
	v := strings.TrimSpace(*p)
	if v == "" {
		return nil
	}
	return &v
}

func validModelID(m string) bool {
	m = strings.TrimSpace(m)
	if m == "" {
		return true // empty resets to default
	}
	if len(m) > 100 {
		return false
	}
	for _, r := range m {
		switch {
		case r >= 'a' && r <= 'z', r >= 'A' && r <= 'Z', r >= '0' && r <= '9':
		case r == '.', r == '-', r == '_', r == ':', r == '/':
		default:
			return false
		}
	}
	return true
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
