package agent

import (
	"encoding/json"
	"fmt"
	"strings"
)

// resumeDoc mirrors the resume extraction / tailored resume JSON. Nulls
// decode to zero values.
type resumeDoc struct {
	Personal struct {
		FullName  string `json:"full_name"`
		Email     string `json:"email"`
		Phone     string `json:"phone"`
		LinkedIn  string `json:"linkedin"`
		GitHub    string `json:"github"`
		Portfolio string `json:"portfolio"`
		Summary   string `json:"summary"`
	} `json:"personal"`
	Summary    string `json:"summary"` // tailored resumes keep the summary top-level
	Experience []struct {
		Company    string   `json:"company"`
		Title      string   `json:"title"`
		Location   string   `json:"location"`
		StartDate  string   `json:"start_date"`
		EndDate    string   `json:"end_date"`
		IsCurrent  bool     `json:"is_current"`
		Highlights []string `json:"highlights"`
	} `json:"experience"`
	Education []struct {
		Institution string `json:"institution"`
		Degree      string `json:"degree"`
		Field       string `json:"field"`
		EndDate     string `json:"end_date"`
	} `json:"education"`
	Skills struct {
		Technical []string `json:"technical"`
		Soft      []string `json:"soft"`
		Languages []string `json:"languages"`
		Tools     []string `json:"tools"`
	} `json:"skills"`
	Certifications []struct {
		Name   string `json:"name"`
		Issuer string `json:"issuer"`
		Date   string `json:"date"`
	} `json:"certifications"`
	Projects []struct {
		Name         string   `json:"name"`
		Description  string   `json:"description"`
		Technologies []string `json:"technologies"`
		URL          string   `json:"url"`
	} `json:"projects"`
	Meta struct {
		TotalYearsExperience float64  `json:"total_years_experience"`
		SeniorityLevel       string   `json:"seniority_level"`
		PrimaryRole          string   `json:"primary_role"`
		Industries           []string `json:"industries"`
	} `json:"meta"`
}

func parseResume(raw *string) *resumeDoc {
	if raw == nil || *raw == "" {
		return nil
	}
	var d resumeDoc
	if err := json.Unmarshal([]byte(*raw), &d); err != nil {
		return nil
	}
	return &d
}

// parseTailored extracts tailored_resume from an alignment result JSON.
func parseTailored(alignmentJSON string) *resumeDoc {
	if alignmentJSON == "" {
		return nil
	}
	var wrapper struct {
		TailoredResume json.RawMessage `json:"tailored_resume"`
	}
	if err := json.Unmarshal([]byte(alignmentJSON), &wrapper); err != nil || len(wrapper.TailoredResume) == 0 {
		return nil
	}
	s := string(wrapper.TailoredResume)
	return parseResume(&s)
}

func (d *resumeDoc) summary() string {
	if d == nil {
		return ""
	}
	if d.Summary != "" {
		return d.Summary
	}
	return d.Personal.Summary
}

// candidateBrief renders what the scoring and search prompts need to know
// about the candidate: no contact details.
func candidateBrief(d *resumeDoc, ap ApplicationProfile) string {
	var sb strings.Builder
	if d != nil {
		if d.Meta.PrimaryRole != "" {
			fmt.Fprintf(&sb, "Primary role: %s\n", d.Meta.PrimaryRole)
		}
		if d.Meta.SeniorityLevel != "" {
			fmt.Fprintf(&sb, "Seniority: %s\n", d.Meta.SeniorityLevel)
		}
		years := d.Meta.TotalYearsExperience
		if ap.YearsOfExperience != nil {
			years = float64(*ap.YearsOfExperience)
		}
		if years > 0 {
			fmt.Fprintf(&sb, "Total experience: %.1f years\n", years)
		}
		if len(d.Meta.Industries) > 0 {
			fmt.Fprintf(&sb, "Industries: %s\n", strings.Join(d.Meta.Industries, ", "))
		}
		if s := d.summary(); s != "" {
			fmt.Fprintf(&sb, "Summary: %s\n", s)
		}
		if len(d.Experience) > 0 {
			sb.WriteString("Experience:\n")
			for i, e := range d.Experience {
				if i >= 6 {
					break
				}
				end := e.EndDate
				if e.IsCurrent || end == "" {
					end = "present"
				}
				fmt.Fprintf(&sb, "- %s at %s (%s to %s)", e.Title, e.Company, orDash(e.StartDate), end)
				for j, h := range e.Highlights {
					if j >= 2 {
						break
					}
					fmt.Fprintf(&sb, "; %s", h)
				}
				sb.WriteString("\n")
			}
		}
		if skills := append(append([]string{}, d.Skills.Technical...), d.Skills.Tools...); len(skills) > 0 {
			fmt.Fprintf(&sb, "Skills: %s\n", strings.Join(capList(skills, 40), ", "))
		}
		if len(d.Skills.Languages) > 0 {
			fmt.Fprintf(&sb, "Spoken languages: %s\n", strings.Join(d.Skills.Languages, ", "))
		}
		for i, e := range d.Education {
			if i >= 3 {
				break
			}
			fmt.Fprintf(&sb, "Education: %s %s, %s\n", e.Degree, e.Field, e.Institution)
		}
		for i, c := range d.Certifications {
			if i >= 5 {
				break
			}
			fmt.Fprintf(&sb, "Certification: %s (%s)\n", c.Name, c.Issuer)
		}
	}
	writeEligibility(&sb, ap)
	return strings.TrimSpace(sb.String())
}

