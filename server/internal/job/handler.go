package job

import (
	"encoding/json"
	"errors"
	"net/http"
	"strconv"
	"strings"

	"github.com/go-chi/chi/v5"

	"github.com/collinsadi/aethlara/internal/ai"
	"github.com/collinsadi/aethlara/internal/config"
	"github.com/collinsadi/aethlara/internal/logger"
	"github.com/collinsadi/aethlara/internal/middleware"
	"github.com/collinsadi/aethlara/pkg/response"
)

const maxBodyBytes = 1 << 20 // 1 MB

type Handler struct {
	svc Service
	cfg *config.Config
}

func NewHandler(svc Service, cfg *config.Config) *Handler {
	return &Handler{svc: svc, cfg: cfg}
}

func decodeBody(w http.ResponseWriter, r *http.Request, v any) bool {
	r.Body = http.MaxBytesReader(w, r.Body, maxBodyBytes)
	if err := json.NewDecoder(r.Body).Decode(v); err != nil {
		response.Error(w, http.StatusBadRequest, response.CodeInvalidInput, "Invalid request body.")
		return false
	}
	return true
}

// ── POST /jobs ────────────────────────────────────────────────────────────────

func (h *Handler) Create(w http.ResponseWriter, r *http.Request) {
	userID, ok := middleware.UserIDFromContext(r.Context())
	if !ok {
		response.Error(w, http.StatusUnauthorized, response.CodeUnauthorized, "Authentication required.")
		return
	}

	var body struct {
		InputMethod string `json:"input_method"`
		JobURL      string `json:"job_url"`
		JobText     string `json:"job_text"`
		CompanyName string `json:"company_name"`
		Role        string `json:"role"`
		ResumeID    string `json:"resume_id"`
	}
	if !decodeBody(w, r, &body) {
		return
	}

	req := CreateJobRequest{
		InputMethod: body.InputMethod,
		JobURL:      strings.TrimSpace(body.JobURL),
		JobText:     body.JobText,
		CompanyName: strings.TrimSpace(body.CompanyName),
		Role:        strings.TrimSpace(body.Role),
		ResumeID:    strings.TrimSpace(body.ResumeID),
	}

	if err := validateCreateRequest(req, h.cfg); err != nil {
		response.Error(w, http.StatusBadRequest, response.CodeInvalidInput, err.Error())
		return
	}

	job, err := h.svc.Create(r.Context(), userID, req)
	if err != nil {
		h.handleServiceError(w, r, err)
		return
	}

	response.Success(w, http.StatusCreated, toJobSummary(job),
		"Job created and resume tailored successfully.")
}

// ── GET /jobs ─────────────────────────────────────────────────────────────────

func (h *Handler) List(w http.ResponseWriter, r *http.Request) {
	userID, ok := middleware.UserIDFromContext(r.Context())
	if !ok {
		response.Error(w, http.StatusUnauthorized, response.CodeUnauthorized, "Authentication required.")
		return
	}

	q := h.parseListQuery(r)

	result, err := h.svc.List(r.Context(), userID, q)
	if err != nil {
		response.Error(w, http.StatusInternalServerError, response.CodeInternalError,
			"An unexpected error occurred.")
		return
	}

	items := make([]map[string]any, len(result.Items))
	for i := range result.Items {
		items[i] = toJobListItem(&result.Items[i])
	}

	response.Success(w, http.StatusOK, map[string]any{
		"items": items,
		"pagination": map[string]any{
			"page":        q.Page,
			"page_size":   q.PageSize,
			"total_items": result.TotalItems,
			"total_pages": result.TotalPages,
			"has_next":    q.Page < result.TotalPages,
			"has_prev":    q.Page > 1,
		},
	}, "")
}

// ── GET /jobs/:id ─────────────────────────────────────────────────────────────

func (h *Handler) GetByID(w http.ResponseWriter, r *http.Request) {
	userID, ok := middleware.UserIDFromContext(r.Context())
	if !ok {
		response.Error(w, http.StatusUnauthorized, response.CodeUnauthorized, "Authentication required.")
		return
	}

	id := chi.URLParam(r, "id")

	detail, err := h.svc.GetByID(r.Context(), id, userID)
	if err != nil {
		if errors.Is(err, ErrNotFound) {
			response.Error(w, http.StatusNotFound, response.CodeNotFound, "Job not found.")
			return
		}
		response.Error(w, http.StatusInternalServerError, response.CodeInternalError,
			"An unexpected error occurred.")
		return
	}

	response.Success(w, http.StatusOK, toJobDetail(detail), "")
}

