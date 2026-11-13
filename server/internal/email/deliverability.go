package email

import (
	"context"
	"encoding/json"
	"fmt"
	"net"
	"net/http"
	"net/url"
	"slices"
	"strings"
	"time"
)

// Deliverability checks for the domain the agent sends from. Mail reaches
// the inbox when the domain is verified in Resend (DKIM signature and SPF
// return path on the domain itself, so both align with the From address
// for DMARC), publishes a DMARC policy, receives replies (MX), and does not
// rewrite links or add tracking pixels. The server runs these checks
// periodically and refuses to send while Resend reports the domain cannot
// send; cmd/mailcheck prints them and can fix the Resend-side settings.

// Check statuses, worst last.
const (
	CheckOK      = "ok"
	CheckUnknown = "unknown"
	CheckWarn    = "warn"
	CheckFail    = "fail"
)

// RequiredWebhookEvents are the Resend webhook events the server handles:
// inbound mail plus the delivery outcome of every email it sends.
var RequiredWebhookEvents = []string{
	"email.received", "email.delivered", "email.delivery_delayed", "email.bounced",
	"email.complained", "email.failed", "email.suppressed",
}

// HealthCheck is one deliverability check.
type HealthCheck struct {
	ID     string `json:"id"`
	Label  string `json:"label"`
	Status string `json:"status"`
	Detail string `json:"detail"`
}

// HealthReport is the result of CheckDeliverability.
type HealthReport struct {
	Domain    string        `json:"domain"`
	Status    string        `json:"status"`
	CheckedAt time.Time     `json:"checked_at"`
	Checks    []HealthCheck `json:"checks"`
	// CanSend is false only when Resend positively reports that the domain
	// cannot send (missing, unverified or sending disabled). Checks that
	// could not run never block sending.
	CanSend bool `json:"can_send"`

	// For cmd/mailcheck -fix.
	DomainID     string   `json:"-"`
	TrackingOn   bool     `json:"-"`
	Webhook      *Webhook `json:"-"`
	MissingEvent []string `json:"-"`
}

// Check returns the check with id, or nil.
func (r *HealthReport) Check(id string) *HealthCheck {
	for i := range r.Checks {
		if r.Checks[i].ID == id {
			return &r.Checks[i]
		}
	}
	return nil
}

// Resolver looks up DNS records (net.DefaultResolver satisfies it).
type Resolver interface {
	LookupTXT(ctx context.Context, name string) ([]string, error)
	LookupMX(ctx context.Context, name string) ([]*net.MX, error)
}

// Domain is a sending domain as Resend reports it.
type Domain struct {
	ID            string `json:"id"`
	Name          string `json:"name"`
	Status        string `json:"status"`
	OpenTracking  *bool  `json:"open_tracking"`
	ClickTracking *bool  `json:"click_tracking"`
	Capabilities  *struct {
		Sending   string `json:"sending"`
		Receiving string `json:"receiving"`
	} `json:"capabilities"`
	Records []DomainRecord `json:"records"`
}

// DomainRecord is a DNS record Resend asks the domain to publish.
type DomainRecord struct {
	Record string `json:"record"` // SPF | DKIM | MX | Tracking | Receiving ...
	Name   string `json:"name"`
	Type   string `json:"type"`
	Status string `json:"status"`
	Value  string `json:"value"`
}

// Webhook is a Resend webhook endpoint.
type Webhook struct {
	ID       string   `json:"id"`
	Endpoint string   `json:"endpoint"`
	Status   string   `json:"status"`
	Events   []string `json:"events"`
}

type listResponse[T any] struct {
	Data    []T  `json:"data"`
	HasMore bool `json:"has_more"`
}

// ListDomains returns the account's domains (without records).
func (c *Client) ListDomains(ctx context.Context) ([]Domain, bool, error) {
	body, err := c.do(ctx, http.MethodGet, "/domains", nil)
	if err != nil {
		return nil, false, err
	}
	var out listResponse[Domain]
	if err := json.Unmarshal(body, &out); err != nil {
		return nil, false, fmt.Errorf("decode domains: %w", err)
	}
	return out.Data, out.HasMore, nil
}

// GetDomain returns one domain with its DNS records and settings.
func (c *Client) GetDomain(ctx context.Context, id string) (*Domain, error) {
	body, err := c.do(ctx, http.MethodGet, "/domains/"+url.PathEscape(id), nil)
	if err != nil {
		return nil, err
	}
	var d Domain
	if err := json.Unmarshal(body, &d); err != nil {
		return nil, fmt.Errorf("decode domain: %w", err)
	}
	return &d, nil
}

