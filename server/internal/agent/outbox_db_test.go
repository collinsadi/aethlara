package agent

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"math/rand/v2"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"strconv"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/collinsadi/aethlara/internal/ai"
	"github.com/collinsadi/aethlara/internal/config"
	"github.com/collinsadi/aethlara/internal/database"
	"github.com/collinsadi/aethlara/internal/email"
	"github.com/collinsadi/aethlara/internal/job"
)

// The send queue against a real Postgres. Set AETHLARA_TEST_DATABASE_URL to
// a server URL (e.g. postgres://postgres@127.0.0.1:5432/postgres); the test
// creates a throwaway database, runs every migration and drops it after.

func freshDB(t *testing.T) *pgxpool.Pool {
	t.Helper()
	base := os.Getenv("AETHLARA_TEST_DATABASE_URL")
	if base == "" {
		t.Skip("set AETHLARA_TEST_DATABASE_URL to run the database tests")
	}
	ctx := context.Background()
	admin, err := pgx.Connect(ctx, base)
	if err != nil {
		t.Fatalf("connect: %v", err)
	}
	name := fmt.Sprintf("aethlara_test_%d", time.Now().UnixNano())
	if _, err := admin.Exec(ctx, "CREATE DATABASE "+name); err != nil {
		t.Fatalf("create database: %v", err)
	}
	u, _ := url.Parse(base)
	u.Path = "/" + name
	pool, err := pgxpool.New(ctx, u.String())
	if err != nil {
		t.Fatalf("pool: %v", err)
	}
	t.Cleanup(func() {
		pool.Close()
		_, _ = admin.Exec(context.Background(), "DROP DATABASE IF EXISTS "+name)
		_ = admin.Close(context.Background())
	})
	if err := database.RunMigrations(ctx, pool); err != nil {
		t.Fatalf("migrations: %v", err)
	}
	return pool
}

// stubJobs is the part of the job service the send queue uses.
type stubJobs struct {
	job.Service
	mu       sync.Mutex
	advanced []string
}

func (j *stubJobs) DownloadPDF(context.Context, string, string) ([]byte, error) {
	return []byte("%PDF-1.4 tailored"), nil
}

func (j *stubJobs) AdvanceStatus(_ context.Context, jobID, _, target string) (*job.Job, error) {
	j.mu.Lock()
	defer j.mu.Unlock()
	j.advanced = append(j.advanced, jobID+":"+target)
	return &job.Job{ID: jobID, Status: target}, nil
}

// fakeResendAPI records the emails it is asked to send.
type fakeResendAPI struct {
	mu   sync.Mutex
	sent []map[string]any
	keys []string
}

func (f *fakeResendAPI) handler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost || r.URL.Path != "/emails" {
		w.WriteHeader(http.StatusNotFound)
		return
	}
	var body map[string]any
	_ = json.NewDecoder(r.Body).Decode(&body)
	f.mu.Lock()
	f.sent = append(f.sent, body)
	f.keys = append(f.keys, r.Header.Get("Idempotency-Key"))
	n := len(f.sent)
	f.mu.Unlock()
	w.Header().Set("Content-Type", "application/json")
	_, _ = io.WriteString(w, fmt.Sprintf(`{"id":"re_%d"}`, n))
}

type dbFixture struct {
	s        *Service
	repo     *Repository
	pool     *pgxpool.Pool
	api      *fakeResendAPI
	jobs     *stubJobs
	userID   string
	resume   *ResumeInfo
	profile  *Profile
	secret   string
	jobRowID string
}