// ── PATCH /jobs/:id/status ────────────────────────────────────────────────────

func (h *Handler) UpdateStatus(w http.ResponseWriter, r *http.Request) {
	userID, ok := middleware.UserIDFromContext(r.Context())
	if !ok {
		response.Error(w, http.StatusUnauthorized, response.CodeUnauthorized, "Authentication required.")
		return
	}

	id := chi.URLParam(r, "id")

	var body struct {
		Status string  `json:"status"`
		Notes  *string `json:"notes"`
	}
	if !decodeBody(w, r, &body) {
		return
	}

	validStatuses := map[string]bool{
		"not_applied": true, "applied": true, "interview": true,
		"offer": true, "rejected": true, "withdrawn": true,
	}
	if !validStatuses[body.Status] {
		response.Error(w, http.StatusBadRequest, response.CodeInvalidInput,
			"status must be one of: not_applied, applied, interview, offer, rejected, withdrawn.")
		return
	}
	if body.Notes != nil && len([]rune(*body.Notes)) > 2000 {
		response.Error(w, http.StatusBadRequest, response.CodeInvalidInput,
			"notes must not exceed 2000 characters.")
		return
	}

	req := UpdateStatusRequest{Status: body.Status, Notes: body.Notes}

	updated, err := h.svc.UpdateStatus(r.Context(), id, userID, req)
	if err != nil {
		switch {
		case errors.Is(err, ErrNotFound):
			response.Error(w, http.StatusNotFound, response.CodeNotFound, "Job not found.")
		case errors.Is(err, ErrInvalidInput):
			response.Error(w, http.StatusBadRequest, "INVALID_TRANSITION", err.Error())
		default:
			response.Error(w, http.StatusInternalServerError, response.CodeInternalError,
				"An unexpected error occurred.")
		}
		return
	}

	response.Success(w, http.StatusOK, map[string]any{
		"id":         updated.ID,
		"status":     updated.Status,
		"applied_at": updated.AppliedAt,
		"updated_at": updated.UpdatedAt,
	}, "")
}

// ── GET /jobs/:id/resume-preview ──────────────────────────────────────────────

func (h *Handler) ResumePreview(w http.ResponseWriter, r *http.Request) {
	userID, ok := middleware.UserIDFromContext(r.Context())
	if !ok {
		response.Error(w, http.StatusUnauthorized, response.CodeUnauthorized, "Authentication required.")
		return
	}

	id := chi.URLParam(r, "id")

	result, err := h.svc.PreviewURL(r.Context(), id, userID)
	if err != nil {
		switch {
		case errors.Is(err, ErrNotFound):
			response.Error(w, http.StatusNotFound, response.CodeNotFound, "Job not found.")
		case errors.Is(err, ErrPDFNotReady):
			response.Error(w, http.StatusNotFound, "PDF_NOT_READY",
				"Tailored resume PDF is not yet available for this job.")
		default:
			response.Error(w, http.StatusInternalServerError, response.CodeInternalError,
				"An unexpected error occurred.")
		}
		return
	}

	response.Success(w, http.StatusOK, map[string]any{
		"url":        result.URL,
		"expires_at": result.ExpiresAt,
	}, "")
}

// ── DELETE /jobs/:id ──────────────────────────────────────────────────────────

func (h *Handler) Delete(w http.ResponseWriter, r *http.Request) {
	userID, ok := middleware.UserIDFromContext(r.Context())
	if !ok {
		response.Error(w, http.StatusUnauthorized, response.CodeUnauthorized, "Authentication required.")
		return
	}

	id := chi.URLParam(r, "id")

	deleted, err := h.svc.Delete(r.Context(), id, userID)
	if err != nil {
		if errors.Is(err, ErrNotFound) {
			response.Error(w, http.StatusNotFound, response.CodeNotFound, "Job not found.")
			return
		}
		response.Error(w, http.StatusInternalServerError, response.CodeInternalError,
			"An unexpected error occurred.")
		return
	}

	response.Success(w, http.StatusOK, map[string]any{
		"id":         deleted.ID,
		"deleted_at": deleted.DeletedAt,
	}, "Job removed successfully.")
}

// ── POST /jobs/:id/autofill ───────────────────────────────────────────────────

