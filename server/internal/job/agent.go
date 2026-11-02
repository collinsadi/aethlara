package job

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/collinsadi/aethlara/internal/logger"
)

// Entry points used by the autopilot (internal/agent). They reuse the same
// extraction -> alignment -> PDF pipeline as manual job creation.

// LeadTailorInput is a discovered posting the user approved.
type LeadTailorInput struct {
	ResumeID    string
	JobURL      string
	Title       string
	Company     string
	Description string // plain-text posting
}

// LeadTailorResult is what the agent needs to apply.
type LeadTailorResult struct {
	Job        *Job
	Tailored   *TailoredResume // nil when misaligned
	MatchScore int
	Misaligned bool
	Reason     string
	PDFKey     string // tailored PDF object key; "" when none was produced
}

// TailoredContext exposes the AI-derived JSON for one job to the agent.
type TailoredContext struct {
	Job              *Job
	ExtractedJobJSON string
	TailoredJSON     string
}

// maxAgentPDFBytes bounds generated PDFs read back for attachments/uploads.
const maxAgentPDFBytes = 8 << 20

// TailorForLead creates a job record (input_method "agent") from an approved
// lead and tailors the resume to it. A misaligned result is NOT an error:
// the job is kept without a tailored PDF so the agent can still apply with
// the original resume.
func (s *service) TailorForLead(ctx context.Context, userID string, in LeadTailorInput) (*LeadTailorResult, error) {
	log := logger.FromContext(ctx).With(
		"component", "job",
		"operation", "TailorForLead",
		"resume_id", in.ResumeID,
	)

	resume, err := s.repo.GetResumeForJob(ctx, in.ResumeID, userID)
	if err != nil {
		return nil, ErrInternal
	}
	if resume == nil {
		return nil, fmt.Errorf("%w: resume not found or does not belong to you", ErrInvalidInput)
	}
	if resume.ExtractionStatus != "completed" || resume.ExtractedJSON == nil || *resume.ExtractedJSON == "" {
		return nil, fmt.Errorf("%w: resume is not fully processed yet", ErrInvalidInput)
	}
	if strings.TrimSpace(in.Description) == "" {
		return nil, fmt.Errorf("%w: posting has no description", ErrInvalidInput)
	}

	var jobURL *string
	if in.JobURL != "" {
		u := in.JobURL
		jobURL = &u
	}
	j, err := s.repo.Create(ctx, Job{UserID: userID, ResumeID: in.ResumeID, InputMethod: "agent", JobURL: jobURL})
	if err != nil {
		log.Error("job record create failed", "error", logger.TruncateError(err, 200), "error_type", "db_error")
		return nil, ErrInternal
	}
	log = log.With("job_id", j.ID)
	_ = s.repo.UpdateExtractionStatus(ctx, j.ID, "processing", nil, nil)

	rawContent := fmt.Sprintf("Company: %s\nRole: %s\nURL: %s\n\n%s",
		sanitizeField(in.Company), sanitizeField(in.Title), in.JobURL, SanitizeText(in.Description))

	rawKey := fmt.Sprintf("jobs/raw/%s/%s", userID, j.ID)
	if err := s.r2.Upload(ctx, rawKey, []byte(rawContent), "text/plain"); err != nil {
		log.Warn("raw input archive failed", "error", logger.TruncateError(err, 200), "error_type", "r2_error")
	}

	aiCtx, cancel := s.aiContext(ctx)
	defer cancel()

	extracted, extractedJSON, err := s.runExtraction(aiCtx, userID, j.ID, rawContent)
	if err != nil {
		// A job that could not even be parsed is noise in the user's list.
		_, _ = s.repo.SoftDelete(ctx, j.ID, userID)
		return nil, err
	}

	result := &LeadTailorResult{}
	align, _, err := s.runAlignment(aiCtx, userID, j.ID, extracted, extractedJSON, *resume.ExtractedJSON, false)
	var misErr *MisalignedError
	switch {
	case err == nil:
		result.MatchScore = align.MatchScore
		result.Tailored = align.TailoredResume
	case errors.As(err, &misErr):
		result.Misaligned = true
		result.MatchScore = misErr.MatchScore
		result.Reason = misErr.Reason
	default:
		return nil, err
	}

	if result.Tailored != nil {
		if pdf, pdfErr := GeneratePDF(result.Tailored); pdfErr != nil {
			log.Warn("pdf generation failed", "error", logger.TruncateError(pdfErr, 200), "error_type", "pdf_error")
		} else {
			key := fmt.Sprintf("%s%s/%s.pdf", s.cfg.PDFStoragePrefix, userID, j.ID)
			if upErr := s.r2.Upload(ctx, key, pdf, "application/pdf"); upErr != nil {
				log.Warn("pdf upload failed", "error", logger.TruncateError(upErr, 200), "error_type", "r2_error")
			} else if dbErr := s.repo.UpdatePDF(ctx, j.ID, key, time.Now()); dbErr == nil {
				result.PDFKey = key
			}
		}
	}

	fields := jobFieldsFromExtracted(extracted)
	if fields.JobTitle == "" {
		fields.JobTitle = sanitizeField(in.Title)
	}
	if fields.Company == "" {
		fields.Company = sanitizeField(in.Company)
	}
	if err := s.repo.UpdateJobFields(ctx, j.ID, fields); err != nil {
		log.Warn("job fields update failed", "error", logger.TruncateError(err, 200), "error_type", "db_error")
	}

	final, err := s.repo.GetByID(ctx, j.ID, userID)
	if err != nil || final == nil {
		final = j
	}
	result.Job = final
	log.Info("lead tailored", "match_score", result.MatchScore, "misaligned", result.Misaligned, "has_pdf", result.PDFKey != "")
	return result, nil
}

