package sources

import (
	"context"
	"errors"
	"html"
	"net/url"
	"regexp"
	"strconv"
	"strings"
)

// Single-posting and board lookups on the ATSs the agent knows, used to
// recover a full posting when a lead only has a title and a link (web
// search results, careers index pages).

// ATSRef points at one board (ID empty) or one posting on Greenhouse,
// Lever or Ashby.
type ATSRef struct {
	ATS  string
	Slug string
	ID   string
	EU   bool // Lever's EU data centre (jobs.eu.lever.co)
}

// Board returns the board the posting belongs to.
func (r ATSRef) Board() ATSRef { return ATSRef{ATS: r.ATS, Slug: r.Slug, EU: r.EU} }

func (r ATSRef) key() string {
	k := r.ATS + ":" + strings.ToLower(r.Slug)
	if r.EU {
		k += ":eu"
	}
	return k
}

var (
	uuidRe   = regexp.MustCompile(`^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$`)
	digitsRe = regexp.MustCompile(`^\d{3,}$`)
	slugRe   = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$`)
)

// reservedPaths are first path segments that are not board slugs.
var reservedPaths = map[string]bool{"embed": true, "api": true, "v1": true, "static": true, "assets": true}

// ParseATSURL recognises Greenhouse, Lever and Ashby board and posting URLs,
// including Greenhouse's embed forms. Company sites that only carry a
// gh_jid parameter are not recognised here (the board slug is unknown).
func ParseATSURL(raw string) (ATSRef, bool) {
	u, err := url.Parse(strings.TrimSpace(raw))
	if err != nil || u.Host == "" {
		return ATSRef{}, false
	}
	host := strings.ToLower(u.Hostname())
	parts := strings.FieldsFunc(u.Path, func(r rune) bool { return r == '/' })
	q := u.Query()
	switch host {
	case "boards.greenhouse.io", "job-boards.greenhouse.io", "boards.eu.greenhouse.io", "job-boards.eu.greenhouse.io":
		if len(parts) >= 1 && parts[0] == "embed" {
			slug := q.Get("for")
			if !slugRe.MatchString(slug) {
				return ATSRef{}, false
			}
			ref := ATSRef{ATS: ATSGreenhouse, Slug: slug}
			if len(parts) >= 2 && parts[1] == "job_app" && digitsRe.MatchString(q.Get("token")) {
				ref.ID = q.Get("token")
			}
			return ref, true
		}
		if len(parts) >= 1 && slugRe.MatchString(parts[0]) && !reservedPaths[parts[0]] {
			ref := ATSRef{ATS: ATSGreenhouse, Slug: parts[0]}
			if len(parts) >= 3 && parts[1] == "jobs" && digitsRe.MatchString(parts[2]) {
				ref.ID = parts[2]
			}
			return ref, true
		}
	case "boards-api.greenhouse.io":
		if len(parts) >= 3 && parts[0] == "v1" && parts[1] == "boards" && slugRe.MatchString(parts[2]) {
			ref := ATSRef{ATS: ATSGreenhouse, Slug: parts[2]}
			if len(parts) >= 5 && parts[3] == "jobs" && digitsRe.MatchString(parts[4]) {
				ref.ID = parts[4]
			}
			return ref, true
		}
	case "jobs.lever.co", "jobs.eu.lever.co":
		if len(parts) >= 1 && slugRe.MatchString(parts[0]) && !reservedPaths[parts[0]] {
			ref := ATSRef{ATS: ATSLever, Slug: parts[0], EU: host == "jobs.eu.lever.co"}
			if len(parts) >= 2 && uuidRe.MatchString(parts[1]) {
				ref.ID = strings.ToLower(parts[1])
			}
			return ref, true
		}
	case "jobs.ashbyhq.com":
		if len(parts) >= 1 && slugRe.MatchString(parts[0]) && !reservedPaths[parts[0]] {
			ref := ATSRef{ATS: ATSAshby, Slug: parts[0]}
			if len(parts) >= 2 && uuidRe.MatchString(parts[1]) {
				ref.ID = strings.ToLower(parts[1])
			}
			return ref, true
		}
	}
	return ATSRef{}, false
}

var (
	atsLinkRe = regexp.MustCompile(`(?i)(?:https?:)?//(?:(?:boards|job-boards)(?:\.eu)?\.greenhouse\.io|boards-api\.greenhouse\.io|jobs(?:\.eu)?\.lever\.co|jobs\.ashbyhq\.com)/[^\s"'<>\\)]*`)
	// Greenhouse's embed script: Grnhse.Settings.boardToken = "acme"
	ghBoardTokenRe = regexp.MustCompile(`boardToken["']?\s*[:=]\s*["']([A-Za-z0-9._-]+)["']`)
)