func (h *Handler) Autofill(w http.ResponseWriter, r *http.Request) {
	userID, ok := middleware.UserIDFromContext(r.Context())
	if !ok {
		response.Error(w, http.StatusUnauthorized, response.CodeUnauthorized, "Authentication required.")
		return
	}

	id := chi.URLParam(r, "id")

	var body AutofillRequest
	r.Body = http.MaxBytesReader(w, r.Body, 1<<20)
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		response.Error(w, http.StatusBadRequest, response.CodeInvalidInput, "Invalid request body.")
		return
	}

	if len(body.Fields) == 0 {
		response.Error(w, http.StatusBadRequest, response.CodeInvalidInput, "fields array is required and must not be empty.")
		return
	}

	result, err := h.svc.Autofill(r.Context(), id, userID, body)
	if err != nil {
		switch {
		case errors.Is(err, ErrNotFound):
			response.Error(w, http.StatusNotFound, response.CodeNotFound, "Job not found.")
		case errors.Is(err, ErrInvalidInput):
			response.Error(w, http.StatusBadRequest, response.CodeInvalidInput, err.Error())
		default:
			response.Error(w, http.StatusInternalServerError, response.CodeInternalError, "An unexpected error occurred.")
		}
		return
	}

	response.Success(w, http.StatusOK, result, "")
}

// ── POST /jobs/extract-from-extension ────────────────────────────────────────

func (h *Handler) ExtractFromExtension(w http.ResponseWriter, r *http.Request) {
	userID, ok := middleware.UserIDFromContext(r.Context())
	if !ok {
		response.Error(w, http.StatusUnauthorized, response.CodeUnauthorized, "Authentication required.")
		return
	}

	var body ExtractFromExtensionRequest
	r.Body = http.MaxBytesReader(w, r.Body, 2<<20) // 2 MB for page text
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		response.Error(w, http.StatusBadRequest, response.CodeInvalidInput, "Invalid request body.")
		return
	}

	result, err := h.svc.ExtractFromExtension(r.Context(), userID, body)
	if err != nil {
		h.handleServiceError(w, r, err)
		return
	}

	response.Success(w, http.StatusOK, result, "")
}

// handleServiceError centralises the mapping from service-level sentinel
// errors to HTTP responses. Every handler routes failure here so status
// codes, error codes, and log lines stay consistent.
func (h *Handler) handleServiceError(w http.ResponseWriter, r *http.Request, err error) {
	log := logger.FromContext(r.Context())

	switch {
	case errors.Is(err, ErrInvalidInput):
		response.Error(w, http.StatusBadRequest, response.CodeInvalidInput, err.Error())
		return
	case errors.Is(err, ErrNotFound):
		response.Error(w, http.StatusNotFound, response.CodeNotFound, "Job not found.")
		return
	case errors.Is(err, ErrForbidden):
		response.Error(w, http.StatusForbidden, response.CodeForbidden, "Access denied.")
		return
	case errors.Is(err, ErrDuplicate):
		response.Error(w, http.StatusConflict, "DUPLICATE_JOB",
			"A job from this URL was already created in the last 24 hours.")
		return
	case errors.Is(err, ErrPDFNotReady):
		response.Error(w, http.StatusNotFound, "PDF_NOT_READY",
			"Tailored resume PDF is not yet available for this job.")
		return
	case errors.Is(err, ErrAIPipelineTimeout):
		log.Warn("ai pipeline timeout",
			"component", "job",
			"error_type", "timeout",
		)
		response.Error(w, http.StatusGatewayTimeout, "AI_TIMEOUT",
			"The AI took too long to respond. Please try again.")
		return
	case errors.Is(err, ai.ErrNoAPIKey):
		log.Warn("no API key at AI call time",
			"component", "job",
			"error_type", "missing_api_key",
		)
		// This endpoint emits a richer body than response.Error so the
		// client can render an inline CTA pointing at Settings.
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusForbidden)
		_, _ = w.Write([]byte(`{"error":{"code":"API_KEY_REQUIRED","message":"An OpenRouter API key is required to use this feature. Add your key in Settings.","action":{"label":"Add API Key","path":"/settings#api-key"}}}`))
		return
	case errors.Is(err, ErrExtraction):
		var extErr *ExtractionError
		if errors.As(err, &extErr) {
			log.Info("extraction rejected by model",
				"component", "job",
				"error_code", extErr.Code,
			)
			response.Error(w, http.StatusUnprocessableEntity, extErr.Code, extErr.Reason)
			return
		}
		log.Warn("extraction failed",
			"component", "job",
			"error", logger.TruncateError(err, 200),
			"error_type", "extraction_error",
		)
		response.Error(w, http.StatusUnprocessableEntity, "EXTRACTION_FAILED", err.Error())
		return
	case errors.Is(err, ErrMisaligned):
		var misErr *MisalignedError
		if errors.As(err, &misErr) {
			h.writeMismatchResponse(w, misErr)
			return
		}
		response.Error(w, http.StatusUnprocessableEntity, "RESUME_MISALIGNED", err.Error())
		return
	default:
		log.Error("unhandled service error",
			"component", "job",
			"error", logger.TruncateError(err, 200),
			"error_type", "internal_error",
		)
		response.Error(w, http.StatusInternalServerError, response.CodeInternalError,
			"An unexpected error occurred.")
	}
}

