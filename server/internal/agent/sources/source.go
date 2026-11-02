// Package sources fetches job postings from public job-board APIs and
// normalises them into Posting values. Every source is unauthenticated and
// free; all of them are polled at most a few times a day per board thanks to
// the shared response cache.
//
// Attribution: Remotive, Remote OK and Jobicy require that listings link back
// to the original posting and name them as the source. Posting.URL is always
// the source's own posting page and Posting.SourceLabel its display name, so
// clients can render "via <SourceLabel>" linking to URL.
package sources

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"html"
	"io"
	"net/http"
	"regexp"
	"strings"
	"sync"
	"time"
	"unicode"
)

// MaxDescriptionChars caps stored/scored description text per posting.
const MaxDescriptionChars = 12000

// Source IDs.
const (
	Greenhouse = "greenhouse"
	Lever      = "lever"
	Ashby      = "ashby"
	Remotive   = "remotive"
	RemoteOK   = "remoteok"
	Himalayas  = "himalayas"
	Jobicy     = "jobicy"
	Arbeitnow  = "arbeitnow"
	WebSearch  = "web_search"
	Manual     = "manual"
	Extension  = "extension"
)

// Posting is a job posting normalised across sources.
type Posting struct {
	Source         string
	SourceLabel    string
	ExternalID     string
	Title          string
	Company        string
	Location       string
	IsRemote       bool
	EmploymentType string // full_time|part_time|contract|freelance|internship|temporary|""
	SalaryMin      *int
	SalaryMax      *int
	SalaryCurrency string
	SalaryText     string
	URL            string // the source's posting page (attribution link)
	ApplyURL       string // where the application form lives
	ApplyEmail     string
	ATS            string // detected applicant tracking system, see DetectATS
	Description    string // plain text, <= MaxDescriptionChars
	Tags           []string
	PostedAt       *time.Time
}

// CompanyRef points at one company's board on an ATS.
type CompanyRef struct {
	ATS  string `json:"ats"`
	Slug string `json:"slug"`
	Name string `json:"name,omitempty"`
}

// Query describes what the user is looking for. Sources use it to build
// requests and to drop obviously irrelevant postings early (e.g. before
// fetching per-job details on an ATS board).
type Query struct {
	Titles     []string
	Keywords   []string
	Companies  []CompanyRef
	RemoteOnly bool
	// PerSourceLimit caps postings returned by one source (0 = 100).
	PerSourceLimit int
}

// Source fetches postings for a query.
type Source interface {
	ID() string
	Label() string
	Search(ctx context.Context, q Query) ([]Posting, error)
}

// ── Query matching ────────────────────────────────────────────────────────────

var stopwords = map[string]bool{
	"and": true, "or": true, "the": true, "a": true, "an": true, "of": true,
	"for": true, "in": true, "to": true, "with": true, "at": true, "on": true,
	"i": true, "ii": true, "iii": true, "iv": true, "sr": true, "jr": true,
	"senior": true, "junior": true, "lead": true, "staff": true, "principal": true,
	"remote": true, "hybrid": true, "mid": true, "level": true,
}

// Tokens lowercases s and splits it into alphanumeric words, dropping
// stopwords and seniority words so "Senior Backend Engineer" matches
// "Backend Engineer II".
func Tokens(s string) []string {
	fields := strings.FieldsFunc(strings.ToLower(s), func(r rune) bool {
		return !unicode.IsLetter(r) && !unicode.IsDigit(r) && r != '+' && r != '#'
	})
	out := fields[:0]
	for _, f := range fields {
		if f != "" && !stopwords[f] {
			out = append(out, f)
		}
	}
	return out
}

// genericRoleWords carry half weight in title matching: on their own they
// say little ("Engineering Manager" should not match "Backend Engineer").
var genericRoleWords = map[string]bool{
	"engineer": true, "engineering": true, "engin": true, "developer": true,
	"development": true, "develop": true, "manager": true, "management": true,
	"specialist": true, "analyst": true, "consultant": true, "associate": true,
	"officer": true, "coordinator": true, "representative": true,
	"administrator": true, "scientist": true, "designer": true, "architect": true,
}

