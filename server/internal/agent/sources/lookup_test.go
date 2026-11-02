package sources

import (
	"context"
	"os"
	"testing"
	"time"
)

func TestParseATSURL(t *testing.T) {
	cases := []struct {
		in   string
		want ATSRef
		ok   bool
	}{
		{"https://job-boards.greenhouse.io/embed/job_app?for=ondofinance&token=4012345", ATSRef{ATS: ATSGreenhouse, Slug: "ondofinance", ID: "4012345"}, true},
		{"https://boards.greenhouse.io/embed/job_board?for=acme", ATSRef{ATS: ATSGreenhouse, Slug: "acme"}, true},
		{"https://boards.greenhouse.io/acme/jobs/123456", ATSRef{ATS: ATSGreenhouse, Slug: "acme", ID: "123456"}, true},
		{"https://job-boards.greenhouse.io/ondofinance", ATSRef{ATS: ATSGreenhouse, Slug: "ondofinance"}, true},
		{"https://boards-api.greenhouse.io/v1/boards/acme/jobs/987654", ATSRef{ATS: ATSGreenhouse, Slug: "acme", ID: "987654"}, true},
		{"https://jobs.lever.co/acme/0b1c2d3e-4f50-6172-8394-a5b6c7d8e9f0/apply", ATSRef{ATS: ATSLever, Slug: "acme", ID: "0b1c2d3e-4f50-6172-8394-a5b6c7d8e9f0"}, true},
		{"https://jobs.eu.lever.co/acme", ATSRef{ATS: ATSLever, Slug: "acme", EU: true}, true},
		{"https://jobs.ashbyhq.com/lightning/9F3E2D1C-0B4A-4C5D-8E6F-7A8B9C0D1E2F/application", ATSRef{ATS: ATSAshby, Slug: "lightning", ID: "9f3e2d1c-0b4a-4c5d-8e6f-7a8b9c0d1e2f"}, true},
		{"https://jobs.ashbyhq.com/lightning", ATSRef{ATS: ATSAshby, Slug: "lightning"}, true},
		{"https://lightning.engineering/careers", ATSRef{}, false},
		{"https://acme.com/careers?gh_jid=123", ATSRef{}, false},
		{"https://jobs.ashbyhq.com/api/whatever", ATSRef{}, false},
	}
	for _, c := range cases {
		got, ok := ParseATSURL(c.in)
		if ok != c.ok || got != c.want {
			t.Errorf("ParseATSURL(%q) = %+v, %v; want %+v, %v", c.in, got, ok, c.want, c.ok)
		}
	}
}

func TestFindATSRefs(t *testing.T) {
	page := `<a href="https://jobs.ashbyhq.com/lightning">Open roles</a>
<script src="https://boards.greenhouse.io/embed/job_board/js?for=ondofinance"></script>
<a href='//jobs.lever.co/acme/0b1c2d3e-4f50-6172-8394-a5b6c7d8e9f0'>Backend</a>
<script>Grnhse.Settings.boardToken = "tokenco";</script>
<a href="https://job-boards.greenhouse.io/embed/job_app?for=ondofinance&amp;token=4012345">Apply</a>`
	refs := FindATSRefs(page)
	want := []ATSRef{
		{ATS: ATSAshby, Slug: "lightning"},
		{ATS: ATSGreenhouse, Slug: "ondofinance"},
		{ATS: ATSLever, Slug: "acme", ID: "0b1c2d3e-4f50-6172-8394-a5b6c7d8e9f0"},
		{ATS: ATSGreenhouse, Slug: "ondofinance", ID: "4012345"},
		{ATS: ATSGreenhouse, Slug: "tokenco"},
	}
	if len(refs) != len(want) {
		t.Fatalf("got %d refs %+v, want %d", len(refs), refs, len(want))
	}
	for i := range want {
		if refs[i] != want[i] {
			t.Errorf("ref %d = %+v, want %+v", i, refs[i], want[i])
		}
	}
}

