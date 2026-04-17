package chat

import (
	"encoding/json"
	"fmt"
	"strings"

	"github.com/collinsadi/aethlara/internal/prompts"
)

// buildSystemPrompt takes the raw JSON blobs from the DB, extracts only the
// safe subset needed for chat context (stripping contact info), and returns
// the fully-assembled system prompt.
//
// SECURITY NOTES:
//   - email, phone, full_name are STRIPPED from the resume context
//   - raw JSON is never embedded — only structured summaries
//   - any JSON parse failures fall back to empty strings rather than leaking raw data
func buildSystemPrompt(jc *JobContext) (string, error) {
	ctx := prompts.JobChatContext{
		JobTitle: jc.JobTitle,
		Company:  jc.Company,
	}
	if jc.MatchScore != nil {
		ctx.MatchScore = *jc.MatchScore
	}

	// Extract job context from extracted_job_json
	if jc.ExtractedJobJSON != nil {
		ej := parseExtractedJob(*jc.ExtractedJobJSON)
		if ej != nil {
			ctx.Location = ej.Location
			ctx.RemoteStatus = remoteLabel(ej.IsRemote)
			ctx.EmploymentType = humanise(ej.EmploymentType)
			ctx.ExperienceLevel = humanise(ej.ExperienceLevel)
			ctx.SalaryRange = formatSalary(ej.Salary)
			ctx.JobSummary = ej.Summary
			ctx.Responsibilities = capList(ej.Responsibilities, 10)
			ctx.RequiredSkills = capList(ej.RequiredSkills, 30)
			ctx.PreferredSkills = capList(ej.PreferredSkills, 30)
			ctx.TechStack = capList(ej.TechStack, 30)
		}
	}

	// Extract resume context from resumes.extracted_json (contact info stripped)
	if jc.ResumeExtractedJSON != nil {
		ctx.ResumeSummary = summariseResume(*jc.ResumeExtractedJSON)
	}

	// Extract match breakdown + tailored summary from tailored_resume_json
	if jc.TailoredResumeJSON != nil {
		ar := parseAlignment(*jc.TailoredResumeJSON)
		if ar != nil {
			if ar.MatchBreakdown != nil {
				ctx.SkillsMatch = ar.MatchBreakdown.SkillsMatch
				ctx.ExperienceMatch = ar.MatchBreakdown.ExperienceMatch
				ctx.EducationMatch = ar.MatchBreakdown.EducationMatch
			}
			ctx.Gaps = capList(ar.Gaps, 15)
			ctx.TailoredResumeSummary = summariseTailored(ar.TailoredResume)
		}
	}

	return prompts.JobChatSystemPrompt(ctx), nil
}

// ── extracted_job_json shape (subset — matches job.ExtractedJob) ──────────────

type extractedJobWire struct {
	Valid bool `json:"valid"`
	Job   *struct {
		Title            string   `json:"title"`
		Company          string   `json:"company"`
		Location         string   `json:"location"`
		IsRemote         bool     `json:"is_remote"`
		EmploymentType   string   `json:"employment_type"`
		ExperienceLevel  string   `json:"experience_level"`
		Salary           *struct {
			Min      *int   `json:"min"`
			Max      *int   `json:"max"`
			Currency string `json:"currency"`
			Period   string `json:"period"`
		} `json:"salary"`
		Summary          string   `json:"summary"`
		Responsibilities []string `json:"responsibilities"`
		RequiredSkills   []string `json:"required_skills"`
		PreferredSkills  []string `json:"preferred_skills"`
		TechStack        []string `json:"tech_stack"`
	} `json:"job"`
}

type extractedJob struct {
	Location         string
	IsRemote         bool
	EmploymentType   string
	ExperienceLevel  string
	Salary           *salary
	Summary          string
	Responsibilities []string
	RequiredSkills   []string
	PreferredSkills  []string
	TechStack        []string
}

type salary struct {
	Min      *int
	Max      *int
	Currency string
	Period   string
}

