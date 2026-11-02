package agent

import (
	"strings"
	"testing"
	"time"

	"github.com/collinsadi/aethlara/internal/agent/sources"
	"github.com/collinsadi/aethlara/internal/config"
	"github.com/collinsadi/aethlara/internal/prompts"
)

func TestDedupeKey(t *testing.T) {
	if dedupeKey("Acme, Inc.", "Senior Backend Engineer (Go)") != dedupeKey("acme inc", "senior backend engineer go") {
		t.Fatal("dedupe key should ignore case and punctuation")
	}
	if dedupeKey("Acme", "Backend Engineer") == dedupeKey("Acme", "Frontend Engineer") {
		t.Fatal("different titles must not collide")
	}
}

func posting(title, company, location string, remote bool) sources.Posting {
	return sources.Posting{Source: sources.Remotive, Title: title, Company: company, Location: location,
		IsRemote: remote, URL: "https://example.com/" + strings.ReplaceAll(title, " ", "-")}
}

func TestPrefilter(t *testing.T) {
	s := &Service{cfg: &config.Config{}}
	old := time.Now().AddDate(0, 0, -60)
	stale := posting("Backend Engineer", "Oldco", "Remote", true)
	stale.PostedAt = &old
	atsStale := stale
	atsStale.Source, atsStale.Company = sources.Greenhouse, "Evergreen" // ATS boards ignore max age

	in := []sources.Posting{
		posting("Senior Backend Engineer", "Acme", "Remote", true),
		posting("Senior Backend Engineer", "Acme", "Remote", true), // duplicate
		posting("Backend Engineer", "Badco", "Remote", true),       // excluded company
		posting("Backend Engineer (Clearance Required)", "Gov", "Remote", true),
		posting("Backend Engineer", "Officeco", "Berlin", false), // not remote
		posting("Account Executive", "Salesco", "Remote", true),  // off-target title
		stale,
		atsStale,
		{Source: sources.Remotive, Title: "No URL Engineer", Company: "X"},
	}
	sp := SearchPrefs{
		Titles: []string{"Backend Engineer"}, RemoteOnly: true, MaxAgeDays: 30,
		ExcludeCompanies: []string{"badco"}, ExcludeKeywords: []string{"clearance"},
	}
	got := s.prefilter(in, sp)
	kept := map[string]bool{}
	for _, d := range got {
		kept[d.posting.Company] = true
	}
	if len(got) != 2 || !kept["Acme"] || !kept["Evergreen"] {
		t.Fatalf("prefilter kept %v, want Acme and Evergreen", kept)
	}
}

func TestPrefilterPrefersAutoApplyAndWebSearch(t *testing.T) {
	s := &Service{cfg: &config.Config{}}
	board := posting("Backend Engineer", "Board", "Remote", true)
	ats := posting("Backend Engineer", "ATS", "Remote", true)
	ats.Source, ats.ATS = sources.Greenhouse, sources.ATSGreenhouse
	web := posting("Backend Engineer", "Web", "Remote", true)
	web.Source = sources.WebSearch
	got := s.prefilter([]sources.Posting{board, ats, web}, SearchPrefs{Titles: []string{"Backend Engineer"}})
	if got[0].posting.Company != "Web" || got[1].posting.Company != "ATS" || got[2].posting.Company != "Board" {
		t.Fatalf("unexpected order: %s, %s, %s", got[0].posting.Company, got[1].posting.Company, got[2].posting.Company)
	}
}

func TestLocationMatches(t *testing.T) {
	cases := []struct {
		loc    string
		wanted []string
		ok     bool
	}{
		{"Lagos, Nigeria", []string{"Lagos"}, true},
		{"Abuja, Nigeria", []string{"Lagos, Nigeria"}, true},
		{"Berlin, Germany", []string{"Lagos, Nigeria"}, false},
		{"Remote - Worldwide", []string{"Remote"}, true},
		{"", []string{"London"}, true},
	}
	for _, c := range cases {
		if got := locationMatches(c.loc, c.wanted); got != c.ok {
			t.Errorf("locationMatches(%q, %v) = %v", c.loc, c.wanted, got)
		}
	}
}

func TestDetectApplyEmail(t *testing.T) {
	cases := []struct {
		p    sources.Posting
		want string
	}{
		{sources.Posting{Description: "To apply, send your CV to Jobs@Acme.io with the role in the subject."}, "jobs@acme.io"},
		{sources.Posting{ApplyURL: "mailto:hiring@acme.io?subject=Hi"}, "hiring@acme.io"},
		{sources.Posting{Description: "Questions? email privacy@acme.io"}, ""},
		{sources.Posting{ATS: sources.ATSGreenhouse, Description: "send your resume to jobs@acme.io"}, ""},
		{sources.Posting{Description: "Apply through our portal."}, ""},
	}
	for _, c := range cases {
		if got := detectApplyEmail(c.p); got != c.want {
			t.Errorf("detectApplyEmail(%+v) = %q, want %q", c.p, got, c.want)
		}
	}
}

