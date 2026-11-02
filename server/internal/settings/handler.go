package settings

import (
	"encoding/json"
	"errors"
	"net/http"
	"strings"
	"time"

	"github.com/collinsadi/aethlara/internal/ai"
	"github.com/collinsadi/aethlara/internal/middleware"
	"github.com/collinsadi/aethlara/pkg/response"
)

type Handler struct {
	svc Service
}

func NewHandler(svc Service) *Handler {
	return &Handler{svc: svc}
}

// ── DTOs ──────────────────────────────────────────────────────────────────────

type saveAPIKeyRequest struct {
	APIKey     string  `json:"api_key"`
	Label      *string `json:"label,omitempty"`
	Provider   string  `json:"provider,omitempty"`    // "openrouter" (default) or "anthropic"
	MakeActive *bool   `json:"make_active,omitempty"` // default true
}

type aiSettingsResponse struct {
	Provider            string                `json:"provider"`
	SmartModel          *string               `json:"smart_model"`
	FastModel           *string               `json:"fast_model"`
	EffectiveSmartModel string                `json:"effective_smart_model"`
	EffectiveFastModel  string                `json:"effective_fast_model"`
	Keys                []apiKeyResponse      `json:"keys"`
	Providers           []aiProviderOptionDTO `json:"providers"`
}

type aiProviderOptionDTO struct {
	ID                string   `json:"id"`
	Label             string   `json:"label"`
	KeyPrefix         string   `json:"key_prefix"`
	SupportsWebSearch bool     `json:"supports_web_search"`
	SuggestedModels   []string `json:"suggested_models"`
}

type updateAISettingsRequest struct {
	Provider   string  `json:"provider"`
	SmartModel *string `json:"smart_model"`
	FastModel  *string `json:"fast_model"`
}

type apiKeyResponse struct {
	ID               string     `json:"id"`
	Provider         string     `json:"provider"`
	KeyPrefix        string     `json:"key_prefix"`
	Label            *string    `json:"label,omitempty"`
	ValidationStatus string     `json:"validation_status"`
	LastUsedAt       *time.Time `json:"last_used_at"`
	LastValidatedAt  *time.Time `json:"last_validated_at"`
	CreatedAt        time.Time  `json:"created_at"`
	// encrypted_key is intentionally absent from this struct.
}

type updateProfileRequest struct {
	FullName string `json:"full_name"`
}

type userResponse struct {
	ID        string    `json:"id"`
	FullName  string    `json:"full_name"`
	Email     string    `json:"email"`
	UpdatedAt time.Time `json:"updated_at"`
}

type requestEmailChangeRequest struct {
	NewEmail string `json:"new_email"`
}

type confirmEmailChangeRequest struct {
	NewEmail string `json:"new_email"`
	OTP      string `json:"otp"`
}

// ── Handlers ──────────────────────────────────────────────────────────────────

func (h *Handler) SaveAPIKey(w http.ResponseWriter, r *http.Request) {
	userID, ok := middleware.UserIDFromContext(r.Context())
	if !ok {
		response.Error(w, http.StatusUnauthorized, response.CodeUnauthorized, "Authentication required.")
		return
	}

	var req saveAPIKeyRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		response.Error(w, http.StatusBadRequest, response.CodeInvalidInput, "Invalid request body.")
		return
	}

	req.APIKey = strings.TrimSpace(req.APIKey)
	if req.APIKey == "" {
		response.Error(w, http.StatusBadRequest, response.CodeInvalidInput, "api_key is required.")
		return
	}
	if req.Label != nil {
		trimmed := strings.TrimSpace(*req.Label)
		if len(trimmed) > 50 {
			response.Error(w, http.StatusBadRequest, response.CodeInvalidInput, "label must be 50 characters or fewer.")
			return
		}
		req.Label = &trimmed
	}

	provider := ai.ProviderOpenRouter
	if req.Provider != "" {
		p, ok := ai.ParseProvider(req.Provider)
		if !ok {
			response.Error(w, http.StatusBadRequest, response.CodeInvalidInput, "provider must be \"openrouter\" or \"anthropic\".")
			return
		}
		provider = p
	}
	makeActive := req.MakeActive == nil || *req.MakeActive

	meta, err := h.svc.SaveAPIKey(r.Context(), userID, SaveAPIKeyRequest{
		Provider:   provider,
		PlainKey:   req.APIKey,
		Label:      req.Label,
		MakeActive: makeActive,
	})
	req.APIKey = "" // zero from handler scope
	if err != nil {
		if errors.Is(err, ErrInvalidKey) {
			response.Error(w, http.StatusUnprocessableEntity, "INVALID_API_KEY",
				"Key format is invalid or was rejected by "+provider.Label()+". Check the key and try again.")
			return
		}
		response.Error(w, http.StatusInternalServerError, response.CodeInternalError, "An unexpected error occurred.")
		return
	}

	response.Success(w, http.StatusCreated, toAPIKeyResponse(meta), "API key saved and verified successfully.")
}

