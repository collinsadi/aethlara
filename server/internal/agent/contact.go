package agent

import (
	"context"
	"encoding/hex"
	"encoding/json"
	"html"
	"net"
	"net/url"
	"regexp"
	"strings"
	"time"

	"github.com/collinsadi/aethlara/internal/ai"
	"github.com/collinsadi/aethlara/internal/job"
	"github.com/collinsadi/aethlara/internal/logger"
	"github.com/collinsadi/aethlara/internal/prompts"
)

// Contact discovery for cold emails. An address is only used when the
// company publishes it: on its own website, on a posting or careers page,
// or on a page a web search cites, which is fetched to confirm the address
// really appears there. Addresses are never guessed.

const contactSearchTimeout = 2 * time.Minute

// contactInfo is the address a cold email goes to.
type contactInfo struct {
	Email  string
	Kind   string // hiring | general | person
	Source string // the page the address was published on
	score  int
}

var (
	mailtoRe  = regexp.MustCompile(`(?i)mailto:([^"'?&\s<>]+)`)
	cfEmailRe = regexp.MustCompile(`(?i)(?:data-cfemail="|/cdn-cgi/l/email-protection#)([0-9a-f]{6,})`)
	emailRe   = regexp.MustCompile(`(?i)\b[a-z0-9][a-z0-9._%+-]{0,63}@[a-z0-9][a-z0-9.-]*\.[a-z]{2,24}\b`)
)

var fileSuffixes = []string{".png", ".jpg", ".jpeg", ".gif", ".svg", ".webp", ".css", ".js", ".ico", ".avif"}

// pageEmails returns the addresses published on a page: mailto links,
// Cloudflare-obfuscated addresses and plain text.
func pageEmails(pageHTML string) []string {
	seen := map[string]bool{}
	var out []string
	add := func(e string) {
		e = strings.ToLower(strings.Trim(strings.TrimSpace(e), ".,;:"))
		if !validEmail(e) || seen[e] {
			return
		}
		seen[e] = true
		out = append(out, e)
	}
	for _, m := range mailtoRe.FindAllStringSubmatch(pageHTML, 200) {
		if dec, err := url.PathUnescape(m[1]); err == nil {
			add(dec)
		}
	}
	for _, m := range cfEmailRe.FindAllStringSubmatch(pageHTML, 100) {
		add(decodeCFEmail(m[1]))
	}
	for _, m := range emailRe.FindAllString(html.UnescapeString(pageHTML), 400) {
		add(m)
	}
	return out
}

// decodeCFEmail reverses Cloudflare's email obfuscation: the first byte is
// a key XORed into every following byte.
func decodeCFEmail(h string) string {
	b, err := hex.DecodeString(h)
	if err != nil || len(b) < 2 {
		return ""
	}
	out := make([]byte, len(b)-1)
	for i := 1; i < len(b); i++ {
		out[i-1] = b[i] ^ b[0]
	}
	return string(out)
}

func validEmail(e string) bool {
	local, domain, ok := strings.Cut(e, "@")
	if !ok || local == "" || len(local) > 64 || strings.Contains(domain, "@") || !strings.Contains(domain, ".") {
		return false
	}
	for _, suf := range fileSuffixes {
		if strings.HasSuffix(domain, suf) {
			return false
		}
	}
	if !emailRe.MatchString(e) {
		return false
	}
	return !strings.HasSuffix(domain, "example.com") && !strings.HasSuffix(domain, "sentry.io")
}