func newDBFixture(t *testing.T) *dbFixture {
	t.Helper()
	pool := freshDB(t)
	ctx := context.Background()
	f := &dbFixture{pool: pool, repo: NewRepository(pool), api: &fakeResendAPI{}, jobs: &stubJobs{}}
	srv := httptest.NewServer(http.HandlerFunc(f.api.handler))
	t.Cleanup(srv.Close)

	f.secret = "whsec_" + base64.StdEncoding.EncodeToString([]byte("test-signing-key-thirty-two-bytes"))
	cfg := &config.Config{
		AgentMailDomain: "mail.agentbox.io", ResendWebhookSecret: f.secret, DashboardURL: "https://app.agentbox.io",
		AppName: "Aethlara", AgentMailMinGapMinutes: 6, AgentMailMaxGapMinutes: 6, AgentMailMaxPerMailboxDay: 40,
	}
	mail := email.NewClient("re_test", "noreply@agentbox.io", "Aethlara", "Aethlara", false)
	mail.SetBaseURL(srv.URL)
	f.s = &Service{repo: f.repo, jobs: f.jobs, ai: ai.NewClient(ai.Config{}), mail: mail, agentMail: mail, cfg: cfg,
		lookupMX: func(context.Context, string) bool { return true }}

	must := func(err error) {
		t.Helper()
		if err != nil {
			t.Fatal(err)
		}
	}
	must(pool.QueryRow(ctx, `INSERT INTO users (full_name, email) VALUES ('Jane Doe', 'jane@personal.io') RETURNING id`).Scan(&f.userID))
	var resumeID string
	must(pool.QueryRow(ctx, `INSERT INTO resumes (user_id, name, original_filename, file_format, file_size_bytes, r2_object_key, extraction_status, extracted_json)
		VALUES ($1, 'Main', 'cv.pdf', 'pdf', 1000, 'k/cv.pdf', 'completed', '{}') RETURNING id`, f.userID).Scan(&resumeID))
	must(pool.QueryRow(ctx, `INSERT INTO jobs (user_id, resume_id, input_method, job_title, company) VALUES ($1, $2, 'agent', 'Backend Engineer', 'Acme') RETURNING id`,
		f.userID, resumeID).Scan(&f.jobRowID))
	var err error
	f.resume, err = f.repo.GetResume(ctx, f.userID, resumeID)
	must(err)

	mailbox := "jane.doe@mail.agentbox.io"
	as := defaultApplySettings()
	as.SendWindowStart, as.SendWindowEnd, as.SendWeekdaysOnly = 0, 24, false // always open: the test runs any time
	f.profile, err = f.repo.CreateProfile(ctx, Profile{UserID: f.userID, ResumeID: &resumeID, MailboxAddress: &mailbox,
		ApplySettings: as, RunIntervalHours: 24})
	must(err)
	return f
}

// scheduledApp creates an approved lead with an application whose email to
// to is due now.
func (f *dbFixture) scheduledApp(t *testing.T, title, to string) (*Application, *OutboxEmail) {
	t.Helper()
	ctx := context.Background()
	lead, err := f.repo.InsertLead(ctx, Lead{UserID: f.userID, Source: "manual", DedupeKey: dedupeKey("Acme", title),
		Title: title, Company: "Acme", URL: "https://acme.io/jobs/" + strings.ReplaceAll(title, " ", "-"), Status: LeadApplying})
	if err != nil || lead == nil {
		t.Fatalf("insert lead: %v", err)
	}
	app, err := f.repo.QueueApplication(ctx, f.userID, lead.ID)
	if err != nil {
		t.Fatal(err)
	}
	app.JobID = &f.jobRowID
	body := "Dear Hiring Team,\n\nI would like to apply for the " + title + " role.\n\nBest regards,\nJane Doe"
	app.CoverLetter = &body
	app.ApplyEmail = &to
	app.RecipientKind = strPtr(RecipientPosting)
	plan := newSendPlan(windowFor(f.profile.ApplySettings), 40, 0, 0, 0, nil, rand.New(rand.NewPCG(1, 1)))
	if _, err := f.s.scheduleEmail(ctx, f.profile, plan, f.resume, []*Application{app}, OutboxApplication, to,
		applicationSubject(lead, "Jane Doe"), body); err != nil {
		t.Fatalf("schedule: %v", err)
	}
	got, _ := f.repo.GetApplication(ctx, f.userID, app.ID)
	o, _ := f.repo.GetOutbox(ctx, f.userID, *got.OutboxID)
	if got.Status != AppScheduled || o == nil || o.Status != OutboxScheduled || got.ScheduledAt == nil {
		t.Fatalf("not scheduled: app %+v outbox %+v", got, o)
	}
	return got, o
}

