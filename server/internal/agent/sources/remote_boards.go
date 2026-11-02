package sources

import (
	"context"
	"fmt"
	"net/url"
	"strconv"
	"strings"
	"time"
)

// keywordSource runs one request per search term against a keyword-search
// API (or one request for a feed) and filters results by title.
type keywordSource struct {
	id, label string
	f         *Fetcher
	// terms is how many distinct search terms to query (0 = one feed fetch).
	terms  int
	search func(ctx context.Context, f *Fetcher, term string) ([]Posting, error)
}

func (s *keywordSource) ID() string    { return s.id }
func (s *keywordSource) Label() string { return s.label }

func (s *keywordSource) Search(ctx context.Context, q Query) ([]Posting, error) {
	terms := []string{""}
	if s.terms > 0 {
		terms = q.SearchTerms(s.terms)
		if len(terms) == 0 {
			return nil, nil
		}
	}

	seen := map[string]bool{}
	var (
		out     []Posting
		lastErr error
	)
	for _, term := range terms {
		postings, err := s.search(ctx, s.f, term)
		if err != nil {
			lastErr = err
			continue
		}
		for _, p := range postings {
			if seen[p.ExternalID] {
				continue
			}
			if q.RemoteOnly && !p.IsRemote {
				continue
			}
			// Keyword APIs match on description too; keep postings whose
			// title is on target, plus feed results that mention a keyword.
			if !q.TitleMatches(p.Title) && !(term == "" && mentionsAny(p, q.Keywords)) {
				continue
			}
			seen[p.ExternalID] = true
			out = append(out, p)
			if len(out) >= q.limit() {
				return out, nil
			}
		}
	}
	if len(out) == 0 && lastErr != nil {
		return nil, lastErr
	}
	return out, nil
}

func mentionsAny(p Posting, keywords []string) bool {
	if len(keywords) == 0 {
		return false
	}
	hay := strings.ToLower(p.Title + " " + strings.Join(p.Tags, " "))
	for _, k := range keywords {
		if k = strings.ToLower(strings.TrimSpace(k)); k != "" && strings.Contains(hay, k) {
			return true
		}
	}
	return false
}

// ── Remotive ──────────────────────────────────────────────────────────────────

// NewRemotive returns the Remotive source. Remotive asks for at most a few
// requests a day; the fetcher cache enforces that across users.
func NewRemotive(f *Fetcher) Source {
	return &keywordSource{id: Remotive, label: "Remotive", f: f, terms: 3, search: searchRemotive}
}

func searchRemotive(ctx context.Context, f *Fetcher, term string) ([]Posting, error) {
	u := "https://remotive.com/api/remote-jobs?limit=100&search=" + url.QueryEscape(term)
	return cached(f, "remotive:"+strings.ToLower(term), func() ([]Posting, error) {
		var body struct {
			Jobs []struct {
				ID                        int64    `json:"id"`
				URL                       string   `json:"url"`
				Title                     string   `json:"title"`
				CompanyName               string   `json:"company_name"`
				JobType                   string   `json:"job_type"`
				PublicationDate           string   `json:"publication_date"`
				CandidateRequiredLocation string   `json:"candidate_required_location"`
				Salary                    string   `json:"salary"`
				Description               string   `json:"description"`
				Tags                      []string `json:"tags"`
			} `json:"jobs"`
		}
		if err := f.getJSON(ctx, u, &body); err != nil {
			return nil, err
		}
		out := make([]Posting, 0, len(body.Jobs))
		for _, j := range body.Jobs {
			loc := j.CandidateRequiredLocation
			if loc == "" {
				loc = "Remote"
			}
			out = append(out, Posting{
				Source:         Remotive,
				SourceLabel:    "Remotive",
				ExternalID:     strconv.FormatInt(j.ID, 10),
				Title:          CleanText(j.Title),
				Company:        CleanText(j.CompanyName),
				Location:       "Remote - " + loc,
				IsRemote:       true,
				EmploymentType: NormalizeEmploymentType(j.JobType),
				SalaryText:     j.Salary,
				URL:            j.URL,
				ApplyURL:       j.URL,
				Description:    HTMLToText(j.Description),
				Tags:           j.Tags,
				PostedAt:       parseTime(j.PublicationDate),
			})
		}
		return out, nil
	})
}

// ── Remote OK ─────────────────────────────────────────────────────────────────

// NewRemoteOK returns the Remote OK source (one feed request, filtered
// locally).
func NewRemoteOK(f *Fetcher) Source {
	return &keywordSource{id: RemoteOK, label: "Remote OK", f: f, terms: 0, search: searchRemoteOK}
}

