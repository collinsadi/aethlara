package sources

import (
	"context"
	"fmt"
	"net/url"
	"strconv"
	"strings"
	"sync"
	"time"
)

// maxDetailFetchesPerBoard caps per-job detail requests on Greenhouse,
// whose list endpoint has no descriptions.
const maxDetailFetchesPerBoard = 10

// boardSource fetches a watchlist of company boards on one ATS.
type boardSource struct {
	id, label string
	fetch     func(ctx context.Context, f *Fetcher, ref CompanyRef, q Query) ([]Posting, error)
	f         *Fetcher
}

func (s *boardSource) ID() string    { return s.id }
func (s *boardSource) Label() string { return s.label }

func (s *boardSource) Search(ctx context.Context, q Query) ([]Posting, error) {
	var refs []CompanyRef
	for _, c := range q.Companies {
		if c.ATS == s.id && strings.TrimSpace(c.Slug) != "" {
			refs = append(refs, c)
		}
	}
	if len(refs) == 0 {
		return nil, nil
	}

	type result struct {
		postings []Posting
		err      error
	}
	results := make([]result, len(refs))
	sem := make(chan struct{}, 4)
	var wg sync.WaitGroup
	for i, ref := range refs {
		wg.Add(1)
		go func(i int, ref CompanyRef) {
			defer wg.Done()
			sem <- struct{}{}
			defer func() { <-sem }()
			p, err := s.fetch(ctx, s.f, ref, q)
			results[i] = result{p, err}
		}(i, ref)
	}
	wg.Wait()

	var (
		out  []Posting
		errs []string
	)
	for i, r := range results {
		if r.err != nil {
			errs = append(errs, refs[i].Slug+": "+r.err.Error())
			continue
		}
		out = append(out, r.postings...)
	}
	if len(out) == 0 && len(errs) > 0 {
		return nil, fmt.Errorf("%s: %s", s.id, strings.Join(errs, "; "))
	}
	if len(out) > q.limit() {
		out = out[:q.limit()]
	}
	return out, nil
}

// NewGreenhouse returns the Greenhouse job-board source.
func NewGreenhouse(f *Fetcher) Source {
	return &boardSource{id: Greenhouse, label: "Greenhouse", f: f, fetch: fetchGreenhouse}
}

// NewLever returns the Lever postings source.
func NewLever(f *Fetcher) Source {
	return &boardSource{id: Lever, label: "Lever", f: f, fetch: fetchLever}
}

// NewAshby returns the Ashby job-board source.
func NewAshby(f *Fetcher) Source {
	return &boardSource{id: Ashby, label: "Ashby", f: f, fetch: fetchAshby}
}

// ── Greenhouse ────────────────────────────────────────────────────────────────

type ghJob struct {
	ID             int64  `json:"id"`
	Title          string `json:"title"`
	AbsoluteURL    string `json:"absolute_url"`
	CompanyName    string `json:"company_name"`
	FirstPublished string `json:"first_published"`
	UpdatedAt      string `json:"updated_at"`
	Content        string `json:"content"`
	Location       struct {
		Name string `json:"name"`
	} `json:"location"`
}

