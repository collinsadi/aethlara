package job

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/golang-jwt/jwt/v5"

	"github.com/collinsadi/aethlara/internal/ai"
	"github.com/collinsadi/aethlara/internal/config"
	"github.com/collinsadi/aethlara/internal/logger"
	"github.com/collinsadi/aethlara/internal/prompts"
	"github.com/collinsadi/aethlara/internal/storage"
)

// Sentinel errors. Callers check with errors.Is. Handler translates each
// one to a specific HTTP status + error code (see handler.handleServiceError).
var (
	ErrNotFound          = errors.New("job not found")
	ErrForbidden         = errors.New("access denied")
	ErrInvalidInput      = errors.New("invalid input")
	ErrDuplicate         = errors.New("duplicate job")
	ErrExtraction        = errors.New("extraction failed")
	ErrMisaligned        = errors.New("resume misaligned")
	ErrPDFNotReady       = errors.New("PDF not ready")
	ErrInternal          = errors.New("internal error")
	ErrAIPipelineTimeout = errors.New("AI pipeline timed out")
)

// MisalignedError carries the full AI mismatch context back to the handler.
type MisalignedError struct {
	JobID          string
	JobTitle       string
	Company        string
	Reason         string
	MatchScore     int
	MatchBreakdown *MatchBreakdown
	Gaps           []string
	Suggestion     string
}

func (e *MisalignedError) Error() string        { return "resume misaligned: " + e.Reason }
func (e *MisalignedError) Is(target error) bool { return target == ErrMisaligned }

// ExtractionError carries the AI's reason back to the handler.
type ExtractionError struct {
	Code   string
	Reason string
}

func (e *ExtractionError) Error() string        { return "extraction failed: " + e.Code + " – " + e.Reason }
func (e *ExtractionError) Is(target error) bool { return target == ErrExtraction }

// ListResult is returned by Service.List.
type ListResult struct {
	Items      []Job
	TotalItems int
	TotalPages int
}

// PreviewURLResult is returned by Service.PreviewURL.
type PreviewURLResult struct {
	URL       string
	ExpiresAt time.Time
}

type Service interface {
	Create(ctx context.Context, userID string, req CreateJobRequest) (*Job, error)
	List(ctx context.Context, userID string, q ListJobsQuery) (*ListResult, error)
	GetByID(ctx context.Context, id, userID string) (*JobDetail, error)
	UpdateStatus(ctx context.Context, id, userID string, req UpdateStatusRequest) (*Job, error)
	PreviewURL(ctx context.Context, id, userID string) (*PreviewURLResult, error)
	Delete(ctx context.Context, id, userID string) (*Job, error)
	Autofill(ctx context.Context, jobID, userID string, req AutofillRequest) (*AutofillResult, error)
	ExtractFromExtension(ctx context.Context, userID string, req ExtractFromExtensionRequest) (*ExtensionExtractionResult, error)
	ConfirmFromExtension(ctx context.Context, userID, previewToken string) (*Job, error)
}

type service struct {
	repo Repository
	r2   *storage.R2Client
	ai   *ai.Client
	cfg  *config.Config
}

func NewService(repo Repository, r2 *storage.R2Client, aiClient *ai.Client, cfg *config.Config) Service {
	return &service{repo: repo, r2: r2, ai: aiClient, cfg: cfg}
}

// aiContext returns a context that is decoupled from the inbound HTTP
// request lifetime and has its own JobAITimeoutSeconds deadline.
//
// Why this matters: the AI pipeline (extract + align) routinely takes
// 30–90 seconds. The extension, proxies, or the server's own WriteTimeout
// may cancel the request before the pipeline finishes, leaving a dangling
// OpenRouter HTTP call. With context.WithoutCancel we keep the values
// (request_id, user_id) for logging while breaking the cancellation edge
// so the AI call can finish on its own independent deadline.
func (s *service) aiContext(parent context.Context) (context.Context, context.CancelFunc) {
	timeout := time.Duration(s.cfg.JobAITimeoutSeconds) * time.Second
	if timeout <= 0 {
		timeout = 120 * time.Second
	}
	return context.WithTimeout(context.WithoutCancel(parent), timeout)
}

// mapAIError converts a low-level ai.Client error into the right service-level
// sentinel. Ensures timeouts surface as ErrAIPipelineTimeout (→ 504) rather
// than a generic 500.
func mapAIError(err error) error {
	switch {
	case err == nil:
		return nil
	case errors.Is(err, ai.ErrNoAPIKey):
		return err
	case errors.Is(err, context.DeadlineExceeded), errors.Is(err, context.Canceled):
		return ErrAIPipelineTimeout
	default:
		return err
	}
}

// ── Create ────────────────────────────────────────────────────────────────────

