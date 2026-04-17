package job

import "time"

// Job is the DB model for a job record.
type Job struct {
	ID              string
	UserID          string
	ResumeID        string
	JobTitle        string
	Company         string
	Location        *string
	IsRemote        bool
	JobURL          *string
	EmploymentType  *string
	ExperienceLevel *string
	SalaryMin       *int
	SalaryMax       *int
	SalaryCurrency  string
	InputMethod     string
	RawInputRef     *string
	// extracted_job_json intentionally excluded from normal scans
	ExtractionStatus string
	ExtractionError  *string
	// tailored_resume_json intentionally excluded from normal scans
	MatchScore      *int
	AlignmentStatus string
	AlignmentError  *string
	PDFR2Key        *string
	PDFGeneratedAt  *time.Time
	Status          string
	AppliedAt       *time.Time
	Notes           *string
	CreatedAt       time.Time
	UpdatedAt       time.Time
	DeletedAt       *time.Time
}

// JobDetail extends Job with AI-derived fields from JSONB columns.
type JobDetail struct {
	Job
	MatchBreakdown *MatchBreakdown `json:"-"`
	Gaps           []string        `json:"-"`
}

// ExtractedJob is the AI response schema for job extraction.
type ExtractedJob struct {
	Valid bool        `json:"valid"`
	Job   *JobDetails `json:"job,omitempty"`
	Error *AIError    `json:"error,omitempty"`
}

type JobDetails struct {
	Title                   string      `json:"title"`
	Company                 string      `json:"company"`
	Location                string      `json:"location"`
	IsRemote                bool        `json:"is_remote"`
	EmploymentType          string      `json:"employment_type"`
	ExperienceLevel         string      `json:"experience_level"`
	Salary                  *SalaryInfo `json:"salary"`
	Summary                 string      `json:"summary"`
	Responsibilities        []string    `json:"responsibilities"`
	RequiredSkills          []string    `json:"required_skills"`
	PreferredSkills         []string    `json:"preferred_skills"`
	RequiredExperienceYears *int        `json:"required_experience_years"`
	EducationRequirements   []string    `json:"education_requirements"`
	Benefits                []string    `json:"benefits"`
	TechStack               []string    `json:"tech_stack"`
	Industry                string      `json:"industry"`
	Department              string      `json:"department"`
	ApplicationDeadline     *string     `json:"application_deadline"`
	PostedAt                *string     `json:"posted_at"`
}

type SalaryInfo struct {
	Min      *int   `json:"min"`
	Max      *int   `json:"max"`
	Currency string `json:"currency"`
	Period   string `json:"period"`
}

type AIError struct {
	Code   string `json:"code"`
	Reason string `json:"reason"`
}

// AlignmentResult is the AI response schema for resume alignment.
type AlignmentResult struct {
	Aligned        bool            `json:"aligned"`
	MatchScore     int             `json:"match_score"`
	MatchBreakdown *MatchBreakdown `json:"match_breakdown,omitempty"`
	Gaps           []string        `json:"gaps,omitempty"`
	TailoredResume *TailoredResume `json:"tailored_resume,omitempty"`
	Error          *AIError        `json:"error,omitempty"`
}

type MatchBreakdown struct {
	SkillsMatch     int    `json:"skills_match"`
	ExperienceMatch int    `json:"experience_match"`
	EducationMatch  int    `json:"education_match"`
	OverallNotes    string `json:"overall_notes"`
}

type TailoredResume struct {
	Personal       map[string]any   `json:"personal"`
	Summary        string           `json:"summary"`
	Experience     []map[string]any `json:"experience"`
	Education      []map[string]any `json:"education"`
	Skills         map[string]any   `json:"skills"`
	Certifications []map[string]any `json:"certifications"`
	Projects       []map[string]any `json:"projects"`
}

// JobFields holds the fields extracted from the AI job JSON to persist on the job record.
type JobFields struct {
	JobTitle        string
	Company         string
	Location        *string
	IsRemote        bool
	EmploymentType  *string
	ExperienceLevel *string
	SalaryMin       *int
	SalaryMax       *int
	SalaryCurrency  string
}

// CreateJobRequest is the validated inbound request for job creation.
type CreateJobRequest struct {
	InputMethod string
	JobURL      string
	JobText     string
	CompanyName string
	Role        string
	ResumeID    string
}

// UpdateStatusRequest is the inbound request for status update.
type UpdateStatusRequest struct {
	Status string
	Notes  *string
}

// ListJobsQuery holds the parsed + validated query params for GET /jobs.
type ListJobsQuery struct {
	Page           int
	PageSize       int
	Sort           string
	Status         string
	EmploymentType string
	IsRemote       *bool
	MinMatch       *int
	Search         string
}

// allowed status transitions
var allowedTransitions = map[string][]string{
	"not_applied": {"applied"},
	"applied":     {"interview", "rejected", "withdrawn"},
	"interview":   {"offer", "rejected", "withdrawn"},
	"offer":       {"withdrawn"},
	"rejected":    {},
	"withdrawn":   {},
}

func IsValidTransition(from, to string) bool {
	targets, ok := allowedTransitions[from]
	if !ok {
		return false
	}
	for _, t := range targets {
		if t == to {
			return true
		}
	}
	return false
}
