package agent

import (
	"context"
	"strings"
	"testing"

	"github.com/collinsadi/aethlara/internal/config"
)

func bounceEvent(kind string) *resendEvent {
	ev := &resendEvent{Type: "email.bounced"}
	ev.Data.EmailID = "re_1"
	ev.Data.Bounce = &struct {
		Type    string `json:"type"`
		SubType string `json:"subType"`
		Message string `json:"message"`
	}{Type: kind, SubType: "General", Message: "550 5.1.1 user unknown"}
	return ev
}

func TestDeliveryOutcome(t *testing.T) {
	cases := []struct {
		ev        *resendEvent
		status    string
		permanent bool
	}{
		{bounceEvent("Permanent"), DeliveryBounced, true},
		{bounceEvent("Transient"), DeliveryDelayed, false},
		{bounceEvent("Undetermined"), DeliveryBounced, false},
		{&resendEvent{Type: "email.delivered"}, DeliveryDelivered, false},
		{&resendEvent{Type: "email.delivery_delayed"}, DeliveryDelayed, false},
		{&resendEvent{Type: "email.complained"}, DeliveryComplained, false},
		{&resendEvent{Type: "email.failed"}, DeliveryFailed, false},
		{&resendEvent{Type: "email.suppressed"}, DeliverySuppressed, false},
		{&resendEvent{Type: "email.opened"}, "", false},
	}
	for _, c := range cases {
		status, _, permanent := deliveryOutcome(c.ev)
		if status != c.status || permanent != c.permanent {
			t.Errorf("%s (%v): got %q permanent=%t, want %q permanent=%t", c.ev.Type, c.ev.Data.Bounce, status, permanent, c.status, c.permanent)
		}
	}
	if _, detail, _ := deliveryOutcome(bounceEvent("Permanent")); detail != "550 5.1.1 user unknown" {
		t.Errorf("bounce detail = %q", detail)
	}
	if !(deliveryRank(DeliveryComplained) > deliveryRank(DeliveryBounced) &&
		deliveryRank(DeliveryBounced) > deliveryRank(DeliveryDelivered) &&
		deliveryRank(DeliveryDelivered) > deliveryRank(DeliveryDelayed)) {
		t.Error("delivery ranks out of order")
	}
}

func TestCheckRecipient(t *testing.T) {
	s, _ := testService(nil, map[string]bool{"acme.io": true})
	s.cfg = &config.Config{AgentMailDomain: "mail.agentbox.io"}
	ctx := context.Background()
	if why := s.checkRecipient(ctx, "Jobs@Acme.io", true); why != "" {
		t.Errorf("good address rejected: %s", why)
	}
	for addr, want := range map[string]string{
		"not-an-address":            "not a valid",
		"no-reply@acme.io":          "no-reply",
		"noreply+jobs@acme.io":      "no-reply",
		"jane@mail.agentbox.io":     "agent mailbox",
		"jobs@nomx.io":              "no MX",
		"jobs@acme.io, x@other.com": "not a valid",
	} {
		if why := s.checkRecipient(ctx, addr, true); !strings.Contains(why, want) {
			t.Errorf("checkRecipient(%q) = %q, want it to mention %q", addr, why, want)
		}
	}
	if why := s.checkRecipient(ctx, "jobs@nomx.io", false); why != "" {
		t.Errorf("MX is not checked at send time, got %q", why)
	}
}

func TestResolveRecipient(t *testing.T) {
	pages := map[string]string{"https://acme.io/contact": `<p>Jobs: careers@acme.io</p>`}
	s, _ := testService(pages, map[string]bool{"acme.io": true, "recruit.io": true})
	ctx := context.Background()
	mailbox := "jane@mail.example.com"
	p := &Profile{UserID: "u1", MailboxAddress: &mailbox}

	lead := &Lead{Title: "Backend Engineer", Company: "Acme", URL: "https://acme.io/careers/backend", ApplyEmail: strPtr("talent@recruit.io")}
	if r, why := s.resolveRecipient(ctx, p, lead, &Application{}, nil); r == nil || r.Email != "talent@recruit.io" || r.Kind != RecipientPosting {
		t.Fatalf("posting address: %+v %s", r, why)
	}

	lead.ApplyEmail = strPtr("no-reply@acme.io")
	r, _ := s.resolveRecipient(ctx, p, lead, &Application{}, nil)
	if r == nil || r.Email != "careers@acme.io" || r.Kind != RecipientHiring || r.Source != "https://acme.io/contact" {
		t.Fatalf("an unusable posting address should fall back to a published one: %+v", r)
	}

	user := &Application{ApplyEmail: strPtr("Recruiter@Recruit.io"), RecipientKind: strPtr(RecipientUser)}
	if r, _ := s.resolveRecipient(ctx, p, lead, user, nil); r == nil || r.Email != "recruiter@recruit.io" || r.Kind != RecipientUser {
		t.Fatalf("the user's address wins: %+v", r)
	}

	none := &Lead{Title: "Designer", Company: "Ghost", URL: "https://ghost.example/jobs/1"}
	if r, why := s.resolveRecipient(ctx, p, none, &Application{}, nil); r != nil || !strings.Contains(why, "Ghost doesn't publish") {
		t.Fatalf("no address anywhere: %+v %q", r, why)
	}
	if r, why := s.resolveRecipient(ctx, &Profile{UserID: "u1"}, none, &Application{}, nil); r != nil || !strings.Contains(why, "agent mailbox") {
		t.Fatalf("contact lookup needs a mailbox: %+v %q", r, why)
	}
}