// FindATSRefs lists the Greenhouse, Lever and Ashby boards and postings a
// page links to or embeds, in page order without duplicates.
func FindATSRefs(pageHTML string) []ATSRef {
	seen := map[string]bool{}
	var out []ATSRef
	add := func(r ATSRef) {
		k := r.key() + "/" + r.ID
		if !seen[k] {
			seen[k] = true
			out = append(out, r)
		}
	}
	for _, m := range atsLinkRe.FindAllString(pageHTML, 200) {
		link := html.UnescapeString(m)
		if strings.HasPrefix(link, "//") {
			link = "https:" + link
		}
		if r, ok := ParseATSURL(link); ok {
			add(r)
		}
	}
	for _, m := range ghBoardTokenRe.FindAllStringSubmatch(pageHTML, 5) {
		add(ATSRef{ATS: ATSGreenhouse, Slug: m[1]})
	}
	return out
}

// ── Title matching ────────────────────────────────────────────────────────────

var titleSpellings = strings.NewReplacer(
	"full-stack", "fullstack", "full stack", "fullstack",
	"front-end", "frontend", "front end", "frontend",
	"back-end", "backend", "back end", "backend",
	"dev ops", "devops", "web 3", "web3",
	"node.js", "node", "nodejs", "node", "react.js", "react", "reactjs", "react",
)

// roleWords normalises a title for matching: common spelling variants are
// unified, stopwords and seniority words dropped, and words stemmed.
func roleWords(title string) []string {
	seen := map[string]bool{}
	var out []string
	for _, t := range Tokens(titleSpellings.Replace(strings.ToLower(title))) {
		st := stem(t)
		if !seen[st] {
			seen[st] = true
			out = append(out, st)
		}
	}
	return out
}

// SameRole reports whether got names the role want describes: every word
// of want appears in got and got adds at most maxExtra words (a location,
// a team). Seniority and remote markers are ignored. want needs two or
// more words so a bare "Engineer" never matches. The second result is the
// number of extra words, for picking the closest of several matches.
func SameRole(want, got string, maxExtra int) (bool, int) {
	w, g := roleWords(want), roleWords(got)
	if len(w) < 2 || len(g) == 0 {
		return false, 0
	}
	have := make(map[string]bool, len(g))
	for _, t := range g {
		have[t] = true
	}
	for _, t := range w {
		if !have[t] {
			return false, 0
		}
	}
	extra := len(g) - len(w)
	return extra <= maxExtra, extra
}

// RoleOverlap is the fraction of want's role words that appear in got
// (0..1); a looser check than SameRole for links that already point at a
// specific posting.
func RoleOverlap(want, got string) float64 {
	w, g := roleWords(want), roleWords(got)
	if len(w) == 0 {
		return 0
	}
	have := make(map[string]bool, len(g))
	for _, t := range g {
		have[t] = true
	}
	hit := 0
	for _, t := range w {
		if have[t] {
			hit++
		}
	}
	return float64(hit) / float64(len(w))
}

