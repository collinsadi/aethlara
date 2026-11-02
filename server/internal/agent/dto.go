package agent

import (
	"encoding/json"
	"time"

	"github.com/collinsadi/aethlara/internal/agent/sources"
)

// JSON shapes returned by the agent API. Field names are part of the public
// contract with the dashboard and the extension (see server/docs.md).

type profileDTO struct {
	Enabled            bool               `json:"enabled"`
	ResumeID           *string            `json:"resume_id"`
	MailboxAddress     *string            `json:"mailbox_address"`
	MailboxDomain      *string            `json:"mailbox_domain"`
	SearchPrefs        SearchPrefs        `json:"search_prefs"`
	ApplicationProfile ApplicationProfile `json:"application_profile"`
	ApplySettings      ApplySettings      `json:"apply_settings"`
	RunIntervalHours   int                `json:"run_interval_hours"`
	NextRunAt          *time.Time         `json:"next_run_at"`
	LastRunAt          *time.Time         `json:"last_run_at"`
	UpdatedAt          time.Time          `json:"updated_at"`
}

func toProfileDTO(p *Profile, domain string) profileDTO {
	sp := p.SearchPrefs
	if sp.Titles == nil {
		sp.Titles = []string{}
	}
	if sp.Keywords == nil {
		sp.Keywords = []string{}
	}
	if sp.ExcludeKeywords == nil {
		sp.ExcludeKeywords = []string{}
	}
	if sp.Locations == nil {
		sp.Locations = []string{}
	}
	if sp.Seniority == nil {
		sp.Seniority = []string{}
	}
	if sp.EmploymentTypes == nil {
		sp.EmploymentTypes = []string{}
	}
	if sp.ExcludeCompanies == nil {
		sp.ExcludeCompanies = []string{}
	}
	if sp.Sources == nil {
		sp.Sources = map[string]bool{}
	}
	if sp.Watchlist == nil {
		sp.Watchlist = []sources.CompanyRef{}
	}
	return profileDTO{
		Enabled: p.Enabled, ResumeID: p.ResumeID, MailboxAddress: p.MailboxAddress, MailboxDomain: strPtr(domain),
		SearchPrefs: sp, ApplicationProfile: p.ApplicationProfile, ApplySettings: p.ApplySettings,
		RunIntervalHours: p.RunIntervalHours, NextRunAt: p.NextRunAt, LastRunAt: p.LastRunAt, UpdatedAt: p.UpdatedAt,
	}
}

type matchDTO struct {
	Score       *int     `json:"score"`
	Fit         *string  `json:"fit"`
	Summary     *string  `json:"summary"`
	Pros        []string `json:"pros"`
	Gaps        []string `json:"gaps"`
	Dealbreaker *string  `json:"dealbreaker"`
}

type salaryDTO struct {
	Min      *int    `json:"min"`
	Max      *int    `json:"max"`
	Currency *string `json:"currency"`
	Text     *string `json:"text"`
}

type leadDTO struct {
	ID                 string     `json:"id"`
	Source             string     `json:"source"`
	SourceLabel        string     `json:"source_label"`
	Title              string     `json:"title"`
	Company            string     `json:"company"`
	Location           *string    `json:"location"`
	IsRemote           bool       `json:"is_remote"`
	EmploymentType     *string    `json:"employment_type"`
	Salary             salaryDTO  `json:"salary"`
	URL                string     `json:"url"`
	ApplyURL           *string    `json:"apply_url"`
	ApplyChannel       string     `json:"apply_channel"`
	ATS                *string    `json:"ats"`
	AutoApplySupported bool       `json:"auto_apply_supported"`
	PostedAt           *time.Time `json:"posted_at"`
	Match              *matchDTO  `json:"match"`
	Status             string     `json:"status"`
	DismissReason      *string    `json:"dismiss_reason"`
	DecidedAt          *time.Time `json:"decided_at"`
	JobID              *string    `json:"job_id"`
	CreatedAt          time.Time  `json:"created_at"`
	Description        *string    `json:"description,omitempty"`
}

func toLeadDTO(l *Lead, withDescription bool) leadDTO {
	channel := ChannelBrowser
	if l.ApplyEmail != nil && *l.ApplyEmail != "" {
		channel = ChannelEmail
	}
	d := leadDTO{
		ID: l.ID, Source: l.Source, SourceLabel: l.SourceLabel, Title: l.Title, Company: l.Company,
		Location: l.Location, IsRemote: l.IsRemote, EmploymentType: l.EmploymentType,
		Salary: salaryDTO{Min: l.SalaryMin, Max: l.SalaryMax, Currency: l.SalaryCurrency, Text: l.SalaryText},
		URL:    l.URL, ApplyURL: l.ApplyURL, ApplyChannel: channel, ATS: l.ATS,
		AutoApplySupported: channel == ChannelEmail || (l.ATS != nil && sources.AutoApplySupported(*l.ATS)),
		PostedAt:           l.PostedAt, Status: l.Status, DismissReason: l.DismissReason, DecidedAt: l.DecidedAt,
		JobID: l.JobID, CreatedAt: l.CreatedAt,
	}
	if l.ScoredAt != nil {
		pros, gaps := l.MatchPros, l.MatchGaps
		if pros == nil {
			pros = []string{}
		}
		if gaps == nil {
			gaps = []string{}
		}
		d.Match = &matchDTO{Score: l.MatchScore, Fit: l.MatchFit, Summary: l.MatchSummary, Pros: pros, Gaps: gaps, Dealbreaker: l.Dealbreaker}
	}
	if withDescription {
		desc := l.Description
		d.Description = &desc
	}
	return d
}

