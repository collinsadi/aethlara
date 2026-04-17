package chat

import (
	"encoding/json"
	"errors"
	"net/http"
	"strconv"
	"strings"

	"github.com/go-chi/chi/v5"

	"github.com/collinsadi/aethlara/internal/ai"
	"github.com/collinsadi/aethlara/internal/middleware"
	"github.com/collinsadi/aethlara/pkg/response"
)

const maxBodyBytes = 1 << 16 // 64 KB — chat bodies are small

type Handler struct {
	svc Service
}

func NewHandler(svc Service) *Handler {
	return &Handler{svc: svc}
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

// ── POST /chat/sessions ───────────────────────────────────────────────────────

func (h *Handler) CreateOrGetSession(w http.ResponseWriter, r *http.Request) {
	userID, ok := middleware.UserIDFromContext(r.Context())
	if !ok {
		response.Error(w, http.StatusUnauthorized, response.CodeUnauthorized, "Authentication required.")
		return
	}

	var body struct {
		JobID string `json:"job_id"`
	}
	if !decodeBody(w, r, &body) {
		return
	}

	summary, created, err := h.svc.CreateOrGetSession(r.Context(), userID, body.JobID)
	if err != nil {
		h.writeServiceError(w, err)
		return
	}

	status := http.StatusOK
	msg := "Existing chat session."
	if created {
		status = http.StatusCreated
		msg = "Chat session created."
	}
	response.Success(w, status, summary, msg)
}

// ── GET /chat/sessions ────────────────────────────────────────────────────────

func (h *Handler) ListSessions(w http.ResponseWriter, r *http.Request) {
	userID, ok := middleware.UserIDFromContext(r.Context())
	if !ok {
		response.Error(w, http.StatusUnauthorized, response.CodeUnauthorized, "Authentication required.")
		return
	}

	sessions, err := h.svc.ListSessions(r.Context(), userID)
	if err != nil {
		h.writeServiceError(w, err)
		return
	}
	response.Success(w, http.StatusOK, map[string]any{"items": sessions}, "")
}

// ── GET /chat/sessions/:session_id/messages ───────────────────────────────────

func (h *Handler) GetMessages(w http.ResponseWriter, r *http.Request) {
	userID, ok := middleware.UserIDFromContext(r.Context())
	if !ok {
		response.Error(w, http.StatusUnauthorized, response.CodeUnauthorized, "Authentication required.")
		return
	}

	sessionID := chi.URLParam(r, "session_id")
	if strings.TrimSpace(sessionID) == "" {
		response.Error(w, http.StatusBadRequest, response.CodeInvalidInput, "session_id is required.")
		return
	}

	// Cursor (oldest currently-loaded id, exclusive)
	var before *string
	if b := strings.TrimSpace(r.URL.Query().Get("before")); b != "" {
		before = &b
	}

	limit := 50
	if ls := r.URL.Query().Get("limit"); ls != "" {
		if n, err := strconv.Atoi(ls); err == nil {
			if n > 0 && n <= 100 {
				limit = n
			}
		}
	}

	page, err := h.svc.GetMessages(r.Context(), userID, sessionID, before, limit)
	if err != nil {
		h.writeServiceError(w, err)
		return
	}
	response.Success(w, http.StatusOK, page, "")
}

// ── POST /chat/sessions/:session_id/messages ──────────────────────────────────

func (h *Handler) SendMessage(w http.ResponseWriter, r *http.Request) {
	userID, ok := middleware.UserIDFromContext(r.Context())
	if !ok {
		response.Error(w, http.StatusUnauthorized, response.CodeUnauthorized, "Authentication required.")
		return
	}

	sessionID := chi.URLParam(r, "session_id")
	if strings.TrimSpace(sessionID) == "" {
		response.Error(w, http.StatusBadRequest, response.CodeInvalidInput, "session_id is required.")
		return
	}

	var body struct {
		Content string `json:"content"`
	}
	if !decodeBody(w, r, &body) {
		return
	}

	msg, err := h.svc.SendMessage(r.Context(), userID, sessionID, body.Content)
	if err != nil {
		h.writeServiceError(w, err)
		return
	}
	response.Success(w, http.StatusCreated, msg, "")
}

// ── DELETE /chat/sessions/:session_id ─────────────────────────────────────────

func (h *Handler) DeleteSession(w http.ResponseWriter, r *http.Request) {
	userID, ok := middleware.UserIDFromContext(r.Context())
	if !ok {
		response.Error(w, http.StatusUnauthorized, response.CodeUnauthorized, "Authentication required.")
		return
	}

	sessionID := chi.URLParam(r, "session_id")
	if strings.TrimSpace(sessionID) == "" {
		response.Error(w, http.StatusBadRequest, response.CodeInvalidInput, "session_id is required.")
		return
	}

	if err := h.svc.DeleteSession(r.Context(), userID, sessionID); err != nil {
		h.writeServiceError(w, err)
		return
	}
	response.Success(w, http.StatusOK, map[string]any{"id": sessionID}, "Chat session deleted.")
}

// ── error mapping ─────────────────────────────────────────────────────────────

// writeServiceError maps a service-level error to the correct HTTP response.
// ai.ErrNoAPIKey is translated into the same 403 API_KEY_REQUIRED envelope
// produced by the AI gate middleware so the frontend can handle it uniformly.
func (h *Handler) writeServiceError(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, ai.ErrNoAPIKey):
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusForbidden)
		_, _ = w.Write([]byte(`{"error":{"code":"API_KEY_REQUIRED","message":"An OpenRouter API key is required to use this feature. Add your key in Settings.","action":{"label":"Add API Key","path":"/settings#api-key"}}}`))
	case errors.Is(err, ErrInvalidInput):
		response.Error(w, http.StatusBadRequest, response.CodeInvalidInput, err.Error())
	case errors.Is(err, ErrNotFound):
		response.Error(w, http.StatusNotFound, response.CodeNotFound, "Chat session not found.")
	case errors.Is(err, ErrJobNotFound):
		response.Error(w, http.StatusNotFound, response.CodeNotFound, "Job not found.")
	case errors.Is(err, ErrJobNotReady):
		response.Error(w, http.StatusConflict, "JOB_NOT_READY",
			"This job's alignment is not yet complete. Chat is available once analysis finishes.")
	case errors.Is(err, ErrRateLimited):
		w.Header().Set("Retry-After", "60")
		response.Error(w, http.StatusTooManyRequests, response.CodeRateLimited,
			"You're sending messages too quickly. Please wait a moment.")
	case errors.Is(err, ErrContextAssembly):
		response.Error(w, http.StatusInternalServerError, "CONTEXT_ASSEMBLY_FAILED",
			"We couldn't assemble the chat context. Please try again.")
	case errors.Is(err, ErrAIUnavailable):
		response.Error(w, http.StatusBadGateway, "AI_UNAVAILABLE",
			"The assistant is temporarily unavailable. Please try again in a moment.")
	case errors.Is(err, ErrForbidden):
		response.Error(w, http.StatusForbidden, response.CodeForbidden, "Access denied.")
	default:
		response.Error(w, http.StatusInternalServerError, response.CodeInternalError, "An unexpected error occurred.")
	}
}