func (h *Handler) GetAPIKey(w http.ResponseWriter, r *http.Request) {
	userID, ok := middleware.UserIDFromContext(r.Context())
	if !ok {
		response.Error(w, http.StatusUnauthorized, response.CodeUnauthorized, "Authentication required.")
		return
	}

	provider, ok := providerFromQuery(w, r)
	if !ok {
		return
	}
	meta, err := h.svc.GetAPIKey(r.Context(), userID, provider)
	if err != nil {
		response.Error(w, http.StatusInternalServerError, response.CodeInternalError, "An unexpected error occurred.")
		return
	}

	if meta == nil {
		response.Success(w, http.StatusOK, nil, "")
		return
	}
	response.Success(w, http.StatusOK, toAPIKeyResponse(meta), "")
}

func (h *Handler) DeleteAPIKey(w http.ResponseWriter, r *http.Request) {
	userID, ok := middleware.UserIDFromContext(r.Context())
	if !ok {
		response.Error(w, http.StatusUnauthorized, response.CodeUnauthorized, "Authentication required.")
		return
	}

	provider, ok := providerFromQuery(w, r)
	if !ok {
		return
	}
	if err := h.svc.DeleteAPIKey(r.Context(), userID, provider); err != nil {
		response.Error(w, http.StatusInternalServerError, response.CodeInternalError, "An unexpected error occurred.")
		return
	}
	response.Success(w, http.StatusOK, nil, "API key deleted permanently.")
}

func (h *Handler) ValidateAPIKey(w http.ResponseWriter, r *http.Request) {
	userID, ok := middleware.UserIDFromContext(r.Context())
	if !ok {
		response.Error(w, http.StatusUnauthorized, response.CodeUnauthorized, "Authentication required.")
		return
	}

	provider, ok := providerFromQuery(w, r)
	if !ok {
		return
	}
	meta, err := h.svc.RevalidateAPIKey(r.Context(), userID, provider)
	if err != nil {
		if errors.Is(err, ErrNoAPIKey) {
			response.Error(w, http.StatusNotFound, response.CodeNotFound, "No API key on file.")
			return
		}
		response.Error(w, http.StatusInternalServerError, response.CodeInternalError, "An unexpected error occurred.")
		return
	}
	response.Success(w, http.StatusOK, toAPIKeyResponse(meta), "")
}

func (h *Handler) UpdateProfile(w http.ResponseWriter, r *http.Request) {
	userID, ok := middleware.UserIDFromContext(r.Context())
	if !ok {
		response.Error(w, http.StatusUnauthorized, response.CodeUnauthorized, "Authentication required.")
		return
	}

	var req updateProfileRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		response.Error(w, http.StatusBadRequest, response.CodeInvalidInput, "Invalid request body.")
		return
	}

	u, err := h.svc.UpdateProfile(r.Context(), userID, UpdateProfileRequest{FullName: req.FullName})
	if err != nil {
		if errors.Is(err, ErrInvalidInput) {
			response.Error(w, http.StatusBadRequest, response.CodeInvalidInput, err.Error())
			return
		}
		response.Error(w, http.StatusInternalServerError, response.CodeInternalError, "An unexpected error occurred.")
		return
	}

	response.Success(w, http.StatusOK, userResponse{
		ID:        u.ID,
		FullName:  u.FullName,
		Email:     u.Email,
		UpdatedAt: u.UpdatedAt,
	}, "")
}

