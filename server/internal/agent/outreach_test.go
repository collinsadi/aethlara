package agent

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/collinsadi/aethlara/internal/agent/sources"
	"github.com/collinsadi/aethlara/internal/ai"
	"github.com/collinsadi/aethlara/internal/config"
	"github.com/collinsadi/aethlara/internal/job"
)

// offlineTransport answers every ATS API call with 404, keeping tests off
// the network.
type offlineTransport struct{}

func (offlineTransport) RoundTrip(r *http.Request) (*http.Response, error) {
	return &http.Response{StatusCode: http.StatusNotFound, Body: io.NopCloser(strings.NewReader("{}")),
		Header: http.Header{}, Request: r}, nil
}

// testService serves pages from a map instead of the internet.
func testService(pages map[string]string, mx map[string]bool) (*Service, *[]string) {
	var fetched []string
	s := &Service{
		cfg:     &config.Config{},
		ai:      ai.NewClient(ai.Config{}), // no credentials: no web search
		fetcher: sources.NewFetcherWithClient(&http.Client{Transport: offlineTransport{}}, time.Minute),
	}
	s.fetchPage = func(_ context.Context, u string) (*job.Page, error) {
		fetched = append(fetched, u)
		if body, ok := pages[u]; ok {
			return &job.Page{URL: u, HTML: body}, nil
		}
		return nil, fmt.Errorf("404")
	}
	s.lookupMX = func(_ context.Context, d string) bool { return mx[d] }
	return s, &fetched
}

var longDescription = strings.Repeat("You will design and run payment systems in Go and PostgreSQL. ", 20)

func TestResolvePostingFromJSONLD(t *testing.T) {
	ld, _ := json.Marshal(map[string]any{
		"@context": "https://schema.org", "@type": "JobPosting",
		"title": "Backend Engineer, Payments", "description": "<p>" + longDescription + "</p>",
		"hiringOrganization": map[string]any{"@type": "Organization", "name": "Acme", "sameAs": "https://acme.io"},
	})
	page := `<html><head><script type="application/ld+json">` + string(ld) + `</script></head><body><div id="root"></div></body></html>`
	s, _ := testService(map[string]string{"https://careers.acme.io/jobs/42": page}, nil)
	lead := &Lead{Title: "Backend Engineer, Payments", Company: "Acme", URL: "https://careers.acme.io/jobs/42", Source: sources.WebSearch}
	rp, clues := s.resolvePosting(context.Background(), "u1", lead)
	if rp == nil || rp.Via != "json_ld" || !strings.Contains(rp.Description, "payment systems") {
		t.Fatalf("resolvePosting = %+v", rp)
	}
	if len(clues.domains) == 0 || clues.domains[0] != "acme.io" {
		t.Errorf("company domains = %v", clues.domains)
	}
}

func TestResolvePostingFollowsRoleLink(t *testing.T) {
	index := `<ul>
<li><a href="/careers/frontend-engineer">Frontend Engineer</a></li>
<li><a href="/careers/backend-engineer-payments">Backend Engineer, Payments (Remote)</a></li>
<li><a href="/careers/designer">Product Designer</a></li></ul>`
	posting := `<html><body><h1>Backend Engineer, Payments</h1><p>` + longDescription + strings.Repeat(" More about the role.", 30) + `</p></body></html>`
	s, fetched := testService(map[string]string{
		"https://acme.io/careers":                           index,
		"https://acme.io/careers/backend-engineer-payments": posting,
	}, nil)
	lead := &Lead{Title: "Backend Engineer - Payments", Company: "Acme", URL: "https://acme.io/careers", Source: sources.WebSearch}
	rp, _ := s.resolvePosting(context.Background(), "u1", lead)
	if rp == nil || rp.Via != "link" || rp.URL != "https://acme.io/careers/backend-engineer-payments" {
		t.Fatalf("resolvePosting = %+v (fetched %v)", rp, *fetched)
	}
}