type appLeadDTO struct {
	Title   string `json:"title"`
	Company string `json:"company"`
	Score   *int   `json:"score"`
	URL     string `json:"url"`
}

type applicationDTO struct {
	ID                string          `json:"id"`
	LeadID            string          `json:"lead_id"`
	JobID             *string         `json:"job_id"`
	Channel           string          `json:"channel"`
	Status            string          `json:"status"`
	ApplyURL          *string         `json:"apply_url"`
	ApplyEmail        *string         `json:"apply_email"`
	ATS               *string         `json:"ats"`
	HasCoverLetter    bool            `json:"has_cover_letter"`
	CoverLetter       *string         `json:"cover_letter,omitempty"`
	UseOriginalResume bool            `json:"use_original_resume"`
	Attempts          int             `json:"attempts"`
	LastError         *string         `json:"last_error"`
	Needs             *Needs          `json:"needs"`
	Result            json.RawMessage `json:"result"`
	ClaimExpiresAt    *time.Time      `json:"claim_expires_at"`
	SubmittedAt       *time.Time      `json:"submitted_at"`
	CreatedAt         time.Time       `json:"created_at"`
	UpdatedAt         time.Time       `json:"updated_at"`
	Lead              appLeadDTO      `json:"lead"`
}

func toApplicationDTO(a *Application, withCoverLetter bool) applicationDTO {
	d := applicationDTO{
		ID: a.ID, LeadID: a.LeadID, JobID: a.JobID, Channel: a.Channel, Status: a.Status,
		ApplyURL: a.ApplyURL, ApplyEmail: a.ApplyEmail, ATS: a.ATS,
		HasCoverLetter:    a.CoverLetter != nil && *a.CoverLetter != "",
		UseOriginalResume: a.UseOriginalResume, Attempts: a.Attempts, LastError: a.LastError, Needs: a.Needs,
		Result: a.Result, ClaimExpiresAt: a.ClaimExpiresAt, SubmittedAt: a.SubmittedAt,
		CreatedAt: a.CreatedAt, UpdatedAt: a.UpdatedAt,
		Lead: appLeadDTO{Title: a.LeadTitle, Company: a.LeadCompany, Score: a.LeadScore, URL: a.LeadURL},
	}
	if len(d.Result) == 0 {
		d.Result = json.RawMessage("null")
	}
	if withCoverLetter {
		d.CoverLetter = a.CoverLetter
	}
	return d
}

type runDTO struct {
	ID         string     `json:"id"`
	Trigger    string     `json:"trigger"`
	Status     string     `json:"status"`
	Stats      RunStats   `json:"stats"`
	Error      *string    `json:"error"`
	StartedAt  time.Time  `json:"started_at"`
	FinishedAt *time.Time `json:"finished_at"`
}

func toRunDTO(r *Run) *runDTO {
	if r == nil {
		return nil
	}
	return &runDTO{ID: r.ID, Trigger: r.Trigger, Status: r.Status, Stats: r.Stats, Error: r.Error,
		StartedAt: r.StartedAt, FinishedAt: r.FinishedAt}
}

type eventDTO struct {
	ID            int64           `json:"id"`
	Kind          string          `json:"kind"`
	Level         string          `json:"level"`
	Message       string          `json:"message"`
	RunID         *string         `json:"run_id"`
	LeadID        *string         `json:"lead_id"`
	ApplicationID *string         `json:"application_id"`
	Data          json.RawMessage `json:"data"`
	CreatedAt     time.Time       `json:"created_at"`
}

func toEventDTOs(evs []Event) []eventDTO {
	out := make([]eventDTO, 0, len(evs))
	for _, e := range evs {
		data := e.Data
		if len(data) == 0 {
			data = json.RawMessage("null")
		}
		out = append(out, eventDTO{ID: e.ID, Kind: e.Kind, Level: e.Level, Message: e.Message, RunID: e.RunID,
			LeadID: e.LeadID, ApplicationID: e.ApplicationID, Data: data, CreatedAt: e.CreatedAt})
	}
	return out
}

