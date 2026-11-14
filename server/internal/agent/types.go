// Package agent is the autopilot: it searches job boards for postings that
// match the user, scores them against their resume, lets the user approve
// the ones worth applying to, and on the next run prepares each application
// as an email from the agent's own mailbox. Emails go out later, one at a
// time, from a send queue (agent_outbox) that spaces them out inside the
// user's sending window; delivery outcomes come back from Resend and
// addresses that bounce or complain are suppressed. Mail that comes back is
// triaged and moves applications along the tracker automatically.
package agent

import (
	"encoding/json"
	"errors"
	"time"

	"github.com/collinsadi/aethlara/internal/agent/sources"
)

var (
	ErrNotFound       = errors.New("not found")
	ErrInvalidInput   = errors.New("invalid input")
	ErrRunInProgress  = errors.New("a run is already in progress")
	ErrNoResume       = errors.New("no processed resume")
	ErrMailboxTaken   = errors.New("mailbox address taken")
	ErrMailboxOff     = errors.New("agent mailbox is not configured")
	ErrNotClaimable   = errors.New("application is not claimable")
	ErrInternal       = errors.New("internal error")
	ErrWebhookDisable = errors.New("inbound webhook is not configured")
)

// Lead statuses.
const (
	LeadNew       = "new"
	LeadApproved  = "approved"
	LeadDismissed = "dismissed"
	LeadApplying  = "applying"
	LeadApplied   = "applied"
	LeadFailed    = "failed"
	LeadExpired   = "expired"
)

// Application statuses.
const (
	AppQueued     = "queued"
	AppPreparing  = "preparing"
	AppReady      = "ready"
	AppInProgress = "in_progress"
	AppNeedsInput = "needs_input"
	// AppScheduled: prepared; its email waits in the send queue.
	AppScheduled = "scheduled"
	AppSubmitted = "submitted"
	AppFailed    = "failed"
	AppCancelled = "cancelled"
)

// Application channels. Every new application is an email; "browser"
// (the Chrome extension filling the form) only appears on old rows.
const (
	ChannelBrowser = "browser"
	ChannelEmail   = "email"
	// ChannelColdEmail: the posting could not be read, so the agent emailed
	// an address the company publishes, with the original resume.
	ChannelColdEmail = "cold_email"
)

// Where an application's address came from (applications.recipient_kind).
const (
	RecipientPosting = "posting" // the posting says to email it
	RecipientHiring  = "hiring"  // careers@, jobs@ ... published by the company
	RecipientGeneral = "general" // hello@, contact@ ... published by the company
	RecipientPerson  = "person"  // a person named on a job page
	RecipientUser    = "user"    // typed in by the user
)

// Outbox statuses.
const (
	OutboxScheduled = "scheduled"
	OutboxSending   = "sending"
	OutboxSent      = "sent"
	OutboxFailed    = "failed"
	OutboxCancelled = "cancelled"
)

// Outbox kinds.
const (
	OutboxApplication = "application"
	OutboxColdEmail   = "cold_email"
)

// Delivery outcomes reported by Resend (agent_outbox.delivery_status).
const (
	DeliveryDelayed    = "delayed"
	DeliveryDelivered  = "delivered"
	DeliveryFailed     = "failed"
	DeliverySuppressed = "suppressed"
	DeliveryBounced    = "bounced"
	DeliveryComplained = "complained"
)

// SearchPrefs describes what the agent looks for (agent_profiles.search_prefs).
type SearchPrefs struct {
	Titles           []string             `json:"titles"`
	Keywords         []string             `json:"keywords"`
	ExcludeKeywords  []string             `json:"exclude_keywords"`
	Locations        []string             `json:"locations"`
	RemoteOnly       bool                 `json:"remote_only"`
	Seniority        []string             `json:"seniority"`
	EmploymentTypes  []string             `json:"employment_types"`
	MinSalary        *int                 `json:"min_salary"`
	SalaryCurrency   string               `json:"salary_currency"`
	ExcludeCompanies []string             `json:"exclude_companies"`
	MaxAgeDays       int                  `json:"max_age_days"`
	MinScore         int                  `json:"min_score"`
	Sources          map[string]bool      `json:"sources"`
	Watchlist        []sources.CompanyRef `json:"watchlist"`
}

