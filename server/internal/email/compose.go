package email

import (
	"fmt"
	"html"
	"regexp"
	"strings"
	"unicode"
)

// SignatureSeparator splits an email body from the signature block.
const SignatureSeparator = "\n\n--\n"

// RenderHTML turns a plain-text email into the HTML part of the same
// message. Spam filters expect a personal email's two parts to say the same
// thing, so the HTML adds nothing the text does not have: no images,
// tracking pixels, remote CSS, buttons or rewritten links. Paragraphs are
// separated by blank lines; the signature (after SignatureSeparator) is set
// in a muted block.
func RenderHTML(subject, text string) string {
	body, signature, _ := strings.Cut(text, SignatureSeparator)
	var sb strings.Builder
	sb.WriteString("<!DOCTYPE html>\n<html lang=\"en\">\n<head>\n<meta charset=\"utf-8\">\n")
	sb.WriteString("<meta name=\"viewport\" content=\"width=device-width, initial-scale=1\">\n")
	fmt.Fprintf(&sb, "<title>%s</title>\n</head>\n", html.EscapeString(subject))
	sb.WriteString(`<body style="margin:0;padding:0">` + "\n")
	sb.WriteString(`<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.5;color:#222222;max-width:640px">` + "\n")
	for _, para := range paragraphs(body) {
		sb.WriteString(`<p style="margin:0 0 12px">`)
		sb.WriteString(strings.ReplaceAll(html.EscapeString(para), "\n", "<br>\n"))
		sb.WriteString("</p>\n")
	}
	if s := strings.TrimSpace(signature); s != "" {
		sb.WriteString(`<p style="margin:16px 0 0;color:#555555">--<br>` + "\n")
		sb.WriteString(strings.ReplaceAll(html.EscapeString(s), "\n", "<br>\n"))
		sb.WriteString("</p>\n")
	}
	sb.WriteString("</div>\n</body>\n</html>\n")
	return sb.String()
}

func paragraphs(text string) []string {
	text = strings.ReplaceAll(text, "\r\n", "\n")
	var out []string
	for p := range strings.SplitSeq(text, "\n\n") {
		if p = strings.TrimSpace(p); p != "" {
			out = append(out, p)
		}
	}
	return out
}

var (
	urlRe       = regexp.MustCompile(`(?i)\bhttps?://[^\s<>"]+|\bwww\.[^\s<>"]+`)
	shortenerRe = regexp.MustCompile(`(?i)\b(?:bit\.ly|tinyurl\.com|t\.co|goo\.gl|ow\.ly|is\.gd|buff\.ly|rebrand\.ly|cutt\.ly|shorturl\.at|rb\.gy|tiny\.cc)/`)
	// Phrases that are rare in a genuine application and common in spam.
	// Only high-precision ones: "guaranteed delivery" or "hackathon winner"
	// are fine in an engineer's email.
	spamPhrases = []string{
		"act now", "100% free", "risk-free", "risk free", "click here", "click below",
		"limited time offer", "earn money fast", "no obligation", "dear friend",
		"urgent response", "cash bonus", "$$$", "double your", "once in a lifetime", "100% satisfied",
		"special promotion", "this is not spam", "unsubscribe", "viagra", "crypto giveaway",
	}
)

// Lint lists features of an email that commonly trip spam filters. The
// agent uses it to reject an AI draft (and fall back to a plain template)
// rather than send something that looks like bulk mail.
func Lint(subject, body string) []string {
	var issues []string
	s := strings.TrimSpace(subject)
	switch {
	case s == "":
		issues = append(issues, "empty subject")
	case len(s) > 150:
		issues = append(issues, "subject longer than 150 characters")
	}
	if shouting(s, 6) {
		issues = append(issues, "subject in capitals")
	}
	if strings.Contains(s, "!!") || strings.Contains(s, "$$") || strings.Contains(s, "??") {
		issues = append(issues, "repeated punctuation in the subject")
	}
	if ls := strings.ToLower(s); strings.HasPrefix(ls, "re:") || strings.HasPrefix(ls, "fwd:") || strings.HasPrefix(ls, "fw:") {
		issues = append(issues, "subject pretends to be a reply or forward")
	}

	urls := urlRe.FindAllString(body, -1)
	if len(urls) > 4 {
		issues = append(issues, fmt.Sprintf("%d links in the body", len(urls)))
	}
	if shortenerRe.MatchString(body) {
		issues = append(issues, "link shortener")
	}
	if strings.Contains(body, "!!") {
		issues = append(issues, "repeated exclamation marks")
	}
	if len(body) >= 200 && shouting(body, 200) {
		issues = append(issues, "body mostly in capitals")
	}
	low := strings.ToLower(s + "\n" + body)
	for _, p := range spamPhrases {
		if strings.Contains(low, p) {
			issues = append(issues, fmt.Sprintf("spam-like phrase %q", p))
		}
	}
	return issues
}

// shouting reports whether at least minLetters letters are present and
// more than 60% of them are capitals (or, for short text, all of them).
func shouting(s string, minLetters int) bool {
	letters, upper := 0, 0
	for _, r := range s {
		if unicode.IsLetter(r) {
			letters++
			if unicode.IsUpper(r) {
				upper++
			}
		}
	}
	if letters < minLetters {
		return false
	}
	if letters < 40 {
		return upper == letters
	}
	return upper*100/letters > 60
}