func fetchGreenhouse(ctx context.Context, f *Fetcher, ref CompanyRef, q Query) ([]Posting, error) {
	slug := url.PathEscape(strings.ToLower(ref.Slug))
	jobs, err := cached(f, "gh:list:"+slug, func() ([]ghJob, error) {
		var body struct {
			Jobs []ghJob `json:"jobs"`
		}
		err := f.getJSON(ctx, "https://boards-api.greenhouse.io/v1/boards/"+slug+"/jobs", &body)
		return body.Jobs, err
	})
	if err != nil {
		return nil, err
	}

	var matched []ghJob
	for _, j := range jobs {
		if q.TitleMatches(j.Title) {
			matched = append(matched, j)
		}
	}
	if len(matched) > maxDetailFetchesPerBoard {
		matched = matched[:maxDetailFetchesPerBoard]
	}

	out := make([]Posting, 0, len(matched))
	for _, j := range matched {
		id := strconv.FormatInt(j.ID, 10)
		detail, err := cached(f, "gh:job:"+slug+":"+id, func() (ghJob, error) {
			var d ghJob
			err := f.getJSON(ctx, "https://boards-api.greenhouse.io/v1/boards/"+slug+"/jobs/"+id, &d)
			return d, err
		})
		if err != nil {
			detail = j // keep the listing even without a description
		}
		company := firstNonEmpty(detail.CompanyName, j.CompanyName, ref.Name, ref.Slug)
		posted := parseTime(firstNonEmpty(j.FirstPublished, j.UpdatedAt))
		out = append(out, Posting{
			Source:      Greenhouse,
			SourceLabel: company + " (Greenhouse)",
			ExternalID:  slug + ":" + id,
			Title:       CleanText(j.Title),
			Company:     company,
			Location:    j.Location.Name,
			IsRemote:    LooksRemote(j.Location.Name),
			URL:         j.AbsoluteURL,
			ApplyURL:    GreenhouseEmbedURL(slug, id),
			ATS:         ATSGreenhouse,
			Description: HTMLToText(detail.Content),
			PostedAt:    posted,
		})
	}
	return out, nil
}

// ── Lever ─────────────────────────────────────────────────────────────────────

type leverPosting struct {
	ID               string `json:"id"`
	Text             string `json:"text"`
	HostedURL        string `json:"hostedUrl"`
	ApplyURL         string `json:"applyUrl"`
	CreatedAt        int64  `json:"createdAt"`
	WorkplaceType    string `json:"workplaceType"`
	DescriptionPlain string `json:"descriptionPlain"`
	AdditionalPlain  string `json:"additionalPlain"`
	Categories       struct {
		Commitment string `json:"commitment"`
		Location   string `json:"location"`
		Team       string `json:"team"`
	} `json:"categories"`
	Lists []struct {
		Text    string `json:"text"`
		Content string `json:"content"`
	} `json:"lists"`
	SalaryRange *struct {
		Min      int    `json:"min"`
		Max      int    `json:"max"`
		Currency string `json:"currency"`
		Interval string `json:"interval"`
	} `json:"salaryRange"`
}

func fetchLever(ctx context.Context, f *Fetcher, ref CompanyRef, q Query) ([]Posting, error) {
	slug := url.PathEscape(strings.ToLower(ref.Slug))
	postings, err := cached(f, "lever:"+slug, func() ([]leverPosting, error) {
		var body []leverPosting
		err := f.getJSON(ctx, "https://api.lever.co/v0/postings/"+slug+"?mode=json", &body)
		return body, err
	})
	if err != nil {
		return nil, err
	}

	company := firstNonEmpty(ref.Name, ref.Slug)
	var out []Posting
	for _, p := range postings {
		if !q.TitleMatches(p.Text) {
			continue
		}
		var sb strings.Builder
		sb.WriteString(p.DescriptionPlain)
		for _, l := range p.Lists {
			sb.WriteString("\n\n" + l.Text + "\n" + HTMLToText(l.Content))
		}
		if p.AdditionalPlain != "" {
			sb.WriteString("\n\n" + p.AdditionalPlain)
		}
		post := Posting{
			Source:         Lever,
			SourceLabel:    company + " (Lever)",
			ExternalID:     slug + ":" + p.ID,
			Title:          CleanText(p.Text),
			Company:        company,
			Location:       p.Categories.Location,
			IsRemote:       strings.EqualFold(p.WorkplaceType, "remote") || LooksRemote(p.Categories.Location),
			EmploymentType: NormalizeEmploymentType(p.Categories.Commitment),
			URL:            p.HostedURL,
			ApplyURL:       firstNonEmpty(p.ApplyURL, strings.TrimRight(p.HostedURL, "/")+"/apply"),
			ATS:            ATSLever,
			Description:    clip(strings.TrimSpace(sb.String()), MaxDescriptionChars),
		}
		if p.CreatedAt > 0 {
			post.PostedAt = timePtr(time.UnixMilli(p.CreatedAt))
		}
		if p.SalaryRange != nil && strings.Contains(strings.ToLower(p.SalaryRange.Interval), "year") {
			post.SalaryMin, post.SalaryMax = intPtr(p.SalaryRange.Min), intPtr(p.SalaryRange.Max)
			post.SalaryCurrency = p.SalaryRange.Currency
		}
		out = append(out, post)
	}
	return out, nil
}