// TitleScore returns how well a posting title matches the query titles:
// the best weighted fraction of a target title's words present in the
// posting title (0..1), with generic role nouns weighted 0.5. With no titles
// configured every posting scores 1.
func (q Query) TitleScore(title string) float64 {
	if len(q.Titles) == 0 {
		return 1
	}
	have := map[string]bool{}
	for _, t := range Tokens(title) {
		have[t] = true
		// "engineer" ~ "engineering", "developer" ~ "development"
		have[stem(t)] = true
	}
	best := 0.0
	for _, target := range q.Titles {
		toks := Tokens(target)
		if len(toks) == 0 {
			continue
		}
		var hit, total float64
		for _, t := range toks {
			w := 1.0
			if genericRoleWords[t] || genericRoleWords[stem(t)] {
				w = 0.5
			}
			total += w
			if have[t] || have[stem(t)] {
				hit += w
			}
		}
		if s := hit / total; s > best {
			best = s
		}
	}
	return best
}

// TitleMatches is the early filter ATS sources apply before fetching
// details: at least half of some target title's words must appear.
func (q Query) TitleMatches(title string) bool {
	return q.TitleScore(title) >= 0.5
}

func stem(t string) string {
	for _, suf := range []string{"ing", "er", "ment", "s"} {
		if len(t) > len(suf)+3 && strings.HasSuffix(t, suf) {
			return strings.TrimSuffix(t, suf)
		}
	}
	return t
}

// SearchTerms returns up to n distinct search strings for keyword-search
// APIs: the target titles first, then keywords.
func (q Query) SearchTerms(n int) []string {
	seen := map[string]bool{}
	var out []string
	for _, s := range append(append([]string{}, q.Titles...), q.Keywords...) {
		s = strings.TrimSpace(s)
		k := strings.ToLower(s)
		if s == "" || seen[k] {
			continue
		}
		seen[k] = true
		out = append(out, s)
		if len(out) == n {
			break
		}
	}
	return out
}

func (q Query) limit() int {
	if q.PerSourceLimit > 0 {
		return q.PerSourceLimit
	}
	return 100
}

// ── HTTP + caching ────────────────────────────────────────────────────────────

const (
	defaultUserAgent = "Mozilla/5.0 (compatible; Aethlara/1.0; +https://github.com/collinsadi/aethlara)"
	maxResponseBytes = 32 << 20
)

// Fetcher performs GET requests for sources and caches decoded results so
// several users (and repeated runs) don't hammer the same board.
type Fetcher struct {
	client    *http.Client
	userAgent string
	ttl       time.Duration

	mu    sync.Mutex
	cache map[string]cacheEntry
}

type cacheEntry struct {
	value   any
	expires time.Time
}

// NewFetcher returns a Fetcher with the given cache TTL.
func NewFetcher(ttl time.Duration) *Fetcher {
	return &Fetcher{
		client:    &http.Client{Timeout: 45 * time.Second},
		userAgent: defaultUserAgent,
		ttl:       ttl,
		cache:     map[string]cacheEntry{},
	}
}

// ErrNotFound is returned for 404 board/company lookups.
var ErrNotFound = errors.New("not found")

// getJSON GETs url and decodes the JSON body into v.
func (f *Fetcher) getJSON(ctx context.Context, url string, v any) error {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return err
	}
	req.Header.Set("User-Agent", f.userAgent)
	req.Header.Set("Accept", "application/json")

	resp, err := f.client.Do(req)
	if err != nil {
		return fmt.Errorf("GET %s: %w", redactURL(url), err)
	}
	defer resp.Body.Close()

	if resp.StatusCode == http.StatusNotFound {
		return ErrNotFound
	}
	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("GET %s: HTTP %d", redactURL(url), resp.StatusCode)
	}
	dec := json.NewDecoder(io.LimitReader(resp.Body, maxResponseBytes))
	if err := dec.Decode(v); err != nil {
		return fmt.Errorf("decode %s: %w", redactURL(url), err)
	}
	return nil
}

// cached returns the cached value for key or computes it with fn.
func cached[T any](f *Fetcher, key string, fn func() (T, error)) (T, error) {
	f.mu.Lock()
	if e, ok := f.cache[key]; ok && time.Now().Before(e.expires) {
		f.mu.Unlock()
		return e.value.(T), nil
	}
	f.mu.Unlock()

	v, err := fn()
	if err != nil {
		var zero T
		return zero, err
	}

	f.mu.Lock()
	f.cache[key] = cacheEntry{value: v, expires: time.Now().Add(f.ttl)}
	// Opportunistic eviction keeps the map from growing without bound.
	if len(f.cache) > 2000 {
		now := time.Now()
		for k, e := range f.cache {
			if now.After(e.expires) {
				delete(f.cache, k)
			}
		}
	}
	f.mu.Unlock()
	return v, nil
}

