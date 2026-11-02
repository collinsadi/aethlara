package agent

import (
	"context"
	"os"
	"testing"
	"time"

	"github.com/collinsadi/aethlara/internal/agent/sources"
	"github.com/collinsadi/aethlara/internal/ai"
	"github.com/collinsadi/aethlara/internal/config"
	"github.com/collinsadi/aethlara/internal/job"
)

// Replays leads shaped like ones that failed in production against the
// real internet (no AI). Run with AETHLARA_LIVE_SOURCES=1.
func TestResolveLive(t *testing.T) {
	if os.Getenv("AETHLARA_LIVE_SOURCES") != "1" {
		t.Skip("set AETHLARA_LIVE_SOURCES=1")
	}
	cfg := &config.Config{AppURL: "https://aethlara.example", ScraperRequestTimeoutSeconds: 20,
		ScraperMaxHTMLBytes: 5 << 20, ScraperUserAgent: "Mozilla/5.0 (compatible; Aethlara/1.0)"}
	s := &Service{cfg: cfg, ai: ai.NewClient(ai.Config{}), fetcher: sources.NewFetcher(time.Minute), lookupMX: hasMX}
	s.fetchPage = func(ctx context.Context, u string) (*job.Page, error) { return job.FetchPage(ctx, u, cfg) }

	leads := []*Lead{
		{Title: "Lightning Protocol Engineer (Remote)", Company: "Lightning Labs", URL: "https://lightning.engineering/careers", Source: sources.WebSearch},
		{Title: "Assets Protocol Engineer (Remote)", Company: "Lightning Labs", URL: "https://lightning.engineering/careers", Source: sources.WebSearch},
		{Title: "Full-Stack Software Engineer - Compliance", Company: "Ondo Finance", URL: "https://job-boards.greenhouse.io/ondofinance", Source: sources.WebSearch},
	}
	for _, l := range leads {
		ctx, cancel := context.WithTimeout(context.Background(), 2*time.Minute)
		start := time.Now()
		rp, clues := s.resolvePosting(ctx, "u1", l)
		if rp != nil {
			t.Logf("%-45s RESOLVED via %-13s %s (%d chars) apply=%s ats=%s [%s]", l.Title, rp.Via, rp.URL, len(rp.Description), rp.ApplyURL, rp.ATS, time.Since(start).Round(time.Millisecond))
		} else {
			ci := s.findContact(ctx, "u1", l, clues)
			t.Logf("%-45s NOT FOUND [%s]; domains=%v pages=%d contact=%+v", l.Title, time.Since(start).Round(time.Millisecond), clues.domains, clues.fetches, ci)
		}
		cancel()
	}
}
