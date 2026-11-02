package email

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"net/mail"
	"strings"
	"time"
)

const defaultResendAPI = "https://api.resend.com"

// SetBaseURL points the client at a Resend-compatible API (proxies, local
// mocks). Empty keeps the default.
func (c *Client) SetBaseURL(u string) {
	c.baseURL = strings.TrimRight(u, "/")
}

func (c *Client) apiBase() string {
	if c.baseURL != "" {
		return c.baseURL
	}
	return defaultResendAPI
}

// Attachment is a file sent with an outbound email.
type Attachment struct {
	Filename    string
	ContentType string
	Content     []byte
}

// OutboundEmail is a fully specified message sent through Resend. From must
// be an address on a domain verified in Resend.
type OutboundEmail struct {
	From        string // "Name <address>"
	To          []string
	ReplyTo     []string
	Subject     string
	HTML        string
	Text        string
	Attachments []Attachment
	Headers     map[string]string
}

type resendAttachment struct {
	Filename    string `json:"filename"`
	Content     string `json:"content"`
	ContentType string `json:"content_type,omitempty"`
}

type resendSendRequest struct {
	From        string             `json:"from"`
	To          []string           `json:"to"`
	ReplyTo     []string           `json:"reply_to,omitempty"`
	Subject     string             `json:"subject"`
	HTML        string             `json:"html,omitempty"`
	Text        string             `json:"text,omitempty"`
	Attachments []resendAttachment `json:"attachments,omitempty"`
	Headers     map[string]string  `json:"headers,omitempty"`
}

// SendMessage sends an arbitrary email (used by the agent for email
// applications) and returns Resend's email id.
func (c *Client) SendMessage(ctx context.Context, m OutboundEmail) (string, error) {
	if len(m.To) == 0 {
		return "", fmt.Errorf("send message: no recipients")
	}
	if c.devLogOnly {
		slog.Info("email: EMAIL_DEV_LOG_ONLY — agent email not sent",
			"to_count", len(m.To), "subject", m.Subject, "attachments", len(m.Attachments))
		return fmt.Sprintf("dev-%d", time.Now().UnixNano()), nil
	}

	payload := resendSendRequest{
		From:    m.From,
		To:      m.To,
		ReplyTo: m.ReplyTo,
		Subject: m.Subject,
		HTML:    m.HTML,
		Text:    m.Text,
		Headers: m.Headers,
	}
	for _, a := range m.Attachments {
		payload.Attachments = append(payload.Attachments, resendAttachment{
			Filename:    a.Filename,
			Content:     base64.StdEncoding.EncodeToString(a.Content),
			ContentType: a.ContentType,
		})
	}
	body, err := json.Marshal(payload)
	if err != nil {
		return "", fmt.Errorf("marshal email: %w", err)
	}

	sendCtx, cancel := context.WithTimeout(ctx, 30*time.Second)
	defer cancel()
	respBody, err := c.do(sendCtx, http.MethodPost, "/emails", body)
	if err != nil {
		return "", err
	}
	var out struct {
		ID string `json:"id"`
	}
	_ = json.Unmarshal(respBody, &out)
	return out.ID, nil
}

// SendNotification emails the user from the platform's sender address.
func (c *Client) SendNotification(ctx context.Context, to, subject, html string) error {
	if c.devLogOnly {
		slog.Info("email: EMAIL_DEV_LOG_ONLY — notification not sent", "subject", subject)
		return nil
	}
	return c.send(ctx, to, subject, html)
}

// ReceivedEmail is an inbound email fetched from Resend's receiving API.
type ReceivedEmail struct {
	ID        string            `json:"id"`
	To        []string          `json:"to"`
	From      string            `json:"from"`
	CreatedAt string            `json:"created_at"`
	Subject   string            `json:"subject"`
	HTML      string            `json:"html"`
	Text      *string           `json:"text"`
	Headers   map[string]string `json:"headers"`
	MessageID string            `json:"message_id"`
	ReplyTo   []string          `json:"reply_to"`
	// Authentication holds SPF/DKIM/DMARC verdicts ("pass", "fail", "gray",
	// ...). Nil for mail received before Resend added the field.
	Authentication *struct {
		SPF   string `json:"spf"`
		DKIM  string `json:"dkim"`
		DMARC string `json:"dmarc"`
	} `json:"authentication"`
	Attachments []struct {
		ID          string `json:"id"`
		Filename    string `json:"filename"`
		ContentType string `json:"content_type"`
		Size        int64  `json:"size"`
	} `json:"attachments"`
}

// FromName returns the display name of the sender, when present.
func (r *ReceivedEmail) FromName() string {
	raw := r.From
	for k, v := range r.Headers {
		if strings.EqualFold(k, "from") && v != "" {
			raw = v
		}
	}
	if addr, err := mail.ParseAddress(raw); err == nil {
		return addr.Name
	}
	return ""
}

// SenderAuth summarises sender authentication: "pass" when DMARC or DKIM
// passed, "fail" when DMARC failed or both SPF and DKIM failed, otherwise
// "unknown".
func (r *ReceivedEmail) SenderAuth() string {
	a := r.Authentication
	if a == nil {
		return "unknown"
	}
	switch {
	case a.DMARC == "pass" || a.DKIM == "pass":
		return "pass"
	case a.DMARC == "fail" || (a.SPF == "fail" && a.DKIM == "fail"):
		return "fail"
	}
	return "unknown"
}

// FromAddress returns the bare sender address.
func (r *ReceivedEmail) FromAddress() string {
	if addr, err := mail.ParseAddress(r.From); err == nil {
		return strings.ToLower(addr.Address)
	}
	return strings.ToLower(strings.TrimSpace(r.From))
}

// GetReceivedEmail fetches the full content of an inbound email. Inline
// images are returned as cid: references to keep the HTML small.
func (c *Client) GetReceivedEmail(ctx context.Context, id string) (*ReceivedEmail, error) {
	if strings.ContainsAny(id, "/?#") || id == "" {
		return nil, fmt.Errorf("invalid email id")
	}
	getCtx, cancel := context.WithTimeout(ctx, 20*time.Second)
	defer cancel()
	body, err := c.do(getCtx, http.MethodGet, "/emails/receiving/"+id+"?html_format=cid", nil)
	if err != nil {
		return nil, err
	}
	var out ReceivedEmail
	if err := json.Unmarshal(body, &out); err != nil {
		return nil, fmt.Errorf("decode received email: %w", err)
	}
	return &out, nil
}

func (c *Client) do(ctx context.Context, method, path string, body []byte) ([]byte, error) {
	var reader io.Reader
	if body != nil {
		reader = bytes.NewReader(body)
	}
	req, err := http.NewRequestWithContext(ctx, method, c.apiBase()+path, reader)
	if err != nil {
		return nil, fmt.Errorf("create request: %w", err)
	}
	req.Header.Set("Authorization", "Bearer "+c.apiKey)
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}

	client := &http.Client{Timeout: 45 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("resend %s %s: %w", method, strings.SplitN(path, "?", 2)[0], err)
	}
	defer resp.Body.Close()

	respBody, _ := io.ReadAll(io.LimitReader(resp.Body, 10<<20))
	if resp.StatusCode >= 300 {
		msg := strings.TrimSpace(string(respBody))
		if len(msg) > 300 {
			msg = msg[:300] + "..."
		}
		return nil, fmt.Errorf("resend API error: HTTP %d: %s", resp.StatusCode, msg)
	}
	return respBody, nil
}