func (h *Handler) RequestEmailChange(w http.ResponseWriter, r *http.Request) {
	userID, ok := middleware.UserIDFromContext(r.Context())
	if !ok {
		response.Error(w, http.StatusUnauthorized, response.CodeUnauthorized, "Authentication required.")
		return
	}

	var req requestEmailChangeRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		response.Error(w, http.StatusBadRequest, response.CodeInvalidInput, "Invalid request body.")
		return
	}

	if err := h.svc.RequestEmailChange(r.Context(), userID, RequestEmailChangeRequest{NewEmail: req.NewEmail}); err != nil {
		if errors.Is(err, ErrInvalidInput) {
			response.Error(w, http.StatusBadRequest, response.CodeInvalidInput, err.Error())
			return
		}
		response.Error(w, http.StatusInternalServerError, response.CodeInternalError, "An unexpected error occurred.")
		return
	}

	response.Success(w, http.StatusAccepted, nil,
		"If that email is available, a verification code has been sent to it.")
}

func (h *Handler) ConfirmEmailChange(w http.ResponseWriter, r *http.Request) {
	userID, ok := middleware.UserIDFromContext(r.Context())
	if !ok {
		response.Error(w, http.StatusUnauthorized, response.CodeUnauthorized, "Authentication required.")
		return
	}

	var req confirmEmailChangeRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		response.Error(w, http.StatusBadRequest, response.CodeInvalidInput, "Invalid request body.")
		return
	}

	if err := h.svc.ConfirmEmailChange(r.Context(), userID, ConfirmEmailChangeRequest{
		NewEmail: req.NewEmail,
		OTP:      req.OTP,
	}); err != nil {
		switch {
		case errors.Is(err, ErrOTPExpired):
			response.Error(w, http.StatusBadRequest, response.CodeOTPExpired, "Verification code has expired.")
		case errors.Is(err, ErrOTPInvalid):
			response.Error(w, http.StatusBadRequest, response.CodeInvalidOTP, "Incorrect verification code.")
		case errors.Is(err, ErrOTPMaxAttempts):
			response.Error(w, http.StatusTooManyRequests, response.CodeOTPMaxAttempts, "Too many incorrect attempts. Request a new code.")
		default:
			response.Error(w, http.StatusInternalServerError, response.CodeInternalError, "An unexpected error occurred.")
		}
		return
	}

	response.Success(w, http.StatusOK, nil,
		"Email updated successfully. Please log in again with your new email address.")
}

func (h *Handler) ListAPIKeys(w http.ResponseWriter, r *http.Request) {
	userID, ok := middleware.UserIDFromContext(r.Context())
	if !ok {
		response.Error(w, http.StatusUnauthorized, response.CodeUnauthorized, "Authentication required.")
		return
	}
	keys, err := h.svc.ListAPIKeys(r.Context(), userID)
	if err != nil {
		response.Error(w, http.StatusInternalServerError, response.CodeInternalError, "An unexpected error occurred.")
		return
	}
	out := make([]apiKeyResponse, 0, len(keys))
	for i := range keys {
		out = append(out, toAPIKeyResponse(&keys[i]))
	}
	response.Success(w, http.StatusOK, out, "")
}

func (h *Handler) GetAISettings(w http.ResponseWriter, r *http.Request) {
	userID, ok := middleware.UserIDFromContext(r.Context())
	if !ok {
		response.Error(w, http.StatusUnauthorized, response.CodeUnauthorized, "Authentication required.")
		return
	}
	settings, err := h.svc.GetAISettings(r.Context(), userID)
	if err != nil {
		response.Error(w, http.StatusInternalServerError, response.CodeInternalError, "An unexpected error occurred.")
		return
	}
	response.Success(w, http.StatusOK, toAISettingsResponse(settings), "")
}