func searchRemoteOK(ctx context.Context, f *Fetcher, _ string) ([]Posting, error) {
	return cached(f, "remoteok:feed", func() ([]Posting, error) {
		// The first element is a legal notice; the rest are jobs.
		var body []struct {
			ID          string   `json:"id"`
			Epoch       int64    `json:"epoch"`
			Company     string   `json:"company"`
			Position    string   `json:"position"`
			Tags        []string `json:"tags"`
			Description string   `json:"description"`
			Location    string   `json:"location"`
			ApplyURL    string   `json:"apply_url"`
			URL         string   `json:"url"`
			SalaryMin   int      `json:"salary_min"`
			SalaryMax   int      `json:"salary_max"`
		}
		if err := f.getJSON(ctx, "https://remoteok.com/api", &body); err != nil {
			return nil, err
		}
		out := make([]Posting, 0, len(body))
		for _, j := range body {
			if j.ID == "" || j.Position == "" {
				continue
			}
			loc := strings.TrimSpace(j.Location)
			if loc == "" {
				loc = "Remote"
			} else if !LooksRemote(loc) {
				loc = "Remote - " + loc
			}
			p := Posting{
				Source:      RemoteOK,
				SourceLabel: "Remote OK",
				ExternalID:  j.ID,
				Title:       CleanText(j.Position),
				Company:     CleanText(j.Company),
				Location:    loc,
				IsRemote:    true,
				SalaryMin:   intPtr(j.SalaryMin),
				SalaryMax:   intPtr(j.SalaryMax),
				URL:         j.URL,
				ApplyURL:    firstNonEmpty(j.ApplyURL, j.URL),
				Description: HTMLToText(j.Description),
				Tags:        j.Tags,
			}
			if p.SalaryMin != nil || p.SalaryMax != nil {
				p.SalaryCurrency = "USD"
			}
			if j.Epoch > 0 {
				p.PostedAt = timePtr(time.Unix(j.Epoch, 0))
			}
			out = append(out, p)
		}
		return out, nil
	})
}

// ── Himalayas ─────────────────────────────────────────────────────────────────

// NewHimalayas returns the Himalayas source (search endpoint, 20 per page).
func NewHimalayas(f *Fetcher) Source {
	return &keywordSource{id: Himalayas, label: "Himalayas", f: f, terms: 3, search: searchHimalayas}
}

func searchHimalayas(ctx context.Context, f *Fetcher, term string) ([]Posting, error) {
	return cached(f, "himalayas:"+strings.ToLower(term), func() ([]Posting, error) {
		var out []Posting
		for page := 1; page <= 2; page++ {
			var body struct {
				Jobs []struct {
					GUID                 string   `json:"guid"`
					Title                string   `json:"title"`
					CompanyName          string   `json:"companyName"`
					EmploymentType       string   `json:"employmentType"`
					MinSalary            int      `json:"minSalary"`
					MaxSalary            int      `json:"maxSalary"`
					SalaryPeriod         string   `json:"salaryPeriod"`
					Currency             string   `json:"currency"`
					Seniority            []string `json:"seniority"`
					LocationRestrictions []string `json:"locationRestrictions"`
					Description          string   `json:"description"`
					PubDate              int64    `json:"pubDate"`
					ApplicationLink      string   `json:"applicationLink"`
					Categories           []string `json:"categories"`
				} `json:"jobs"`
			}
			u := fmt.Sprintf("https://himalayas.app/jobs/api/search?q=%s&page=%d", url.QueryEscape(term), page)
			if err := f.getJSON(ctx, u, &body); err != nil {
				if page == 1 {
					return nil, err
				}
				break
			}
			for _, j := range body.Jobs {
				loc := "Remote"
				if len(j.LocationRestrictions) > 0 {
					loc = "Remote - " + strings.Join(j.LocationRestrictions, ", ")
				}
				p := Posting{
					Source:         Himalayas,
					SourceLabel:    "Himalayas",
					ExternalID:     j.GUID,
					Title:          CleanText(j.Title),
					Company:        CleanText(j.CompanyName),
					Location:       loc,
					IsRemote:       true,
					EmploymentType: NormalizeEmploymentType(j.EmploymentType),
					URL:            j.GUID,
					ApplyURL:       firstNonEmpty(j.ApplicationLink, j.GUID),
					Description:    HTMLToText(j.Description),
					Tags:           append(append([]string{}, j.Categories...), j.Seniority...),
				}
				if strings.EqualFold(j.SalaryPeriod, "annual") {
					p.SalaryMin, p.SalaryMax, p.SalaryCurrency = intPtr(j.MinSalary), intPtr(j.MaxSalary), j.Currency
				}
				if j.PubDate > 0 {
					p.PostedAt = timePtr(time.Unix(j.PubDate, 0))
				}
				out = append(out, p)
			}
			if len(body.Jobs) < 20 {
				break
			}
		}
		return out, nil
	})
}

// ── Jobicy ────────────────────────────────────────────────────────────────────

// NewJobicy returns the Jobicy source (tag search).
func NewJobicy(f *Fetcher) Source {
	return &keywordSource{id: Jobicy, label: "Jobicy", f: f, terms: 3, search: searchJobicy}
}

