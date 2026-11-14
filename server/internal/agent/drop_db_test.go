package agent

import (
	"context"
	"fmt"
	"os"
	"strings"
	"sync"
	"testing"

	"github.com/collinsadi/aethlara/internal/job"
)

// tailorJobs tailors every lead to the fixture's job row and records which.
type tailorJobs struct {
	*stubJobs
	jobID    string
	mu       sync.Mutex
	tailored []string
}

func (j *tailorJobs) TailorForLead(_ context.Context, _ string, in job.LeadTailorInput) (*job.LeadTailorResult, error) {
	j.mu.Lock()
	defer j.mu.Unlock()
	j.tailored = append(j.tailored, in.Company)
	return &job.LeadTailorResult{Job: &job.Job{ID: j.jobID}}, nil
}

func (j *tailorJobs) GetTailoredContext(_ context.Context, jobID, _ string) (*job.TailoredContext, error) {
	return &job.TailoredContext{Job: &job.Job{ID: jobID}}, nil
}

// Jobs with no address are dropped before any tailoring, without using the
// send budget, so a job with an address further down the queue still goes
// out in the same pass.
func TestApplyQueuedDropsJobsWithoutAnAddress(t *testing.T) {
	f := newDBFixture(t)
	ctx := context.Background()
	jobs := &tailorJobs{stubJobs: f.jobs, jobID: f.jobRowID}
	f.s.jobs = jobs
	f.s.fetchPage = func(_ context.Context, rawURL string) (*job.Page, error) {
		return &job.Page{URL: rawURL, HTML: "<html><body><p>We are hiring. Apply on our careers site.</p></body></html>"}, nil
	}
	f.profile.ApplySettings.CoverLetters = false // the template, no AI

	description := strings.Repeat("Build and run backend services in Go and Postgres. ", 20)
	queue := func(company, applyEmail string) string {
		t.Helper()
		lead := Lead{UserID: f.userID, Source: "manual", DedupeKey: dedupeKey(company, "Backend Engineer"),
			Title: "Backend Engineer", Company: company, URL: "https://" + strings.ToLower(company) + ".io/jobs/backend",
			Description: description, Status: LeadApproved}
		if applyEmail != "" {
			lead.ApplyEmail = &applyEmail
		}
		stored, err := f.repo.InsertLead(ctx, lead)
		if err != nil || stored == nil {
			t.Fatalf("insert lead: %v", err)
		}
		app, err := f.repo.QueueApplication(ctx, f.userID, stored.ID)
		if err != nil {
			t.Fatal(err)
		}
		return app.ID
	}
	var dropped []string
	for i := range 6 { // more than the first-day warm-up cap of 5
		dropped = append(dropped, queue(fmt.Sprintf("Nomail%d", i), ""))
	}
	sent := queue("Acme", "jobs@acme.io")

	run, err := f.repo.StartRun(ctx, f.userID, "manual")
	if err != nil || run == nil {
		t.Fatalf("start run: %v", err)
	}
	var stats RunStats
	if err := f.s.applyQueued(ctx, run, f.profile, f.resume, &stats); err != nil {
		t.Fatalf("applyQueued: %v", err)
	}

	if stats.Dropped != 6 || stats.EmailsScheduled != 1 || stats.Prepared != 1 {
		t.Fatalf("stats = %+v, want 6 dropped, 1 prepared and scheduled", stats)
	}
	if len(jobs.tailored) != 1 || jobs.tailored[0] != "Acme" {
		t.Fatalf("tailored %v, want only Acme", jobs.tailored)
	}
	for _, id := range dropped {
		app, _ := f.repo.GetApplication(ctx, f.userID, id)
		if app.Status != AppCancelled || app.Needs != nil || app.LastError == nil || app.OutboxID != nil {
			t.Fatalf("dropped app = %+v", app)
		}
		lead, _ := f.repo.GetLead(ctx, f.userID, app.LeadID)
		if lead.Status != LeadDismissed || lead.DismissReason == nil || *lead.DismissReason != dismissNoEmail {
			t.Fatalf("dropped lead = status %s reason %v", lead.Status, lead.DismissReason)
		}
	}
	app, _ := f.repo.GetApplication(ctx, f.userID, sent)
	if app.Status != AppScheduled || app.OutboxID == nil {
		t.Fatalf("app with an address = %+v, want scheduled", app)
	}
	o, _ := f.repo.GetOutbox(ctx, f.userID, *app.OutboxID)
	if o == nil || o.ToAddress != "jobs@acme.io" || o.Status != OutboxScheduled {
		t.Fatalf("outbox = %+v", o)
	}
}

// Applications parked for an address before jobs were dropped are dropped
// by migration 014; this replays it on a parked row.
func TestMigrationDropsParkedNoEmailApplications(t *testing.T) {
	f := newDBFixture(t)
	ctx := context.Background()
	lead, err := f.repo.InsertLead(ctx, Lead{UserID: f.userID, Source: "manual", DedupeKey: dedupeKey("Zen", "Engineer"),
		Title: "Engineer", Company: "Zen", URL: "https://zen.io/jobs/1", Status: LeadApplying})
	if err != nil || lead == nil {
		t.Fatalf("insert lead: %v", err)
	}
	app, err := f.repo.QueueApplication(ctx, f.userID, lead.ID)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := f.pool.Exec(ctx, `UPDATE applications SET status = 'needs_input',
		needs = '{"reason":"no_email","message":"Zen publishes no address."}' WHERE id = $1`, app.ID); err != nil {
		t.Fatal(err)
	}
	sql, err := os.ReadFile("../database/migrations/014_drop_no_email.sql")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := f.pool.Exec(ctx, string(sql)); err != nil {
		t.Fatalf("replay migration: %v", err)
	}
	got, _ := f.repo.GetApplication(ctx, f.userID, app.ID)
	l, _ := f.repo.GetLead(ctx, f.userID, lead.ID)
	if got.Status != AppCancelled || got.Needs != nil || got.LastError == nil || *got.LastError != "Zen publishes no address." {
		t.Fatalf("app = %+v", got)
	}
	if l.Status != LeadDismissed || l.DismissReason == nil || *l.DismissReason != dismissNoEmail {
		t.Fatalf("lead = %s %v", l.Status, l.DismissReason)
	}
}