func TestValidateFills(t *testing.T) {
	str := func(s string) *string { return &s }
	fields := map[string]FormField{
		"auth":   {FieldID: "auth", Label: "Authorized?", Type: "select", Required: true, Options: []string{"Yes", "No"}},
		"cv":     {FieldID: "cv", Label: "Resume", Type: "file", Required: true},
		"name":   {FieldID: "name", Label: "Name", Type: "text", Required: true},
		"langs":  {FieldID: "langs", Label: "Languages", Type: "checkbox", Options: []string{"Go", "Rust", "TypeScript"}},
		"secret": {FieldID: "secret", Label: "Clearance level", Type: "text", Required: true},
	}
	raw := FillResult{Fills: []FieldFill{
		{FieldID: "auth", Value: str("yes")},
		{FieldID: "cv", Value: str(prompts.ResumeFileToken)},
		{FieldID: "name", Value: str(prompts.ResumeFileToken)}, // token in a text field is dropped
		{FieldID: "langs", Value: str("go | typescript")},
		{FieldID: "ghost", Value: str("x")}, // unknown field dropped
	}}
	got := validateFills(raw, fields)
	vals := map[string]string{}
	for _, f := range got.Fills {
		if f.Value != nil {
			vals[f.FieldID] = *f.Value
		}
	}
	if vals["auth"] != "Yes" || vals["cv"] != prompts.ResumeFileToken || vals["langs"] != "Go | TypeScript" {
		t.Fatalf("unexpected fills %v", vals)
	}
	if _, ok := vals["name"]; ok {
		t.Fatal("file token must not fill a text field")
	}
	missing := map[string]bool{}
	for _, m := range got.Missing {
		missing[m.FieldID] = true
	}
	if !missing["name"] || !missing["secret"] || missing["cv"] {
		t.Fatalf("missing = %v", got.Missing)
	}
}

func TestQuestionKey(t *testing.T) {
	a := QuestionKey("Are you authorized to work in the US? *")
	b := QuestionKey("are you authorized to work in the us")
	if a != b {
		t.Fatalf("%q != %q", a, b)
	}
}

func TestSanitizeSearchPrefs(t *testing.T) {
	sp, err := sanitizeSearchPrefs(SearchPrefs{
		Titles:    []string{" Backend Engineer ", "backend engineer", ""},
		Seniority: []string{"Senior", "wizard"},
		Sources:   map[string]bool{sources.Remotive: true, "bogus": true},
		Watchlist: []sources.CompanyRef{{ATS: "greenhouse", Slug: "stripe"}, {ATS: "greenhouse", Slug: "Stripe"}},
	})
	if err != nil {
		t.Fatal(err)
	}
	if len(sp.Titles) != 1 || len(sp.Seniority) != 1 || sp.Seniority[0] != "senior" {
		t.Fatalf("titles=%v seniority=%v", sp.Titles, sp.Seniority)
	}
	if _, ok := sp.Sources["bogus"]; ok || len(sp.Watchlist) != 1 {
		t.Fatalf("sources=%v watchlist=%v", sp.Sources, sp.Watchlist)
	}
	if _, err := sanitizeSearchPrefs(SearchPrefs{Watchlist: []sources.CompanyRef{{ATS: "workday", Slug: "x"}}}); err == nil {
		t.Fatal("unsupported ATS must be rejected")
	}
	if _, err := sanitizeSearchPrefs(SearchPrefs{Watchlist: []sources.CompanyRef{{ATS: "lever", Slug: "../etc"}}}); err == nil {
		t.Fatal("path-like slugs must be rejected")
	}
}

func TestSuggestMailbox(t *testing.T) {
	s := &Service{cfg: &config.Config{AgentMailDomain: "agent.example.com"}}
	if got := s.suggestMailbox("Collins Adi", 0); got != "collins.adi@agent.example.com" {
		t.Fatalf("got %q", got)
	}
	if got := s.suggestMailbox("Zoë O'Brien-Smith", 2); got != "zo.obriensmith3@agent.example.com" {
		t.Fatalf("got %q", got)
	}
	if got := s.suggestMailbox("", 0); got != "agent@agent.example.com" {
		t.Fatalf("got %q", got)
	}
}

func TestExtractLinks(t *testing.T) {
	links := extractLinks(`<a href="https://x.io/verify?t=1&amp;u=2">Verify</a> or visit https://x.io/help.`)
	if len(links) != 2 || links[0] != "https://x.io/verify?t=1&u=2" || links[1] != "https://x.io/help" {
		t.Fatalf("links = %v", links)
	}
}

func TestCandidateBriefOmitsContactDetails(t *testing.T) {
	raw := `{"personal":{"full_name":"Jane","email":"jane@x.io","phone":"+1 555"},"experience":[{"title":"Engineer","company":"Acme","start_date":"2020-01","is_current":true}],"skills":{"technical":["Go"]},"meta":{"total_years_experience":4.2,"primary_role":"Backend Engineer"}}`
	brief := candidateBrief(parseResume(&raw), ApplicationProfile{Location: "Lagos, Nigeria"})
	for _, leak := range []string{"jane@x.io", "+1 555"} {
		if strings.Contains(brief, leak) {
			t.Fatalf("brief leaked %q: %s", leak, brief)
		}
	}
	for _, want := range []string{"Backend Engineer", "4.2 years", "Engineer at Acme", "Lagos, Nigeria", "Go"} {
		if !strings.Contains(brief, want) {
			t.Fatalf("brief missing %q: %s", want, brief)
		}
	}
}