func searchJobicy(ctx context.Context, f *Fetcher, term string) ([]Posting, error) {
	// Jobicy tags are single words; use the most specific word of the term.
	tag := jobicyTag(term)
	if tag == "" {
		return nil, nil
	}
	return cached(f, "jobicy:"+tag, func() ([]Posting, error) {
		var body struct {
			Jobs []struct {
				ID             int64    `json:"id"`
				URL            string   `json:"url"`
				JobTitle       string   `json:"jobTitle"`
				CompanyName    string   `json:"companyName"`
				JobType        []string `json:"jobType"`
				JobGeo         string   `json:"jobGeo"`
				JobLevel       string   `json:"jobLevel"`
				JobDescription string   `json:"jobDescription"`
				PubDate        string   `json:"pubDate"`
				SalaryMin      float64  `json:"salaryMin"`
				SalaryMax      float64  `json:"salaryMax"`
				SalaryCurrency string   `json:"salaryCurrency"`
				SalaryPeriod   string   `json:"salaryPeriod"`
			} `json:"jobs"`
		}
		if err := f.getJSON(ctx, "https://jobicy.com/api/v2/remote-jobs?count=50&tag="+url.QueryEscape(tag), &body); err != nil {
			return nil, err
		}
		out := make([]Posting, 0, len(body.Jobs))
		for _, j := range body.Jobs {
			loc := "Remote"
			if g := strings.TrimSpace(j.JobGeo); g != "" && !strings.EqualFold(g, "anywhere") {
				loc = "Remote - " + g
			}
			p := Posting{
				Source:         Jobicy,
				SourceLabel:    "Jobicy",
				ExternalID:     strconv.FormatInt(j.ID, 10),
				Title:          CleanText(j.JobTitle),
				Company:        CleanText(j.CompanyName),
				Location:       loc,
				IsRemote:       true,
				EmploymentType: NormalizeEmploymentType(strings.Join(j.JobType, " ")),
				URL:            j.URL,
				ApplyURL:       j.URL,
				Description:    HTMLToText(j.JobDescription),
				PostedAt:       parseTime(j.PubDate),
			}
			if strings.EqualFold(j.SalaryPeriod, "yearly") || strings.EqualFold(j.SalaryPeriod, "annual") {
				p.SalaryMin, p.SalaryMax, p.SalaryCurrency = intPtr(int(j.SalaryMin)), intPtr(int(j.SalaryMax)), j.SalaryCurrency
			}
			out = append(out, p)
		}
		return out, nil
	})
}

func jobicyTag(term string) string {
	toks := Tokens(term)
	generic := map[string]bool{"engineer": true, "developer": true, "manager": true, "specialist": true}
	for _, t := range toks {
		if !generic[t] {
			return t
		}
	}
	if len(toks) > 0 {
		return toks[0]
	}
	return ""
}

// ── Arbeitnow ─────────────────────────────────────────────────────────────────

// NewArbeitnow returns the Arbeitnow source (one feed page, mostly European
// roles, filtered locally).
func NewArbeitnow(f *Fetcher) Source {
	return &keywordSource{id: Arbeitnow, label: "Arbeitnow", f: f, terms: 0, search: searchArbeitnow}
}

func searchArbeitnow(ctx context.Context, f *Fetcher, _ string) ([]Posting, error) {
	return cached(f, "arbeitnow:feed", func() ([]Posting, error) {
		var body struct {
			Data []struct {
				Slug        string   `json:"slug"`
				CompanyName string   `json:"company_name"`
				Title       string   `json:"title"`
				Description string   `json:"description"`
				Remote      bool     `json:"remote"`
				URL         string   `json:"url"`
				Tags        []string `json:"tags"`
				JobTypes    []string `json:"job_types"`
				Location    string   `json:"location"`
				CreatedAt   int64    `json:"created_at"`
			} `json:"data"`
		}
		if err := f.getJSON(ctx, "https://www.arbeitnow.com/api/job-board-api", &body); err != nil {
			return nil, err
		}
		out := make([]Posting, 0, len(body.Data))
		for _, j := range body.Data {
			p := Posting{
				Source:         Arbeitnow,
				SourceLabel:    "Arbeitnow",
				ExternalID:     j.Slug,
				Title:          CleanText(j.Title),
				Company:        CleanText(j.CompanyName),
				Location:       j.Location,
				IsRemote:       j.Remote || LooksRemote(j.Location),
				EmploymentType: NormalizeEmploymentType(strings.Join(j.JobTypes, " ")),
				URL:            j.URL,
				ApplyURL:       j.URL,
				Description:    HTMLToText(j.Description),
				Tags:           j.Tags,
			}
			if j.CreatedAt > 0 {
				p.PostedAt = timePtr(time.Unix(j.CreatedAt, 0))
			}
			out = append(out, p)
		}
		return out, nil
	})
}
