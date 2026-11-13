package agent

import (
	"math/rand/v2"
	"testing"
	"time"
)

func mustLoc(t *testing.T, name string) *time.Location {
	t.Helper()
	loc, err := time.LoadLocation(name)
	if err != nil {
		t.Fatalf("load %s: %v", name, err)
	}
	return loc
}

func weekdayWindow(loc *time.Location) sendWindow {
	return sendWindow{loc: loc, start: 8, end: 18, weekdaysOnly: true}
}

func TestSendWindowNext(t *testing.T) {
	lagos := mustLoc(t, "Africa/Lagos")
	w := weekdayWindow(lagos)
	at := func(s string) time.Time {
		v, err := time.ParseInLocation("2006-01-02 15:04", s, lagos)
		if err != nil {
			t.Fatal(err)
		}
		return v
	}
	cases := []struct{ in, want string }{
		{"2026-11-16 06:30", "2026-11-16 08:00"}, // Monday before the window
		{"2026-11-16 10:15", "2026-11-16 10:15"}, // inside
		{"2026-11-16 18:00", "2026-11-17 08:00"}, // end is exclusive
		{"2026-11-20 19:00", "2026-11-23 08:00"}, // Friday evening -> Monday
		{"2026-11-21 11:00", "2026-11-23 08:00"}, // Saturday -> Monday
	}
	for _, c := range cases {
		if got := w.next(at(c.in)); !got.Equal(at(c.want)) {
			t.Errorf("next(%s) = %s, want %s", c.in, got.In(lagos).Format("Mon 2006-01-02 15:04"), c.want)
		}
	}
	everyDay := sendWindow{loc: lagos, start: 8, end: 18}
	if got := everyDay.next(at("2026-11-21 11:00")); !got.Equal(at("2026-11-21 11:00")) {
		t.Errorf("weekend should be open when weekdaysOnly is off, got %s", got)
	}
	if !w.contains(at("2026-11-16 17:59")) || w.contains(at("2026-11-16 18:00")) {
		t.Error("contains misreads the window edge")
	}
}

func TestWindowForFallsBackOnBadSettings(t *testing.T) {
	w := windowFor(ApplySettings{SendTimezone: "Mars/Olympus", SendWindowStart: 20, SendWindowEnd: 21})
	if w.loc != time.UTC || w.start != defaultSendWindowStart || w.end != defaultSendWindowEnd {
		t.Fatalf("windowFor = %+v", w)
	}
	w = windowFor(ApplySettings{SendTimezone: "America/New_York", SendWindowStart: 9, SendWindowEnd: 17, SendWeekdaysOnly: true})
	if w.loc.String() != "America/New_York" || w.start != 9 || w.end != 17 || !w.weekdaysOnly {
		t.Fatalf("windowFor = %+v", w)
	}
}

func TestSendPlanSpacesEmailsInsideTheWindow(t *testing.T) {
	lagos := mustLoc(t, "Africa/Lagos")
	now := time.Date(2026, 11, 16, 23, 10, 0, 0, lagos) // Monday night
	p := newSendPlan(weekdayWindow(lagos), 3, 30*time.Minute, 6*time.Minute, 18*time.Minute, nil, rand.New(rand.NewPCG(1, 2)))

	var got []time.Time
	for _, to := range []string{"jobs@a.io", "careers@b.io", "hr@c.io", "talent@d.io"} {
		got = append(got, p.slot(now, to))
	}
	tuesday := time.Date(2026, 11, 17, 8, 0, 0, 0, lagos)
	for i, at := range got[:3] {
		if at.Before(tuesday) || at.After(tuesday.Add(4*time.Hour)) {
			t.Errorf("email %d at %s, want Tuesday morning", i, at.In(lagos))
		}
		if i > 0 {
			if gap := at.Sub(got[i-1]); gap < 6*time.Minute || gap > 18*time.Minute {
				t.Errorf("gap before email %d = %s, want 6-18m", i, gap)
			}
		}
	}
	// The daily cap is 3: the fourth goes on Wednesday.
	if wed := time.Date(2026, 11, 18, 8, 0, 0, 0, lagos); got[3].Before(wed) || got[3].After(wed.Add(windowOpenSpread)) {
		t.Errorf("fourth email at %s, want Wednesday 08:00-08:25", got[3].In(lagos))
	}
}

func TestSendPlanDelayAndRecipientSpacing(t *testing.T) {
	now := time.Date(2026, 11, 16, 10, 0, 0, 0, time.UTC)
	prior := []plannedSend{{At: now.Add(-2 * time.Hour), To: "jobs@acme.io"}}
	p := newSendPlan(sendWindow{loc: time.UTC, start: 0, end: 24}, 50, 30*time.Minute, 6*time.Minute, 6*time.Minute, prior, rand.New(rand.NewPCG(3, 4)))

	first := p.slot(now, "careers@other.io")
	if first.Before(now.Add(30*time.Minute)) || first.After(now.Add(45*time.Minute)) {
		t.Errorf("first email at %s, want after the 30-45m delay", first)
	}
	// Same address as two hours ago: 24 hours after that one.
	again := p.slot(now, "JOBS@acme.io")
	if want := now.Add(22 * time.Hour); again.Before(want) {
		t.Errorf("repeat address at %s, want >= %s", again, want)
	}
	// Another address on the same company domain: at least 2 hours apart.
	sameDomain := p.slot(now, "hello@acme.io")
	if sameDomain.Sub(again) < sameDomainGap {
		t.Errorf("same-domain email %s after the previous one, want >= 2h", sameDomain.Sub(again))
	}
}