// writeMismatchResponse serialises a MisalignedError into the documented
// 422 RESUME_MISALIGNED envelope. Every field is guaranteed non-nil so the
// client can render without defensive null checks on the happy path.
func (h *Handler) writeMismatchResponse(w http.ResponseWriter, misErr *MisalignedError) {
	gaps := misErr.Gaps
	if gaps == nil {
		gaps = []string{}
	}

	data := map[string]any{
		"job_id":          misErr.JobID,
		"job_title":       misErr.JobTitle,
		"company":         misErr.Company,
		"match_score":     misErr.MatchScore,
		"match_breakdown": misErr.MatchBreakdown,
		"reason":          misErr.Reason,
		"gaps":            gaps,
		"suggestion":      misErr.Suggestion,
		"learn_more_url":  h.cfg.DashboardURL + "/help/resume-mismatch",
	}

	response.JSON(w, http.StatusUnprocessableEntity, map[string]any{
		"error": map[string]any{
			"code":    "RESUME_MISALIGNED",
			"message": misErr.Reason,
			"data":    data,
		},
	})
}

// ── POST /jobs/confirm-from-extension ────────────────────────────────────────

func (h *Handler) ConfirmFromExtension(w http.ResponseWriter, r *http.Request) {
	userID, ok := middleware.UserIDFromContext(r.Context())
	if !ok {
		response.Error(w, http.StatusUnauthorized, response.CodeUnauthorized, "Authentication required.")
		return
	}

	var body struct {
		PreviewToken string `json:"preview_token"`
	}
	if !decodeBody(w, r, &body) {
		return
	}
	if body.PreviewToken == "" {
		response.Error(w, http.StatusBadRequest, response.CodeInvalidInput, "preview_token is required.")
		return
	}

	job, err := h.svc.ConfirmFromExtension(r.Context(), userID, body.PreviewToken)
	if err != nil {
		switch {
		case errors.Is(err, ErrInvalidInput):
			response.Error(w, http.StatusBadRequest, response.CodeInvalidInput, err.Error())
		default:
			response.Error(w, http.StatusInternalServerError, response.CodeInternalError, "An unexpected error occurred.")
		}
		return
	}

	response.Success(w, http.StatusCreated, toJobSummary(job), "Job saved from extension successfully.")
}

// ── response shapes ───────────────────────────────────────────────────────────

func toJobSummary(j *Job) map[string]any {
	if j == nil {
		return nil
	}
	return map[string]any{
		"id":                j.ID,
		"job_title":         j.JobTitle,
		"company":           j.Company,
		"location":          j.Location,
		"is_remote":         j.IsRemote,
		"employment_type":   j.EmploymentType,
		"experience_level":  j.ExperienceLevel,
		"match_score":       j.MatchScore,
		"status":            j.Status,
		"extraction_status": j.ExtractionStatus,
		"alignment_status":  j.AlignmentStatus,
		"pdf_generated_at":  j.PDFGeneratedAt,
		"created_at":        j.CreatedAt,
	}
}

func toJobListItem(j *Job) map[string]any {
	return map[string]any{
		"id":                j.ID,
		"job_title":         j.JobTitle,
		"company":           j.Company,
		"location":          j.Location,
		"is_remote":         j.IsRemote,
		"employment_type":   j.EmploymentType,
		"experience_level":  j.ExperienceLevel,
		"match_score":       j.MatchScore,
		"status":            j.Status,
		"alignment_status":  j.AlignmentStatus,
		"extraction_status": j.ExtractionStatus,
		"pdf_generated_at":  j.PDFGeneratedAt,
		"resume_id":         j.ResumeID,
		"created_at":        j.CreatedAt,
		"applied_at":        j.AppliedAt,
	}
}

