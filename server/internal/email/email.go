package email

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"html/template"
	"io"
	"log/slog"
	"net/http"
	"strings"
	"time"
)

const otpEmailTmpl = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Your Verification Code</title>
</head>
<body style="margin:0;padding:0;background:#f9fafb;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="padding:40px 0;">
    <tr><td align="center">
      <table width="520" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:12px;padding:40px;border:1px solid #e5e7eb;">
        <tr><td>
          <h1 style="margin:0 0 8px;font-size:22px;color:#111827;">{{if eq .Type "signup"}}Verify your email{{else}}Sign in to {{.AppName}}{{end}}</h1>
          <p style="margin:0 0 32px;color:#6b7280;font-size:15px;">
            {{if eq .Type "signup"}}Use the code below to complete your registration.{{else}}Use the code below to sign in to your account.{{end}}
          </p>
          <div style="background:#f3f4f6;border-radius:8px;padding:24px;text-align:center;margin-bottom:32px;">
            <span style="font-size:40px;font-weight:700;letter-spacing:12px;color:#111827;font-family:monospace;">{{.OTP}}</span>
          </div>
          <p style="margin:0 0 8px;color:#6b7280;font-size:14px;">This code expires in <strong>{{.ExpiryMinutes}} minutes</strong>.</p>
          <p style="margin:0;color:#9ca3af;font-size:13px;">If you did not request this code, you can safely ignore this email.</p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`

var otpTmpl = template.Must(template.New("otp").Parse(otpEmailTmpl))

type Client struct {
	apiKey       string
	from         string
	appName      string
	devLogOnly   bool
	httpClient   *http.Client
}

type sendEmailRequest struct {
	From    string   `json:"from"`
	To      []string `json:"to"`
	Subject string   `json:"subject"`
	Html    string   `json:"html"`
}

func NewClient(apiKey, fromAddress, fromName, appName string, devLogOnly bool) *Client {
	return &Client{
		apiKey:     apiKey,
		from:       fmt.Sprintf("%s <%s>", fromName, fromAddress),
		appName:    appName,
		devLogOnly: devLogOnly,
		httpClient: &http.Client{
			Timeout: 10 * time.Second,
		},
	}
}

func (c *Client) SendEmailChangeOTP(ctx context.Context, to, otp string, expiryMinutes int) error {
	if c.devLogOnly {
		slog.Info("email: EMAIL_DEV_LOG_ONLY — email-change OTP not sent",
			"to", to, "otp", otp, "expires_minutes", expiryMinutes)
		return nil
	}

	subject := fmt.Sprintf("Verify your new email address for %s", c.appName)
	html := fmt.Sprintf(`<!DOCTYPE html><html><body style="font-family:sans-serif;padding:40px;background:#f9fafb;">
<div style="max-width:520px;margin:0 auto;background:#fff;border-radius:12px;padding:40px;border:1px solid #e5e7eb;">
<h2 style="margin:0 0 8px;color:#111827;">Verify your new email</h2>
<p style="color:#6b7280;margin:0 0 32px;">Use this code to confirm your new email address for %s.</p>
<div style="background:#f3f4f6;border-radius:8px;padding:24px;text-align:center;margin-bottom:32px;">
  <span style="font-size:40px;font-weight:700;letter-spacing:12px;color:#111827;font-family:monospace;">%s</span>
</div>
<p style="color:#6b7280;font-size:14px;">This code expires in %d minutes.</p>
<p style="color:#9ca3af;font-size:13px;">If you did not request an email change, you can ignore this.</p>
</div></body></html>`, c.appName, otp, expiryMinutes)

	return c.send(ctx, to, subject, html)
}

func (c *Client) SendEmailChangeNotification(ctx context.Context, oldEmail string) error {
	if c.devLogOnly {
		slog.Info("email: EMAIL_DEV_LOG_ONLY — email-change notification not sent", "to", oldEmail)
		return nil
	}

	subject := fmt.Sprintf("Your %s email address was changed", c.appName)
	html := fmt.Sprintf(`<!DOCTYPE html><html><body style="font-family:sans-serif;padding:40px;background:#f9fafb;">
<div style="max-width:520px;margin:0 auto;background:#fff;border-radius:12px;padding:40px;border:1px solid #e5e7eb;">
<h2 style="margin:0 0 8px;color:#111827;">Email address changed</h2>
<p style="color:#6b7280;margin:0 0 16px;">The email address associated with your %s account was recently changed.</p>
<p style="color:#6b7280;margin:0;">If you made this change, no action is needed. If you did not, please contact us immediately.</p>
</div></body></html>`, c.appName)

	return c.send(ctx, oldEmail, subject, html)
}

func (c *Client) send(ctx context.Context, to, subject, html string) error {
	payload := sendEmailRequest{
		From:    c.from,
		To:      []string{to},
		Subject: subject,
		Html:    html,
	}

	body, err := json.Marshal(payload)
	if err != nil {
		return fmt.Errorf("marshal email payload: %w", err)
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, "https://api.resend.com/emails", bytes.NewReader(body))
	if err != nil {
		return fmt.Errorf("create request: %w", err)
	}
	req.Header.Set("Authorization", "Bearer "+c.apiKey)
	req.Header.Set("Content-Type", "application/json")

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return fmt.Errorf("send email: %w", err)
	}
	defer resp.Body.Close()

	respBody, _ := io.ReadAll(resp.Body)
	if resp.StatusCode >= 300 {
		msg := strings.TrimSpace(string(respBody))
		if len(msg) > 500 {
			msg = msg[:500] + "…"
		}
		return fmt.Errorf("resend API error: HTTP %d: %s", resp.StatusCode, msg)
	}
	return nil
}

func (c *Client) SendOTP(ctx context.Context, to, otp string, expiryMinutes int, otpType string) error {
	if c.devLogOnly {
		slog.Info("email: EMAIL_DEV_LOG_ONLY is set — OTP not sent via Resend",
			"to", to, "otp", otp, "type", otpType, "expires_minutes", expiryMinutes)
		return nil
	}

	var buf bytes.Buffer
	if err := otpTmpl.Execute(&buf, map[string]any{
		"OTP":           otp,
		"ExpiryMinutes": expiryMinutes,
		"Type":          otpType,
		"AppName":       c.appName,
	}); err != nil {
		return fmt.Errorf("render email template: %w", err)
	}

	subject := fmt.Sprintf("Your %s verification code", c.appName)
	if otpType == "login" {
		subject = fmt.Sprintf("Your %s sign-in code", c.appName)
	}

	return c.send(ctx, to, subject, buf.String())
}
