package resume

import (
	"errors"
	"io"
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"

	"github.com/collinsadi/aethlara/internal/middleware"
	"github.com/collinsadi/aethlara/internal/config"
	"github.com/collinsadi/aethlara/pkg/response"
)

type Handler struct {
	svc Service
	cfg *config.Config
}

func NewHandler(svc Service, cfg *config.Config) *Handler {
	return &Handler{svc: svc, cfg: cfg}
}

type resumeResponse struct {
	ID               string     `json:"id"`
	Name             string     `json:"name"`
	FileFormat       string     `json:"file_format"`
	FileSizeBytes    int64      `json:"file_size_bytes"`
	ExtractionStatus string     `json:"extraction_status"`
	UploadedAt       time.Time  `json:"uploaded_at"`
}

func toResponse(r *Resume) resumeResponse {
	return resumeResponse{
		ID:               r.ID,
		Name:             r.Name,
		FileFormat:       r.FileFormat,
		FileSizeBytes:    r.FileSizeBytes,
		ExtractionStatus: r.ExtractionStatus,
		UploadedAt:       r.UploadedAt,
	}
}

// POST /resumes/upload
func (h *Handler) Upload(w http.ResponseWriter, r *http.Request) {
	userID, ok := middleware.UserIDFromContext(r.Context())
	if !ok {
		response.Error(w, http.StatusUnauthorized, response.CodeUnauthorized, "Authentication required.")
		return
	}

	// Limit total request body to max file size + form overhead
	r.Body = http.MaxBytesReader(w, r.Body, h.cfg.ResumeMaxFileSize()+512*1024)
	if err := r.ParseMultipartForm(h.cfg.ResumeMaxFileSize()); err != nil {
		response.Error(w, http.StatusRequestEntityTooLarge, response.CodeInvalidInput,
			"Request body too large or malformed.")
		return
	}

	name := r.FormValue("name")
	if len([]rune(name)) < 2 || len([]rune(name)) > 60 {
		response.Error(w, http.StatusBadRequest, response.CodeInvalidInput,
			"name must be between 2 and 60 characters.")
		return
	}

	file, header, err := r.FormFile("file")
	if err != nil {
		response.Error(w, http.StatusBadRequest, response.CodeInvalidInput, "file field is required.")
		return
	}
	defer file.Close()

	if header.Size > h.cfg.ResumeMaxFileSize() {
		response.Error(w, http.StatusRequestEntityTooLarge, response.CodeInvalidInput,
			"File exceeds the maximum allowed size.")
		return
	}

	data, err := io.ReadAll(io.LimitReader(file, h.cfg.ResumeMaxFileSize()+1))
	if err != nil {
		response.Error(w, http.StatusInternalServerError, response.CodeInternalError,
			"An unexpected error occurred.")
		return
	}

	res, err := h.svc.Upload(r.Context(), UploadRequest{
		UserID:   userID,
		Name:     name,
		Filename: header.Filename,
		FileData: data,
		FileSize: header.Size,
	})
	if err != nil {
		switch {
		case errors.Is(err, ErrInvalidFile):
			response.Error(w, http.StatusUnsupportedMediaType, response.CodeInvalidInput, err.Error())
		case errors.Is(err, ErrLimitExceeded):
			response.Error(w, http.StatusConflict, "RESUME_LIMIT_EXCEEDED",
				"You have reached the maximum number of active resumes.")
		default:
			response.Error(w, http.StatusInternalServerError, response.CodeInternalError,
				"An unexpected error occurred.")
		}
		return
	}

	msg := "Resume uploaded and processed successfully."
	if res.ExtractionStatus == "failed" {
		msg = "Resume uploaded, but text extraction failed. You can retry by re-uploading."
	}

	response.Success(w, http.StatusCreated, toResponse(res), msg)
}

// GET /resumes
func (h *Handler) List(w http.ResponseWriter, r *http.Request) {
	userID, ok := middleware.UserIDFromContext(r.Context())
	if !ok {
		response.Error(w, http.StatusUnauthorized, response.CodeUnauthorized, "Authentication required.")
		return
	}

	resumes, err := h.svc.List(r.Context(), userID)
	if err != nil {
		response.Error(w, http.StatusInternalServerError, response.CodeInternalError,
			"An unexpected error occurred.")
		return
	}

	out := make([]resumeResponse, len(resumes))
	for i, res := range resumes {
		out[i] = toResponse(&resumes[i])
		_ = res
	}
	response.Success(w, http.StatusOK, out, "")
}

// GET /resumes/:id/preview-url
func (h *Handler) PreviewURL(w http.ResponseWriter, r *http.Request) {
	userID, ok := middleware.UserIDFromContext(r.Context())
	if !ok {
		response.Error(w, http.StatusUnauthorized, response.CodeUnauthorized, "Authentication required.")
		return
	}

	id := chi.URLParam(r, "id")

	result, err := h.svc.PreviewURL(r.Context(), id, userID)
	if err != nil {
		if errors.Is(err, ErrNotFound) {
			response.Error(w, http.StatusNotFound, response.CodeNotFound, "Resume not found.")
			return
		}
		response.Error(w, http.StatusInternalServerError, response.CodeInternalError,
			"An unexpected error occurred.")
		return
	}

	response.Success(w, http.StatusOK, map[string]any{
		"url":        result.URL,
		"expires_at": result.ExpiresAt,
	}, "")
}

// DELETE /resumes/:id
func (h *Handler) Delete(w http.ResponseWriter, r *http.Request) {
	userID, ok := middleware.UserIDFromContext(r.Context())
	if !ok {
		response.Error(w, http.StatusUnauthorized, response.CodeUnauthorized, "Authentication required.")
		return
	}

	id := chi.URLParam(r, "id")

	result, err := h.svc.Delete(r.Context(), id, userID)
	if err != nil {
		if errors.Is(err, ErrNotFound) {
			response.Error(w, http.StatusNotFound, response.CodeNotFound, "Resume not found.")
			return
		}
		response.Error(w, http.StatusInternalServerError, response.CodeInternalError,
			"An unexpected error occurred.")
		return
	}

	resp := map[string]any{
		"id":         result.Resume.ID,
		"deleted_at": result.Resume.DeletedAt,
	}
	msg := "Resume deleted successfully."
	if result.WasLastResume {
		msg = "Resume deleted. You no longer have any active resumes — you will need to upload one before adding jobs."
	}

	response.Success(w, http.StatusOK, resp, msg)
}

// GET /resumes/has-active  (used by the job creation gate)
func (h *Handler) HasActive(w http.ResponseWriter, r *http.Request) {
	userID, ok := middleware.UserIDFromContext(r.Context())
	if !ok {
		response.Error(w, http.StatusUnauthorized, response.CodeUnauthorized, "Authentication required.")
		return
	}

	has, err := h.svc.HasActive(r.Context(), userID)
	if err != nil {
		response.Error(w, http.StatusInternalServerError, response.CodeInternalError,
			"An unexpected error occurred.")
		return
	}

	response.Success(w, http.StatusOK, map[string]bool{"has_active_resume": has}, "")
}