func writeEligibility(sb *strings.Builder, ap ApplicationProfile) {
	if ap.Location != "" {
		fmt.Fprintf(sb, "Based in: %s\n", ap.Location)
	}
	if ap.Country != "" && !strings.Contains(strings.ToLower(ap.Location), strings.ToLower(ap.Country)) {
		fmt.Fprintf(sb, "Country: %s\n", ap.Country)
	}
	if ap.WorkAuthorization != "" {
		fmt.Fprintf(sb, "Work authorization: %s\n", ap.WorkAuthorization)
	}
	if ap.RequiresSponsorship != nil {
		fmt.Fprintf(sb, "Requires visa sponsorship: %s\n", yesNo(*ap.RequiresSponsorship))
	}
	if ap.WillingToRelocate != nil {
		fmt.Fprintf(sb, "Willing to relocate: %s\n", yesNo(*ap.WillingToRelocate))
	}
}

// preferencesBrief renders search preferences for the prompts.
func preferencesBrief(sp SearchPrefs) string {
	var sb strings.Builder
	list := func(label string, v []string) {
		if len(v) > 0 {
			fmt.Fprintf(&sb, "%s: %s\n", label, strings.Join(v, ", "))
		}
	}
	list("Target titles", sp.Titles)
	list("Key skills / keywords", sp.Keywords)
	list("Seniority", sp.Seniority)
	list("Employment types", sp.EmploymentTypes)
	if sp.RemoteOnly {
		sb.WriteString("Work arrangement: remote only\n")
	} else if len(sp.Locations) > 0 {
		fmt.Fprintf(&sb, "Acceptable locations (or remote): %s\n", strings.Join(sp.Locations, ", "))
	} else {
		sb.WriteString("Work arrangement: remote or anywhere the candidate is eligible\n")
	}
	if sp.MinSalary != nil && *sp.MinSalary > 0 {
		cur := sp.SalaryCurrency
		if cur == "" {
			cur = "USD"
		}
		fmt.Fprintf(&sb, "Minimum salary: %d %s per year\n", *sp.MinSalary, cur)
	}
	list("Excluded keywords", sp.ExcludeKeywords)
	list("Excluded companies", sp.ExcludeCompanies)
	return strings.TrimSpace(sb.String())
}

// resumeForApplication renders the (tailored) resume for cover letters and
// form filling. Contact details are omitted: the application profile is the
// single source for those.
func resumeForApplication(d *resumeDoc) string {
	if d == nil {
		return "(resume unavailable)"
	}
	var sb strings.Builder
	if s := d.summary(); s != "" {
		fmt.Fprintf(&sb, "Summary: %s\n\n", s)
	}
	if len(d.Experience) > 0 {
		sb.WriteString("Experience:\n")
		for _, e := range d.Experience {
			end := e.EndDate
			if e.IsCurrent || end == "" {
				end = "Present"
			}
			fmt.Fprintf(&sb, "%s - %s", e.Title, e.Company)
			if e.Location != "" {
				fmt.Fprintf(&sb, " (%s)", e.Location)
			}
			fmt.Fprintf(&sb, ", %s to %s\n", orDash(e.StartDate), end)
			for _, h := range e.Highlights {
				fmt.Fprintf(&sb, "  - %s\n", h)
			}
		}
		sb.WriteString("\n")
	}
	if len(d.Education) > 0 {
		sb.WriteString("Education:\n")
		for _, e := range d.Education {
			fmt.Fprintf(&sb, "- %s %s, %s %s\n", e.Degree, e.Field, e.Institution, e.EndDate)
		}
		sb.WriteString("\n")
	}
	if skills := append(append([]string{}, d.Skills.Technical...), d.Skills.Tools...); len(skills) > 0 {
		fmt.Fprintf(&sb, "Skills: %s\n", strings.Join(skills, ", "))
	}
	if len(d.Skills.Languages) > 0 {
		fmt.Fprintf(&sb, "Languages: %s\n", strings.Join(d.Skills.Languages, ", "))
	}
	if len(d.Certifications) > 0 {
		sb.WriteString("Certifications:\n")
		for _, c := range d.Certifications {
			fmt.Fprintf(&sb, "- %s, %s %s\n", c.Name, c.Issuer, c.Date)
		}
	}
	if len(d.Projects) > 0 {
		sb.WriteString("Projects:\n")
		for _, p := range d.Projects {
			fmt.Fprintf(&sb, "- %s: %s", p.Name, p.Description)
			if p.URL != "" {
				fmt.Fprintf(&sb, " (%s)", p.URL)
			}
			sb.WriteString("\n")
		}
	}
	return strings.TrimSpace(sb.String())
}