// BestRole returns the index of the posting whose title is the closest
// SameRole match for want, or -1.
func BestRole(want string, postings []Posting, maxExtra int) int {
	best, bestExtra := -1, maxExtra+1
	for i, p := range postings {
		if ok, extra := SameRole(want, p.Title, maxExtra); ok && extra < bestExtra {
			best, bestExtra = i, extra
		}
	}
	return best
}

// ── Lookups ───────────────────────────────────────────────────────────────────

// Board is the cached listing of one ATS board.
type Board struct {
	Found bool
	// Postings lists every open posting. Greenhouse listings carry no
	// description; FetchATSPosting fills it for the one that matters.
	Postings []Posting
}

func leverAPI(eu bool) string {
	if eu {
		return "https://api.eu.lever.co/v0/postings/"
	}
	return "https://api.lever.co/v0/postings/"
}

// BoardPostings lists a board's open postings. A board that does not exist
// returns Found=false (cached, so guessing slugs stays cheap).
func BoardPostings(ctx context.Context, f *Fetcher, ref ATSRef) (*Board, error) {
	if !slugRe.MatchString(ref.Slug) {
		return &Board{}, nil
	}
	return cached(f, "board:"+ref.key(), func() (*Board, error) {
		slug := url.PathEscape(ref.Slug)
		b := &Board{Found: true}
		var err error
		switch ref.ATS {
		case ATSGreenhouse:
			lslug := strings.ToLower(slug)
			var jobs []ghJob
			jobs, err = cached(f, "gh:list:"+lslug, func() ([]ghJob, error) {
				var body struct {
					Jobs []ghJob `json:"jobs"`
				}
				e := f.getJSON(ctx, "https://boards-api.greenhouse.io/v1/boards/"+lslug+"/jobs", &body)
				return body.Jobs, e
			})
			for _, j := range jobs {
				b.Postings = append(b.Postings, ghPosting(lslug, ref.Slug, j, ghJob{}))
			}
		case ATSLever:
			key := "lever:" + strings.ToLower(slug)
			if ref.EU {
				key = "lever-eu:" + strings.ToLower(slug)
			}
			var postings []leverPosting
			postings, err = cached(f, key, func() ([]leverPosting, error) {
				var body []leverPosting
				e := f.getJSON(ctx, leverAPI(ref.EU)+strings.ToLower(slug)+"?mode=json", &body)
				return body, e
			})
			for _, p := range postings {
				b.Postings = append(b.Postings, leverToPosting(strings.ToLower(slug), ref.Slug, p))
			}
		case ATSAshby:
			var jobs []ashbyJob
			jobs, err = ashbyBoard(ctx, f, slug)
			for _, j := range jobs {
				if j.IsListed {
					b.Postings = append(b.Postings, ashbyToPosting(slug, ref.Slug, j))
				}
			}
		default:
			return &Board{}, nil
		}
		if errors.Is(err, ErrNotFound) {
			return &Board{}, nil
		}
		if err != nil {
			return nil, err
		}
		return b, nil
	})
}

