package response

import (
	"encoding/json"
	"net/http"
)

// Error codes
const (
	CodeInvalidInput   = "INVALID_INPUT"
	CodeEmailExists    = "EMAIL_EXISTS"
	CodeInvalidOTP     = "INVALID_OTP"
	CodeOTPExpired     = "OTP_EXPIRED"
	CodeOTPMaxAttempts = "OTP_MAX_ATTEMPTS"
	CodeUnauthorized   = "UNAUTHORIZED"
	CodeForbidden      = "FORBIDDEN"
	CodeNotFound       = "NOT_FOUND"
	CodeInternalError  = "INTERNAL_ERROR"
	CodeRateLimited    = "RATE_LIMITED"
	CodeTokenInvalid   = "TOKEN_INVALID"
	CodeTokenRevoked   = "TOKEN_REVOKED"
)

type successEnvelope struct {
	Data    any    `json:"data,omitempty"`
	Message string `json:"message,omitempty"`
}

type errDetail struct {
	Code    string `json:"code"`
	Message string `json:"message"`
}

type errEnvelope struct {
	Error errDetail `json:"error"`
}

func JSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}

func Success(w http.ResponseWriter, status int, data any, message string) {
	JSON(w, status, successEnvelope{Data: data, Message: message})
}

func Error(w http.ResponseWriter, status int, code, message string) {
	JSON(w, status, errEnvelope{Error: errDetail{Code: code, Message: message}})
}
