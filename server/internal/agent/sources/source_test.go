package sources

import (
	"context"
	"os"
	"strings"
	"testing"
	"time"
)

func TestTitleScore(t *testing.T) {
	q := Query{Titles: []string{"Backend Engineer", "Go Developer"}}
	cases := []struct {
		title string
		match bool
	}{
		{"Senior Backend Engineer", true},
		{"Backend Engineering Lead", true},
		{"Staff Software Engineer, Backend", true},
		{"Golang Developer", false}, // "golang" != "go": keywords cover this
		{"Go Developer (Remote)", true},
		{"Product Designer", false},
		{"Account Executive", false},
		{"Engineering Manager, Machine Learning", false},
		{"Backend Developer", true},
	}
	for _, c := range cases {
		if got := q.TitleMatches(c.title); got != c.match {
			t.Errorf("TitleMatches(%q) = %v (score %.2f), want %v", c.title, got, q.TitleScore(c.title), c.match)
		}
	}
	if (Query{}).TitleScore("anything") != 1 {
		t.Error("empty query should match everything")
	}
}

func TestSearchTermsDedupesAndCaps(t *testing.T) {
	q := Query{Titles: []string{"Backend Engineer", "backend engineer", "Go Developer"}, Keywords: []string{"golang", "postgres"}}
	got := q.SearchTerms(3)
	want := []string{"Backend Engineer", "Go Developer", "golang"}
	if strings.Join(got, "|") != strings.Join(want, "|") {
		t.Fatalf("SearchTerms = %v, want %v", got, want)
	}
}

func TestHTMLToText(t *testing.T) {
	in := "&lt;h2&gt;About&lt;/h2&gt;&lt;p&gt;We build &amp;amp; ship.&lt;/p&gt;&lt;ul&gt;&lt;li&gt;Go&lt;/li&gt;&lt;li&gt;SQL&lt;/li&gt;&lt;/ul&gt;"
	got := HTMLToText(in)
	for _, want := range []string{"About", "We build & ship.", "Go", "SQL"} {
		if !strings.Contains(got, want) {
			t.Fatalf("HTMLToText missing %q in %q", want, got)
		}
	}
	if strings.Contains(got, "<") {
		t.Fatalf("tags left in %q", got)
	}
	if got := HTMLToText("<script>alert(1)</script><p>ok</p>"); got != "ok" {
		t.Fatalf("script not stripped: %q", got)
	}
}

func TestDetectATS(t *testing.T) {
	cases := map[string]string{
		"https://job-boards.greenhouse.io/embed/job_app?for=stripe&token=1": ATSGreenhouse,
		"https://stripe.com/jobs/search?gh_jid=8172510":                     ATSGreenhouse,
		"https://jobs.lever.co/palantir/abc/apply":                          ATSLever,
		"https://jobs.ashbyhq.com/ramp/abc/application":                     ATSAshby,
		"https://acme.wd5.myworkdayjobs.com/en-US/careers/job/x":            ATSWorkday,
		"https://apply.workable.com/acme/j/123/":                            ATSWorkable,
		"https://remotive.com/remote-jobs/dev/x":                            ATSUnknown,
		"not a url":                                                         ATSUnknown,
	}
	for in, want := range cases {
		if got := DetectATS(in); got != want {
			t.Errorf("DetectATS(%q) = %q, want %q", in, got, want)
		}
	}
}

func TestNormalizeApplyURL(t *testing.T) {
	cases := map[string]string{
		"https://job-boards.greenhouse.io/discord/jobs/123":               "https://job-boards.greenhouse.io/embed/job_app?for=discord&token=123",
		"https://boards.greenhouse.io/stripe/jobs/8172510?gh_src=x":       "https://job-boards.greenhouse.io/embed/job_app?for=stripe&token=8172510",
		"https://job-boards.greenhouse.io/embed/job_app?for=a&token=1":    "https://job-boards.greenhouse.io/embed/job_app?for=a&token=1",
		"https://jobs.lever.co/palantir/abc-123":                          "https://jobs.lever.co/palantir/abc-123/apply",
		"https://jobs.lever.co/palantir/abc-123/apply":                    "https://jobs.lever.co/palantir/abc-123/apply",
		"https://jobs.ashbyhq.com/ramp/34413f8d?utm_source=x":             "https://jobs.ashbyhq.com/ramp/34413f8d/application",
		"https://jobs.ashbyhq.com/ramp/34413f8d/application":              "https://jobs.ashbyhq.com/ramp/34413f8d/application",
		"https://remotive.com/remote-jobs/software-development/x-2091165": "https://remotive.com/remote-jobs/software-development/x-2091165",
	}
	for in, want := range cases {
		if got := NormalizeApplyURL(in); got != want {
			t.Errorf("NormalizeApplyURL(%q) = %q, want %q", in, got, want)
		}
	}
}