func parseExtractedJob(raw string) *extractedJob {
	var wire extractedJobWire
	if err := json.Unmarshal([]byte(raw), &wire); err != nil || wire.Job == nil {
		return nil
	}
	j := wire.Job
	out := &extractedJob{
		Location:         j.Location,
		IsRemote:         j.IsRemote,
		EmploymentType:   j.EmploymentType,
		ExperienceLevel:  j.ExperienceLevel,
		Summary:          j.Summary,
		Responsibilities: j.Responsibilities,
		RequiredSkills:   j.RequiredSkills,
		PreferredSkills:  j.PreferredSkills,
		TechStack:        j.TechStack,
	}
	if j.Salary != nil {
		out.Salary = &salary{
			Min:      j.Salary.Min,
			Max:      j.Salary.Max,
			Currency: j.Salary.Currency,
			Period:   j.Salary.Period,
		}
	}
	return out
}

// ── tailored_resume_json shape (subset) ───────────────────────────────────────

type alignmentWire struct {
	Aligned        bool `json:"aligned"`
	MatchScore     int  `json:"match_score"`
	MatchBreakdown *struct {
		SkillsMatch     int    `json:"skills_match"`
		ExperienceMatch int    `json:"experience_match"`
		EducationMatch  int    `json:"education_match"`
		OverallNotes    string `json:"overall_notes"`
	} `json:"match_breakdown"`
	Gaps           []string       `json:"gaps"`
	TailoredResume map[string]any `json:"tailored_resume"`
}

type alignment struct {
	MatchBreakdown *struct {
		SkillsMatch     int
		ExperienceMatch int
		EducationMatch  int
	}
	Gaps           []string
	TailoredResume map[string]any
}

func parseAlignment(raw string) *alignment {
	var wire alignmentWire
	if err := json.Unmarshal([]byte(raw), &wire); err != nil {
		return nil
	}
	out := &alignment{
		Gaps:           wire.Gaps,
		TailoredResume: wire.TailoredResume,
	}
	if wire.MatchBreakdown != nil {
		out.MatchBreakdown = &struct {
			SkillsMatch     int
			ExperienceMatch int
			EducationMatch  int
		}{
			SkillsMatch:     wire.MatchBreakdown.SkillsMatch,
			ExperienceMatch: wire.MatchBreakdown.ExperienceMatch,
			EducationMatch:  wire.MatchBreakdown.EducationMatch,
		}
	}
	return out
}

// ── resume summariser (strips email/phone/full_name) ──────────────────────────

type resumeWire struct {
	Personal *struct {
		Summary string `json:"summary"`
	} `json:"personal"`
	Experience []struct {
		Company    string   `json:"company"`
		Title      string   `json:"title"`
		StartDate  string   `json:"start_date"`
		EndDate    string   `json:"end_date"`
		IsCurrent  bool     `json:"is_current"`
		Highlights []string `json:"highlights"`
	} `json:"experience"`
	Education []struct {
		School string `json:"school"`
		Degree string `json:"degree"`
		Field  string `json:"field"`
	} `json:"education"`
	Skills map[string]any `json:"skills"`
}