func ashbyBoard(ctx context.Context, f *Fetcher, slug string) ([]ashbyJob, error) {
	return cached(f, "ashby:"+strings.ToLower(slug), func() ([]ashbyJob, error) {
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
}

// FetchATSPosting fetches one posting with its full description. Returns
// ErrNotFound when the posting is gone.
func FetchATSPosting(ctx context.Context, f *Fetcher, ref ATSRef) (*Posting, error) {
	if !slugRe.MatchString(ref.Slug) || ref.ID == "" {
		return nil, ErrNotFound
	}
	slug := strings.ToLower(url.PathEscape(ref.Slug))
	switch ref.ATS {
	case ATSGreenhouse:
		d, err := cached(f, "gh:job:"+slug+":"+ref.ID, func() (ghJob, error) {
			var d ghJob
			err := f.getJSON(ctx, "https://boards-api.greenhouse.io/v1/boards/"+slug+"/jobs/"+url.PathEscape(ref.ID), &d)
			return d, err
		})
		if err != nil {
			return nil, err
		}
		if d.ID == 0 {
			d.ID, _ = strconv.ParseInt(ref.ID, 10, 64)
		}
		p := ghPosting(slug, ref.Slug, d, d)
		return &p, nil
	case ATSLever:
		var lp leverPosting
		if err := f.getJSON(ctx, leverAPI(ref.EU)+slug+"/"+url.PathEscape(ref.ID), &lp); err != nil {
			return nil, err
		}
		p := leverToPosting(slug, ref.Slug, lp)
		return &p, nil
	case ATSAshby:
		jobs, err := ashbyBoard(ctx, f, url.PathEscape(ref.Slug))
		if err != nil {
			return nil, err
		}
		for _, j := range jobs {
			if strings.EqualFold(j.ID, ref.ID) {
				p := ashbyToPosting(url.PathEscape(ref.Slug), ref.Slug, j)
				return &p, nil
			}
		}
		return nil, ErrNotFound
	}
	return nil, ErrNotFound
}

// FindOnBoard returns the posting on board whose title is the closest
// SameRole match for title, with its full description, or nil.
func FindOnBoard(ctx context.Context, f *Fetcher, board ATSRef, title string, maxExtra int) (*Posting, error) {
	b, err := BoardPostings(ctx, f, board.Board())
	if err != nil || !b.Found {
		return nil, err
	}
	i := BestRole(title, b.Postings, maxExtra)
	if i < 0 {
		return nil, nil
	}
	p := b.Postings[i]
	if p.Description == "" && board.ATS == ATSGreenhouse {
		_, id, _ := strings.Cut(p.ExternalID, ":")
		full, err := FetchATSPosting(ctx, f, ATSRef{ATS: ATSGreenhouse, Slug: board.Slug, ID: id})
		if err != nil {
			return nil, err
		}
		return full, nil
	}
	return &p, nil
}

// GreenhouseBoardName returns the company name of a Greenhouse board, used
// to confirm a board found by guessing its slug.
func GreenhouseBoardName(ctx context.Context, f *Fetcher, slug string) string {
	if !slugRe.MatchString(slug) {
		return ""
	}
	name, err := cached(f, "gh:name:"+strings.ToLower(slug), func() (string, error) {
		var body struct {
			Name string `json:"name"`
		}
		err := f.getJSON(ctx, "https://boards-api.greenhouse.io/v1/boards/"+strings.ToLower(slug), &body)
		return body.Name, err
	})
	if err != nil {
		return ""
	}
	return name
}

// GuessBoardSlugs derives likely ATS board slugs from a company name and
// its website domain: "Lightning Labs" -> lightninglabs, lightning-labs,
// lightning; "Ondo Finance" -> ondofinance, ondo-finance, ondo.
func GuessBoardSlugs(company string, domains []string) []string {
	seen := map[string]bool{}
	var out []string
	add := func(s string) {
		s = strings.Trim(strings.ToLower(s), "-.")
		if len(s) >= 2 && slugRe.MatchString(s) && !seen[s] {
			seen[s] = true
			out = append(out, s)
		}
	}
	words := strings.FieldsFunc(strings.ToLower(company), func(r rune) bool {
		return !(r >= 'a' && r <= 'z' || r >= '0' && r <= '9')
	})
	// Legal suffixes never appear in slugs.
	for len(words) > 1 {
		last := words[len(words)-1]
		if last == "inc" || last == "llc" || last == "ltd" || last == "gmbh" || last == "corp" || last == "co" || last == "sa" || last == "plc" {
			words = words[:len(words)-1]
			continue
		}
		break
	}
	if len(words) > 0 {
		add(strings.Join(words, ""))
		add(strings.Join(words, "-"))
		add(words[0])
	}
	for _, d := range domains {
		if label, _, ok := strings.Cut(d, "."); ok {
			add(label)
		}
	}
	if len(out) > 5 {
		out = out[:5]
	}
	return out
}