func TestSameRole(t *testing.T) {
	cases := []struct {
		want, got string
		max       int
		ok        bool
	}{
		{"Lightning Protocol Engineer (Remote)", "Lightning Protocol Engineer (Remote)", 0, true},
		{"Lightning Protocol Engineer", "Senior Lightning Protocol Engineer - Remote", 0, true},
		{"Smart Contract QA Engineer, Atlas Oracle", "Smart Contract QA Engineer - Atlas Oracle", 0, true},
		{"Full Stack Engineer", "Full-Stack Engineer", 0, true},
		// The posting the user approved is not on the board: the closest
		// title differs in its distinctive word and must not match.
		{"Full-Stack Software Engineer - Compliance", "Full-Stack Software Engineer - Growth", 2, false},
		{"Backend Engineer", "Backend Engineer, Payments (Berlin)", 2, true},
		{"Backend Engineer", "Backend Engineer, Payments (Berlin)", 1, false},
		{"Engineer", "Engineer", 2, false}, // too vague to match anything
		{"Data Engineer", "Data Scientist", 2, false},
	}
	for _, c := range cases {
		if ok, _ := SameRole(c.want, c.got, c.max); ok != c.ok {
			t.Errorf("SameRole(%q, %q, %d) = %v, want %v", c.want, c.got, c.max, ok, c.ok)
		}
	}
	postings := []Posting{{Title: "Backend Engineer, Payments (Berlin)"}, {Title: "Backend Engineer"}, {Title: "Frontend Engineer"}}
	if i := BestRole("Senior Backend Engineer", postings, 2); i != 1 {
		t.Errorf("BestRole picked %d, want the exact title (1)", i)
	}
}

func TestGuessBoardSlugs(t *testing.T) {
	got := GuessBoardSlugs("Lightning Labs", []string{"lightning.engineering"})
	want := []string{"lightninglabs", "lightning-labs", "lightning"}
	if len(got) != len(want) {
		t.Fatalf("got %v, want %v", got, want)
	}
	for i := range want {
		if got[i] != want[i] {
			t.Fatalf("got %v, want %v", got, want)
		}
	}
	if g := GuessBoardSlugs("Acme, Inc.", nil); len(g) == 0 || g[0] != "acme" {
		t.Errorf("legal suffix not dropped: %v", g)
	}
}

// Live check against the real boards behind two leads that failed in
// production. Run with AETHLARA_LIVE_SOURCES=1.
func TestFindOnBoardLive(t *testing.T) {
	if os.Getenv("AETHLARA_LIVE_SOURCES") != "1" {
		t.Skip("set AETHLARA_LIVE_SOURCES=1")
	}
	ctx, cancel := context.WithTimeout(context.Background(), time.Minute)
	defer cancel()
	f := NewFetcher(time.Minute)
	for _, title := range []string{"Lightning Protocol Engineer (Remote)", "Assets Protocol Engineer (Remote)"} {
		p, err := FindOnBoard(ctx, f, ATSRef{ATS: ATSAshby, Slug: "lightning"}, title, 1)
		if err != nil || p == nil {
			t.Fatalf("%s: %v %v", title, p, err)
		}
		t.Logf("%s -> %s (%d chars) apply %s", title, p.URL, len(p.Description), p.ApplyURL)
		if len(p.Description) < 500 {
			t.Errorf("%s: description too short", title)
		}
	}
	p, err := FindOnBoard(ctx, f, ATSRef{ATS: ATSGreenhouse, Slug: "ondofinance"}, "Full-Stack Software Engineer - Compliance", 2)
	if err != nil || p != nil {
		t.Errorf("Ondo: want no match, got %v %v", p, err)
	}
	p, err = FindOnBoard(ctx, f, ATSRef{ATS: ATSGreenhouse, Slug: "ondofinance"}, "Full-Stack Software Engineer - Growth", 1)
	if err != nil || p == nil || len(p.Description) < 500 {
		t.Fatalf("Ondo Growth: %v %v", p, err)
	}
	t.Logf("Ondo Growth -> %s (%d chars) apply %s", p.URL, len(p.Description), p.ApplyURL)
	b, err := BoardPostings(ctx, f, ATSRef{ATS: ATSLever, Slug: "lightninglabs"})
	if err != nil || b.Found {
		t.Errorf("missing board should be Found=false: %+v %v", b, err)
	}
	if n := GreenhouseBoardName(ctx, f, "ondofinance"); n == "" {
		t.Errorf("no board name for ondofinance")
	} else {
		t.Logf("ondofinance board name: %q", n)
	}
}
