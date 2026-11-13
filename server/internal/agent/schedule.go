package agent

import (
	"context"
	"math/rand/v2"
	"strings"
	"time"
)

// Send pacing. Prepared emails never go out during the run. Each one gets a
// send time that:
//   - waits at least the user's delay (send_delay_minutes, an undo window),
//   - falls inside the user's sending window (by default weekdays
//     08:00-18:00 in their timezone), when recruiters read mail,
//   - leaves a random gap of several minutes after the mailbox's previous
//     email, so mail trickles out the way a person sends it rather than in
//     a burst,
//   - keeps 24 hours between emails to the same address and 2 hours
//     between emails to the same company domain,
//   - fits a daily cap that starts low for a new mailbox and ramps up over
//     about two weeks (warm-up), never above the user's daily limit.
// A burst of identical-looking mail from a new address is the strongest
// spam signal a small sender controls; pacing is how the agent avoids it.

const (
	sameRecipientGap = 24 * time.Hour
	sameDomainGap    = 2 * time.Hour
	// windowOpenSpread spreads mail held overnight over the first minutes
	// of the window instead of sending it all at its first second.
	windowOpenSpread = 25 * time.Minute
	// planLookback loads enough history to count today's mail in any
	// timezone and to apply the per-recipient gap.
	planLookback = 48 * time.Hour
)

// Sending defaults (see ApplySettings).
const (
	defaultSendDelayMinutes = 30
	defaultSendWindowStart  = 8
	defaultSendWindowEnd    = 18
	minSendWindowHours      = 2
	maxSendDelayMinutes     = 24 * 60
	minSendDelayMinutes     = 5
)

// warmupCap is how many emails a mailbox may send per day, days after its
// first email: 5 on day one, 3 more each day, at most 50.
func warmupCap(days int) int {
	if days < 0 {
		days = 0
	}
	return min(5+3*days, 50)
}

// sendWindow is when a user's agent may send mail.
type sendWindow struct {
	loc          *time.Location
	start, end   int // local hours, [start, end)
	weekdaysOnly bool
}

// windowFor reads the sending window from the apply settings; invalid or
// unknown values fall back to the defaults.
func windowFor(as ApplySettings) sendWindow {
	loc := time.UTC
	if as.SendTimezone != "" {
		if l, err := time.LoadLocation(as.SendTimezone); err == nil {
			loc = l
		}
	}
	start, end := as.SendWindowStart, as.SendWindowEnd
	if start < 0 || start > 23 || end > 24 || end-start < minSendWindowHours {
		start, end = defaultSendWindowStart, defaultSendWindowEnd
	}
	return sendWindow{loc: loc, start: start, end: end, weekdaysOnly: as.SendWeekdaysOnly}
}

func (w sendWindow) openOn(day time.Time) bool {
	wd := day.Weekday()
	return !w.weekdaysOnly || (wd != time.Saturday && wd != time.Sunday)
}

// next returns the earliest moment at or after t inside the window.
func (w sendWindow) next(t time.Time) time.Time {
	lt := t.In(w.loc)
	for range 8 {
		y, m, d := lt.Date()
		start := time.Date(y, m, d, w.start, 0, 0, 0, w.loc)
		end := time.Date(y, m, d, w.end, 0, 0, 0, w.loc)
		if w.openOn(start) {
			if lt.Before(start) {
				return start
			}
			if lt.Before(end) {
				return lt
			}
		}
		lt = time.Date(y, m, d+1, 0, 0, 0, 0, w.loc)
	}
	return t
}

// contains reports whether t is inside the window.
func (w sendWindow) contains(t time.Time) bool {
	return w.next(t).Equal(t)
}

// day is t's local calendar date, the unit of the daily cap.
func (w sendWindow) day(t time.Time) string {
	return t.In(w.loc).Format("2006-01-02")
}

// nextDay is local midnight after t.
func (w sendWindow) nextDay(t time.Time) time.Time {
	y, m, d := t.In(w.loc).Date()
	return time.Date(y, m, d+1, 0, 0, 0, 0, w.loc)
}

// sendPlan hands out send times for one mailbox, given what it already
// sent or scheduled.
type sendPlan struct {
	window     sendWindow
	dailyCap   int
	delay      time.Duration
	minGap     time.Duration
	maxGap     time.Duration
	perDay     map[string]int
	last       time.Time
	lastTo     map[string]time.Time
	lastDomain map[string]time.Time
	rnd        *rand.Rand
}

func newSendPlan(w sendWindow, dailyCap int, delay, minGap, maxGap time.Duration, prior []plannedSend, rnd *rand.Rand) *sendPlan {
	if maxGap < minGap {
		maxGap = minGap
	}
	p := &sendPlan{
		window: w, dailyCap: max(dailyCap, 1), delay: delay, minGap: minGap, maxGap: maxGap,
		perDay: map[string]int{}, lastTo: map[string]time.Time{}, lastDomain: map[string]time.Time{}, rnd: rnd,
	}
	for _, s := range prior {
		p.record(s.At, s.To)
	}
	return p
}

func (p *sendPlan) record(at time.Time, to string) {
	to = strings.ToLower(to)
	p.perDay[p.window.day(at)]++
	if at.After(p.last) {
		p.last = at
	}
	if at.After(p.lastTo[to]) {
		p.lastTo[to] = at
	}
	if d := domainOf(to); at.After(p.lastDomain[d]) {
		p.lastDomain[d] = at
	}
}