func TestNormalizeEmploymentType(t *testing.T) {
	cases := map[string]string{
		"FullTime": "full_time", "Full-Time": "full_time", "full_time": "full_time",
		"Part-time": "part_time", "Contract": "contract", "Intern": "internship",
		"Unbefristeter arbeitsvertrag": "full_time", "": "", "weird": "",
	}
	for in, want := range cases {
		if got := NormalizeEmploymentType(in); got != want {
			t.Errorf("NormalizeEmploymentType(%q) = %q, want %q", in, got, want)
		}
	}
}

func TestJobicyTag(t *testing.T) {
	if got := jobicyTag("Senior Golang Engineer"); got != "golang" {
		t.Fatalf("jobicyTag = %q", got)
	}
	if got := jobicyTag("Engineer"); got != "engineer" {
		t.Fatalf("jobicyTag = %q", got)
	}
}

func TestCachedReusesValues(t *testing.T) {
	f := NewFetcher(time.Minute)
	calls := 0
	fn := func() (int, error) { calls++; return 42, nil }
	for range 3 {
		v, err := cached(f, "k", fn)
		if err != nil || v != 42 {
			t.Fatalf("cached = %v, %v", v, err)
		}
	}
	if calls != 1 {
		t.Fatalf("fn called %d times, want 1", calls)
	}
}

// TestLiveSources hits the real APIs. Run with AETHLARA_LIVE_SOURCES=1.
func TestLiveSources(t *testing.T) {
	if os.Getenv("AETHLARA_LIVE_SOURCES") == "" {
		t.Skip("set AETHLARA_LIVE_SOURCES=1 to query real job boards")
	}
	f := NewFetcher(time.Minute)
	q := Query{
		Titles:    []string{"Software Engineer", "Backend Engineer"},
		Keywords:  []string{"golang"},
		Companies: []CompanyRef{{ATSGreenhouse, "discord", "Discord"}, {ATSLever, "spotify", "Spotify"}, {ATSAshby, "linear", "Linear"}},
	}
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Minute)
	defer cancel()
	for id, src := range New(f) {
		postings, err := src.Search(ctx, q)
		if err != nil {
			t.Errorf("%s: %v", id, err)
			continue
		}
		t.Logf("%-10s %3d postings", id, len(postings))
		for i, p := range postings {
			if i >= 2 {
				break
			}
			t.Logf("    %q @ %q | %s | remote=%v | ats=%s | desc=%d chars | posted=%v", p.Title, p.Company, p.Location, p.IsRemote, p.ATS, len(p.Description), p.PostedAt)
			if p.Title == "" || p.URL == "" || p.ApplyURL == "" || p.ExternalID == "" {
				t.Errorf("%s: incomplete posting %+v", id, p)
			}
		}
	}
}

func TestRepairMojibake(t *testing.T) {
	cases := map[string]string{
		"Whatâ\u0080\u0099s Important": "What’s Important",         // Latin-1 decoded
		"Weâ€™re hiring 1â€“2 seniors": "We’re hiring 1–2 seniors", // Windows-1252 decoded
		"José from Zürich":             "José from Zürich",         // correct text untouched
		"We’re hiring – now":           "We’re hiring – now",       // correct punctuation untouched
		"Café ☕ and Ã©":                "Café ☕ and é",             // repaired run next to real emoji
		"plain ascii":                  "plain ascii",
	}
	for in, want := range cases {
		if got := RepairMojibake(in); got != want {
			t.Errorf("RepairMojibake(%q) = %q, want %q", in, got, want)
		}
	}
	if got := CleanText("  hims &#038; hers  "); got != "hims & hers" {
		t.Errorf("CleanText = %q", got)
	}
}
