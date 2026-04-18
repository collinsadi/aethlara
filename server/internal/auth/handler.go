package auth

import (
	"encoding/json"
	"errors"
	"net/http"
	"time"

	"github.com/collinsadi/aethlara/internal/middleware"
	"github.com/collinsadi/aethlara/pkg/response"
	"github.com/collinsadi/aethlara/pkg/validator"
)

const maxBodyBytes = 1 << 20 // 1 MB

type Handler struct {
	svc Service
}

func NewHandler(svc Service) *Handler {
	return &Handler{svc: svc}
}

// POST /auth/signup
func (h *Handler) Signup(w http.ResponseWriter, r *http.Request) {
	var body struct {
		FullName string `json:"full_name"`
		Email    string `json:"email"`
	}
	if !decodeBody(w, r, &body) {
		return
	}

	body.Email = validator.NormalizeEmail(body.Email)

	if !validator.ValidateFullName(body.FullName) {
		response.Error(w, http.StatusBadRequest, response.CodeInvalidInput,
			"full_name must be 2–100 characters and contain only letters, spaces, and hyphens.")
		return
	}
	if !validator.ValidateEmail(body.Email) {
		response.Error(w, http.StatusBadRequest, response.CodeInvalidInput, "A valid email address is required.")
		return
	}

	err := h.svc.Signup(r.Context(), SignupRequest{
		FullName: body.FullName,
		Email:    body.Email,
	})

	// Always return the same message regardless of outcome (prevent enumeration)
	if err != nil && !errors.Is(err, ErrUserExists) {
		response.Error(w, http.StatusInternalServerError, response.CodeInternalError, "An unexpected error occurred.")
		return
	}

	response.Success(w, http.StatusAccepted, nil,
		"If this email is valid, a verification code has been sent.")
}

// POST /auth/verify-otp
func (h *Handler) VerifyOTP(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Email string `json:"email"`
		OTP   string `json:"otp"`
		Type  string `json:"type"`
	}
	if !decodeBody(w, r, &body) {
		return
	}

	body.Email = validator.NormalizeEmail(body.Email)

	if !validator.ValidateEmail(body.Email) {
		response.Error(w, http.StatusBadRequest, response.CodeInvalidInput, "A valid email address is required.")
		return
	}
	if !validator.ValidateOTP(body.OTP) {
		response.Error(w, http.StatusBadRequest, response.CodeInvalidInput, "otp must be a 6-digit numeric code.")
		return
	}
	if !validator.ValidateOTPType(body.Type) {
		response.Error(w, http.StatusBadRequest, response.CodeInvalidInput, "type must be 'signup' or 'login'.")
		return
	}

	pair, err := h.svc.VerifyOTP(r.Context(), VerifyOTPRequest{
		Email:     body.Email,
		OTP:       body.OTP,
		Type:      body.Type,
		UserAgent: r.UserAgent(),
		IPAddress: extractIP(r),
	})
	if err != nil {
		switch {
		case errors.Is(err, ErrOTPMaxAttempts):
			response.Error(w, http.StatusTooManyRequests, response.CodeOTPMaxAttempts,
				"Too many incorrect attempts. Please request a new code.")
		case errors.Is(err, ErrOTPExpired):
			response.Error(w, http.StatusBadRequest, response.CodeOTPExpired,
				"The verification code has expired. Please request a new one.")
		default:
			response.Error(w, http.StatusBadRequest, response.CodeInvalidOTP,
				"The code you entered is incorrect or has expired.")
		}
		return
	}

	response.Success(w, http.StatusOK, tokenResponse(pair), "")
}

// POST /auth/login
func (h *Handler) Login(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Email string `json:"email"`
	}
	if !decodeBody(w, r, &body) {
		return
	}

	body.Email = validator.NormalizeEmail(body.Email)
	if !validator.ValidateEmail(body.Email) {
		response.Error(w, http.StatusBadRequest, response.CodeInvalidInput, "A valid email address is required.")
		return
	}

	// Error is swallowed — identical response regardless of outcome (prevent enumeration)
	_ = h.svc.Login(r.Context(), LoginRequest{Email: body.Email})

	response.Success(w, http.StatusAccepted, nil,
		"If this email is associated with an account, a login code has been sent.")
}

// POST /auth/refresh
func (h *Handler) Refresh(w http.ResponseWriter, r *http.Request) {
	var body struct {
		RefreshToken string `json:"refresh_token"`
	}
	if !decodeBody(w, r, &body) {
		return
	}

	// Also accept from Refresh-Token header
	if body.RefreshToken == "" {
		body.RefreshToken = r.Header.Get("Refresh-Token")
	}
	if body.RefreshToken == "" {
		response.Error(w, http.StatusBadRequest, response.CodeInvalidInput, "refresh_token is required.")
		return
	}

	pair, err := h.svc.Refresh(r.Context(), RefreshRequest{
		RefreshToken: body.RefreshToken,
		UserAgent:    r.UserAgent(),
		IPAddress:    extractIP(r),
	})
	if err != nil {
		switch {
		case errors.Is(err, ErrTokenRevoked):
			response.Error(w, http.StatusUnauthorized, response.CodeTokenRevoked,
				"Token has been revoked. Please sign in again.")
		case errors.Is(err, ErrTokenExpired):
			response.Error(w, http.StatusUnauthorized, response.CodeTokenInvalid,
				"Token has expired. Please sign in again.")
		default:
			response.Error(w, http.StatusUnauthorized, response.CodeTokenInvalid,
				"Invalid refresh token.")
		}
		return
	}

	response.Success(w, http.StatusOK, map[string]any{
		"access_token":  pair.AccessToken,
		"refresh_token": pair.RefreshToken,
		"expires_in":    pair.ExpiresIn,
	}, "")
}