func (s *service) Create(ctx context.Context, userID string, req CreateJobRequest) (*Job, error) {
	pipelineStart := time.Now()
	log := logger.FromContext(ctx).With(
		"component", "job",
		"operation", "CreateJob",
		"input_method", req.InputMethod,
		"resume_id", req.ResumeID,
	)

	log.Info("pipeline started",
		"pipeline_stage", "input",
		"pipeline_status", "started",
	)

	// Validate & verify resume ownership + completion
	resume, err := s.repo.GetResumeForJob(ctx, req.ResumeID, userID)
	if err != nil {
		log.Error("pipeline failed fetching resume",
			"pipeline_stage", "validate",
			"pipeline_status", "failed",
			"error", logger.TruncateError(err, 200),
			"error_type", "db_error",
		)
		return nil, ErrInternal
	}
	if resume == nil {
		return nil, fmt.Errorf("%w: resume not found or does not belong to you", ErrInvalidInput)
	}
	if resume.ExtractionStatus != "completed" {
		return nil, fmt.Errorf("%w: resume is not fully processed yet (status: %s)", ErrInvalidInput, resume.ExtractionStatus)
	}
	if resume.ExtractedJSON == nil || *resume.ExtractedJSON == "" {
		return nil, fmt.Errorf("%w: resume has no extracted content", ErrInvalidInput)
	}

	// Deduplication: same URL within last 24 hours
	if req.InputMethod == "url" {
		existing, err := s.repo.FindDuplicate(ctx, userID, req.JobURL, time.Now().Add(-24*time.Hour))
		if err != nil {
			log.Error("pipeline failed on duplicate check",
				"pipeline_stage", "validate",
				"pipeline_status", "failed",
				"error", logger.TruncateError(err, 200),
				"error_type", "db_error",
			)
			return nil, ErrInternal
		}
		if existing != nil {
			return nil, fmt.Errorf("%w: job already created from this URL (id: %s)", ErrDuplicate, existing.ID)
		}
	}

	// Create initial job record
	var jobURL *string
	if req.JobURL != "" {
		jobURL = &req.JobURL
	}
	j, err := s.repo.Create(ctx, Job{
		UserID:      userID,
		ResumeID:    req.ResumeID,
		InputMethod: req.InputMethod,
		JobURL:      jobURL,
	})
	if err != nil {
		log.Error("pipeline failed creating job record",
			"pipeline_stage", "db_create",
			"pipeline_status", "failed",
			"error", logger.TruncateError(err, 200),
			"error_type", "db_error",
		)
		return nil, ErrInternal
	}
	log = log.With("job_id", j.ID)
	log.Debug("job record created",
		"pipeline_stage", "db_create",
		"pipeline_status", "completed",
	)

	// Mark extraction as processing
	procStatus := "processing"
	_ = s.repo.UpdateExtractionStatus(ctx, j.ID, procStatus, nil, nil)

	// Stage: acquire raw input
	log.Info("scrape started",
		"pipeline_stage", "scrape",
		"pipeline_status", "started",
	)
	var rawContent string
	switch req.InputMethod {
	case "url":
		rawContent, err = ScrapeJob(ctx, req.JobURL, s.cfg)
		if err != nil {
			errMsg := "scrape failed: " + err.Error()
			_ = s.repo.UpdateExtractionStatus(ctx, j.ID, "failed", nil, &errMsg)
			log.Warn("scrape failed",
				"pipeline_stage", "scrape",
				"pipeline_status", "failed",
				"error", logger.TruncateError(err, 200),
				"error_type", "scrape_error",
			)
			return nil, fmt.Errorf("%w: %s", ErrExtraction, err)
		}
	case "text":
		rawContent = fmt.Sprintf("Company: %s\nRole: %s\n\n%s",
			SanitizeText(req.CompanyName),
			SanitizeText(req.Role),
			SanitizeText(req.JobText),
		)
	}
	log.Info("scrape completed",
		"pipeline_stage", "scrape",
		"pipeline_status", "completed",
		"raw_bytes", len(rawContent),
	)

	// Archive raw input to R2 (best-effort)
	rawKey := fmt.Sprintf("jobs/raw/%s/%s", userID, j.ID)
	if err := s.r2.Upload(ctx, rawKey, []byte(rawContent), "text/plain"); err != nil {
		log.Warn("raw input archive failed",
			"pipeline_stage", "archive",
			"pipeline_status", "failed",
			"error", logger.TruncateError(err, 200),
			"error_type", "r2_error",
		)
	}

	// Decoupled AI context for the extract+align pipeline so HTTP cancel
	// (proxy / write timeout / extension timeout) doesn't kill us mid-call.
	aiCtx, aiCancel := s.aiContext(ctx)
	defer aiCancel()

	// Stage 4–6: job extraction AI
	extractedJob, extractedJSONStr, err := s.runExtraction(aiCtx, userID, j.ID, rawContent)
	if err != nil {
		return nil, err
	}

	// Stage 7–10: resume alignment AI
	alignResult, alignJSONStr, err := s.runAlignment(aiCtx, userID, j.ID, extractedJob, extractedJSONStr, *resume.ExtractedJSON)
	if err != nil {
		return nil, err
	}

	// Stage 11–13: PDF generation (best-effort, non-fatal)
	if alignResult.TailoredResume != nil {
		pdfStart := time.Now()
		log.Info("pdf generation started",
			"pipeline_stage", "pdf",
			"pipeline_status", "started",
		)
		pdfBytes, pdfErr := GeneratePDF(alignResult.TailoredResume)
		if pdfErr != nil {
			log.Warn("pdf generation failed",
				"pipeline_stage", "pdf",
				"pipeline_status", "failed",
				"error", logger.TruncateError(pdfErr, 200),
				"error_type", "pdf_error",
			)
		} else {
			pdfKey := fmt.Sprintf("%s%s/%s.pdf", s.cfg.PDFStoragePrefix, userID, j.ID)
			if uploadErr := s.r2.Upload(ctx, pdfKey, pdfBytes, "application/pdf"); uploadErr != nil {
				log.Warn("pdf upload failed",
					"pipeline_stage", "upload",
					"pipeline_status", "failed",
					"error", logger.TruncateError(uploadErr, 200),
					"error_type", "r2_error",
				)
			} else {
				generatedAt := time.Now()
				if dbErr := s.repo.UpdatePDF(ctx, j.ID, pdfKey, generatedAt); dbErr != nil {
					log.Warn("pdf db update failed",
						"pipeline_stage", "pdf",
						"pipeline_status", "failed",
						"error", logger.TruncateError(dbErr, 200),
						"error_type", "db_error",
					)
				} else {
					log.Info("pdf generation completed",
						"pipeline_stage", "pdf",
						"pipeline_status", "completed",
						"latency_ms", time.Since(pdfStart).Milliseconds(),
					)
				}
			}
		}
	}

	// Stage 14: update job fields from extracted data
	fields := jobFieldsFromExtracted(extractedJob)
	if req.InputMethod == "text" {
		if fields.Company == "" {
			fields.Company = sanitizeField(req.CompanyName)
		}
		if fields.JobTitle == "" {
			fields.JobTitle = sanitizeField(req.Role)
		}
	}
	if err := s.repo.UpdateJobFields(ctx, j.ID, fields); err != nil {
		log.Warn("job fields update failed",
			"pipeline_stage", "persist",
			"pipeline_status", "failed",
			"error", logger.TruncateError(err, 200),
			"error_type", "db_error",
		)
	}

	_ = alignJSONStr

	log.Info("pipeline completed",
		"pipeline_stage", "complete",
		"pipeline_status", "completed",
		"match_score", alignResult.MatchScore,
		"total_latency_ms", time.Since(pipelineStart).Milliseconds(),
	)

	final, err := s.repo.GetByID(ctx, j.ID, userID)
	if err != nil || final == nil {
		return j, nil
	}
	return final, nil
}