var (
	hiringLocals = map[string]bool{
		"careers": true, "career": true, "jobs": true, "job": true, "talent": true, "recruiting": true,
		"recruitment": true, "recruiter": true, "recruiters": true, "hiring": true, "hire": true, "hr": true,
		"people": true, "join": true, "joinus": true, "work": true, "workwithus": true, "apply": true,
		"applications": true, "application": true, "cv": true, "resumes": true, "humanresources": true,
		"staffing": true, "team-hiring": true,
	}
	generalLocals = map[string]bool{
		"hello": true, "hi": true, "contact": true, "info": true, "team": true, "office": true, "general": true,
		"inquiries": true, "enquiries": true, "founders": true, "hey": true, "mail": true,
	}
	rejectLocalWords = map[string]bool{
		"privacy": true, "legal": true, "security": true, "abuse": true, "support": true, "help": true,
		"helpdesk": true, "press": true, "media": true, "pr": true, "news": true, "billing": true, "invoice": true,
		"invoices": true, "accounts": true, "accounting": true, "finance": true, "sales": true, "partners": true,
		"partnerships": true, "partner": true, "marketing": true, "noreply": true, "no-reply": true,
		"donotreply": true, "do-not-reply": true, "postmaster": true, "webmaster": true, "hostmaster": true,
		"admin": true, "dpo": true, "gdpr": true, "compliance": true, "investors": true, "ir": true,
		"unsubscribe": true, "bounce": true, "bounces": true, "mailer-daemon": true, "feedback": true,
		"bugs": true, "bug": true, "report": true, "dmca": true, "copyright": true, "trust": true, "safety": true,
		"fraud": true, "orders": true, "shop": true, "store": true, "events": true, "community": true,
		"developers": true, "api": true, "status": true, "notifications": true, "alerts": true,
		"newsletter": true, "subscribe": true, "ops": true, "devrel": true, "grants": true, "listings": true,
	}
	personLocalRe = regexp.MustCompile(`^[a-z]{2,20}([._-][a-z]{1,20})?$`)
)

// classifyLocal sorts an address by its local part: a hiring inbox, a
// general inbox, possibly a person, or one that must not get job emails.
func classifyLocal(local string) string {
	local = strings.ToLower(local)
	if i := strings.IndexByte(local, '+'); i > 0 {
		local = local[:i]
	}
	words := strings.FieldsFunc(local, func(r rune) bool { return r == '.' || r == '-' || r == '_' })
	for _, w := range words {
		if rejectLocalWords[w] {
			return "reject"
		}
	}
	if rejectLocalWords[local] {
		return "reject"
	}
	if hiringLocals[local] {
		return "hiring"
	}
	for _, w := range words {
		if hiringLocals[w] {
			return "hiring"
		}
	}
	if generalLocals[local] {
		return "general"
	}
	for _, w := range words {
		if generalLocals[w] {
			return "general"
		}
	}
	if personLocalRe.MatchString(local) {
		return "person"
	}
	return "reject"
}

// candidateContact scores one address found on a page; nil when it must
// not be used. The address must be on one of the company's domains or on a
// domain carrying its name (careers@proton.ch for Proton, whose site is
// proton.me), never on a job board's or a third party's.
func candidateContact(addr, source string, jobPage bool, companyDomains []string, company string) *contactInfo {
	local, domain, _ := strings.Cut(addr, "@")
	kind := classifyLocal(local)
	if kind == "reject" {
		return nil
	}
	d := registrableDomain(domain)
	if d == "" || isJobHost(d) {
		return nil
	}
	own := domainMatchesCompany(d, company)
	for _, cd := range companyDomains {
		if cd == d {
			own = true
			break
		}
	}
	if !own {
		return nil
	}
	if kind == "person" && !jobPage {
		// A person's address only counts on a job page ("send your CV to
		// jane@..."); elsewhere it may be anyone at the company.
		return nil
	}
	score := map[string]int{"hiring": 30, "general": 20, "person": 12}[kind]
	if jobPage {
		score += 5
	}
	return &contactInfo{Email: addr, Kind: kind, Source: source, score: score}
}