func (f *dbFixture) webhook(t *testing.T, payload string) error {
	t.Helper()
	key, _ := base64.StdEncoding.DecodeString(strings.TrimPrefix(f.secret, "whsec_"))
	ts := strconv.FormatInt(time.Now().Unix(), 10)
	mac := hmac.New(sha256.New, key)
	mac.Write([]byte("msg_" + ts + "." + ts + "."))
	mac.Write([]byte(payload))
	h := http.Header{}
	h.Set("svix-id", "msg_"+ts)
	h.Set("svix-timestamp", ts)
	h.Set("svix-signature", "v1,"+base64.StdEncoding.EncodeToString(mac.Sum(nil)))
	return f.s.HandleResendWebhook(context.Background(), h, []byte(payload))
}

func TestOutboxSendsPacesAndHandlesDelivery(t *testing.T) {
	f := newDBFixture(t)
	ctx := context.Background()

	// 1. A due email is sent once, with an idempotency key, and the
	//    application moves to submitted.
	app1, o1 := f.scheduledApp(t, "Backend Engineer", "jobs@acme.io")
	f.s.sendDue(ctx)
	if len(f.api.sent) != 1 {
		t.Fatalf("sent %d emails, want 1", len(f.api.sent))
	}
	sent := f.api.sent[0]
	if f.api.keys[0] != "aethlara-outbox-"+o1.ID || sent["from"] != "Jane Doe <jane.doe@mail.agentbox.io>" ||
		fmt.Sprint(sent["to"]) != "[jobs@acme.io]" || fmt.Sprint(sent["reply_to"]) != "[jane.doe@mail.agentbox.io]" {
		t.Errorf("send request = key %q %v", f.api.keys[0], sent)
	}
	if text, _ := sent["text"].(string); !strings.Contains(text, "role.\n\nBest regards,\nJane Doe\n\n--\nJane Doe\njane.doe@mail.agentbox.io") {
		t.Errorf("text part = %q", text)
	}
	if html, _ := sent["html"].(string); !strings.Contains(html, "<!DOCTYPE html>") || strings.Contains(html, "<img") {
		t.Errorf("html part = %q", html)
	}
	if att, _ := sent["attachments"].([]any); len(att) != 1 || att[0].(map[string]any)["filename"] != "Jane_Doe_Resume.pdf" {
		t.Errorf("attachments = %v", sent["attachments"])
	}
	app1, _ = f.repo.GetApplication(ctx, f.userID, app1.ID)
	o1, _ = f.repo.GetOutbox(ctx, f.userID, o1.ID)
	if app1.Status != AppSubmitted || app1.SubmittedAt == nil || o1.Status != OutboxSent || deref(o1.ProviderID) != "re_1" {
		t.Fatalf("after send: app %s outbox %s provider %v", app1.Status, o1.Status, o1.ProviderID)
	}
	if lead, _ := f.repo.GetLead(ctx, f.userID, app1.LeadID); lead.Status != LeadApplied {
		t.Errorf("lead status = %s", lead.Status)
	}
	if len(f.jobs.advanced) != 1 || f.jobs.advanced[0] != f.jobRowID+":applied" {
		t.Errorf("tracker job advanced = %v", f.jobs.advanced)
	}
	if msgs, _, _ := f.repo.ListMessages(ctx, f.userID, "outbound", 10, 0); len(msgs) != 1 || deref(msgs[0].ProviderID) != "re_1" {
		t.Errorf("outbound messages = %+v", msgs)
	}

	// 2. A second email due right away is held: the mailbox just sent one.
	app2, o2 := f.scheduledApp(t, "Platform Engineer", "careers@other.io")
	f.s.sendDue(ctx)
	if len(f.api.sent) != 1 {
		t.Fatalf("a burst went out: %d emails", len(f.api.sent))
	}
	o2, _ = f.repo.GetOutbox(ctx, f.userID, o2.ID)
	if o2.Status != OutboxScheduled || o2.Attempts != 0 || o2.ScheduledAt.Before(o1.SentAt.Add(6*time.Minute)) {
		t.Fatalf("held email: status %s attempts %d at %s (sent %s)", o2.Status, o2.Attempts, o2.ScheduledAt, o1.SentAt)
	}

	// 3. Resend reports a hard bounce for the first email: the address is
	//    suppressed and the application fails. A retried webhook changes
	//    nothing.
	bounce := `{"type":"email.bounced","data":{"email_id":"re_1","to":["jobs@acme.io"],"bounce":{"type":"Permanent","subType":"General","message":"550 user unknown"}}}`
	for range 2 {
		if err := f.webhook(t, bounce); err != nil {
			t.Fatalf("bounce webhook: %v", err)
		}
	}
	if reason, _ := f.repo.Suppression(ctx, "JOBS@acme.io"); reason != "bounce" {
		t.Errorf("suppression = %q", reason)
	}
	app1, _ = f.repo.GetApplication(ctx, f.userID, app1.ID)
	if app1.Status != AppFailed || !strings.Contains(deref(app1.LastError), "bounced (550 user unknown)") || deref(app1.DeliveryStatus) != DeliveryBounced {
		t.Errorf("after bounce: %s %q %v", app1.Status, deref(app1.LastError), app1.DeliveryStatus)
	}
	events, _ := f.repo.ListEvents(ctx, f.userID, 0, 50)
	bounced := 0
	for _, e := range events {
		if e.Kind == EventEmailBounced {
			bounced++
		}
	}
	if bounced != 1 {
		t.Errorf("bounce events = %d, want 1", bounced)
	}
	if err := f.webhook(t, `{"type":"email.delivered","data":{"email_id":"re_1"}}`); err != nil {
		t.Fatal(err)
	}
	if o, _ := f.repo.GetOutbox(ctx, f.userID, o1.ID); deref(o.DeliveryStatus) != DeliveryBounced {
		t.Errorf("a late 'delivered' replaced the bounce: %v", o.DeliveryStatus)
	}

	// 4. The address is refused from now on, and the user can redirect the
	//    failed application to another one.
	if _, err := f.s.SetRecipient(ctx, f.userID, app1.ID, "jobs@acme.io"); err == nil || !strings.Contains(err.Error(), "bounced") {
		t.Errorf("a bounced address was accepted: %v", err)
	}
	redirected, err := f.s.SetRecipient(ctx, f.userID, app1.ID, "Hiring@Acme.io")
	if err != nil || redirected.Status != AppQueued || deref(redirected.ApplyEmail) != "hiring@acme.io" || deref(redirected.RecipientKind) != RecipientUser {
		t.Fatalf("set recipient: %+v %v", redirected, err)
	}

	// 5. Time passes; the held email goes out. A spam complaint about it
	//    suppresses the address and pauses the user's sending.
	if _, err := f.pool.Exec(ctx, `UPDATE agent_outbox SET sent_at = sent_at - INTERVAL '1 hour' WHERE id = $1`, o1.ID); err != nil {
		t.Fatal(err)
	}
	if _, err := f.pool.Exec(ctx, `UPDATE agent_outbox SET scheduled_at = NOW() - INTERVAL '1 minute' WHERE id = $1`, o2.ID); err != nil {
		t.Fatal(err)
	}
	f.s.sendDue(ctx)
	if len(f.api.sent) != 2 {
		t.Fatalf("held email not sent once due: %d emails", len(f.api.sent))
	}
	if err := f.webhook(t, `{"type":"email.complained","data":{"email_id":"re_2","to":["careers@other.io"]}}`); err != nil {
		t.Fatal(err)
	}
	p, _ := f.repo.GetProfile(ctx, f.userID)
	if !p.SendingPaused(time.Now()) || p.SendingPausedUntil.Before(time.Now().Add(71*time.Hour)) {
		t.Errorf("complaint did not pause sending: %v", p.SendingPausedUntil)
	}
	if reason, _ := f.repo.Suppression(ctx, "careers@other.io"); reason != "complaint" {
		t.Errorf("complaint suppression = %q", reason)
	}
	app2, _ = f.repo.GetApplication(ctx, f.userID, app2.ID)
	if app2.Status != AppSubmitted || deref(app2.DeliveryStatus) != DeliveryComplained {
		t.Errorf("complained application: %s %v", app2.Status, app2.DeliveryStatus)
	}
	notified := false
	for _, e := range f.api.sent {
		if e["subject"] == "Your autopilot paused sending" && fmt.Sprint(e["to"]) == "[jane@personal.io]" {
			notified = true
		}
	}
	if !notified {
		t.Error("the user was not told about the pause")
	}

	// 6. While paused, due email waits; cancelling it takes it out of the
	//    queue.
	app3, o3 := f.scheduledApp(t, "Data Engineer", "talent@third.io")
	before := len(f.api.sent)
	f.s.sendDue(ctx)
	if len(f.api.sent) != before {
		t.Fatal("sent while paused")
	}
	if _, err := f.s.CancelApplication(ctx, f.userID, app3.ID); err != nil {
		t.Fatal(err)
	}
	o3, _ = f.repo.GetOutbox(ctx, f.userID, o3.ID)
	app3, _ = f.repo.GetApplication(ctx, f.userID, app3.ID)
	if o3.Status != OutboxCancelled || app3.Status != AppCancelled {
		t.Errorf("cancel: outbox %s app %s", o3.Status, app3.Status)
	}

	// 7. The overview reports the queue and the pause.
	if _, err := f.repo.ExtendSendingPause(ctx, f.userID, time.Now().Add(time.Hour), "short"); err != nil {
		t.Fatal(err)
	}
	scheduled, next, sent24, err := f.repo.SendingSummary(ctx, f.userID)
	if err != nil || scheduled != 0 || next != nil || sent24 != 2 {
		t.Errorf("summary = %d %v %d %v", scheduled, next, sent24, err)
	}

	// 8. Unknown provider ids are ignored.
	if err := f.webhook(t, `{"type":"email.bounced","data":{"email_id":"re_unknown","bounce":{"type":"Permanent"}}}`); err != nil {
		t.Errorf("unknown email id: %v", err)
	}
}

