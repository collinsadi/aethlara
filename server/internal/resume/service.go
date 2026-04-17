package resume

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"time"

	"github.com/collinsadi/aethlara/internal/ai"
	"github.com/collinsadi/aethlara/internal/config"
	"github.com/collinsadi/aethlara/internal/prompts"
	"github.com/collinsadi/aethlara/internal/storage"
)

var (
	ErrNotFound      = errors.New("resume not found")
	ErrLimitExceeded = errors.New("active resume limit reached")
	ErrInvalidFile   = errors.New("invalid file")
	ErrInternal      = errors.New("internal error")
)

type UploadRequest struct {
	UserID    string
	Name      string
	Filename  string
	FileData  []byte
	FileSize  int64
}

type PreviewURLResponse struct {
	URL       string
	ExpiresAt time.Time
}

type DeleteResponse struct {
	Resume        *Resume
	WasLastResume bool
}

type Service interface {
	Upload(ctx context.Context, req UploadRequest) (*Resume, error)
	List(ctx context.Context, userID string) ([]Resume, error)
	PreviewURL(ctx context.Context, id, userID string) (*PreviewURLResponse, error)
	Delete(ctx context.Context, id, userID string) (*DeleteResponse, error)
	HasActive(ctx context.Context, userID string) (bool, error)
}

type service struct {
	repo   Repository
	r2     *storage.R2Client
	ai     *ai.Client
	cfg    *config.Config
}

func NewService(repo Repository, r2 *storage.R2Client, aiClient *ai.Client, cfg *config.Config) Service {
	return &service{repo: repo, r2: r2, ai: aiClient, cfg: cfg}
}

func (s *service) Upload(ctx context.Context, req UploadRequest) (*Resume, error) {
	// Validate file size
	if req.FileSize > s.cfg.ResumeMaxFileSize() {
		return nil, fmt.Errorf("%w: file exceeds maximum size of %dMB",
			ErrInvalidFile, s.cfg.ResumeMaxFileSizeMB)
	}

	// Validate format via magic bytes
	format, err := DetectAndValidateFormat(req.FileData, req.Filename)
	if err != nil {
		return nil, fmt.Errorf("%w: %s", ErrInvalidFile, err)
	}

	// Enforce per-user resume limit
	count, err := s.repo.CountActive(ctx, req.UserID)
	if err != nil {
		return nil, ErrInternal
	}
	if count >= s.cfg.ResumeMaxActivePerUser {
		return nil, ErrLimitExceeded
	}

	// Build R2 object key: resumes/{user_id}/{unix_ms}_{safe_filename}
	safeFilename := SanitizeFilename(req.Filename)
	objectKey := fmt.Sprintf("resumes/%s/%d_%s", req.UserID, time.Now().UnixMilli(), safeFilename)

	// Upload to R2 first — if this fails, nothing is persisted
	contentType := ContentTypeFor(format)
	if err := s.r2.Upload(ctx, objectKey, req.FileData, contentType); err != nil {
		slog.Error("r2 upload failed", "user_id", req.UserID, "error", err)
		return nil, ErrInternal
	}

	// Create DB record (status: processing)
	resume, err := s.repo.Create(ctx, Resume{
		UserID:           req.UserID,
		Name:             req.Name,
		OriginalFilename: req.Filename,
		FileFormat:       format,
		FileSizeBytes:    req.FileSize,
		R2ObjectKey:      objectKey,
	})
	if err != nil {
		slog.Error("resume db create failed", "user_id", req.UserID, "error", err)
		return nil, ErrInternal
	}

	// Extract text and run AI — failures are recorded in DB but file is preserved
	extractedJSON, extractErr := s.processExtraction(ctx, req.UserID, resume.ID, req.FileData, format)

	if extractErr != nil {
		errMsg := extractErr.Error()
		_ = s.repo.UpdateExtraction(ctx, resume.ID, "failed", nil, &errMsg)
		resume.ExtractionStatus = "failed"
		resume.ExtractionError = &errMsg
		slog.Warn("resume extraction failed",
			"resume_id", resume.ID,
			"format", format,
			"error", extractErr,
		)
	} else {
		_ = s.repo.UpdateExtraction(ctx, resume.ID, "completed", &extractedJSON, nil)
		resume.ExtractionStatus = "completed"
	}

	return resume, nil
}

func (s *service) processExtraction(ctx context.Context, userID, resumeID string, data []byte, format string) (string, error) {
	text, err := ExtractText(data, format)
	if err != nil {
		return "", fmt.Errorf("text extraction: %w", err)
	}
	if len(text) < 50 {
		return "", fmt.Errorf("extracted text too short to process")
	}

	aiResp, err := s.ai.Complete(ctx, ai.Request{
		UserID:        userID,
		SystemPrompt:  prompts.ResumeExtractionSystemPrompt(),
		UserMessage:   text,
		PromptVersion: prompts.ResumeExtractionV1,
	})
	if err != nil {
		return "", fmt.Errorf("ai extraction: %w", err)
	}

	// Validate the AI response is valid JSON before saving
	if !json.Valid([]byte(aiResp.Content)) {
		return "", fmt.Errorf("ai returned invalid JSON")
	}

	return aiResp.Content, nil
}

func (s *service) List(ctx context.Context, userID string) ([]Resume, error) {
	resumes, err := s.repo.GetAllActive(ctx, userID)
	if err != nil {
		return nil, ErrInternal
	}
	if resumes == nil {
		resumes = []Resume{}
	}
	return resumes, nil
}

func (s *service) PreviewURL(ctx context.Context, id, userID string) (*PreviewURLResponse, error) {
	r, err := s.repo.GetByID(ctx, id, userID)
	if err != nil {
		return nil, ErrInternal
	}
	if r == nil {
		return nil, ErrNotFound
	}

	url, expiresAt, err := s.r2.PresignURL(ctx, r.R2ObjectKey)
	if err != nil {
		slog.Error("presign url failed",
			"user_id", userID,
			"resume_id", id,
			"error", err,
		)
		return nil, ErrInternal
	}

	return &PreviewURLResponse{URL: url, ExpiresAt: expiresAt}, nil
}

func (s *service) Delete(ctx context.Context, id, userID string) (*DeleteResponse, error) {
	deleted, err := s.repo.SoftDelete(ctx, id, userID)
	if err != nil {
		return nil, ErrInternal
	}
	if deleted == nil {
		return nil, ErrNotFound
	}

	remaining, err := s.repo.CountActiveAfterDelete(ctx, userID)
	if err != nil {
		return nil, ErrInternal
	}

	return &DeleteResponse{
		Resume:        deleted,
		WasLastResume: remaining == 0,
	}, nil
}

func (s *service) HasActive(ctx context.Context, userID string) (bool, error) {
	n, err := s.repo.CountActive(ctx, userID)
	if err != nil {
		return false, ErrInternal
	}
	return n > 0, nil
}