// EEOAnswers are voluntary self-identification answers. Empty means
// "decline to self-identify".
type EEOAnswers struct {
	Gender            string `json:"gender"`
	Race              string `json:"race"`
	Veteran           string `json:"veteran"`
	Disability        string `json:"disability"`
	SexualOrientation string `json:"sexual_orientation"`
}

// ApplicationProfile holds the answers application forms ask for
// (agent_profiles.application_profile).
type ApplicationProfile struct {
	FullName            string     `json:"full_name"`
	Phone               string     `json:"phone"`
	Location            string     `json:"location"`
	Country             string     `json:"country"`
	LinkedIn            string     `json:"linkedin"`
	GitHub              string     `json:"github"`
	Portfolio           string     `json:"portfolio"`
	Website             string     `json:"website"`
	WorkAuthorization   string     `json:"work_authorization"`
	RequiresSponsorship *bool      `json:"requires_sponsorship"`
	WillingToRelocate   *bool      `json:"willing_to_relocate"`
	NoticePeriod        string     `json:"notice_period"`
	EarliestStartDate   string     `json:"earliest_start_date"`
	SalaryExpectation   string     `json:"salary_expectation"`
	YearsOfExperience   *int       `json:"years_of_experience"`
	Pronouns            string     `json:"pronouns"`
	HowDidYouHear       string     `json:"how_did_you_hear"`
	AdditionalInfo      string     `json:"additional_info"`
	EEO                 EEOAnswers `json:"eeo"`
}

// ApplySettings are the agent's rules for applying (agent_profiles.apply_settings).
type ApplySettings struct {
	// AutoSubmit let the extension press "Submit" on application forms.
	// Applying is email-only now, so it only matters to older extensions.
	AutoSubmit bool `json:"auto_submit"`
	// DailyLimit caps application emails per day. A new mailbox starts
	// lower and ramps up to it (warm-up, see schedule.go).
	DailyLimit int `json:"daily_limit"`
	// AutoApproveScore approves new leads scoring at or above it without
	// review. nil = always ask.
	AutoApproveScore *int `json:"auto_approve_score"`
	CoverLetters     bool `json:"cover_letters"`
	DigestEmails     bool `json:"digest_emails"`
	ImportantAlerts  bool `json:"important_alerts"`
	// ColdEmailFallback: when a posting cannot be read, email an address
	// the company publishes instead of failing the application.
	ColdEmailFallback bool `json:"cold_email_fallback"`

	// Sending. Prepared emails wait at least SendDelayMinutes (the undo
	// window), then go out one at a time between SendWindowStart and
	// SendWindowEnd (hours, 0-24) in SendTimezone (IANA name; "" = UTC),
	// on weekdays only when SendWeekdaysOnly.
	SendDelayMinutes int    `json:"send_delay_minutes"`
	SendWindowStart  int    `json:"send_window_start"`
	SendWindowEnd    int    `json:"send_window_end"`
	SendWeekdaysOnly bool   `json:"send_weekdays_only"`
	SendTimezone     string `json:"send_timezone"`
}

// Profile is the agent configuration for one user.
type Profile struct {
	UserID             string
	Enabled            bool
	ResumeID           *string
	MailboxAddress     *string
	SearchPrefs        SearchPrefs
	ApplicationProfile ApplicationProfile
	ApplySettings      ApplySettings
	RunIntervalHours   int
	NextRunAt          *time.Time
	LastRunAt          *time.Time
	// SendingPausedUntil holds scheduled emails back (set by the user, or
	// by the circuit breaker after bounces or a spam complaint).
	SendingPausedUntil *time.Time
	SendingPauseReason *string
	CreatedAt          time.Time
	UpdatedAt          time.Time
}