// ── Ashby ─────────────────────────────────────────────────────────────────────

type ashbyJob struct {
	ID               string `json:"id"`
	Title            string `json:"title"`
	Location         string `json:"location"`
	IsRemote         bool   `json:"isRemote"`
	IsListed         bool   `json:"isListed"`
	WorkplaceType    string `json:"workplaceType"`
	EmploymentType   string `json:"employmentType"`
	JobURL           string `json:"jobUrl"`
	ApplyURL         string `json:"applyUrl"`
	PublishedAt      string `json:"publishedAt"`
	DescriptionPlain string `json:"descriptionPlain"`
	Compensation     *struct {
		Summary string `json:"scrapeableCompensationSalarySummary"`
	} `json:"compensation"`
}

func fetchAshby(ctx context.Context, f *Fetcher, ref CompanyRef, q Query) ([]Posting, error) {
	slug := url.PathEscape(ref.Slug)
	jobs, err := cached(f, "ashby:"+strings.ToLower(slug), func() ([]ashbyJob, error) {
		var body struct {
			Jobs []ashbyJob `json:"jobs"`
		}
		err := f.getJSON(ctx, "https://api.ashbyhq.com/posting-api/job-board/"+slug+"?includeCompensation=true", &body)
		if err != nil {
			return nil, err
		}
		// Keep only what we use: Ashby boards can be many MB.
		for i := range body.Jobs {
			body.Jobs[i].DescriptionPlain = clip(body.Jobs[i].DescriptionPlain, MaxDescriptionChars)
		}
		return body.Jobs, nil
	})
	if err != nil {
		return nil, err
	}

	company := firstNonEmpty(ref.Name, ref.Slug)
	var out []Posting
	for _, j := range jobs {
		if !j.IsListed || !q.TitleMatches(j.Title) {
			continue
		}
		post := Posting{
			Source:         Ashby,
			SourceLabel:    company + " (Ashby)",
			ExternalID:     strings.ToLower(slug) + ":" + j.ID,
			Title:          CleanText(j.Title),
			Company:        company,
			Location:       j.Location,
			IsRemote:       ashbyRemote(j),
			EmploymentType: NormalizeEmploymentType(j.EmploymentType),
			URL:            j.JobURL,
			ApplyURL:       firstNonEmpty(j.ApplyURL, strings.TrimRight(j.JobURL, "/")+"/application"),
			ATS:            ATSAshby,
			Description:    j.DescriptionPlain,
			PostedAt:       parseTime(j.PublishedAt),
		}
		if j.Compensation != nil {
			post.SalaryText = j.Compensation.Summary
		}
		out = append(out, post)
	}
	return out, nil
}

func firstNonEmpty(vals ...string) string {
	for _, v := range vals {
		if strings.TrimSpace(v) != "" {
			return strings.TrimSpace(v)
		}
	}
	return ""
}

// ashbyRemote trusts workplaceType when Ashby provides it: isRemote is also
// true for hybrid roles that merely allow some remote days.
func ashbyRemote(j ashbyJob) bool {
	switch strings.ToLower(j.WorkplaceType) {
	case "remote":
		return true
	case "hybrid", "onsite", "on-site":
		return false
	}
	return j.IsRemote || LooksRemote(j.Location)
}
