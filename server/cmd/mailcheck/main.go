// Command mailcheck reports whether the agent's sending domain is set up
// for application emails to reach the inbox: verified in Resend with DKIM
// and an SPF return path on the domain itself (both align with the From
// address for DMARC), a DMARC policy, an MX record for replies, open and
// click tracking off, and a webhook that reports deliveries, bounces and
// spam complaints back to the server.
//
// It reads AGENT_MAIL_DOMAIN and AGENT_RESEND_API_KEY (or RESEND_API_KEY)
// from the environment or the .env file in the working directory, and never
// prints the key.
//
//	go run ./cmd/mailcheck          # report (exit status 1 when a check fails)
//	go run ./cmd/mailcheck -fix     # also turn tracking off and subscribe the
//	                                # webhook to the delivery events
//	go run ./cmd/mailcheck -json    # machine-readable report
package main

import (
	"context"
	"encoding/json"
	"flag"
	"fmt"
	"os"
	"strings"
	"time"

	"github.com/joho/godotenv"

	"github.com/collinsadi/aethlara/internal/email"
)

func main() {
	fix := flag.Bool("fix", false, "turn off open/click tracking and subscribe the webhook to the delivery events")
	asJSON := flag.Bool("json", false, "print the report as JSON")
	envFile := flag.String("env", ".env", "env file to read (skipped when missing)")
	flag.Parse()
	_ = godotenv.Load(*envFile)

	domain := strings.ToLower(strings.TrimSpace(os.Getenv("AGENT_MAIL_DOMAIN")))
	key := strings.TrimSpace(os.Getenv("AGENT_RESEND_API_KEY"))
	if key == "" {
		key = strings.TrimSpace(os.Getenv("RESEND_API_KEY"))
	}
	if domain == "" || key == "" {
		fmt.Fprintln(os.Stderr, "mailcheck: AGENT_MAIL_DOMAIN and AGENT_RESEND_API_KEY (or RESEND_API_KEY) must be set")
		os.Exit(2)
	}
	client := email.NewClient(key, "", "", "", false)
	if base := os.Getenv("RESEND_BASE_URL"); base != "" {
		client.SetBaseURL(base)
	}

	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Minute)
	defer cancel()
	rep := client.CheckDeliverability(ctx, domain, nil)

	if *fix {
		var changed []string
		if rep.DomainID != "" && rep.TrackingOn {
			if err := client.SetDomainTracking(ctx, rep.DomainID, false, false); err != nil {
				fmt.Fprintln(os.Stderr, "mailcheck: turning tracking off failed:", err)
			} else {
				changed = append(changed, "turned open and click tracking off")
			}
		}
		if rep.Webhook != nil && (len(rep.MissingEvent) > 0 || rep.Webhook.Status != "enabled") {
			events := append(append([]string{}, rep.Webhook.Events...), rep.MissingEvent...)
			if err := client.SetWebhookEvents(ctx, *rep.Webhook, events); err != nil {
				fmt.Fprintln(os.Stderr, "mailcheck: updating the webhook failed:", err)
			} else {
				changed = append(changed, "subscribed the webhook to "+strings.Join(rep.MissingEvent, ", "))
			}
		}
		if len(changed) > 0 {
			for _, c := range changed {
				fmt.Fprintln(os.Stderr, "fixed:", c)
			}
			rep = client.CheckDeliverability(ctx, domain, nil)
		} else {
			fmt.Fprintln(os.Stderr, "nothing to fix on the Resend side")
		}
	}

	if *asJSON {
		out, _ := json.MarshalIndent(rep, "", "  ")
		fmt.Println(string(out))
	} else {
		fmt.Printf("Deliverability for %s: %s (can send: %t)\n\n", rep.Domain, strings.ToUpper(rep.Status), rep.CanSend)
		for _, c := range rep.Checks {
			fmt.Printf("  [%-7s] %-28s %s\n", c.Status, c.Label, c.Detail)
		}
		fmt.Println()
	}
	for _, c := range rep.Checks {
		if c.Status == email.CheckFail {
			os.Exit(1)
		}
	}
}
