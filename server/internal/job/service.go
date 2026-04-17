package job

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"strings"
	"time"

	"github.com/collinsadi/aethlara/internal/ai"
	"github.com/collinsadi/aethlara/internal/config"
	"github.com/collinsadi/aethlara/internal/prompts"
	"github.com/collinsadi/aethlara/internal/storage"
)

var (
	ErrNotFound      = errors.New("job not found")
	ErrForbidden     = errors.New("access denied")
	ErrInvalidInput  = errors.New("invalid input")
	ErrDuplicate     = errors.New("duplicate job")
	ErrExtraction    = errors.New("extraction failed")
	ErrMisaligned    = errors.New("resume misaligned")
	ErrPDFNotReady   = errors.New("PDF not ready")
	ErrInternal      = errors.New("internal error")
)

// MisalignedError carries the AI's reason back to the handler.
type MisalignedError struct {
	Reason     string
	MatchScore int
}

func (e *MisalignedError) Error() string { return "resume misaligned: " + e.Reason }
func (e *MisalignedError) Is(target error) bool { return target == ErrMisaligned }

// ExtractionError carries the AI's reason back to the handler.
type ExtractionError struct {
	Code   string
	Reason string
}

func (e *ExtractionError) Error() string { return "extraction failed: " + e.Code + " – " + e.Reason }
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

// ── Create ────────────────────────────────────────────────────────────────────

func (s *service) Create(ctx context.Context, userID string, req CreateJobRequest) (*Job, error) {
	// Validate & verify resume ownership + completion
	resume, err := s.repo.GetResumeForJob(ctx, req.ResumeID, userID)
	if err != nil {
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
		slog.Error("job create failed", "user_id", userID, "error", err)
		return nil, ErrInternal
	}

	// Mark extraction as processing
	procStatus := "processing"
	_ = s.repo.UpdateExtractionStatus(ctx, j.ID, procStatus, nil, nil)

	// Stage 3: acquire raw input
	var rawContent string
	switch req.InputMethod {
	case "url":
		rawContent, err = ScrapeJob(ctx, req.JobURL, s.cfg)
		if err != nil {
			errMsg := "scrape failed: " + err.Error()
			_ = s.repo.UpdateExtractionStatus(ctx, j.ID, "failed", nil, &errMsg)
			return nil, fmt.Errorf("%w: %s", ErrExtraction, err)
		}
	case "text":
		rawContent = fmt.Sprintf("Company: %s\nRole: %s\n\n%s",
			SanitizeText(req.CompanyName),
			SanitizeText(req.Role),
			SanitizeText(req.JobText),
		)
	}

	// Archive raw input to R2
	rawKey := fmt.Sprintf("jobs/raw/%s/%s", userID, j.ID)
	if err := s.r2.Upload(ctx, rawKey, []byte(rawContent), "text/plain"); err != nil {
		slog.Warn("raw input archive failed", "job_id", j.ID, "error", err)
		// Non-fatal: continue without archive
	} else {
		// Store the R2 key — best effort, ignore error
		_ = s.repo.UpdateExtractionStatus(ctx, j.ID, "processing", nil, nil)
	}

	// Stage 4–6: job extraction AI
	extractedJob, extractedJSONStr, err := s.runExtraction(ctx, userID, j.ID, rawContent)
	if err != nil {
		return nil, err
	}

	// Stage 7–10: resume alignment AI
	alignResult, alignJSONStr, err := s.runAlignment(ctx, userID, j.ID, extractedJSONStr, *resume.ExtractedJSON)
	if err != nil {
		return nil, err
	}

	// Stage 11–13: PDF generation (best-effort, non-fatal)
	if alignResult.TailoredResume != nil {
		pdfBytes, pdfErr := GeneratePDF(alignResult.TailoredResume)
		if pdfErr != nil {
			slog.Warn("pdf generation failed", "job_id", j.ID, "error", pdfErr)
		} else {
			pdfKey := fmt.Sprintf("%s%s/%s.pdf", s.cfg.PDFStoragePrefix, userID, j.ID)
			if uploadErr := s.r2.Upload(ctx, pdfKey, pdfBytes, "application/pdf"); uploadErr != nil {
				slog.Warn("pdf upload failed", "job_id", j.ID, "error", uploadErr)
			} else {
				generatedAt := time.Now()
				if dbErr := s.repo.UpdatePDF(ctx, j.ID, pdfKey, generatedAt); dbErr != nil {
					slog.Warn("pdf db update failed", "job_id", j.ID, "error", dbErr)
				}
			}
		}
	}

	// Stage 14: update job fields from extracted data
	fields := jobFieldsFromExtracted(extractedJob)
	// For text input, use the client-provided values as fallback
	if req.InputMethod == "text" {
		if fields.Company == "" {
			fields.Company = sanitizeField(req.CompanyName)
		}
		if fields.JobTitle == "" {
			fields.JobTitle = sanitizeField(req.Role)
		}
	}
	if err := s.repo.UpdateJobFields(ctx, j.ID, fields); err != nil {
		slog.Warn("job fields update failed", "job_id", j.ID, "error", err)
	}

	// Store alignment JSON (match_score already saved in runAlignment)
	_ = alignJSONStr

	// Fetch final state
	final, err := s.repo.GetByID(ctx, j.ID, userID)
	if err != nil || final == nil {
		return j, nil
	}
	return final, nil
}