func TestResolvePostingRejectsIndexAndOtherRoles(t *testing.T) {
	// The role is not on the careers index; similar titles must not match.
	index := `<a href="/jobs/1">Full-Stack Software Engineer - Growth</a><a href="/jobs/2">Senior Full-Stack Engineer (Web3)</a>
<a href="/jobs/3">Compliance Manager</a><a href="/jobs/4">Backend Engineer</a><a href="/jobs/5">Data Engineer</a>
<a href="/jobs/6">Product Designer</a><a href="/jobs/7">Engineering Manager</a>` + strings.Repeat("<p>We are hiring across teams.</p>", 80)
	s, _ := testService(map[string]string{"https://ondo.example/careers": index}, nil)
	lead := &Lead{Title: "Full-Stack Software Engineer - Compliance", Company: "Ondo Finance", URL: "https://ondo.example/careers", Source: sources.WebSearch}
	if rp, _ := s.resolvePosting(context.Background(), "u1", lead); rp != nil {
		t.Fatalf("expected no posting, got %+v", rp)
	}
}

func TestPageEmails(t *testing.T) {
	// "careers@acme.io" obfuscated by Cloudflare with key 0x2a.
	key := byte(0x2a)
	enc := fmt.Sprintf("%02x", key)
	for _, b := range []byte("careers@acme.io") {
		enc += fmt.Sprintf("%02x", b^key)
	}
	page := `<a href="mailto:Jobs%40Acme.io?subject=CV">Email us</a>
<span class="__cf_email__" data-cfemail="` + enc + `">[email&#160;protected]</span>
<p>Press: press@acme.io. Logo: logo@2x.png</p>`
	got := strings.Join(pageEmails(page), ",")
	for _, want := range []string{"jobs@acme.io", "careers@acme.io", "press@acme.io"} {
		if !strings.Contains(got, want) {
			t.Errorf("pageEmails missing %s: %s", want, got)
		}
	}
	if strings.Contains(got, "2x.png") {
		t.Errorf("image name parsed as email: %s", got)
	}
}

func TestCandidateContact(t *testing.T) {
	acme := []string{"acme.io"}
	cases := []struct {
		addr    string
		jobPage bool
		domains []string
		company string
		kind    string // "" = rejected
	}{
		{"careers@acme.io", false, acme, "Acme", "hiring"},
		{"talent.team@acme.io", false, acme, "Acme", "hiring"},
		{"hello@acme.io", false, acme, "Acme", "general"},
		{"support@acme.io", true, acme, "Acme", ""},
		{"press@acme.io", true, acme, "Acme", ""},
		{"no-reply@acme.io", true, acme, "Acme", ""},
		{"jane.doe@acme.io", true, acme, "Acme", "person"},
		{"jane.doe@acme.io", false, acme, "Acme", ""},
		{"careers@other.com", true, acme, "Acme", ""},                             // a third party's address
		{"jobs@acme.io", true, nil, "Acme", "hiring"},                             // domain unknown, but it carries the name
		{"careers@proton.ch", true, []string{"proton.me"}, "Proton AG", "hiring"}, // a second company domain
		{"jobs@cryptojobslist.com", true, nil, "Ondo Finance", ""},                // the job board's own inbox
		{"careers@greenhouse.io", true, nil, "Greenhouse", ""},                    // an ATS is never the company
		{"careers@careers.acme.co.uk", false, []string{"acme.co.uk"}, "Acme", "hiring"},
	}
	for _, c := range cases {
		ci := candidateContact(c.addr, "https://acme.io/careers", c.jobPage, c.domains, c.company)
		got := ""
		if ci != nil {
			got = ci.Kind
		}
		if got != c.kind {
			t.Errorf("candidateContact(%q, jobPage=%v, %v, %q) = %q, want %q", c.addr, c.jobPage, c.domains, c.company, got, c.kind)
		}
	}
	for domain, want := range map[string]bool{
		"lightning.engineering": true, "ondo.finance": true, "coinmarketcap.com": true,
		"cryptojobslist.com": false, "acme.io": false,
	} {
		company := map[string]string{"lightning.engineering": "Lightning Labs", "ondo.finance": "Ondo Finance",
			"coinmarketcap.com": "CoinMarketCap", "cryptojobslist.com": "Ondo Finance", "acme.io": "Lightning Labs"}[domain]
		if got := domainMatchesCompany(domain, company); got != want {
			t.Errorf("domainMatchesCompany(%q, %q) = %v", domain, company, got)
		}
	}
}