// SetDomainTracking turns open and click tracking on or off.
func (c *Client) SetDomainTracking(ctx context.Context, id string, open, click bool) error {
	body, _ := json.Marshal(map[string]bool{"open_tracking": open, "click_tracking": click})
	_, err := c.do(ctx, http.MethodPatch, "/domains/"+url.PathEscape(id), body)
	return err
}

// ListWebhooks returns the account's webhook endpoints.
func (c *Client) ListWebhooks(ctx context.Context) ([]Webhook, error) {
	body, err := c.do(ctx, http.MethodGet, "/webhooks", nil)
	if err != nil {
		return nil, err
	}
	var out listResponse[Webhook]
	if err := json.Unmarshal(body, &out); err != nil {
		return nil, fmt.Errorf("decode webhooks: %w", err)
	}
	return out.Data, nil
}

// SetWebhookEvents replaces the events a webhook is subscribed to (and
// enables it). The endpoint and signing secret stay the same.
func (c *Client) SetWebhookEvents(ctx context.Context, w Webhook, events []string) error {
	body, _ := json.Marshal(map[string]any{"endpoint": w.Endpoint, "events": events, "status": "enabled"})
	_, err := c.do(ctx, http.MethodPatch, "/webhooks/"+url.PathEscape(w.ID), body)
	return err
}

// WebhookPath is the path of the server's Resend webhook endpoint.
const WebhookPath = "/webhooks/resend"