// identity is how the agent introduces the candidate on applications.
type identity struct {
	FullName  string `json:"full_name"`
	FirstName string `json:"first_name"`
	LastName  string `json:"last_name"`
	Email     string `json:"email"`
	Phone     string `json:"phone"`
	Location  string `json:"location"`
	LinkedIn  string `json:"linkedin"`
	GitHub    string `json:"github"`
	Portfolio string `json:"portfolio"`
	Website   string `json:"website"`
}

func buildIdentity(p *Profile, user *UserBasics, d *resumeDoc) identity {
	ap := p.ApplicationProfile
	id := identity{
		FullName:  firstNonEmpty(ap.FullName, user.FullName),
		Email:     user.Email,
		Phone:     ap.Phone,
		Location:  ap.Location,
		LinkedIn:  ap.LinkedIn,
		GitHub:    ap.GitHub,
		Portfolio: ap.Portfolio,
		Website:   ap.Website,
	}
	if p.MailboxAddress != nil && *p.MailboxAddress != "" {
		id.Email = *p.MailboxAddress
	}
	if d != nil {
		id.Phone = firstNonEmpty(id.Phone, d.Personal.Phone)
		id.LinkedIn = firstNonEmpty(id.LinkedIn, d.Personal.LinkedIn)
		id.GitHub = firstNonEmpty(id.GitHub, d.Personal.GitHub)
		id.Portfolio = firstNonEmpty(id.Portfolio, d.Personal.Portfolio)
	}
	parts := strings.Fields(id.FullName)
	if len(parts) > 0 {
		id.FirstName = parts[0]
		if len(parts) > 1 {
			id.LastName = strings.Join(parts[1:], " ")
		}
	}
	return id
}

// profileBrief renders the application profile for the fill prompt.
func profileBrief(id identity, ap ApplicationProfile) string {
	var sb strings.Builder
	line := func(label, v string) {
		if strings.TrimSpace(v) != "" {
			fmt.Fprintf(&sb, "%s: %s\n", label, v)
		}
	}
	line("Full name", id.FullName)
	line("First name", id.FirstName)
	line("Last name", id.LastName)
	line("Email", id.Email)
	line("Phone", id.Phone)
	line("Location", id.Location)
	line("Country", ap.Country)
	line("LinkedIn", id.LinkedIn)
	line("GitHub", id.GitHub)
	line("Portfolio", id.Portfolio)
	line("Website", id.Website)
	line("Pronouns", ap.Pronouns)
	line("Work authorization", ap.WorkAuthorization)
	if ap.RequiresSponsorship != nil {
		line("Requires visa sponsorship", yesNo(*ap.RequiresSponsorship))
	}
	if ap.WillingToRelocate != nil {
		line("Willing to relocate", yesNo(*ap.WillingToRelocate))
	}
	line("Notice period", ap.NoticePeriod)
	line("Earliest start date", ap.EarliestStartDate)
	line("Salary expectation", ap.SalaryExpectation)
	if ap.YearsOfExperience != nil {
		line("Years of experience", fmt.Sprintf("%d", *ap.YearsOfExperience))
	}
	line("How did you hear about us", ap.HowDidYouHear)
	eeo := func(label, v string) {
		if v == "" {
			v = "decline to self-identify"
		}
		line("Self-identification - "+label, v)
	}
	eeo("gender", ap.EEO.Gender)
	eeo("race/ethnicity", ap.EEO.Race)
	eeo("veteran status", ap.EEO.Veteran)
	eeo("disability", ap.EEO.Disability)
	eeo("sexual orientation", ap.EEO.SexualOrientation)
	line("Additional information", ap.AdditionalInfo)
	return strings.TrimSpace(sb.String())
}

func answersBrief(answers []Answer) string {
	var sb strings.Builder
	for i, a := range answers {
		if i >= 60 {
			break
		}
		fmt.Fprintf(&sb, "Q: %s\nA: %s\n", a.Question, a.Answer)
	}
	return strings.TrimSpace(sb.String())
}

func yesNo(b bool) string {
	if b {
		return "Yes"
	}
	return "No"
}

func orDash(s string) string {
	if s == "" {
		return "?"
	}
	return s
}

func capList(v []string, n int) []string {
	if len(v) > n {
		return v[:n]
	}
	return v
}

func firstNonEmpty(vals ...string) string {
	for _, v := range vals {
		if strings.TrimSpace(v) != "" {
			return strings.TrimSpace(v)
		}
	}
	return ""
}