// GetTailoredContext returns the job with its extracted-job and tailored
// resume JSON.
func (s *service) GetTailoredContext(ctx context.Context, jobID, userID string) (*TailoredContext, error) {
	j, extracted, tailored, err := s.repo.GetByIDWithJSON(ctx, jobID, userID)
	if err != nil {
		return nil, ErrInternal
	}
	if j == nil {
		return nil, ErrNotFound
	}
	tc := &TailoredContext{Job: j}
	if extracted != nil {
		tc.ExtractedJobJSON = *extracted
	}
	if tailored != nil {
		tc.TailoredJSON = *tailored
	}
	return tc, nil
}

// DownloadPDF returns the tailored resume PDF bytes for a job.
func (s *service) DownloadPDF(ctx context.Context, jobID, userID string) ([]byte, error) {
	j, err := s.repo.GetByID(ctx, jobID, userID)
	if err != nil {
		return nil, ErrInternal
	}
	if j == nil {
		return nil, ErrNotFound
	}
	if j.PDFR2Key == nil {
		return nil, ErrPDFNotReady
	}
	data, _, err := s.r2.Download(ctx, *j.PDFR2Key, maxAgentPDFBytes)
	if err != nil {
		return nil, ErrInternal
	}
	return data, nil
}

// AdvanceStatus moves a job to target through the shortest chain of valid
// transitions (e.g. not_applied -> applied -> rejected when a rejection
// email arrives for an application the tracker never saw submitted). It is
// a no-op when the job is already at target and fails when target is
// unreachable from the current status.
func (s *service) AdvanceStatus(ctx context.Context, jobID, userID, target string) (*Job, error) {
	current, err := s.repo.GetByID(ctx, jobID, userID)
	if err != nil {
		return nil, ErrInternal
	}
	if current == nil {
		return nil, ErrNotFound
	}
	if current.Status == target {
		return current, nil
	}
	path := TransitionPath(current.Status, target)
	if path == nil {
		return nil, fmt.Errorf("%w: cannot move from %q to %q", ErrInvalidInput, current.Status, target)
	}

	updated := current
	for _, step := range path {
		var appliedAt *time.Time
		if step == "applied" && updated.AppliedAt == nil {
			now := time.Now()
			appliedAt = &now
		}
		next, err := s.repo.UpdateStatus(ctx, jobID, userID, step, appliedAt, nil)
		if err != nil {
			return nil, ErrInternal
		}
		if next == nil {
			return nil, ErrNotFound
		}
		updated = next
	}
	return updated, nil
}

// TransitionPath returns the statuses to step through (excluding from) to
// reach to, or nil when to is unreachable.
func TransitionPath(from, to string) []string {
	if from == to {
		return []string{}
	}
	prev := map[string]string{from: ""}
	queue := []string{from}
	for len(queue) > 0 {
		cur := queue[0]
		queue = queue[1:]
		for _, next := range allowedTransitions[cur] {
			if _, seen := prev[next]; seen {
				continue
			}
			prev[next] = cur
			if next == to {
				var path []string
				for at := to; at != from; at = prev[at] {
					path = append([]string{at}, path...)
				}
				return path
			}
			queue = append(queue, next)
		}
	}
	return nil
}
