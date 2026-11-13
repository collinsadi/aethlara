package email

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

type fakeDNS struct {
	txt map[string][]string
	mx  map[string][]*net.MX
}

func (f fakeDNS) LookupTXT(_ context.Context, name string) ([]string, error) {
	if v, ok := f.txt[name]; ok {
		return v, nil
	}
	return nil, errors.New("no such host")
}

func (f fakeDNS) LookupMX(_ context.Context, name string) ([]*net.MX, error) {
	if v, ok := f.mx[name]; ok {
		return v, nil
	}
	return nil, errors.New("no such host")
}

// fakeResend serves the domain and webhook endpoints of the Resend API.
func fakeResend(t *testing.T, domain map[string]any, hooks []map[string]any, patched *[]string) *Client {
	t.Helper()
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") != "Bearer re_test" {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		switch {
		case r.Method == http.MethodGet && r.URL.Path == "/domains":
			list := []any{}
			if domain != nil {
				list = append(list, map[string]any{"id": domain["id"], "name": domain["name"], "status": domain["status"]})
			}
			_ = json.NewEncoder(w).Encode(map[string]any{"object": "list", "data": list})
		case r.Method == http.MethodGet && domain != nil && r.URL.Path == "/domains/"+domain["id"].(string):
			_ = json.NewEncoder(w).Encode(domain)
		case r.Method == http.MethodGet && r.URL.Path == "/webhooks":
			_ = json.NewEncoder(w).Encode(map[string]any{"object": "list", "has_more": false, "data": hooks})
		case r.Method == http.MethodPatch:
			body, _ := io.ReadAll(r.Body)
			*patched = append(*patched, r.URL.Path+" "+string(body))
			_ = json.NewEncoder(w).Encode(map[string]any{"id": "x"})
		default:
			w.WriteHeader(http.StatusNotFound)
		}
	}))
	t.Cleanup(srv.Close)
	c := NewClient("re_test", "", "", "", false)
	c.SetBaseURL(srv.URL)
	return c
}

func verifiedDomain(tracking bool) map[string]any {
	return map[string]any{
		"id": "d1", "name": "mail.example.com", "status": "verified",
		"open_tracking": tracking, "click_tracking": false,
		"capabilities": map[string]any{"sending": "enabled", "receiving": "enabled"},
		"records": []map[string]any{
			{"record": "SPF", "name": "send.mail", "type": "MX", "status": "verified"},
			{"record": "SPF", "name": "send.mail", "type": "TXT", "status": "verified"},
			{"record": "DKIM", "name": "resend._domainkey.mail", "type": "TXT", "status": "verified"},
		},
	}
}

func goodDNS() fakeDNS {
	return fakeDNS{
		txt: map[string][]string{"_dmarc.example.com": {"v=DMARC1; p=none;"}},
		mx:  map[string][]*net.MX{"mail.example.com": {{Host: "inbound.resend.example.", Pref: 10}}},
	}
}

func TestCheckDeliverabilityHealthyDomain(t *testing.T) {
	hooks := []map[string]any{{"id": "w1", "endpoint": "https://api.example.com/api/v1/webhooks/resend", "status": "enabled", "events": RequiredWebhookEvents}}
	var patched []string
	c := fakeResend(t, verifiedDomain(false), hooks, &patched)
	rep := c.CheckDeliverability(context.Background(), "mail.example.com", goodDNS())
	if rep.Status != CheckOK || !rep.CanSend {
		t.Fatalf("status %s can_send %t: %+v", rep.Status, rep.CanSend, rep.Checks)
	}
	if dm := rep.Check("dmarc"); dm == nil || !strings.Contains(dm.Detail, "_dmarc.example.com") {
		t.Errorf("dmarc should fall back to the organisational domain: %+v", dm)
	}
}