func (s *service) runExtraction(ctx context.Context, userID, jobID, rawContent string) (*ExtractedJob, string, error) {
	log := logger.FromContext(ctx).With(
		"component", "job",
		"operation", "runExtraction",
		"job_id", jobID,
	)
	log.Info("job extraction started",
		"pipeline_stage", "extract",
		"pipeline_status", "started",
	)

	aiResp, err := s.ai.Complete(ctx, ai.Request{
		UserID:        userID,
		SystemPrompt:  prompts.JobExtractionSystemPrompt(),
		UserMessage:   rawContent,
		PromptVersion: prompts.JobExtractionV1,
		Stage:         ai.StageJobExtraction,
	})
	if err != nil {
		mapped := mapAIError(err)
		errMsg := "AI extraction error: " + err.Error()
		_ = s.repo.UpdateExtractionStatus(ctx, jobID, "failed", nil, &errMsg)
		log.Error("job extraction failed",
			"pipeline_stage", "extract",
			"pipeline_status", "failed",
			"error", logger.TruncateError(err, 200),
			"error_type", ai.ClassifyError(err),
		)
		if errors.Is(mapped, ErrAIPipelineTimeout) || errors.Is(mapped, ai.ErrNoAPIKey) {
			return nil, "", mapped
		}
		return nil, "", fmt.Errorf("%w: %s", ErrExtraction, err)
	}

	if !json.Valid([]byte(aiResp.Content)) {
		errMsg := "AI returned invalid JSON"
		_ = s.repo.UpdateExtractionStatus(ctx, jobID, "failed", nil, &errMsg)
		log.Error("job extraction returned invalid JSON",
			"pipeline_stage", "extract",
			"pipeline_status", "failed",
			"error_type", "ai_invalid_json",
		)
		return nil, "", fmt.Errorf("%w: AI returned non-JSON response", ErrExtraction)
	}

	var extracted ExtractedJob
	if err := json.Unmarshal([]byte(aiResp.Content), &extracted); err != nil {
		errMsg := "JSON unmarshal failed: " + err.Error()
		_ = s.repo.UpdateExtractionStatus(ctx, jobID, "failed", nil, &errMsg)
		log.Error("job extraction unmarshal failed",
			"pipeline_stage", "extract",
			"pipeline_status", "failed",
			"error", logger.TruncateError(err, 200),
			"error_type", "json_unmarshal_error",
		)
		return nil, "", fmt.Errorf("%w: failed to parse AI response", ErrExtraction)
	}

	if !extracted.Valid {
		code := "INVALID_JOB_INPUT"
		reason := "The provided content does not appear to be a valid job description."
		if extracted.Error != nil {
			code = extracted.Error.Code
			reason = extracted.Error.Reason
		}
		errMsg := fmt.Sprintf("%s: %s", code, reason)
		_ = s.repo.UpdateExtractionStatus(ctx, jobID, "failed", nil, &errMsg)
		log.Info("job extraction rejected by model",
			"pipeline_stage", "extract",
			"pipeline_status", "rejected",
			"error_code", code,
		)
		return nil, "", &ExtractionError{Code: code, Reason: reason}
	}

	content := aiResp.Content
	_ = s.repo.UpdateExtractionStatus(ctx, jobID, "completed", &content, nil)
	log.Info("job extraction completed",
		"pipeline_stage", "extract",
		"pipeline_status", "completed",
		"latency_ms", aiResp.LatencyMS,
	)
	return &extracted, content, nil
}

func (s *service) runAlignment(ctx context.Context, userID, jobID string, extractedJob *ExtractedJob, extractedJobJSON, resumeJSON string) (*AlignmentResult, string, error) {
	log := logger.FromContext(ctx).With(
		"component", "job",
		"operation", "runAlignment",
		"job_id", jobID,
	)
	log.Info("resume alignment started",
		"pipeline_stage", "align",
		"pipeline_status", "started",
	)

	_ = s.repo.UpdateAlignmentStatus(ctx, jobID, "processing", nil, nil, nil)

	userMsg := fmt.Sprintf("--- JOB ---\n%s\n--- RESUME ---\n%s", extractedJobJSON, resumeJSON)

	aiResp, err := s.ai.Complete(ctx, ai.Request{
		UserID:        userID,
		SystemPrompt:  prompts.ResumeAlignmentSystemPrompt(),
		UserMessage:   userMsg,
		PromptVersion: prompts.ResumeAlignmentV1,
		Stage:         ai.StageResumeAlignment,
	})
	if err != nil {
		mapped := mapAIError(err)
		errMsg := "AI alignment error: " + err.Error()
		_ = s.repo.UpdateAlignmentStatus(ctx, jobID, "failed", nil, nil, &errMsg)
		log.Error("resume alignment failed",
			"pipeline_stage", "align",
			"pipeline_status", "failed",
			"error", logger.TruncateError(err, 200),
			"error_type", ai.ClassifyError(err),
		)
		if errors.Is(mapped, ErrAIPipelineTimeout) || errors.Is(mapped, ai.ErrNoAPIKey) {
			return nil, "", mapped
		}
		return nil, "", fmt.Errorf("%w: %s", ErrMisaligned, err)
	}

	if !json.Valid([]byte(aiResp.Content)) {
		errMsg := "AI returned invalid JSON"
		_ = s.repo.UpdateAlignmentStatus(ctx, jobID, "failed", nil, nil, &errMsg)
		log.Error("resume alignment returned invalid JSON",
			"pipeline_stage", "align",
			"pipeline_status", "failed",
			"error_type", "ai_invalid_json",
		)
		return nil, "", fmt.Errorf("%w: AI returned non-JSON response", ErrMisaligned)
	}

	var result AlignmentResult
	if err := json.Unmarshal([]byte(aiResp.Content), &result); err != nil {
		errMsg := "JSON unmarshal failed: " + err.Error()
		_ = s.repo.UpdateAlignmentStatus(ctx, jobID, "failed", nil, nil, &errMsg)
		log.Error("resume alignment unmarshal failed",
			"pipeline_stage", "align",
			"pipeline_status", "failed",
			"error", logger.TruncateError(err, 200),
			"error_type", "json_unmarshal_error",
		)
		return nil, "", fmt.Errorf("%w: failed to parse AI response", ErrMisaligned)
	}

	if !result.Aligned {
		reason := "Resume is fundamentally misaligned with this job."
		if result.Error != nil {
			reason = result.Error.Reason
		}

		jobTitle, company := "", ""
		if extractedJob != nil && extractedJob.Job != nil {
			jobTitle = extractedJob.Job.Title
			company = extractedJob.Job.Company
		}

		misErr := buildMisalignedError(jobID, jobTitle, company, reason, &result)

		errMsg := fmt.Sprintf("RESUME_MISALIGNED (score %d): %s", misErr.MatchScore, reason)
		score := misErr.MatchScore
		_ = s.repo.UpdateAlignmentStatus(ctx, jobID, "misaligned", nil, &score, &errMsg)

		// Soft-delete BEFORE returning — job must not appear in the user's list
		_, _ = s.repo.SoftDelete(ctx, jobID, userID)

		log.Warn("resume misaligned — soft deleting job",
			"pipeline_stage", "align",
			"pipeline_status", "misaligned",
			"match_score", misErr.MatchScore,
		)
		return nil, "", misErr
	}

	content := aiResp.Content
	score := result.MatchScore
	_ = s.repo.UpdateAlignmentStatus(ctx, jobID, "completed", &content, &score, nil)
	log.Info("resume alignment completed",
		"pipeline_stage", "align",
		"pipeline_status", "completed",
		"match_score", result.MatchScore,
		"latency_ms", aiResp.LatencyMS,
	)
	return &result, content, nil
}