func TestSendPlanCountsEarlierMailAgainstTheCap(t *testing.T) {
	now := time.Date(2026, 11, 16, 9, 0, 0, 0, time.UTC)
	prior := []plannedSend{
		{At: now.Add(-50 * time.Minute), To: "a@x.io"},
		{At: now.Add(-40 * time.Minute), To: "b@y.io"},
	}
	p := newSendPlan(weekdayWindow(time.UTC), 2, 30*time.Minute, 6*time.Minute, 6*time.Minute, prior, rand.New(rand.NewPCG(5, 6)))
	if at := p.slot(now, "c@z.io"); at.Before(time.Date(2026, 11, 17, 8, 0, 0, 0, time.UTC)) {
		t.Errorf("cap already used today, got %s", at)
	}
}

func TestHoldUntil(t *testing.T) {
	w := weekdayWindow(time.UTC)
	now := time.Date(2026, 11, 16, 11, 0, 0, 0, time.UTC) // Monday 11:00
	minGap, gap := 6*time.Minute, 10*time.Minute

	if h := holdUntil(now, w, nil, "a@x.io", 5, minGap, gap, 0); !h.IsZero() {
		t.Errorf("no history should send now, got %s", h)
	}
	recent := []plannedSend{{At: now.Add(-2 * time.Minute), To: "b@y.io"}}
	if h := holdUntil(now, w, recent, "a@x.io", 5, minGap, gap, 0); !h.Equal(now.Add(8 * time.Minute)) {
		t.Errorf("hold after a recent send = %s, want last + gap", h)
	}
	old := []plannedSend{{At: now.Add(-7 * time.Minute), To: "b@y.io"}}
	if h := holdUntil(now, w, old, "a@x.io", 5, minGap, gap, 0); !h.IsZero() {
		t.Errorf("min gap passed, got hold %s", h)
	}
	sameAddr := []plannedSend{{At: now.Add(-3 * time.Hour), To: "a@x.io"}}
	if h := holdUntil(now, w, sameAddr, "A@x.io", 5, minGap, gap, 0); !h.Equal(now.Add(21 * time.Hour)) {
		t.Errorf("same address hold = %s, want 24h after the last email", h)
	}
	full := []plannedSend{{At: now.Add(-3 * time.Hour), To: "c@z.io"}, {At: now.Add(-2 * time.Hour), To: "d@z.io"}}
	if h := holdUntil(now, w, full, "a@x.io", 2, minGap, gap, 0); !h.Equal(time.Date(2026, 11, 17, 8, 0, 0, 0, time.UTC)) {
		t.Errorf("cap reached hold = %s, want the next window", h)
	}
	late := time.Date(2026, 11, 16, 17, 58, 0, 0, time.UTC)
	if h := holdUntil(late, w, []plannedSend{{At: late.Add(-time.Minute), To: "b@y.io"}}, "a@x.io", 5, minGap, gap, 0); !h.Equal(time.Date(2026, 11, 17, 8, 0, 0, 0, time.UTC)) {
		t.Errorf("a hold past the window end = %s, want the next window", h)
	}
}

func TestWarmupCap(t *testing.T) {
	for days, want := range map[int]int{-1: 5, 0: 5, 1: 8, 5: 20, 15: 50, 400: 50} {
		if got := warmupCap(days); got != want {
			t.Errorf("warmupCap(%d) = %d, want %d", days, got, want)
		}
	}
}

func TestValidateSending(t *testing.T) {
	ok := defaultApplySettings()
	ok.SendTimezone = "Europe/London"
	if err := validateSending(&ok); err != nil {
		t.Fatalf("valid settings rejected: %v", err)
	}
	for name, mutate := range map[string]func(*ApplySettings){
		"short window":   func(a *ApplySettings) { a.SendWindowStart, a.SendWindowEnd = 9, 10 },
		"end past 24":    func(a *ApplySettings) { a.SendWindowEnd = 25 },
		"tiny delay":     func(a *ApplySettings) { a.SendDelayMinutes = 1 },
		"bad zone":       func(a *ApplySettings) { a.SendTimezone = "Nowhere/Land" },
		"local is a lie": func(a *ApplySettings) { a.SendTimezone = "Local" },
	} {
		as := defaultApplySettings()
		mutate(&as)
		if err := validateSending(&as); err == nil {
			t.Errorf("%s: accepted %+v", name, as)
		}
	}
}