// jitter returns a random duration in [0, upTo).
func (p *sendPlan) jitter(upTo time.Duration) time.Duration {
	if upTo <= 0 || p.rnd == nil {
		return 0
	}
	return time.Duration(p.rnd.Int64N(int64(upTo)))
}

// slot picks the send time for an email to address prepared at now, and
// records it so the next email is spaced after it.
func (p *sendPlan) slot(now time.Time, address string) time.Time {
	address = strings.ToLower(address)
	t := now.Add(p.delay + p.jitter(p.delay/2))
	if !p.last.IsZero() {
		t = later(t, p.last.Add(p.minGap+p.jitter(p.maxGap-p.minGap)))
	}
	if v, ok := p.lastTo[address]; ok {
		t = later(t, v.Add(sameRecipientGap))
	}
	if v, ok := p.lastDomain[domainOf(address)]; ok {
		t = later(t, v.Add(sameDomainGap))
	}
	for range 60 {
		if w := p.window.next(t); !w.Equal(t) {
			t = w.Add(p.jitter(windowOpenSpread))
		}
		if p.perDay[p.window.day(t)] < p.dailyCap {
			break
		}
		t = p.window.nextDay(t)
	}
	t = t.Truncate(time.Second)
	p.record(t, address)
	return t
}

func later(a, b time.Time) time.Time {
	if b.After(a) {
		return b
	}
	return a
}

func domainOf(address string) string {
	_, d, _ := strings.Cut(strings.ToLower(address), "@")
	return d
}

// holdUntil is the send-time pacing check. Emails become due in bunches
// (after a pause, downtime, or a window that closed) and must still go out
// spaced: it returns when an email to address should go instead, given the
// mailbox's sent history, or the zero time when it may go now. It holds
// the email when the last one left less than minGap ago (and then waits
// gap, a random value of at least minGap), when the address got an email
// in the last 24 hours, or when today's cap is used up.
func holdUntil(now time.Time, w sendWindow, sent []plannedSend, address string, dailyCap int, minGap, gap, openJitter time.Duration) time.Time {
	address = strings.ToLower(address)
	var last, lastTo time.Time
	today := 0
	for _, s := range sent {
		if s.At.After(last) {
			last = s.At
		}
		if s.To == address && s.At.After(lastTo) {
			lastTo = s.At
		}
		if w.day(s.At) == w.day(now) {
			today++
		}
	}
	hold := time.Time{}
	if !last.IsZero() && now.Before(last.Add(minGap)) {
		hold = last.Add(max(gap, minGap))
	}
	if !lastTo.IsZero() && now.Before(lastTo.Add(sameRecipientGap)) {
		hold = later(hold, lastTo.Add(sameRecipientGap))
	}
	if today >= max(dailyCap, 1) {
		hold = later(hold, w.next(w.nextDay(now)).Add(openJitter))
	}
	if !hold.IsZero() && !w.contains(hold) {
		hold = w.next(hold).Add(openJitter)
	}
	return hold
}

// ── Service glue ──────────────────────────────────────────────────────────────

// sendGaps returns the configured range of the gap between two emails from
// one mailbox.
func (s *Service) sendGaps() (time.Duration, time.Duration) {
	lo, hi := s.cfg.AgentMailMinGapMinutes, s.cfg.AgentMailMaxGapMinutes
	if lo <= 0 {
		lo = 6
	}
	if hi < lo {
		hi = lo
	}
	return time.Duration(lo) * time.Minute, time.Duration(hi) * time.Minute
}

// dailySendCap is how many emails the user's mailbox may send per day now:
// the user's daily limit, bounded by the server ceiling and the mailbox's
// warm-up. warming is true while the warm-up is the binding limit.
func (s *Service) dailySendCap(ctx context.Context, p *Profile, now time.Time) (limit int, warming bool) {
	limit = max(p.ApplySettings.DailyLimit, 1)
	if ceiling := s.cfg.AgentMailMaxPerMailboxDay; ceiling > 0 && limit > ceiling {
		limit = ceiling
	}
	days := 0
	if first, err := s.repo.FirstOutboundAt(ctx, p.UserID); err == nil && first != nil {
		days = int(now.Sub(*first).Hours() / 24)
	}
	if w := warmupCap(days); w < limit {
		return w, true
	}
	return limit, false
}

// loadSendPlan builds the user's send plan from what their mailbox has sent
// and scheduled.
func (s *Service) loadSendPlan(ctx context.Context, p *Profile, now time.Time) (*sendPlan, error) {
	prior, err := s.repo.PlannedSends(ctx, p.UserID, now.Add(-planLookback))
	if err != nil {
		return nil, err
	}
	limit, _ := s.dailySendCap(ctx, p, now)
	minGap, maxGap := s.sendGaps()
	delay := time.Duration(p.ApplySettings.SendDelayMinutes) * time.Minute
	return newSendPlan(windowFor(p.ApplySettings), limit, delay, minGap, maxGap, prior, newRand()), nil
}

func newRand() *rand.Rand {
	return rand.New(rand.NewPCG(uint64(time.Now().UnixNano()), rand.Uint64()))
}