func redactURL(u string) string {
	if i := strings.IndexByte(u, '?'); i >= 0 {
		return u[:i]
	}
	return u
}

// ── Text helpers ──────────────────────────────────────────────────────────────

var (
	scriptStyleRe = regexp.MustCompile(`(?is)<(script|style|noscript)[^>]*>.*?</(script|style|noscript)>`)
	blockTagRe    = regexp.MustCompile(`(?i)</?(p|div|br|li|ul|ol|h[1-6]|tr|section|article|header|footer|blockquote)[^>]*>`)
	tagRe         = regexp.MustCompile(`<[^>]+>`)
	spaceRe       = regexp.MustCompile(`[ \t\x{00a0}]+`)
	blankLinesRe  = regexp.MustCompile(`\n{3,}`)
)

// HTMLToText converts an HTML fragment into readable plain text. It also
// handles HTML that was itself entity-escaped (Greenhouse returns
// "&lt;p&gt;...").
func HTMLToText(s string) string {
	if strings.Contains(s, "&lt;") && !strings.Contains(s, "<") {
		s = html.UnescapeString(s)
	}
	s = scriptStyleRe.ReplaceAllString(s, " ")
	s = blockTagRe.ReplaceAllString(s, "\n")
	s = tagRe.ReplaceAllString(s, " ")
	s = html.UnescapeString(s)
	s = spaceRe.ReplaceAllString(s, " ")
	lines := strings.Split(s, "\n")
	for i, l := range lines {
		lines[i] = strings.TrimSpace(l)
	}
	s = strings.Join(lines, "\n")
	s = blankLinesRe.ReplaceAllString(s, "\n\n")
	return clip(strings.TrimSpace(s), MaxDescriptionChars)
}

func clip(s string, n int) string {
	if len(s) <= n {
		return s
	}
	// Cut on a rune boundary.
	cut := n
	for cut > 0 && !utf8RuneStart(s[cut]) {
		cut--
	}
	return s[:cut] + "..."
}

func utf8RuneStart(b byte) bool { return b&0xC0 != 0x80 }

var remoteWords = []string{"remote", "anywhere", "worldwide", "work from home", "wfh", "distributed"}

// LooksRemote reports whether a location string describes a remote role.
func LooksRemote(location string) bool {
	l := strings.ToLower(location)
	for _, w := range remoteWords {
		if strings.Contains(l, w) {
			return true
		}
	}
	return false
}

// NormalizeEmploymentType maps the many spellings sources use onto the
// platform's employment_type enum.
func NormalizeEmploymentType(s string) string {
	l := strings.ToLower(strings.NewReplacer("-", "", "_", "", " ", "").Replace(s))
	switch {
	case l == "":
		return ""
	case strings.Contains(l, "fulltime"), l == "permanent", strings.Contains(l, "unbefristet"):
		return "full_time"
	case strings.Contains(l, "parttime"), strings.Contains(l, "teilzeit"):
		return "part_time"
	case strings.Contains(l, "contract"), strings.Contains(l, "contractor"):
		return "contract"
	case strings.Contains(l, "freelance"):
		return "freelance"
	case strings.Contains(l, "intern"), strings.Contains(l, "praktikum"):
		return "internship"
	case strings.Contains(l, "temp"), strings.Contains(l, "befristet"):
		return "temporary"
	}
	return ""
}

func intPtr(n int) *int {
	if n <= 0 {
		return nil
	}
	return &n
}

func timePtr(t time.Time) *time.Time {
	if t.IsZero() {
		return nil
	}
	return &t
}

func parseTime(s string) *time.Time {
	s = strings.TrimSpace(s)
	if s == "" {
		return nil
	}
	for _, layout := range []string{time.RFC3339Nano, time.RFC3339, "2006-01-02T15:04:05", "2006-01-02 15:04:05", "2006-01-02"} {
		if t, err := time.Parse(layout, s); err == nil {
			return &t
		}
	}
	return nil
}