// findContact looks for a published address to email the company at.
func (s *Service) findContact(ctx context.Context, userID string, lead *Lead, c *siteClues) *contactInfo {
	ctx, cancel := context.WithTimeout(ctx, contactSearchTimeout)
	defer cancel()
	if c == nil {
		c = newSiteClues(lead.Company)
	}
	c.addDomainFromURL(lead.URL)
	if lead.ApplyURL != nil {
		c.addDomainFromURL(*lead.ApplyURL)
	}
	if lead.ApplyEmail != nil && validEmail(*lead.ApplyEmail) {
		if ci := candidateContact(*lead.ApplyEmail, lead.URL, true, nil, lead.Company); ci != nil {
			return s.withMX(ctx, []*contactInfo{ci})
		}
	}

	var found []*contactInfo
	scan := func(page *job.Page) {
		for _, e := range pageEmails(page.HTML) {
			if ci := candidateContact(e, page.URL, c.jobPage[page.URL], c.domains, lead.Company); ci != nil {
				found = append(found, ci)
			}
		}
	}
	haveHiring := func() bool {
		for _, f := range found {
			if f.Kind == "hiring" {
				return true
			}
		}
		return false
	}
	crawled := map[string]bool{}
	crawl := func(domain string) {
		if crawled[domain] {
			return
		}
		crawled[domain] = true
		for _, path := range []string{"/careers", "/jobs", "/contact", "/about", "/"} {
			if haveHiring() || ctx.Err() != nil {
				return
			}
			if page := s.fetchClue(ctx, "https://"+domain+path, c, path == "/careers" || path == "/jobs"); page != nil {
				scan(page)
			}
		}
	}

	for _, page := range c.pages {
		scan(page)
	}
	for i := 0; i < len(c.domains) && i < 2 && !haveHiring(); i++ {
		crawl(c.domains[i])
	}

	if !haveHiring() && s.ai.SupportsWebSearch(ctx, userID) {
		site, emails := s.searchContact(ctx, userID, lead, c.domains)
		if site != "" {
			c.addDomainFromURL(site)
		}
		for _, e := range emails {
			if haveHiring() {
				break
			}
			// Confirm the address on the page the search cites.
			page := s.fetchClue(ctx, e.SourceURL, c, false)
			if page == nil {
				continue
			}
			for _, have := range pageEmails(page.HTML) {
				if have == strings.ToLower(e.Email) {
					if ci := candidateContact(have, page.URL, false, c.domains, lead.Company); ci != nil {
						found = append(found, ci)
					}
				}
			}
		}
		for i := 0; i < len(c.domains) && i < 2 && !haveHiring(); i++ {
			crawl(c.domains[i])
		}
	}
	return s.withMX(ctx, found)
}

// withMX returns the best-scoring address whose domain accepts mail.
func (s *Service) withMX(ctx context.Context, found []*contactInfo) *contactInfo {
	for len(found) > 0 {
		best := 0
		for i, f := range found {
			if f.score > found[best].score {
				best = i
			}
		}
		ci := found[best]
		_, domain, _ := strings.Cut(ci.Email, "@")
		if s.lookupMX(ctx, domain) {
			return ci
		}
		found = append(found[:best], found[best+1:]...)
	}
	return nil
}

// hasMX reports whether domain publishes mail exchangers.
func hasMX(ctx context.Context, domain string) bool {
	ctx, cancel := context.WithTimeout(ctx, 8*time.Second)
	defer cancel()
	mx, err := net.DefaultResolver.LookupMX(ctx, domain)
	return err == nil && len(mx) > 0
}

type searchedEmail struct {
	Email     string `json:"email"`
	SourceURL string `json:"source_url"`
	Purpose   string `json:"purpose"`
}

// searchContact asks web search for the company's site and hiring address.
func (s *Service) searchContact(ctx context.Context, userID string, lead *Lead, domains []string) (string, []searchedEmail) {
	resp, err := s.ai.WebSearch(ctx, ai.WebSearchRequest{
		UserID:         userID,
		SystemPrompt:   prompts.ContactSearchSystemPrompt(),
		UserMessage:    prompts.ContactSearchUserMessage(lead.Company, strings.Join(domains, ", "), lead.Title),
		PromptVersion:  prompts.ContactSearchV1,
		Stage:          ai.StageContactSearch,
		MaxSearches:    3,
		BlockedDomains: webSearchBlocked,
		MaxTokens:      2048,
	})
	if err != nil {
		logger.FromContext(ctx).Warn("contact search failed", "component", "agent", "error", logger.TruncateError(err, 200))
		return "", nil
	}
	raw, ok := ai.ExtractJSON(resp.Content)
	if !ok {
		return "", nil
	}
	var out struct {
		Website string          `json:"website"`
		Emails  []searchedEmail `json:"emails"`
	}
	if json.Unmarshal([]byte(raw), &out) != nil {
		return "", nil
	}
	var emails []searchedEmail
	for _, e := range out.Emails {
		if validEmail(strings.ToLower(strings.TrimSpace(e.Email))) && isHTTPURL(e.SourceURL) && len(emails) < 4 {
			emails = append(emails, e)
		}
	}
	site := ""
	if isHTTPURL(out.Website) {
		site = out.Website
	}
	return site, emails
}