// CheckDeliverability inspects domain through Resend's API and public DNS.
// r may be nil to use the system resolver.
func (c *Client) CheckDeliverability(ctx context.Context, domain string, r Resolver) *HealthReport {
	if r == nil {
		r = net.DefaultResolver
	}
	domain = strings.ToLower(strings.TrimSuffix(strings.TrimSpace(domain), "."))
	rep := &HealthReport{Domain: domain, CheckedAt: time.Now().UTC(), CanSend: true}
	add := func(id, label, status, detail string) {
		rep.Checks = append(rep.Checks, HealthCheck{ID: id, Label: label, Status: status, Detail: detail})
	}

	// 1. Resend: domain verified, sending enabled, DKIM and SPF records,
	//    tracking off.
	d, apiErr := c.findDomain(ctx, domain)
	switch {
	case apiErr != nil:
		add("domain", "Verified in Resend", CheckUnknown, "Could not ask Resend: "+apiErr.Error()+". Sending uses the API key's own checks.")
	case d == nil:
		rep.CanSend = false
		add("domain", "Verified in Resend", CheckFail, domain+" is not a domain in the Resend account behind the agent API key, so every send would be rejected. Add it in Resend (or use the key of the account that owns it).")
	default:
		rep.DomainID = d.ID
		switch strings.ToLower(d.Status) {
		case "verified":
			add("domain", "Verified in Resend", CheckOK, "Resend has verified "+domain+".")
		case "not_started", "pending", "failed", "temporary_failure":
			rep.CanSend = false
			add("domain", "Verified in Resend", CheckFail, fmt.Sprintf("Resend reports the domain as %q; it cannot send until its DNS records verify.", d.Status))
		default:
			add("domain", "Verified in Resend", CheckWarn, fmt.Sprintf("Resend reports the domain as %q.", d.Status))
		}
		if d.Capabilities != nil && strings.EqualFold(d.Capabilities.Sending, "disabled") {
			rep.CanSend = false
			add("sending", "Sending enabled", CheckFail, "Sending is disabled for "+domain+" in Resend.")
		}
		rep.TrackingOn = (d.OpenTracking != nil && *d.OpenTracking) || (d.ClickTracking != nil && *d.ClickTracking)
		if rep.TrackingOn {
			add("tracking", "Open and click tracking off", CheckWarn, "Tracking adds a pixel and rewrites every link through a tracking domain, which makes a personal email look like bulk mail. Turn both off (cmd/mailcheck -fix does it).")
		} else {
			add("tracking", "Open and click tracking off", CheckOK, "No tracking pixel or rewritten links.")
		}
	}

	// 2. DKIM and SPF: Resend's record status when available, else DNS.
	recordStatus := func(kind string) (string, bool) {
		if d == nil {
			return "", false
		}
		status, found := "", false
		for _, rec := range d.Records {
			if strings.EqualFold(rec.Record, kind) {
				found = true
				if status == "" || !strings.EqualFold(rec.Status, "verified") {
					status = strings.ToLower(rec.Status)
				}
			}
		}
		return status, found
	}
	if st, ok := recordStatus("DKIM"); ok {
		if st == "verified" {
			add("dkim", "DKIM signature", CheckOK, "Mail is signed for "+domain+" (aligned with the From address).")
		} else {
			add("dkim", "DKIM signature", CheckFail, fmt.Sprintf("Resend reports the DKIM record as %q. Unsigned mail is likely to land in spam.", st))
		}
	} else {
		dkim := "resend._domainkey." + domain
		if txt := lookupTXT(ctx, r, dkim); hasPrefixed(txt, "p=") {
			add("dkim", "DKIM signature", CheckOK, "DKIM key published at "+dkim+".")
		} else {
			add("dkim", "DKIM signature", CheckFail, "No DKIM key at "+dkim+". Publish the DKIM record Resend shows for the domain.")
		}
	}
	if st, ok := recordStatus("SPF"); ok {
		if st == "verified" {
			add("spf", "SPF return path", CheckOK, "Bounces use a return path on "+domain+" that authorises Resend (aligned with the From address).")
		} else {
			add("spf", "SPF return path", CheckFail, fmt.Sprintf("Resend reports the SPF record as %q. Publish the SPF and MX records Resend shows for the send subdomain.", st))
		}
	} else {
		spf := "send." + domain
		if txt := lookupTXT(ctx, r, spf); anyContains(txt, "v=spf1") {
			add("spf", "SPF return path", CheckOK, "SPF published at "+spf+".")
		} else {
			add("spf", "SPF return path", CheckFail, "No SPF record at "+spf+". Publish the SPF record Resend shows for the domain.")
		}
	}

	// 3. DMARC: the domain's own policy, else its organisational domain's.
	policy, where := dmarcPolicy(ctx, r, domain)
	switch policy {
	case "":
		add("dmarc", "DMARC policy", CheckFail, fmt.Sprintf("No DMARC record at _dmarc.%s or _dmarc.%s. Gmail, Yahoo and Outlook expect one; publish at least \"v=DMARC1; p=none;\".", domain, orgDomain(domain)))
	case "none":
		add("dmarc", "DMARC policy", CheckOK, fmt.Sprintf("Published at %s (p=none: monitoring). Once reports look clean, p=quarantine adds protection against spoofing.", where))
	default:
		add("dmarc", "DMARC policy", CheckOK, fmt.Sprintf("Published at %s (p=%s).", where, policy))
	}

	// 4. Replies: the domain must receive mail so answers reach the agent.
	if mx, err := lookupMXWithTimeout(ctx, r, domain); err == nil && len(mx) > 0 {
		add("mx", "Receives replies", CheckOK, "MX "+strings.TrimSuffix(mx[0].Host, ".")+" receives replies for the agent inbox.")
	} else {
		add("mx", "Receives replies", CheckWarn, "No MX record for "+domain+": replies to applications bounce. Add the receiving MX record Resend shows.")
	}

	// 5. Webhook: delivery events come back so bounces and complaints are
	//    suppressed and applications updated.
	hooks, err := c.ListWebhooks(ctx)
	switch {
	case err != nil:
		add("webhook", "Delivery events", CheckUnknown, "Could not list webhooks: "+err.Error())
	default:
		var hook *Webhook
		for i := range hooks {
			if strings.HasSuffix(strings.TrimRight(hooks[i].Endpoint, "/"), WebhookPath) {
				if hook == nil || (hooks[i].Status == "enabled" && hook.Status != "enabled") {
					hook = &hooks[i]
				}
			}
		}
		if hook == nil {
			add("webhook", "Delivery events", CheckWarn, "No Resend webhook points at "+WebhookPath+": replies are not received and bounces or spam complaints are not reported back.")
			break
		}
		rep.Webhook = hook
		for _, ev := range RequiredWebhookEvents {
			if !slices.Contains(hook.Events, ev) {
				rep.MissingEvent = append(rep.MissingEvent, ev)
			}
		}
		switch {
		case hook.Status != "enabled":
			add("webhook", "Delivery events", CheckWarn, "The Resend webhook is "+hook.Status+".")
		case len(rep.MissingEvent) > 0:
			add("webhook", "Delivery events", CheckWarn, "The webhook is not subscribed to "+strings.Join(rep.MissingEvent, ", ")+", so bounced or complained addresses are not suppressed automatically (cmd/mailcheck -fix subscribes it).")
		default:
			add("webhook", "Delivery events", CheckOK, "Bounces, complaints and deliveries are reported back.")
		}
	}

	rep.Status = CheckOK
	for _, ch := range rep.Checks {
		rep.Status = worse(rep.Status, ch.Status)
	}
	return rep
}

