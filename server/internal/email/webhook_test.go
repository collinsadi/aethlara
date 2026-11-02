package email

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"net/http"
	"strconv"
	"testing"
	"time"
)

func sign(t *testing.T, secret, id string, ts int64, body []byte) string {
	t.Helper()
	key, err := base64.StdEncoding.DecodeString(secret[len("whsec_"):])
	if err != nil {
		t.Fatal(err)
	}
	mac := hmac.New(sha256.New, key)
	mac.Write([]byte(id + "." + strconv.FormatInt(ts, 10) + "."))
	mac.Write(body)
	return "v1," + base64.StdEncoding.EncodeToString(mac.Sum(nil))
}

func TestVerifyWebhook(t *testing.T) {
	secret := "whsec_" + base64.StdEncoding.EncodeToString([]byte("super-secret-signing-key-32-bytes"))
	body := []byte(`{"type":"email.received","data":{"email_id":"abc"}}`)
	now := time.Unix(1_800_000_000, 0)
	good := sign(t, secret, "msg_1", now.Unix(), body)

	headers := func(id string, ts int64, sig string) http.Header {
		h := http.Header{}
		h.Set("svix-id", id)
		h.Set("svix-timestamp", strconv.FormatInt(ts, 10))
		h.Set("svix-signature", sig)
		return h
	}

	cases := []struct {
		name string
		h    http.Header
		body []byte
		ok   bool
	}{
		{"valid", headers("msg_1", now.Unix(), good), body, true},
		{"valid among rotated", headers("msg_1", now.Unix(), "v1,bm9wZQ== "+good), body, true},
		{"tampered body", headers("msg_1", now.Unix(), good), []byte(`{"type":"x"}`), false},
		{"wrong id", headers("msg_2", now.Unix(), good), body, false},
		{"stale", headers("msg_1", now.Add(-10*time.Minute).Unix(), sign(t, secret, "msg_1", now.Add(-10*time.Minute).Unix(), body)), body, false},
		{"missing headers", http.Header{}, body, false},
		{"unknown version", headers("msg_1", now.Unix(), "v2,"+good[3:]), body, false},
	}
	for _, c := range cases {
		err := VerifyWebhook(secret, c.h, c.body, 5*time.Minute, now)
		if (err == nil) != c.ok {
			t.Errorf("%s: err = %v, want ok=%v", c.name, err, c.ok)
		}
	}
	if VerifyWebhook("", headers("msg_1", now.Unix(), good), body, 5*time.Minute, now) == nil {
		t.Error("empty secret must never verify")
	}
}