// buildMisalignedError normalises a misalignment response so the client
// always receives populated match_breakdown, gaps, and suggestion fields.
// The frontend renders defensive fallbacks for missing data, but we shape
// the payload here so "nothing to display" never occurs.
func buildMisalignedError(jobID, jobTitle, company, reason string, result *AlignmentResult) *MisalignedError {
	score := result.MatchScore

	breakdown := result.MatchBreakdown
	if breakdown == nil {
		// The AI sometimes omits the per-dimension breakdown on a hard reject.
		// Fall back to the overall score so the UI can still render three bars
		// rather than a blank section.
		breakdown = &MatchBreakdown{
			SkillsMatch:     score,
			ExperienceMatch: score,
			EducationMatch:  score,
			OverallNotes:    "Detailed breakdown unavailable for this analysis.",
		}
	}

	gaps := result.Gaps
	if gaps == nil {
		gaps = []string{}
	}

	var suggestion string
	if len(gaps) > 0 {
		suggestion = "Consider updating your resume to include any relevant skills or experience you may have omitted."
	} else {
		suggestion = "Your overall experience level may not meet this role's requirements. Try applying to roles that match your current background."
	}

	return &MisalignedError{
		JobID:          jobID,
		JobTitle:       jobTitle,
		Company:        company,
		Reason:         reason,
		MatchScore:     score,
		MatchBreakdown: breakdown,
		Gaps:           gaps,
		Suggestion:     suggestion,
	}
}

// ── List ──────────────────────────────────────────────────────────────────────

func (s *service) List(ctx context.Context, userID string, q ListJobsQuery) (*ListResult, error) {
	jobs, total, err := s.repo.List(ctx, userID, q)
	if err != nil {
		return nil, ErrInternal
	}
	if jobs == nil {
		jobs = []Job{}
	}
	totalPages := (total + q.PageSize - 1) / q.PageSize
	if totalPages == 0 {
		totalPages = 1
	}
	return &ListResult{Items: jobs, TotalItems: total, TotalPages: totalPages}, nil
}

// ── GetByID ───────────────────────────────────────────────────────────────────

func (s *service) GetByID(ctx context.Context, id, userID string) (*JobDetail, error) {
	j, _, tailoredJSON, err := s.repo.GetByIDWithJSON(ctx, id, userID)
	if err != nil {
		return nil, ErrInternal
	}
	if j == nil {
		return nil, ErrNotFound
	}

	detail := &JobDetail{Job: *j}

	// Extract match_breakdown and gaps from tailored_resume_json
	if tailoredJSON != nil && *tailoredJSON != "" {
		var alignment AlignmentResult
		if err := json.Unmarshal([]byte(*tailoredJSON), &alignment); err == nil {
			detail.MatchBreakdown = alignment.MatchBreakdown
			detail.Gaps = alignment.Gaps
			if len(detail.Gaps) == 0 {
				detail.Gaps = []string{}
			}
		}
	}
	return detail, nil
}

// ── UpdateStatus ──────────────────────────────────────────────────────────────

func (s *service) UpdateStatus(ctx context.Context, id, userID string, req UpdateStatusRequest) (*Job, error) {
	log := logger.FromContext(ctx).With(
		"component", "job",
		"operation", "UpdateStatus",
		"job_id", id,
	)

	current, err := s.repo.GetByID(ctx, id, userID)
	if err != nil {
		return nil, ErrInternal
	}
	if current == nil {
		return nil, ErrNotFound
	}

	if !IsValidTransition(current.Status, req.Status) {
		return nil, fmt.Errorf("%w: cannot transition from %q to %q",
			ErrInvalidInput, current.Status, req.Status)
	}

	var appliedAt *time.Time
	if req.Status == "applied" && current.AppliedAt == nil {
		now := time.Now()
		appliedAt = &now
	}

	updated, err := s.repo.UpdateStatus(ctx, id, userID, req.Status, appliedAt, req.Notes)
	if err != nil {
		return nil, ErrInternal
	}
	if updated == nil {
		return nil, ErrNotFound
	}

	log.Info("job status updated",
		"from", current.Status,
		"to", req.Status,
	)
	return updated, nil
}

// ── PreviewURL ────────────────────────────────────────────────────────────────