func worse(a, b string) string {
	rank := map[string]int{CheckOK: 0, CheckUnknown: 1, CheckWarn: 2, CheckFail: 3}
	if b == CheckUnknown {
		b = CheckWarn // a check that could not run deserves a look
	}
	if rank[b] > rank[a] {
		return b
	}
	return a
}

// findDomain returns the account's domain named domain (with records), nil
// when the account has no such domain.
func (c *Client) findDomain(ctx context.Context, domain string) (*Domain, error) {
	ctx, cancel := context.WithTimeout(ctx, 20*time.Second)
	defer cancel()
	list, hasMore, err := c.ListDomains(ctx)
	if err != nil {
		return nil, err
	}
	for _, d := range list {
		if strings.EqualFold(d.Name, domain) {
			full, err := c.GetDomain(ctx, d.ID)
			if err != nil {
				return &d, nil
			}
			return full, nil
		}
	}
	if hasMore {
		return nil, fmt.Errorf("the account has more domains than one page lists")
	}
	return nil, nil
}

// dmarcPolicy returns the p= tag of the DMARC record that governs domain
// and where it was found ("" when there is none).
func dmarcPolicy(ctx context.Context, r Resolver, domain string) (policy, where string) {
	for _, name := range []string{"_dmarc." + domain, "_dmarc." + orgDomain(domain)} {
		for _, txt := range lookupTXT(ctx, r, name) {
			if p, ok := parseDMARC(txt); ok {
				return p, name
			}
		}
		if orgDomain(domain) == domain {
			break
		}
	}
	return "", ""
}

// parseDMARC returns the policy of a DMARC record ("none" when p= is absent
// but the record is valid).
func parseDMARC(txt string) (string, bool) {
	tags := strings.Split(txt, ";")
	if len(tags) == 0 || !strings.EqualFold(strings.ReplaceAll(strings.TrimSpace(tags[0]), " ", ""), "v=DMARC1") {
		return "", false
	}
	for _, t := range tags[1:] {
		k, v, ok := strings.Cut(strings.TrimSpace(t), "=")
		if ok && strings.EqualFold(strings.TrimSpace(k), "p") {
			if v = strings.ToLower(strings.TrimSpace(v)); v != "" {
				return v, true
			}
		}
	}
	return "none", true
}

// orgDomain approximates the organisational domain ("mail.example.co.uk" ->
// "example.co.uk") without a public suffix list.
func orgDomain(domain string) string {
	labels := strings.Split(domain, ".")
	n := 2
	if len(labels) >= 3 {
		sld, tld := labels[len(labels)-2], labels[len(labels)-1]
		switch sld {
		case "co", "com", "org", "net", "ac", "gov", "edu", "ltd", "plc", "or", "ne":
			if len(tld) == 2 {
				n = 3
			}
		}
	}
	if len(labels) <= n {
		return domain
	}
	return strings.Join(labels[len(labels)-n:], ".")
}

func lookupTXT(ctx context.Context, r Resolver, name string) []string {
	ctx, cancel := context.WithTimeout(ctx, 8*time.Second)
	defer cancel()
	txt, err := r.LookupTXT(ctx, name)
	if err != nil {
		return nil
	}
	return txt
}

func lookupMXWithTimeout(ctx context.Context, r Resolver, name string) ([]*net.MX, error) {
	ctx, cancel := context.WithTimeout(ctx, 8*time.Second)
	defer cancel()
	return r.LookupMX(ctx, name)
}

func hasPrefixed(list []string, prefix string) bool {
	for _, s := range list {
		for part := range strings.SplitSeq(s, ";") {
			if strings.HasPrefix(strings.TrimSpace(part), prefix) {
				return true
			}
		}
	}
	return false
}

func anyContains(list []string, sub string) bool {
	for _, s := range list {
		if strings.Contains(s, sub) {
			return true
		}
	}
	return false
}