func (s *service) runExtraction(ctx context.Context, userID, jobID, rawContent string) (*ExtractedJob, string, error) {
	aiResp, err := s.ai.Complete(ctx, ai.Request{
		UserID:        userID,
		SystemPrompt:  prompts.JobExtractionSystemPrompt(),
		UserMessage:   rawContent,
		PromptVersion: prompts.JobExtractionV1,
	})
	if err != nil {
		errMsg := "AI extraction error: " + err.Error()
		_ = s.repo.UpdateExtractionStatus(ctx, jobID, "failed", nil, &errMsg)
		return nil, "", fmt.Errorf("%w: %s", ErrExtraction, err)
	}

	if !json.Valid([]byte(aiResp.Content)) {
		errMsg := "AI returned invalid JSON"
		_ = s.repo.UpdateExtractionStatus(ctx, jobID, "failed", nil, &errMsg)
		return nil, "", fmt.Errorf("%w: AI returned non-JSON response", ErrExtraction)
	}

	var extracted ExtractedJob
	if err := json.Unmarshal([]byte(aiResp.Content), &extracted); err != nil {
		errMsg := "JSON unmarshal failed: " + err.Error()
		_ = s.repo.UpdateExtractionStatus(ctx, jobID, "failed", nil, &errMsg)
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
		return nil, "", &ExtractionError{Code: code, Reason: reason}
	}

	content := aiResp.Content
	_ = s.repo.UpdateExtractionStatus(ctx, jobID, "completed", &content, nil)
	return &extracted, content, nil
}

func (s *service) runAlignment(ctx context.Context, userID, jobID, extractedJobJSON, resumeJSON string) (*AlignmentResult, string, error) {
	_ = s.repo.UpdateAlignmentStatus(ctx, jobID, "processing", nil, nil, nil)

	userMsg := fmt.Sprintf("--- JOB ---\n%s\n--- RESUME ---\n%s", extractedJobJSON, resumeJSON)

	aiResp, err := s.ai.Complete(ctx, ai.Request{
		UserID:        userID,
		SystemPrompt:  prompts.ResumeAlignmentSystemPrompt(),
		UserMessage:   userMsg,
		PromptVersion: prompts.ResumeAlignmentV1,
	})
	if err != nil {
		errMsg := "AI alignment error: " + err.Error()
		_ = s.repo.UpdateAlignmentStatus(ctx, jobID, "failed", nil, nil, &errMsg)
		return nil, "", fmt.Errorf("%w: %s", ErrMisaligned, err)
	}

	if !json.Valid([]byte(aiResp.Content)) {
		errMsg := "AI returned invalid JSON"
		_ = s.repo.UpdateAlignmentStatus(ctx, jobID, "failed", nil, nil, &errMsg)
		return nil, "", fmt.Errorf("%w: AI returned non-JSON response", ErrMisaligned)
	}

	var result AlignmentResult
	if err := json.Unmarshal([]byte(aiResp.Content), &result); err != nil {
		errMsg := "JSON unmarshal failed: " + err.Error()
		_ = s.repo.UpdateAlignmentStatus(ctx, jobID, "failed", nil, nil, &errMsg)
		return nil, "", fmt.Errorf("%w: failed to parse AI response", ErrMisaligned)
	}

	if !result.Aligned {
		reason := "Resume is fundamentally misaligned with this job."
		if result.Error != nil {
			reason = result.Error.Reason
		}
		errMsg := fmt.Sprintf("RESUME_MISALIGNED (score %d): %s", result.MatchScore, reason)
		score := result.MatchScore
		_ = s.repo.UpdateAlignmentStatus(ctx, jobID, "misaligned", nil, &score, &errMsg)
		return nil, "", &MisalignedError{Reason: reason, MatchScore: result.MatchScore}
	}

	content := aiResp.Content
	score := result.MatchScore
	_ = s.repo.UpdateAlignmentStatus(ctx, jobID, "completed", &content, &score, nil)
	return &result, content, nil
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

	slog.Info("job status updated",
		"job_id", id,
		"user_id", userID,
		"from", current.Status,
		"to", req.Status,
	)
	return updated, nil
}

// ── PreviewURL ────────────────────────────────────────────────────────────────

func (s *service) PreviewURL(ctx context.Context, id, userID string) (*PreviewURLResult, error) {
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
		slog.Error("presign url failed", "job_id", id, "user_id", userID, "error", err)
		return nil, ErrInternal
	}

	slog.Info("job pdf presigned url generated",
		"job_id", id,
		"user_id", userID,
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