func (s *service) PreviewURL(ctx context.Context, id, userID string) (*PreviewURLResult, error) {
	log := logger.FromContext(ctx).With(
		"component", "job",
		"operation", "PreviewURL",
		"job_id", id,
	)

	j, err := s.repo.GetByID(ctx, id, userID)
	if err != nil {
		return nil, ErrInternal
	}
	if j == nil {
		return nil, ErrNotFound
	}
	if j.AlignmentStatus != "completed" || j.PDFR2Key == nil {
		return nil, ErrPDFNotReady
	}

	presignURL, expiresAt, err := s.r2.PresignURL(ctx, *j.PDFR2Key)
	if err != nil {
		log.Error("presign url failed",
			"error", logger.TruncateError(err, 200),
			"error_type", "r2_error",
		)
		return nil, ErrInternal
	}

	log.Info("job pdf presigned url generated",
		"expires_at", expiresAt,
	)
	return &PreviewURLResult{URL: presignURL, ExpiresAt: expiresAt}, nil
}

// ── Delete ────────────────────────────────────────────────────────────────────

func (s *service) Delete(ctx context.Context, id, userID string) (*Job, error) {
	deleted, err := s.repo.SoftDelete(ctx, id, userID)
	if err != nil {
		return nil, ErrInternal
	}
	if deleted == nil {
		return nil, ErrNotFound
	}
	return deleted, nil
}

// ── helpers ───────────────────────────────────────────────────────────────────

func jobFieldsFromExtracted(e *ExtractedJob) JobFields {
	if e == nil || e.Job == nil {
		return JobFields{SalaryCurrency: "USD"}
	}
	d := e.Job
	f := JobFields{
		JobTitle: d.Title,
		Company:  d.Company,
		IsRemote: d.IsRemote,
	}
	if d.Location != "" {
		l := d.Location
		f.Location = &l
	}
	if d.EmploymentType != "" {
		et := d.EmploymentType
		f.EmploymentType = &et
	}
	if d.ExperienceLevel != "" {
		el := d.ExperienceLevel
		f.ExperienceLevel = &el
	}
	if d.Salary != nil {
		f.SalaryMin = d.Salary.Min
		f.SalaryMax = d.Salary.Max
		if d.Salary.Currency != "" {
			f.SalaryCurrency = d.Salary.Currency
		} else {
			f.SalaryCurrency = "USD"
		}
	} else {
		f.SalaryCurrency = "USD"
	}
	return f
}

func sanitizeField(s string) string {
	return strings.TrimSpace(SanitizeText(s))
}

// ── Autofill ──────────────────────────────────────────────────────────────────

func (s *service) Autofill(ctx context.Context, jobID, userID string, req AutofillRequest) (*AutofillResult, error) {
	log := logger.FromContext(ctx).With(
		"component", "job",
		"operation", "Autofill",
		"job_id", jobID,
		"field_count", len(req.Fields),
	)

	if len(req.Fields) == 0 || len(req.Fields) > 100 {
		return nil, fmt.Errorf("%w: fields must contain 1–100 items", ErrInvalidInput)
	}

	seen := make(map[string]bool, len(req.Fields))
	for _, f := range req.Fields {
		if seen[f.FieldID] {
			return nil, fmt.Errorf("%w: duplicate field_id: %s", ErrInvalidInput, f.FieldID)
		}
		seen[f.FieldID] = true
	}

	j, extractedJSONStr, tailoredJSONStr, err := s.repo.GetByIDWithJSON(ctx, jobID, userID)
	if err != nil {
		return nil, ErrInternal
	}
	if j == nil {
		return nil, ErrNotFound
	}
	if j.AlignmentStatus != "completed" {
		return nil, fmt.Errorf("%w: job alignment must be completed before autofill", ErrInvalidInput)
	}

	resume, err := s.repo.GetResumeForJob(ctx, j.ResumeID, userID)
	if err != nil || resume == nil {
		return nil, ErrInternal
	}

	profile, err := s.repo.GetUserProfile(ctx, userID)
	if err != nil || profile == nil {
		return nil, ErrInternal
	}

	chatMsgs, err := s.repo.GetRecentChatMessagesForJob(ctx, jobID, userID, 10)
	if err != nil {
		log.Warn("autofill: chat messages fetch failed",
			"error", logger.TruncateError(err, 200),
			"error_type", "db_error",
		)
		chatMsgs = nil
	}

	jobTitle, company, location, employmentType := j.JobTitle, j.Company, "", ""
	if j.Location != nil {
		location = *j.Location
	}
	if j.EmploymentType != nil {
		employmentType = *j.EmploymentType
	}

	skills := parseResumeSkills(resume.ExtractedJSON)
	experience := parseResumeExperience(resume.ExtractedJSON)
	education := parseResumeEducation(resume.ExtractedJSON)
	tailoredSummary, tailoredHighlights := summariseTailoredJSON(tailoredJSONStr)
	jobDetails := summariseExtractedJobJSON(extractedJSONStr)
	chatSummary := formatChatMessages(chatMsgs)

	fieldsJSON, _ := json.Marshal(req.Fields)

	log.Debug("autofill context assembled",
		"skills_len", len(skills),
		"experience_len", len(experience),
		"education_len", len(education),
		"tailored_summary_len", len(tailoredSummary),
		"job_details_len", len(jobDetails),
	)

	userMsg := prompts.AutofillUserMessage(
		jobTitle, company, location, employmentType,
		jobDetails,
		profile.FullName, profile.Email,
		skills, experience, education,
		tailoredSummary, tailoredHighlights,
		chatSummary,
		string(fieldsJSON),
	)

	// Autofill uses the decoupled AI context too — the AI call can take
	// 10–20s and we don't want a twitchy client to kill it mid-flight.
	aiCtx, aiCancel := s.aiContext(ctx)
	defer aiCancel()

	aiResp, err := s.ai.Complete(aiCtx, ai.Request{
		UserID:        userID,
		SystemPrompt:  prompts.AutofillSystemPrompt(),
		UserMessage:   userMsg,
		PromptVersion: prompts.AutofillV1,
		Stage:         ai.StageAutofill,
	})
	if err != nil {
		if mapped := mapAIError(err); errors.Is(mapped, ErrAIPipelineTimeout) || errors.Is(mapped, ai.ErrNoAPIKey) {
			return nil, mapped
		}
		return nil, fmt.Errorf("%w: AI call failed", ErrInternal)
	}

	if !json.Valid([]byte(aiResp.Content)) {
		return nil, fmt.Errorf("%w: AI returned invalid JSON", ErrInternal)
	}

	var rawFills map[string]*string
	if err := json.Unmarshal([]byte(aiResp.Content), &rawFills); err != nil {
		return nil, fmt.Errorf("%w: failed to parse AI fill map", ErrInternal)
	}

	fills := make(map[string]*string, len(req.Fields))
	unfilledCount := 0
	for _, f := range req.Fields {
		val, exists := rawFills[f.FieldID]
		if !exists || val == nil {
			unfilledCount++
			fills[f.FieldID] = nil
			continue
		}
		sanitised := sanitiseFillValue(*val)
		fills[f.FieldID] = &sanitised
	}

	confidence := "high"
	if unfilledCount > len(req.Fields)/2 {
		confidence = "low"
	} else if unfilledCount > 0 {
		confidence = "medium"
	}

	return &AutofillResult{
		Fills:         fills,
		Confidence:    confidence,
		UnfilledCount: unfilledCount,
		ModelUsed:     s.cfg.OpenRouterModel,
	}, nil
}