// summariseResume returns a short, human-readable paragraph describing the
// candidate's resume. PII (email, phone, full_name, addresses) is deliberately
// excluded — the model does not need identifying info to strategise.
func summariseResume(raw string) string {
	var wire resumeWire
	if err := json.Unmarshal([]byte(raw), &wire); err != nil {
		return ""
	}

	var b strings.Builder

	if wire.Personal != nil && strings.TrimSpace(wire.Personal.Summary) != "" {
		b.WriteString("Candidate summary: ")
		b.WriteString(strings.TrimSpace(wire.Personal.Summary))
		b.WriteString("\n\n")
	}

	if len(wire.Experience) > 0 {
		b.WriteString("Experience:\n")
		for i, exp := range wire.Experience {
			if i >= 6 {
				break
			}
			endDate := exp.EndDate
			if exp.IsCurrent {
				endDate = "present"
			}
			fmt.Fprintf(&b, "- %s at %s (%s – %s)\n",
				safeField(exp.Title), safeField(exp.Company),
				safeField(exp.StartDate), safeField(endDate))
			for j, h := range exp.Highlights {
				if j >= 3 {
					break
				}
				h = strings.TrimSpace(h)
				if h == "" {
					continue
				}
				fmt.Fprintf(&b, "  • %s\n", h)
			}
		}
		b.WriteString("\n")
	}

	if len(wire.Education) > 0 {
		b.WriteString("Education:\n")
		for i, ed := range wire.Education {
			if i >= 3 {
				break
			}
			fmt.Fprintf(&b, "- %s in %s, %s\n",
				safeField(ed.Degree), safeField(ed.Field), safeField(ed.School))
		}
		b.WriteString("\n")
	}

	if len(wire.Skills) > 0 {
		b.WriteString("Skills: ")
		parts := []string{}
		for k, v := range wire.Skills {
			if arr, ok := v.([]any); ok && len(arr) > 0 {
				flat := []string{}
				for _, it := range arr {
					if str, ok := it.(string); ok {
						flat = append(flat, str)
					}
				}
				if len(flat) > 0 {
					parts = append(parts, fmt.Sprintf("%s (%s)", k, strings.Join(flat, ", ")))
				}
			}
		}
		b.WriteString(strings.Join(parts, "; "))
	}

	return strings.TrimSpace(b.String())
}

// summariseTailored describes the tailored resume in natural language rather
// than dumping the full JSON tree.
func summariseTailored(tr map[string]any) string {
	if len(tr) == 0 {
		return ""
	}

	var b strings.Builder
	if summary, ok := tr["summary"].(string); ok && strings.TrimSpace(summary) != "" {
		b.WriteString("Tailored summary: ")
		b.WriteString(strings.TrimSpace(summary))
		b.WriteString("\n")
	}
	if exp, ok := tr["experience"].([]any); ok {
		fmt.Fprintf(&b, "Experience entries emphasised: %d\n", len(exp))
	}
	if skills, ok := tr["skills"].(map[string]any); ok {
		parts := []string{}
		for k := range skills {
			parts = append(parts, k)
		}
		if len(parts) > 0 {
			fmt.Fprintf(&b, "Skill categories highlighted: %s\n", strings.Join(parts, ", "))
		}
	}
	return strings.TrimSpace(b.String())
}

// ── tiny helpers ──────────────────────────────────────────────────────────────

func remoteLabel(isRemote bool) string {
	if isRemote {
		return "Remote"
	}
	return "On-site / Hybrid"
}

func humanise(s string) string {
	s = strings.ReplaceAll(s, "_", " ")
	s = strings.TrimSpace(s)
	return s
}

func safeField(s string) string {
	s = strings.TrimSpace(s)
	if s == "" {
		return "—"
	}
	return s
}

func formatSalary(s *salary) string {
	if s == nil {
		return "Not specified"
	}
	cur := s.Currency
	if cur == "" {
		cur = "USD"
	}
	period := s.Period
	switch strings.ToLower(period) {
	case "", "annual", "yearly":
		period = "yr"
	case "hourly":
		period = "hr"
	case "monthly":
		period = "mo"
	}
	switch {
	case s.Min != nil && s.Max != nil:
		return fmt.Sprintf("%s%s – %s%s /%s", cur, formatNum(*s.Min), cur, formatNum(*s.Max), period)
	case s.Min != nil:
		return fmt.Sprintf("from %s%s /%s", cur, formatNum(*s.Min), period)
	case s.Max != nil:
		return fmt.Sprintf("up to %s%s /%s", cur, formatNum(*s.Max), period)
	}
	return "Not specified"
}

func formatNum(n int) string {
	// Simple thousands separator.
	s := fmt.Sprintf("%d", n)
	if len(s) <= 3 {
		return s
	}
	var b strings.Builder
	rem := len(s) % 3
	if rem > 0 {
		b.WriteString(s[:rem])
		if len(s) > rem {
			b.WriteString(",")
		}
	}
	for i := rem; i < len(s); i += 3 {
		b.WriteString(s[i : i+3])
		if i+3 < len(s) {
			b.WriteString(",")
		}
	}
	return b.String()
}

func capList(items []string, max int) []string {
	if len(items) <= max {
		return items
	}
	return items[:max]
}