func TestApplicationEmailContent(t *testing.T) {
	ident := identity{FullName: "Jane Doe", FirstName: "Jane", LastName: "Doe"}
	lead := &Lead{Title: "Backend Engineer", Company: "Acme"}

	body := applicationEmailTemplate(ident, nil, lead, RecipientGeneral)
	if !strings.HasPrefix(body, "Hi Acme team,") || !strings.Contains(body, "pass it on") || !strings.HasSuffix(body, "Best regards,\nJane Doe") {
		t.Errorf("general-inbox template = %q", body)
	}
	if body := applicationEmailTemplate(ident, nil, lead, RecipientPosting); !strings.HasPrefix(body, "Dear Hiring Team,") || strings.Contains(body, "pass it on") {
		t.Errorf("posting template = %q", body)
	}

	subject := applicationSubject(&Lead{Title: "Backend Engineer\r\nBcc: x@y.z"}, "Jane <Doe>")
	if strings.ContainsAny(subject, "\r\n<>") || !strings.HasPrefix(subject, "Application for Backend Engineer") {
		t.Errorf("subject not sanitised: %q", subject)
	}

	good := "Dear Hiring Team,\n\nI would like to apply for the Backend Engineer role at Acme. " +
		strings.Repeat("At my last company I moved payment reconciliation to Go and cut failures by a third. ", 4) +
		"\n\nMy resume is attached, and I would welcome a short conversation.\n\nBest regards,\nJane Doe"
	if issues := applicationEmailIssues(subject, good); len(issues) != 0 {
		t.Errorf("good draft rejected: %v", issues)
	}
	for name, bad := range map[string]string{
		"short":       "Dear Hiring Team,\n\nHire me.\n\nBest regards,\nJane",
		"placeholder": strings.Replace(good, "Acme", "[Company]", 1),
		"spammy":      good + "\n\nClick here to see my portfolio!!",
	} {
		if issues := applicationEmailIssues(subject, bad); len(issues) == 0 {
			t.Errorf("%s draft accepted", name)
		}
	}
}

func TestSenderAndSignature(t *testing.T) {
	s := &Service{cfg: &config.Config{AppName: "Aethlara", EmailFromAddress: "noreply@aethlara.example"}}
	mailbox := "jane.doe@mail.example.com"
	ident := identity{FullName: "Doe, Jane \"JD\"", Email: mailbox, Phone: "+1 555 0100", LinkedIn: "https://linkedin.com/in/jd"}
	from, reply := s.sender(&Profile{MailboxAddress: &mailbox}, ident)
	if from != "Doe Jane JD <jane.doe@mail.example.com>" || reply != mailbox {
		t.Errorf("sender = %q / %q", from, reply)
	}
	if senderAddress(from) != mailbox {
		t.Errorf("senderAddress(%q) = %q", from, senderAddress(from))
	}
	from, reply = s.sender(&Profile{}, identity{FullName: "Jane Doe", Email: "jane@gmail.example"})
	if from != "Jane Doe via Aethlara <noreply@aethlara.example>" || reply != "jane@gmail.example" {
		t.Errorf("fallback sender = %q / %q", from, reply)
	}
	if got := strings.Join(signatureLines(ident), "|"); got != "Doe Jane JD|jane.doe@mail.example.com|+1 555 0100|https://linkedin.com/in/jd" {
		t.Errorf("signature = %q", got)
	}
}