func TestOutboxGroupEmailAndRecovery(t *testing.T) {
	f := newDBFixture(t)
	ctx := context.Background()

	// A cold email covering two roles: cancelling one re-queues the other
	// (its email names both roles, so it must be rewritten).
	var apps []*Application
	for _, title := range []string{"Protocol Engineer", "Assets Engineer"} {
		lead, _ := f.repo.InsertLead(ctx, Lead{UserID: f.userID, Source: "manual", DedupeKey: dedupeKey("Lightning", title),
			Title: title, Company: "Lightning", URL: "https://lightning.io/careers", Status: LeadApplying})
		app, _ := f.repo.QueueApplication(ctx, f.userID, lead.ID)
		app.Channel = ChannelColdEmail
		app.ApplyEmail = strPtr("careers@lightning.io")
		apps = append(apps, app)
	}
	plan := newSendPlan(windowFor(f.profile.ApplySettings), 40, 0, 0, 0, nil, rand.New(rand.NewPCG(2, 2)))
	if _, err := f.s.scheduleEmail(ctx, f.profile, plan, f.resume, apps, OutboxColdEmail, "careers@lightning.io", "Lightning roles - Jane Doe", "Hi Lightning team, ..."); err != nil {
		t.Fatal(err)
	}
	if at, _, err := f.repo.LastColdEmail(ctx, f.userID, "Careers@Lightning.io", time.Now().Add(-coldEmailCooldown)); err != nil || at == nil {
		t.Errorf("a scheduled cold email must count for the cooldown: %v %v", at, err)
	}
	if _, err := f.s.CancelApplication(ctx, f.userID, apps[0].ID); err != nil {
		t.Fatal(err)
	}
	other, _ := f.repo.GetApplication(ctx, f.userID, apps[1].ID)
	if other.Status != AppQueued || other.OutboxID != nil {
		t.Errorf("sibling after cancel: %s %v", other.Status, other.OutboxID)
	}
	if lead, _ := f.repo.GetLead(ctx, f.userID, other.LeadID); lead.Status != LeadApproved {
		t.Errorf("sibling lead = %s", lead.Status)
	}

	// An email whose send was interrupted (lease expired) is claimed again
	// with the same idempotency key.
	_, o := f.scheduledApp(t, "SRE", "jobs@lightning.io")
	if _, err := f.pool.Exec(ctx, `UPDATE agent_outbox SET status = 'sending', attempts = 1, locked_until = NOW() - INTERVAL '1 minute' WHERE id = $1`, o.ID); err != nil {
		t.Fatal(err)
	}
	claimed, err := f.repo.ClaimDueOutbox(ctx, outboxLease)
	if err != nil || claimed == nil || claimed.ID != o.ID || claimed.Attempts != 2 {
		t.Fatalf("reclaim: %+v %v", claimed, err)
	}
	if again, _ := f.repo.ClaimDueOutbox(ctx, outboxLease); again != nil {
		t.Errorf("a leased email was claimed twice: %+v", again)
	}
}