func toJobDetail(d *JobDetail) map[string]any {
	j := &d.Job

	gaps := d.Gaps
	if gaps == nil {
		gaps = []string{}
	}

	return map[string]any{
		"id":                j.ID,
		"job_title":         j.JobTitle,
		"company":           j.Company,
		"location":          j.Location,
		"is_remote":         j.IsRemote,
		"employment_type":   j.EmploymentType,
		"experience_level":  j.ExperienceLevel,
		"salary": map[string]any{
			"min":      j.SalaryMin,
			"max":      j.SalaryMax,
			"currency": j.SalaryCurrency,
			"period":   "yearly",
		},
		"match_score":       j.MatchScore,
		"match_breakdown":   d.MatchBreakdown,
		"gaps":              gaps,
		"status":            j.Status,
		"notes":             j.Notes,
		"resume_id":         j.ResumeID,
		"input_method":      j.InputMethod,
		"job_url":           j.JobURL,
		"extraction_status": j.ExtractionStatus,
		"alignment_status":  j.AlignmentStatus,
		"pdf_generated_at":  j.PDFGeneratedAt,
		"created_at":        j.CreatedAt,
		"applied_at":        j.AppliedAt,
		"updated_at":        j.UpdatedAt,
	}
}

// ── validation ────────────────────────────────────────────────────────────────

func validateCreateRequest(req CreateJobRequest, cfg *config.Config) error {
	if req.InputMethod != "url" && req.InputMethod != "text" {
		return errors.New("input_method must be \"url\" or \"text\"")
	}
	if req.ResumeID == "" {
		return errors.New("resume_id is required")
	}
	switch req.InputMethod {
	case "url":
		if req.JobURL == "" {
			return errors.New("job_url is required when input_method is \"url\"")
		}
		if len(req.JobURL) > 2048 {
			return errors.New("job_url must not exceed 2048 characters")
		}
		if !strings.HasPrefix(req.JobURL, "https://") {
			return errors.New("job_url must be a valid HTTPS URL")
		}
	case "text":
		if int64(len(req.JobText)) < 100 {
			return errors.New("job_text must be at least 100 characters")
		}
		if int64(len(req.JobText)) > cfg.JobMaxTextInputBytes {
			return errors.New("job_text exceeds maximum allowed length")
		}
		if len([]rune(req.CompanyName)) < 1 || len([]rune(req.CompanyName)) > 200 {
			return errors.New("company_name must be between 1 and 200 characters")
		}
		if len([]rune(req.Role)) < 1 || len([]rune(req.Role)) > 200 {
			return errors.New("role must be between 1 and 200 characters")
		}
	}
	return nil
}

func (h *Handler) parseListQuery(r *http.Request) ListJobsQuery {
	q := ListJobsQuery{
		Page:     1,
		PageSize: h.cfg.DefaultPageSize,
		Sort:     "recent",
	}

	if v := r.URL.Query().Get("page"); v != "" {
		if n, err := strconv.Atoi(v); err == nil && n > 0 {
			q.Page = n
		}
	}
	if v := r.URL.Query().Get("page_size"); v != "" {
		if n, err := strconv.Atoi(v); err == nil && n > 0 {
			if n > h.cfg.MaxPageSize {
				n = h.cfg.MaxPageSize
			}
			q.PageSize = n
		}
	}
	if v := r.URL.Query().Get("sort"); v == "best_match" {
		q.Sort = "best_match"
	}

	validStatuses := map[string]bool{
		"not_applied": true, "applied": true, "interview": true,
		"offer": true, "rejected": true, "withdrawn": true,
	}
	if v := r.URL.Query().Get("status"); validStatuses[v] {
		q.Status = v
	}

	validEmpTypes := map[string]bool{
		"full_time": true, "part_time": true, "contract": true,
		"freelance": true, "internship": true, "temporary": true,
	}
	if v := r.URL.Query().Get("employment_type"); validEmpTypes[v] {
		q.EmploymentType = v
	}

	if v := r.URL.Query().Get("is_remote"); v == "true" || v == "1" {
		b := true
		q.IsRemote = &b
	} else if v == "false" || v == "0" {
		b := false
		q.IsRemote = &b
	}

	if v := r.URL.Query().Get("min_match"); v != "" {
		if n, err := strconv.Atoi(v); err == nil && n >= 1 && n <= 100 {
			q.MinMatch = &n
		}
	}

	if v := r.URL.Query().Get("search"); v != "" {
		if len(v) > 100 {
			v = v[:100]
		}
		q.Search = v
	}
	return q
}