// ── ExtractFromExtension ──────────────────────────────────────────────────────

type previewClaims struct {
	jwt.RegisteredClaims
	Type             string `json:"t"`
	UserID           string `json:"uid"`
	ResumeID         string `json:"rid"`
	ExtractedJobJSON string `json:"ejson"`
	AlignmentJSON    string `json:"ajson"`
}

func (s *service) ExtractFromExtension(ctx context.Context, userID string, req ExtractFromExtensionRequest) (*ExtensionExtractionResult, error) {
	log := logger.FromContext(ctx).With(
		"component", "job",
		"operation", "ExtractFromExtension",
		"resume_id", req.ResumeID,
	)

	log.Info("pipeline started",
		"pipeline_stage", "input",
		"pipeline_status", "started",
		"page_bytes", len(req.PageText),
	)

	if len(req.PageText) < 100 || len(req.PageText) > 50000 {
		return nil, fmt.Errorf("%w: page_text must be 100–50000 characters", ErrInvalidInput)
	}
	if req.ResumeID == "" {
		return nil, fmt.Errorf("%w: resume_id is required", ErrInvalidInput)
	}

	resume, err := s.repo.GetResumeForJob(ctx, req.ResumeID, userID)
	if err != nil {
		log.Error("GetResumeForJob failed",
			"pipeline_stage", "validate",
			"pipeline_status", "failed",
			"error", logger.TruncateError(err, 200),
			"error_type", "db_error",
		)
		return nil, ErrInternal
	}
	if resume == nil {
		return nil, fmt.Errorf("%w: resume not found or does not belong to you", ErrInvalidInput)
	}
	if resume.ExtractionStatus != "completed" || resume.ExtractedJSON == nil {
		return nil, fmt.Errorf("%w: resume is not fully processed", ErrInvalidInput)
	}

	// Detach from the HTTP request context so the extension's ~30s timeout
	// (or any proxy in between) does not cancel an in-flight OpenRouter
	// call halfway through the extract→align pipeline. The aiCtx still
	// carries request_id / user_id for log correlation but has its own
	// JobAITimeoutSeconds deadline.
	aiCtx, aiCancel := s.aiContext(ctx)
	defer aiCancel()

	log.Info("job extraction started",
		"pipeline_stage", "extract",
		"pipeline_status", "started",
	)

	aiExtractResp, err := s.ai.Complete(aiCtx, ai.Request{
		UserID:        userID,
		SystemPrompt:  prompts.JobExtractionSystemPrompt(),
		UserMessage:   req.PageText,
		PromptVersion: prompts.JobExtractionV1,
		Stage:         ai.StageJobExtraction,
	})
	if err != nil {
		if errors.Is(err, ai.ErrNoAPIKey) {
			return nil, err
		}
		if mapped := mapAIError(err); errors.Is(mapped, ErrAIPipelineTimeout) {
			log.Error("job extraction timed out",
				"pipeline_stage", "extract",
				"pipeline_status", "failed",
				"error", logger.TruncateError(err, 200),
				"error_type", ai.ClassifyError(err),
			)
			return nil, mapped
		}
		log.Error("job extraction failed",
			"pipeline_stage", "extract",
			"pipeline_status", "failed",
			"error", logger.TruncateError(err, 200),
			"error_type", ai.ClassifyError(err),
		)
		return nil, fmt.Errorf("%w: extraction AI failed", ErrInternal)
	}

	if !json.Valid([]byte(aiExtractResp.Content)) {
		return nil, fmt.Errorf("%w: extraction AI returned invalid JSON", ErrExtraction)
	}

	var extracted ExtractedJob
	if err := json.Unmarshal([]byte(aiExtractResp.Content), &extracted); err != nil || !extracted.Valid {
		code := "INVALID_JOB_INPUT"
		reason := "The provided content does not appear to be a valid job description."
		if extracted.Error != nil {
			code = extracted.Error.Code
			reason = extracted.Error.Reason
		}
		log.Info("job extraction rejected by model",
			"pipeline_stage", "extract",
			"pipeline_status", "rejected",
			"error_code", code,
		)
		return nil, &ExtractionError{Code: code, Reason: reason}
	}

	log.Info("job extraction completed",
		"pipeline_stage", "extract",
		"pipeline_status", "completed",
	)

	log.Info("resume alignment started",
		"pipeline_stage", "align",
		"pipeline_status", "started",
	)

	userMsg := fmt.Sprintf("--- JOB ---\n%s\n--- RESUME ---\n%s", aiExtractResp.Content, *resume.ExtractedJSON)
	aiAlignResp, err := s.ai.Complete(aiCtx, ai.Request{
		UserID:        userID,
		SystemPrompt:  prompts.ResumeAlignmentSystemPrompt(),
		UserMessage:   userMsg,
		PromptVersion: prompts.ResumeAlignmentV1,
		Stage:         ai.StageResumeAlignment,
	})
	if err != nil {
		if errors.Is(err, ai.ErrNoAPIKey) {
			return nil, err
		}
		if mapped := mapAIError(err); errors.Is(mapped, ErrAIPipelineTimeout) {
			log.Error("resume alignment timed out",
				"pipeline_stage", "align",
				"pipeline_status", "failed",
				"error", logger.TruncateError(err, 200),
				"error_type", ai.ClassifyError(err),
			)
			return nil, mapped
		}
		log.Error("resume alignment failed",
			"pipeline_stage", "align",
			"pipeline_status", "failed",
			"error", logger.TruncateError(err, 200),
			"error_type", ai.ClassifyError(err),
		)
		return nil, fmt.Errorf("%w: alignment AI failed", ErrInternal)
	}

	var alignResult AlignmentResult
	if err := json.Unmarshal([]byte(aiAlignResp.Content), &alignResult); err != nil {
		log.Error("resume alignment unmarshal failed",
			"pipeline_stage", "align",
			"pipeline_status", "failed",
			"error", logger.TruncateError(err, 200),
			"error_type", "json_unmarshal_error",
			"content_len", len(aiAlignResp.Content),
		)
		return nil, fmt.Errorf("%w: alignment AI returned invalid JSON", ErrInternal)
	}

	// Reject misaligned jobs before creating a preview token — no job record exists to delete.
	if !alignResult.Aligned {
		reason := "Resume is fundamentally misaligned with this job."
		if alignResult.Error != nil {
			reason = alignResult.Error.Reason
		}
		jobTitle, company := "", ""
		if extracted.Job != nil {
			jobTitle = extracted.Job.Title
			company = extracted.Job.Company
		}
		misErr := buildMisalignedError("", jobTitle, company, reason, &alignResult)
		log.Warn("resume misaligned",
			"pipeline_stage", "align",
			"pipeline_status", "misaligned",
			"match_score", misErr.MatchScore,
		)
		return nil, misErr
	}

	gaps := alignResult.Gaps
	if gaps == nil {
		gaps = []string{}
	}

	log.Info("resume alignment completed",
		"pipeline_stage", "align",
		"pipeline_status", "completed",
		"match_score", alignResult.MatchScore,
	)

	// Build preview_token (10 min JWT containing embedded JSON)
	expiresAt := time.Now().Add(10 * time.Minute)
	claims := previewClaims{
		RegisteredClaims: jwt.RegisteredClaims{
			ExpiresAt: jwt.NewNumericDate(expiresAt),
			IssuedAt:  jwt.NewNumericDate(time.Now()),
		},
		Type:             "preview",
		UserID:           userID,
		ResumeID:         req.ResumeID,
		ExtractedJobJSON: aiExtractResp.Content,
		AlignmentJSON:    aiAlignResp.Content,
	}
	token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	previewToken, err := token.SignedString([]byte(s.cfg.JWTAccessSecret))
	if err != nil {
		log.Error("JWT sign preview token failed",
			"pipeline_stage", "finalise",
			"pipeline_status", "failed",
			"error", logger.TruncateError(err, 200),
			"error_type", "jwt_error",
		)
		return nil, ErrInternal
	}

	log.Info("pipeline completed",
		"pipeline_stage", "complete",
		"pipeline_status", "completed",
		"match_score", alignResult.MatchScore,
	)

	return &ExtensionExtractionResult{
		Job:            extracted.Job,
		MatchScore:     alignResult.MatchScore,
		MatchBreakdown: alignResult.MatchBreakdown,
		Gaps:           gaps,
		PreviewToken:   previewToken,
		PreviewExpires: expiresAt,
	}, nil
}