// POST /auth/logout
func (h *Handler) Logout(w http.ResponseWriter, r *http.Request) {
	userID, ok := middleware.UserIDFromContext(r.Context())
	if !ok {
		response.Error(w, http.StatusUnauthorized, response.CodeUnauthorized, "Authentication required.")
		return
	}

	var body struct {
		RefreshToken string `json:"refresh_token"`
	}
	if !decodeBody(w, r, &body) {
		return
	}
	if body.RefreshToken == "" {
		response.Error(w, http.StatusBadRequest, response.CodeInvalidInput, "refresh_token is required.")
		return
	}

	if err := h.svc.Logout(r.Context(), userID, body.RefreshToken); err != nil {
		if errors.Is(err, ErrTokenOwnership) {
			response.Error(w, http.StatusForbidden, response.CodeForbidden, "Token does not belong to this user.")
			return
		}
		response.Error(w, http.StatusInternalServerError, response.CodeInternalError, "An unexpected error occurred.")
		return
	}

	response.Success(w, http.StatusOK, nil, "Logged out successfully.")
}

// POST /auth/logout-all
func (h *Handler) LogoutAll(w http.ResponseWriter, r *http.Request) {
	userID, ok := middleware.UserIDFromContext(r.Context())
	if !ok {
		response.Error(w, http.StatusUnauthorized, response.CodeUnauthorized, "Authentication required.")
		return
	}

	if err := h.svc.LogoutAll(r.Context(), userID); err != nil {
		response.Error(w, http.StatusInternalServerError, response.CodeInternalError, "An unexpected error occurred.")
		return
	}

	response.Success(w, http.StatusOK, nil, "All sessions logged out successfully.")
}

// POST /auth/extension-token
func (h *Handler) GenerateExtensionToken(w http.ResponseWriter, r *http.Request) {
	userID, ok := middleware.UserIDFromContext(r.Context())
	if !ok {
		response.Error(w, http.StatusUnauthorized, response.CodeUnauthorized, "Authentication required.")
		return
	}

	origin := r.Header.Get("Origin")

	result, err := h.svc.GenerateExtensionToken(r.Context(), userID, origin)
	if err != nil {
		switch {
		case errors.Is(err, ErrExtensionRateLimited):
			response.Error(w, http.StatusTooManyRequests, response.CodeRateLimited,
				"Too many extension tokens generated. Try again later.")
		default:
			response.Error(w, http.StatusInternalServerError, response.CodeInternalError,
				"An unexpected error occurred.")
		}
		return
	}

	response.Success(w, http.StatusCreated, map[string]any{
		"token":      result.Token,
		"expires_in": result.ExpiresIn,
	}, "")
}

// POST /auth/extension-token/exchange
func (h *Handler) ExchangeExtensionToken(w http.ResponseWriter, r *http.Request) {
	var body struct {
		ExtToken string `json:"ext_token"`
	}
	if !decodeBody(w, r, &body) {
		return
	}
	if body.ExtToken == "" {
		response.Error(w, http.StatusBadRequest, response.CodeInvalidInput, "ext_token is required.")
		return
	}

	result, err := h.svc.ExchangeExtensionToken(r.Context(), body.ExtToken)
	if err != nil {
		// Generic response — no detail about what failed
		response.Error(w, http.StatusUnauthorized, response.CodeUnauthorized, "Invalid or expired token.")
		return
	}

	response.Success(w, http.StatusOK, map[string]any{
		"access_token": result.AccessToken,
		"expires_at":   result.ExpiresAt,
		"user": map[string]any{
			"id":        result.User.ID,
			"full_name": result.User.FullName,
			"email":     result.User.Email,
		},
	}, "")
}

// ---- helpers ----

type tokenResponseData struct {
	AccessToken  string    `json:"access_token"`
	RefreshToken string    `json:"refresh_token"`
	TokenType    string    `json:"token_type"`
	ExpiresIn    int       `json:"expires_in"`
	User         userResp  `json:"user"`
}

type userResp struct {
	ID          string     `json:"id"`
	FullName    string     `json:"full_name"`
	Email       string     `json:"email"`
	BillingPlan string     `json:"billing_plan"`
	CreatedAt   time.Time  `json:"created_at"`
}

func tokenResponse(pair *TokenPair) tokenResponseData {
	return tokenResponseData{
		AccessToken:  pair.AccessToken,
		RefreshToken: pair.RefreshToken,
		TokenType:    "Bearer",
		ExpiresIn:    pair.ExpiresIn,
		User: userResp{
			ID:          pair.User.ID,
			FullName:    pair.User.FullName,
			Email:       pair.User.Email,
			BillingPlan: pair.User.BillingPlan,
			CreatedAt:   pair.User.CreatedAt,
		},
	}
}

func decodeBody(w http.ResponseWriter, r *http.Request, v any) bool {
	r.Body = http.MaxBytesReader(w, r.Body, maxBodyBytes)
	dec := json.NewDecoder(r.Body)
	dec.DisallowUnknownFields()
	if err := dec.Decode(v); err != nil {
		response.Error(w, http.StatusBadRequest, response.CodeInvalidInput, "Invalid request body.")
		return false
	}
	return true
}

func extractIP(r *http.Request) string {
	return middleware.GetRealIP(r)
}