func (h *Handler) UpdateAISettings(w http.ResponseWriter, r *http.Request) {
	userID, ok := middleware.UserIDFromContext(r.Context())
	if !ok {
		response.Error(w, http.StatusUnauthorized, response.CodeUnauthorized, "Authentication required.")
		return
	}
	var req updateAISettingsRequest
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 16<<10)).Decode(&req); err != nil {
		response.Error(w, http.StatusBadRequest, response.CodeInvalidInput, "Invalid request body.")
		return
	}
	provider, ok := ai.ParseProvider(req.Provider)
	if !ok {
		response.Error(w, http.StatusBadRequest, response.CodeInvalidInput, "provider must be \"openrouter\" or \"anthropic\".")
		return
	}

	settings, err := h.svc.UpdateAISettings(r.Context(), userID, UpdateAISettingsRequest{
		Provider:   provider,
		SmartModel: req.SmartModel,
		FastModel:  req.FastModel,
	})
	if err != nil {
		switch {
		case errors.Is(err, ErrProviderNoKey):
			response.Error(w, http.StatusUnprocessableEntity, "PROVIDER_KEY_REQUIRED",
				"Add a valid "+provider.Label()+" API key before switching to it.")
		case errors.Is(err, ErrInvalidInput), errors.Is(err, ErrInvalidProvider):
			response.Error(w, http.StatusBadRequest, response.CodeInvalidInput, err.Error())
		default:
			response.Error(w, http.StatusInternalServerError, response.CodeInternalError, "An unexpected error occurred.")
		}
		return
	}
	response.Success(w, http.StatusOK, toAISettingsResponse(settings), "AI settings updated.")
}

// providerFromQuery reads ?provider=; empty means "the active provider".
func providerFromQuery(w http.ResponseWriter, r *http.Request) (ai.Provider, bool) {
	raw := strings.TrimSpace(r.URL.Query().Get("provider"))
	if raw == "" {
		return "", true
	}
	p, ok := ai.ParseProvider(raw)
	if !ok {
		response.Error(w, http.StatusBadRequest, response.CodeInvalidInput, "provider must be \"openrouter\" or \"anthropic\".")
		return "", false
	}
	return p, true
}

func toAISettingsResponse(s *AISettings) aiSettingsResponse {
	keys := make([]apiKeyResponse, 0, len(s.Keys))
	for i := range s.Keys {
		keys = append(keys, toAPIKeyResponse(&s.Keys[i]))
	}
	return aiSettingsResponse{
		Provider:            string(s.Provider),
		SmartModel:          s.SmartModel,
		FastModel:           s.FastModel,
		EffectiveSmartModel: s.EffectiveSmartModel,
		EffectiveFastModel:  s.EffectiveFastModel,
		Keys:                keys,
		Providers: []aiProviderOptionDTO{
			{
				ID: string(ai.ProviderAnthropic), Label: ai.ProviderAnthropic.Label(), KeyPrefix: "sk-ant-",
				SupportsWebSearch: true, SuggestedModels: ai.SuggestedModels(ai.ProviderAnthropic),
			},
			{
				ID: string(ai.ProviderOpenRouter), Label: ai.ProviderOpenRouter.Label(), KeyPrefix: "sk-or-",
				SupportsWebSearch: false, SuggestedModels: ai.SuggestedModels(ai.ProviderOpenRouter),
			},
		},
	}
}

func toAPIKeyResponse(m *APIKeyMetadata) apiKeyResponse {
	return apiKeyResponse{
		ID:               m.ID,
		Provider:         m.Provider,
		KeyPrefix:        m.KeyPrefix,
		Label:            m.Label,
		ValidationStatus: m.ValidationStatus,
		LastUsedAt:       m.LastUsedAt,
		LastValidatedAt:  m.LastValidatedAt,
		CreatedAt:        m.CreatedAt,
	}
}