// SendingPaused reports whether scheduled emails are held back at now.
func (p *Profile) SendingPaused(now time.Time) bool {
	return p.SendingPausedUntil != nil && p.SendingPausedUntil.After(now)
}

// Run is one execution of the agent loop.
type Run struct {
	ID         string
	UserID     string
	Trigger    string
	Status     string
	Stats      RunStats
	Error      *string
	StartedAt  time.Time
	FinishedAt *time.Time
}

// RunStats summarises what a run did.
type RunStats struct {
	SourcesQueried  int               `json:"sources_queried"`
	SourceErrors    map[string]string `json:"source_errors,omitempty"`
	PostingsFetched int               `json:"postings_fetched"`
	NewLeads        int               `json:"new_leads"`
	Scored          int               `json:"scored"`
	StrongMatches   int               `json:"strong_matches"`
	AutoApproved    int               `json:"auto_approved"`
	Prepared        int               `json:"prepared"`
	EmailsScheduled int               `json:"emails_scheduled"`
	// EmailsSent counts emails sent during the run; since sending moved to
	// the send queue it only appears on runs from before.
	EmailsSent      int `json:"emails_sent"`
	ReadyForBrowser int `json:"ready_for_browser"`
	Failed          int `json:"failed"`
	// Dropped counts jobs given up because there was no address to email.
	Dropped         int `json:"dropped"`
	MessagesTriaged int `json:"messages_triaged"`
}

// Event is one entry in the activity feed.
type Event struct {
	ID            int64
	UserID        string
	RunID         *string
	Kind          string
	Level         string
	Message       string
	LeadID        *string
	ApplicationID *string
	Data          json.RawMessage
	CreatedAt     time.Time
}

// Event kinds.
const (
	EventRunStarted    = "run_started"
	EventRunFinished   = "run_finished"
	EventRunFailed     = "run_failed"
	EventLeadsFound    = "leads_found"
	EventSourceError   = "source_error"
	EventLeadApproved  = "lead_approved"
	EventPrepared      = "application_prepared"
	EventScheduled     = "application_scheduled"
	EventEmailSent     = "application_emailed"
	EventSubmitted     = "application_submitted"
	EventNeedsInput    = "application_needs_input"
	EventAppFailed     = "application_failed"
	EventAppDropped    = "application_dropped"
	EventMailReceived  = "mail_received"
	EventStatusChanged = "status_changed"
	EventDigestSent    = "digest_sent"
	EventEmailBounced  = "email_bounced"
	EventComplaint     = "email_complained"
	EventSendingPaused = "sending_paused"
)

// Lead is a discovered posting.
type Lead struct {
	ID             string
	UserID         string
	RunID          *string
	Source         string
	SourceLabel    string
	ExternalID     *string
	DedupeKey      string
	Title          string
	Company        string
	Location       *string
	IsRemote       bool
	EmploymentType *string
	SalaryMin      *int
	SalaryMax      *int
	SalaryCurrency *string
	SalaryText     *string
	URL            string
	ApplyURL       *string
	ApplyEmail     *string
	ATS            *string
	Description    string
	PostedAt       *time.Time
	MatchScore     *int
	MatchFit       *string
	MatchSummary   *string
	MatchPros      []string
	MatchGaps      []string
	Dealbreaker    *string
	ScoredAt       *time.Time
	Status         string
	DismissReason  *string
	DecidedAt      *time.Time
	JobID          *string
	CreatedAt      time.Time
	UpdatedAt      time.Time
}