func TestFindContactPrefersHiringAndNeedsMX(t *testing.T) {
	pages := map[string]string{
		"https://acme.io/careers": `<p>Questions? <a href="mailto:hello@acme.io">hello@acme.io</a></p>`,
		"https://acme.io/contact": `<p>Jobs: careers@acme.io. Support: support@acme.io</p>`,
	}
	s, _ := testService(pages, map[string]bool{"acme.io": true})
	lead := &Lead{Title: "Backend Engineer", Company: "Acme", URL: "https://acme.io/careers/backend"}
	ci := s.findContact(context.Background(), "u1", lead, nil)
	if ci == nil || ci.Email != "careers@acme.io" || ci.Source != "https://acme.io/contact" {
		t.Fatalf("findContact = %+v", ci)
	}
	s2, _ := testService(pages, map[string]bool{}) // domain without MX records
	if ci := s2.findContact(context.Background(), "u1", lead, nil); ci != nil {
		t.Fatalf("address without MX accepted: %+v", ci)
	}
}

func TestRegistrableDomain(t *testing.T) {
	for in, want := range map[string]string{
		"careers.acme.io": "acme.io", "www.acme.co.uk": "acme.co.uk", "acme.com": "acme.com",
		"jobs.ashbyhq.com": "ashbyhq.com", "localhost": "",
	} {
		if got := registrableDomain(in); got != want {
			t.Errorf("registrableDomain(%q) = %q, want %q", in, got, want)
		}
	}
	if !isJobHost("ashbyhq.com") || isJobHost("lightning.engineering") {
		t.Error("isJobHost misclassifies")
	}
}

func TestColdEmailTemplateAndChecks(t *testing.T) {
	ident := identity{FullName: "Collins Adi"}
	group := []coldEmailJob{
		{lead: &Lead{Title: "Lightning Protocol Engineer", Company: "Lightning Labs"}},
		{lead: &Lead{Title: "Assets Protocol Engineer", Company: "Lightning Labs"}},
	}
	subject, body := coldEmailTemplate(ident, nil, group)
	if subject != "Lightning Labs roles - Collins Adi" || !strings.Contains(body, "Lightning Protocol Engineer and Assets Protocol Engineer roles") ||
		!strings.HasSuffix(body, "Best regards,\nCollins Adi") {
		t.Fatalf("template = %q / %q", subject, body)
	}
	if coldEmailOK("Backend Engineer - Collins", "Hi [Company] team,"+strings.Repeat(" text", 80)) {
		t.Error("placeholder accepted")
	}
	if !coldEmailOK("Backend Engineer - Collins", "Hi Acme team,"+strings.Repeat(" text", 80)) {
		t.Error("good email rejected")
	}
}

func TestTransientPrepareError(t *testing.T) {
	if !transientPrepareError(job.ErrAIPipelineTimeout) {
		t.Error("timeout should be transient")
	}
	if !transientPrepareError(fmt.Errorf("%w: AI returned non-JSON response", job.ErrExtraction)) {
		t.Error("malformed extraction reply should be transient")
	}
	if transientPrepareError(&job.ExtractionError{Code: "INSUFFICIENT_JOB_DATA", Reason: "no posting"}) {
		t.Error("an unreadable posting is not transient")
	}
	if transientPrepareError(errors.New("boom")) {
		t.Error("unknown errors are not transient")
	}
}

func TestApplySettingsDefaultsForOldProfiles(t *testing.T) {
	// Saved before cold_email_fallback existed: decoding over the defaults
	// turns it on; an explicit false stays false.
	as := defaultApplySettings()
	if err := json.Unmarshal([]byte(`{"auto_submit":false,"daily_limit":5,"cover_letters":true}`), &as); err != nil {
		t.Fatal(err)
	}
	if !as.ColdEmailFallback || as.AutoSubmit || as.DailyLimit != 5 {
		t.Errorf("decoded %+v", as)
	}
	as = defaultApplySettings()
	_ = json.Unmarshal([]byte(`{"cold_email_fallback":false}`), &as)
	if as.ColdEmailFallback {
		t.Error("explicit false was overridden")
	}
}
