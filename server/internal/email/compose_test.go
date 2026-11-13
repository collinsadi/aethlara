package email

import (
	"strings"
	"testing"
)

func TestRenderHTMLMatchesTheText(t *testing.T) {
	text := "Dear Hiring Team,\n\nI built <payments> & \"ledgers\".\nSecond line.\n\nBest regards,\nJane Doe" +
		SignatureSeparator + "Jane Doe\njane@mail.example.com\nhttps://linkedin.com/in/jane"
	out := RenderHTML("Application for Backend Engineer - Jane Doe", text)
	for _, want := range []string{
		"<!DOCTYPE html>", `<html lang="en">`, `<meta charset="utf-8">`,
		"<title>Application for Backend Engineer - Jane Doe</title>",
		"I built &lt;payments&gt; &amp; &#34;ledgers&#34;.<br>\nSecond line.",
		"Best regards,<br>\nJane Doe</p>",
		"--<br>\nJane Doe<br>\njane@mail.example.com",
	} {
		if !strings.Contains(out, want) {
			t.Errorf("RenderHTML missing %q in:\n%s", want, out)
		}
	}
	for _, banned := range []string{"<img", "<a ", "http-equiv", "<script", "<link"} {
		if strings.Contains(out, banned) {
			t.Errorf("RenderHTML must not contain %q", banned)
		}
	}
	if strings.Count(out, "<p ") != 4 {
		t.Errorf("want 3 paragraphs and a signature, got:\n%s", out)
	}
}

func TestLint(t *testing.T) {
	good := "Dear Hiring Team,\n\nI would like to apply for the Backend Engineer role. I built guaranteed-delivery queues in Go and won a hackathon (winner, 2024).\n\nMy resume is attached.\n\nBest regards,\nJane"
	if issues := Lint("Application for Backend Engineer - Jane Doe", good); len(issues) != 0 {
		t.Errorf("a normal application was flagged: %v", issues)
	}
	cases := map[string][2]string{
		"capitals":  {"APPLICATION FOR BACKEND ENGINEER", good},
		"fake re":   {"Re: your opening", good},
		"shortener": {"Application", good + " https://bit.ly/abc"},
		"links":     {"Application", good + " https://a.io https://b.io https://c.io https://d.io https://e.io"},
		"phrase":    {"Application", good + " Click here to see my work."},
		"shouting":  {"Application", strings.Repeat("HIRE ME NOW BECAUSE I AM GREAT ", 10)},
		"bangs":     {"Application", good + " Thank you!!"},
		"empty":     {"  ", good},
	}
	for name, c := range cases {
		if issues := Lint(c[0], c[1]); len(issues) == 0 {
			t.Errorf("%s: not flagged", name)
		}
	}
}