type messageDTO struct {
	ID            string          `json:"id"`
	Direction     string          `json:"direction"`
	FromAddress   string          `json:"from_address"`
	FromName      *string         `json:"from_name"`
	To            []string        `json:"to"`
	Subject       string          `json:"subject"`
	Snippet       string          `json:"snippet"`
	Category      *string         `json:"category"`
	Summary       *string         `json:"summary"`
	Important     bool            `json:"important"`
	ApplicationID *string         `json:"application_id"`
	JobID         *string         `json:"job_id"`
	TriageStatus  string          `json:"triage_status"`
	SenderAuth    string          `json:"sender_auth"`
	ReadAt        *time.Time      `json:"read_at"`
	ReceivedAt    time.Time       `json:"received_at"`
	TextBody      *string         `json:"text_body,omitempty"`
	Links         []string        `json:"links,omitempty"`
	Attachments   json.RawMessage `json:"attachments,omitempty"`
	Extracted     *TriageResult   `json:"extracted,omitempty"`
}

func toMessageDTO(m *Message, detail bool) messageDTO {
	to := m.ToAddresses
	if to == nil {
		to = []string{}
	}
	d := messageDTO{
		ID: m.ID, Direction: m.Direction, FromAddress: m.FromAddress, FromName: m.FromName, To: to,
		Subject: m.Subject, Snippet: clipText(collapseSpace(m.TextBody), 180), Category: m.Category,
		Summary: m.Summary, Important: m.Important, ApplicationID: m.ApplicationID, JobID: m.JobID,
		TriageStatus: m.TriageStatus, SenderAuth: m.SenderAuth, ReadAt: m.ReadAt, ReceivedAt: m.ReceivedAt,
	}
	if detail {
		body := m.TextBody
		d.TextBody = &body
		d.Links = m.Links
		if d.Links == nil {
			d.Links = []string{}
		}
		d.Attachments = m.Attachments
		d.Extracted = m.Extracted
	}
	return d
}

type answerDTO struct {
	ID        string    `json:"id"`
	Question  string    `json:"question"`
	Answer    string    `json:"answer"`
	Source    string    `json:"source"`
	UpdatedAt time.Time `json:"updated_at"`
}

func toAnswerDTOs(as []Answer) []answerDTO {
	out := make([]answerDTO, 0, len(as))
	for _, a := range as {
		out = append(out, answerDTO{ID: a.ID, Question: a.Question, Answer: a.Answer, Source: a.Source, UpdatedAt: a.UpdatedAt})
	}
	return out
}

type packetDTO struct {
	Application       applicationDTO     `json:"application"`
	Lead              leadDTO            `json:"lead"`
	Identity          identity           `json:"identity"`
	Profile           ApplicationProfile `json:"profile"`
	Answers           []answerDTO        `json:"answers"`
	CoverLetter       string             `json:"cover_letter"`
	Resume            fileRefDTO         `json:"resume"`
	CoverLetterFile   *fileRefDTO        `json:"cover_letter_file"`
	AutoSubmit        bool               `json:"auto_submit"`
	VerificationSince time.Time          `json:"verification_since"`
}

type fileRefDTO struct {
	Filename string `json:"filename"`
	Path     string `json:"path"` // relative to the API base URL
}

func toPacketDTO(p *Packet) packetDTO {
	d := packetDTO{
		Application:       toApplicationDTO(p.Application, false),
		Lead:              toLeadDTO(p.Lead, false),
		Identity:          p.Identity,
		Profile:           p.Profile,
		Answers:           toAnswerDTOs(p.Answers),
		CoverLetter:       p.CoverLetter,
		Resume:            fileRefDTO{Filename: p.ResumeName, Path: "/agent/applications/" + p.Application.ID + "/resume"},
		AutoSubmit:        p.AutoSubmit,
		VerificationSince: time.Now().Add(-2 * time.Minute),
	}
	if p.CoverLetter != "" {
		name := "Cover_Letter.pdf"
		if p.Identity.FirstName != "" {
			name = p.Identity.FirstName + "_Cover_Letter.pdf"
		}
		d.CoverLetterFile = &fileRefDTO{Filename: name, Path: "/agent/applications/" + p.Application.ID + "/cover-letter.pdf"}
	}
	return d
}

type verificationDTO struct {
	MessageID  string    `json:"message_id"`
	From       string    `json:"from"`
	Subject    string    `json:"subject"`
	Code       *string   `json:"code"`
	Link       *string   `json:"link"`
	ReceivedAt time.Time `json:"received_at"`
}

func collapseSpace(s string) string {
	out := make([]rune, 0, len(s))
	space := false
	for _, r := range s {
		if r == '\n' || r == '\t' || r == '\r' || r == ' ' {
			if !space {
				out = append(out, ' ')
			}
			space = true
			continue
		}
		space = false
		out = append(out, r)
	}
	return string(out)
}