// ── ConfirmFromExtension ──────────────────────────────────────────────────────

func (s *service) ConfirmFromExtension(ctx context.Context, userID, rawToken string) (*Job, error) {
	log := logger.FromContext(ctx).With(
		"component", "job",
		"operation", "ConfirmFromExtension",
	)

	token, err := jwt.ParseWithClaims(rawToken, &previewClaims{}, func(t *jwt.Token) (any, error) {
		if _, ok := t.Method.(*jwt.SigningMethodHMAC); !ok {
			return nil, fmt.Errorf("unexpected signing method")
		}
		return []byte(s.cfg.JWTAccessSecret), nil
	})
	if err != nil || !token.Valid {
		return nil, fmt.Errorf("%w: invalid or expired preview token", ErrInvalidInput)
	}

	claims, ok := token.Claims.(*previewClaims)
	if !ok || claims.Type != "preview" || claims.UserID != userID {
		return nil, fmt.Errorf("%w: invalid preview token", ErrInvalidInput)
	}

	resume, err := s.repo.GetResumeForJob(ctx, claims.ResumeID, userID)
	if err != nil {
		log.Error("GetResumeForJob failed",
			"resume_id", claims.ResumeID,
			"error", logger.TruncateError(err, 200),
			"error_type", "db_error",
		)
		return nil, ErrInternal
	}
	if resume == nil {
		return nil, fmt.Errorf("%w: resume not found", ErrInvalidInput)
	}

	var extracted ExtractedJob
	if err := json.Unmarshal([]byte(claims.ExtractedJobJSON), &extracted); err != nil || !extracted.Valid {
		return nil, fmt.Errorf("%w: preview token contains invalid extracted job", ErrInvalidInput)
	}

	var alignResult AlignmentResult
	if err := json.Unmarshal([]byte(claims.AlignmentJSON), &alignResult); err != nil {
		return nil, fmt.Errorf("%w: preview token contains invalid alignment", ErrInvalidInput)
	}

	j, err := s.repo.CreateFromPreview(ctx, Job{
		UserID:   userID,
		ResumeID: claims.ResumeID,
	})
	if err != nil {
		log.Error("CreateFromPreview failed",
			"resume_id", claims.ResumeID,
			"error", logger.TruncateError(err, 200),
			"error_type", "db_error",
		)
		return nil, ErrInternal
	}

	extractedContent := claims.ExtractedJobJSON
	_ = s.repo.UpdateExtractionStatus(ctx, j.ID, "completed", &extractedContent, nil)

	alignContent := claims.AlignmentJSON
	score := alignResult.MatchScore
	_ = s.repo.UpdateAlignmentStatus(ctx, j.ID, "completed", &alignContent, &score, nil)

	if alignResult.TailoredResume != nil {
		pdfBytes, pdfErr := GeneratePDF(alignResult.TailoredResume)
		if pdfErr == nil {
			pdfKey := fmt.Sprintf("%s%s/%s.pdf", s.cfg.PDFStoragePrefix, userID, j.ID)
			if uploadErr := s.r2.Upload(ctx, pdfKey, pdfBytes, "application/pdf"); uploadErr == nil {
				generatedAt := time.Now()
				_ = s.repo.UpdatePDF(ctx, j.ID, pdfKey, generatedAt)
			}
		}
	}

	fields := jobFieldsFromExtracted(&extracted)
	_ = s.repo.UpdateJobFields(ctx, j.ID, fields)

	final, err := s.repo.GetByID(ctx, j.ID, userID)
	if err != nil || final == nil {
		return j, nil
	}
	return final, nil
}

