package email

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"errors"
	"net/http"
	"strconv"
	"strings"
	"time"
)

// ErrWebhookSignature is returned when a webhook fails verification.
var ErrWebhookSignature = errors.New("invalid webhook signature")

// VerifyWebhook checks a Resend webhook delivery. Resend signs webhooks with
// Svix: the signature is base64(HMAC-SHA256(key, id + "." + timestamp + "."
// + body)) where key is the base64-decoded part of the "whsec_..." secret.
// The svix-signature header may carry several space-separated "v1,<sig>"
// values (secret rotation); any match passes. Deliveries older or newer
// than tolerance are rejected to stop replays.
func VerifyWebhook(secret string, h http.Header, body []byte, tolerance time.Duration, now time.Time) error {
	if secret == "" {
		return ErrWebhookSignature
	}
	id := h.Get("svix-id")
	ts := h.Get("svix-timestamp")
	sigHeader := h.Get("svix-signature")
	if id == "" || ts == "" || sigHeader == "" {
		return ErrWebhookSignature
	}

	sec, err := strconv.ParseInt(ts, 10, 64)
	if err != nil {
		return ErrWebhookSignature
	}
	sent := time.Unix(sec, 0)
	if now.Sub(sent) > tolerance || sent.Sub(now) > tolerance {
		return ErrWebhookSignature
	}

	key, err := base64.StdEncoding.DecodeString(strings.TrimPrefix(secret, "whsec_"))
	if err != nil {
		return ErrWebhookSignature
	}
	mac := hmac.New(sha256.New, key)
	mac.Write([]byte(id + "." + ts + "."))
	mac.Write(body)
	expected := mac.Sum(nil)

	for _, part := range strings.Fields(sigHeader) {
		version, sig, ok := strings.Cut(part, ",")
		if !ok || version != "v1" {
			continue
		}
		got, err := base64.StdEncoding.DecodeString(sig)
		if err != nil {
			continue
		}
		if hmac.Equal(got, expected) {
			return nil
		}
	}
	return ErrWebhookSignature
}