// Application is one approved lead on its way to being submitted.
type Application struct {
	ID                string
	UserID            string
	LeadID            string
	JobID             *string
	Channel           string
	Status            string
	ApplyURL          *string
	ApplyEmail        *string
	ATS               *string
	CoverLetter       *string
	UseOriginalResume bool
	Attempts          int
	LastError         *string
	Needs             *Needs
	Result            json.RawMessage
	ClaimedAt         *time.Time
	ClaimExpiresAt    *time.Time
	SubmittedAt       *time.Time
	OutboxID          *string
	RecipientKind     *string
	RecipientSource   *string
	CreatedAt         time.Time
	UpdatedAt         time.Time

	// Joined from job_leads for list views.
	LeadTitle   string
	LeadCompany string
	LeadScore   *int
	LeadURL     string

	// Joined from agent_outbox (read-only).
	ScheduledAt    *time.Time
	DeliveryStatus *string
	DeliveryDetail *string
}

// OutboxEmail is one email in the send queue.
type OutboxEmail struct {
	ID             string
	UserID         string
	Kind           string
	ToAddress      string
	Subject        string
	Body           string // without the signature
	ResumeJobID    *string
	ResumeID       *string
	Status         string
	ScheduledAt    time.Time
	LockedUntil    *time.Time
	Attempts       int
	LastError      *string
	ProviderID     *string
	SentAt         *time.Time
	DeliveryStatus *string
	DeliveryDetail *string
	CreatedAt      time.Time
}

// Needs explains why an application is waiting on the user.
type Needs struct {
	Reason    string     `json:"reason"` // missing_answers|captcha|login_required|unsupported_form|review (no_email before jobs without an address were dropped)
	Message   string     `json:"message"`
	Questions []Question `json:"questions,omitempty"`
	PageURL   string     `json:"page_url,omitempty"`
}

// Question is a form question the agent could not answer.
type Question struct {
	FieldID string   `json:"field_id"`
	Label   string   `json:"label"`
	Type    string   `json:"type,omitempty"`
	Options []string `json:"options,omitempty"`
}

// Message is a mail in the agent mailbox.
type Message struct {
	ID             string
	UserID         string
	Direction      string
	ProviderID     *string
	MessageID      *string
	FromAddress    string
	FromName       *string
	ToAddresses    []string
	Subject        string
	TextBody       string
	Links          []string
	Attachments    json.RawMessage
	Category       *string
	Summary        *string
	Extracted      *TriageResult
	Important      bool
	ApplicationID  *string
	JobID          *string
	TriageStatus   string
	TriageAttempts int
	SenderAuth     string // pass | fail | unknown
	ReadAt         *time.Time
	ReceivedAt     time.Time
	CreatedAt      time.Time
}

// TriageResult is the structured classification of an inbound email.
type TriageResult struct {
	Category           string  `json:"category"`
	Company            *string `json:"company"`
	JobTitle           *string `json:"job_title"`
	Summary            string  `json:"summary"`
	ActionRequired     bool    `json:"action_required"`
	Action             *string `json:"action"`
	Deadline           *string `json:"deadline"`
	VerificationCode   *string `json:"verification_code"`
	VerificationLink   *string `json:"verification_link"`
	MatchedApplication *string `json:"matched_application"`
}

// Answer is a saved answer to an application question.
type Answer struct {
	ID          string
	UserID      string
	QuestionKey string
	Question    string
	Answer      string
	Source      string
	CreatedAt   time.Time
	UpdatedAt   time.Time
}

// ResumeInfo is the resume data the agent reads.
type ResumeInfo struct {
	ID               string
	Name             string
	OriginalFilename string
	FileFormat       string
	R2ObjectKey      string
	ExtractionStatus string
	ExtractedJSON    *string
}

// UserBasics is the account identity.
type UserBasics struct {
	ID       string
	FullName string
	Email    string
}

// AppMatch is a compact application used to match inbound mail.
type AppMatch struct {
	ApplicationID string
	JobID         *string
	Company       string
	Title         string
	Status        string
	SubmittedAt   *time.Time
}