// ── autofill helpers ──────────────────────────────────────────────────────────

func sanitiseFillValue(s string) string {
	s = strings.Map(func(r rune) rune {
		if r == 0 || (r < 32 && r != '\n' && r != '\t') {
			return -1
		}
		return r
	}, s)
	inTag := false
	var out strings.Builder
	for _, ch := range s {
		if ch == '<' {
			inTag = true
			continue
		}
		if ch == '>' {
			inTag = false
			continue
		}
		if !inTag {
			out.WriteRune(ch)
		}
	}
	return strings.TrimSpace(out.String())
}

func parseResumeSkills(jsonStr *string) string {
	if jsonStr == nil || *jsonStr == "" {
		return ""
	}
	var m map[string]any
	if err := json.Unmarshal([]byte(*jsonStr), &m); err != nil {
		return ""
	}
	skills, ok := m["skills"].(map[string]any)
	if !ok {
		return ""
	}
	var parts []string
	for _, key := range []string{"technical", "tools", "soft", "languages"} {
		arr, ok := skills[key].([]any)
		if !ok || len(arr) == 0 {
			continue
		}
		strs := make([]string, 0, len(arr))
		for _, v := range arr {
			if s, ok := v.(string); ok && s != "" {
				strs = append(strs, s)
			}
		}
		if len(strs) > 0 {
			parts = append(parts, strings.Join(strs, ", "))
		}
	}
	return strings.Join(parts, "; ")
}

func parseResumeExperience(jsonStr *string) string {
	if jsonStr == nil || *jsonStr == "" {
		return ""
	}
	var m map[string]any
	if err := json.Unmarshal([]byte(*jsonStr), &m); err != nil {
		return ""
	}
	exp, ok := m["experience"].([]any)
	if !ok || len(exp) == 0 {
		return ""
	}
	var sb strings.Builder
	for i, item := range exp {
		if i >= 3 {
			break
		}
		e, ok := item.(map[string]any)
		if !ok {
			continue
		}
		title, _ := e["title"].(string)
		company, _ := e["company"].(string)
		start, _ := e["start_date"].(string)
		end, _ := e["end_date"].(string)
		if end == "" {
			end = "Present"
		}
		fmt.Fprintf(&sb, "%s at %s (%s - %s)", title, company, start, end)
		if highlights, ok := e["highlights"].([]any); ok {
			for j, h := range highlights {
				if j >= 2 {
					break
				}
				if hs, ok := h.(string); ok && hs != "" {
					fmt.Fprintf(&sb, "; %s", hs)
				}
			}
		}
		sb.WriteString("\n")
	}
	return strings.TrimSpace(sb.String())
}

func parseResumeEducation(jsonStr *string) string {
	if jsonStr == nil || *jsonStr == "" {
		return ""
	}
	var m map[string]any
	if err := json.Unmarshal([]byte(*jsonStr), &m); err != nil {
		return ""
	}
	edu, ok := m["education"].([]any)
	if !ok || len(edu) == 0 {
		return ""
	}
	var parts []string
	for _, item := range edu {
		e, ok := item.(map[string]any)
		if !ok {
			continue
		}
		degree, _ := e["degree"].(string)
		field, _ := e["field"].(string)
		institution, _ := e["institution"].(string)
		if degree != "" || field != "" {
			parts = append(parts, fmt.Sprintf("%s in %s at %s", degree, field, institution))
		}
	}
	return strings.Join(parts, "; ")
}

func summariseTailoredJSON(jsonStr *string) (summary, highlights string) {
	if jsonStr == nil || *jsonStr == "" {
		return "", ""
	}
	var m map[string]any
	if err := json.Unmarshal([]byte(*jsonStr), &m); err != nil {
		return "", ""
	}
	if s, ok := m["summary"].(string); ok {
		summary = s
	}
	if skills, ok := m["skills"].(map[string]any); ok {
		if tech, ok := skills["technical"].([]any); ok && len(tech) > 0 {
			strs := make([]string, 0, len(tech))
			for _, v := range tech {
				if s, ok := v.(string); ok && s != "" {
					strs = append(strs, s)
				}
			}
			highlights = strings.Join(strs, ", ")
		}
	}
	return summary, highlights
}

func summariseExtractedJobJSON(jsonStr *string) string {
	if jsonStr == nil || *jsonStr == "" {
		return ""
	}
	var m map[string]any
	if err := json.Unmarshal([]byte(*jsonStr), &m); err != nil {
		return ""
	}
	job, ok := m["job"].(map[string]any)
	if !ok {
		return ""
	}
	var sb strings.Builder
	if v, ok := job["summary"].(string); ok && v != "" {
		fmt.Fprintf(&sb, "Summary: %s\n", v)
	}
	if arr, ok := job["required_skills"].([]any); ok && len(arr) > 0 {
		skills := make([]string, 0, len(arr))
		for _, v := range arr {
			if s, ok := v.(string); ok {
				skills = append(skills, s)
			}
		}
		fmt.Fprintf(&sb, "Required Skills: %s\n", strings.Join(skills, ", "))
	}
	if arr, ok := job["responsibilities"].([]any); ok && len(arr) > 0 {
		sb.WriteString("Responsibilities:\n")
		for i, v := range arr {
			if i >= 4 {
				break
			}
			if s, ok := v.(string); ok && s != "" {
				fmt.Fprintf(&sb, "- %s\n", s)
			}
		}
	}
	return strings.TrimSpace(sb.String())
}

func formatChatMessages(msgs []ChatMessage) string {
	if len(msgs) == 0 {
		return "No chat history."
	}
	var sb strings.Builder
	for _, m := range msgs {
		sb.WriteString(m.Role)
		sb.WriteString(": ")
		content := m.Content
		if len(content) > 500 {
			content = content[:500] + "…"
		}
		sb.WriteString(content)
		sb.WriteString("\n")
	}
	return sb.String()
}