func TestCheckDeliverabilityFindsProblems(t *testing.T) {
	hooks := []map[string]any{{"id": "w1", "endpoint": "https://api.example.com/api/v1/webhooks/resend", "status": "enabled", "events": []string{"email.received"}}}
	var patched []string
	c := fakeResend(t, verifiedDomain(true), hooks, &patched)
	dns := fakeDNS{txt: map[string][]string{}, mx: map[string][]*net.MX{}}
	rep := c.CheckDeliverability(context.Background(), "mail.example.com", dns)
	want := map[string]string{"tracking": CheckWarn, "dmarc": CheckFail, "mx": CheckWarn, "webhook": CheckWarn, "dkim": CheckOK, "spf": CheckOK}
	for id, status := range want {
		if ch := rep.Check(id); ch == nil || ch.Status != status {
			t.Errorf("check %s = %+v, want %s", id, ch, status)
		}
	}
	if rep.Status != CheckFail || !rep.CanSend {
		t.Errorf("a missing DMARC record fails the report but must not stop sending: %s %t", rep.Status, rep.CanSend)
	}
	if !rep.TrackingOn || rep.Webhook == nil || len(rep.MissingEvent) != len(RequiredWebhookEvents)-1 {
		t.Errorf("fix data: tracking %t webhook %+v missing %v", rep.TrackingOn, rep.Webhook, rep.MissingEvent)
	}

	if err := c.SetDomainTracking(context.Background(), rep.DomainID, false, false); err != nil {
		t.Fatal(err)
	}
	if err := c.SetWebhookEvents(context.Background(), *rep.Webhook, RequiredWebhookEvents); err != nil {
		t.Fatal(err)
	}
	if len(patched) != 2 || !strings.Contains(patched[0], `"open_tracking":false`) || !strings.Contains(patched[1], "email.bounced") {
		t.Errorf("patches = %v", patched)
	}
}

func TestCheckDeliverabilityBlocksAnUnverifiedDomain(t *testing.T) {
	d := verifiedDomain(false)
	d["status"] = "pending"
	var patched []string
	rep := fakeResend(t, d, nil, &patched).CheckDeliverability(context.Background(), "mail.example.com", goodDNS())
	if rep.CanSend {
		t.Error("an unverified domain must hold sending")
	}
	rep = fakeResend(t, nil, nil, &patched).CheckDeliverability(context.Background(), "mail.example.com", goodDNS())
	if rep.CanSend || rep.Check("domain").Status != CheckFail {
		t.Errorf("a domain missing from the account must hold sending: %+v", rep.Check("domain"))
	}
}

func TestCheckDeliverabilityWithoutAPIAccessUsesDNS(t *testing.T) {
	c := NewClient("re_wrong", "", "", "", false)
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusUnauthorized)
	}))
	defer srv.Close()
	c.SetBaseURL(srv.URL)
	dns := goodDNS()
	dns.txt["resend._domainkey.mail.example.com"] = []string{"p=MIGfMA0GCSqGSIb3DQEB"}
	dns.txt["send.mail.example.com"] = []string{"v=spf1 include:amazonses.com ~all"}
	rep := c.CheckDeliverability(context.Background(), "mail.example.com", dns)
	if !rep.CanSend {
		t.Error("checks that cannot run must not hold sending")
	}
	if rep.Check("domain").Status != CheckUnknown || rep.Check("dkim").Status != CheckOK || rep.Check("spf").Status != CheckOK {
		t.Errorf("checks = %+v", rep.Checks)
	}
}

func TestParseDMARCAndOrgDomain(t *testing.T) {
	for in, want := range map[string]string{
		"v=DMARC1; p=quarantine; rua=mailto:x@y": "quarantine",
		"v=DMARC1;p=reject":                      "reject",
		"v=DMARC1; rua=mailto:x@y":               "none",
	} {
		if got, ok := parseDMARC(in); !ok || got != want {
			t.Errorf("parseDMARC(%q) = %q %t", in, got, ok)
		}
	}
	if _, ok := parseDMARC("v=spf1 -all"); ok {
		t.Error("an SPF record is not DMARC")
	}
	for in, want := range map[string]string{
		"mail.example.com": "example.com", "example.com": "example.com", "agent.mail.example.co.uk": "example.co.uk",
	} {
		if got := orgDomain(in); got != want {
			t.Errorf("orgDomain(%q) = %q, want %q", in, got, want)
		}
	}
}

func TestIsPermanent(t *testing.T) {
	if !IsPermanent(&APIError{Status: 422}) || !IsPermanent(&APIError{Status: 400}) {
		t.Error("validation errors are permanent")
	}
	for _, status := range []int{401, 403, 409, 429, 500, 503} {
		if IsPermanent(&APIError{Status: status}) {
			t.Errorf("HTTP %d should be retried", status)
		}
	}
	if IsPermanent(errors.New("connection reset")) {
		t.Error("network errors should be retried")
	}
}
