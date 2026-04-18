package job

import (
	"bytes"
	"fmt"
	"strings"

	"github.com/go-pdf/fpdf"

	"github.com/collinsadi/aethlara/pkg/sanitise"
)

const (
	pageW      = 210.0 // A4 width mm
	marginLR   = 19.05 // 0.75 inch
	lineHeight = 5.0
	maxPages   = 2
)

// GeneratePDF produces an ATS-friendly single-column resume PDF from a TailoredResume.
func GeneratePDF(tr *TailoredResume) ([]byte, error) {
	f := fpdf.New("P", "mm", "A4", "")
	f.SetMargins(marginLR, 19.05, marginLR)
	f.SetAutoPageBreak(true, 19.05)
	f.AddPage()

	contentW := pageW - 2*marginLR

	// Helper closures
	setFont := func(style string, size float64) {
		f.SetFont("Helvetica", style, size)
	}

	cell := func(h float64, txt string) {
		f.MultiCell(contentW, h, txt, "", "L", false)
	}

	sectionHeader := func(title string) {
		f.Ln(3)
		setFont("B", 12)
		f.SetFillColor(240, 240, 240)
		f.CellFormat(contentW, 7, strings.ToUpper(title), "B", 1, "L", true, 0, "")
		f.Ln(1)
	}

	bullet := func(txt string) {
		setFont("", 10)
		f.SetX(marginLR + 4)
		f.MultiCell(contentW-4, lineHeight, "- "+sanitise.ResumeText(txt), "", "L", false)
	}

	kvLine := func(label, value string) {
		if value == "" {
			return
		}
		setFont("B", 10)
		f.CellFormat(35, lineHeight, label+":", "", 0, "L", false, 0, "")
		setFont("", 10)
		f.MultiCell(contentW-35, lineHeight, value, "", "L", false)
	}

	// ── Personal Info ──────────────────────────────────────────────────────────
	name := strField(tr.Personal, "full_name")
	if name != "" {
		setFont("B", 18)
		f.CellFormat(contentW, 10, name, "", 1, "C", false, 0, "")
	}

	contactParts := []string{}
	for _, key := range []string{"email", "phone", "linkedin", "github", "portfolio"} {
		if v := strField(tr.Personal, key); v != "" {
			contactParts = append(contactParts, v)
		}
	}
	if len(contactParts) > 0 {
		setFont("", 9)
		f.CellFormat(contentW, 5, strings.Join(contactParts, "  |  "), "", 1, "C", false, 0, "")
	}

	// ── Summary ────────────────────────────────────────────────────────────────
	if tr.Summary != "" {
		sectionHeader("Summary")
		setFont("", 10)
		cell(lineHeight, tr.Summary)
	}

	// ── Experience ─────────────────────────────────────────────────────────────
	if len(tr.Experience) > 0 {
		sectionHeader("Experience")
		for _, exp := range tr.Experience {
			title := strField(exp, "title")
			company := strField(exp, "company")
			location := strField(exp, "location")
			start := strField(exp, "start_date")
			end := strField(exp, "end_date")
			if boolField(exp, "is_current") {
				end = "Present"
			}

			dateRange := joinNonEmpty(" – ", start, end)
			header := joinNonEmpty(", ", title, company)
			if location != "" {
				header = joinNonEmpty(" | ", header, location)
			}

			setFont("B", 10)
			f.CellFormat(contentW*0.7, lineHeight, header, "", 0, "L", false, 0, "")
			setFont("", 9)
			f.CellFormat(contentW*0.3, lineHeight, dateRange, "", 1, "R", false, 0, "")

			if highlights, ok := exp["highlights"].([]any); ok {
				for _, h := range highlights {
					if hs, ok := h.(string); ok && hs != "" {
						bullet(hs)
					}
				}
			}
			f.Ln(2)
		}
	}

	// ── Skills ─────────────────────────────────────────────────────────────────
	hasSkills := false
	for _, key := range []string{"technical", "soft", "languages", "tools"} {
		if vals := strSliceField(tr.Skills, key); len(vals) > 0 {
			hasSkills = true
			break
		}
	}
	if hasSkills {
		sectionHeader("Skills")
		labelMap := map[string]string{
			"technical": "Technical",
			"soft":      "Soft",
			"languages": "Languages",
			"tools":     "Tools",
		}
		for _, key := range []string{"technical", "soft", "languages", "tools"} {
			if vals := strSliceField(tr.Skills, key); len(vals) > 0 {
				kvLine(labelMap[key], strings.Join(vals, ", "))
			}
		}
	}

	// ── Education ──────────────────────────────────────────────────────────────
	if len(tr.Education) > 0 {
		sectionHeader("Education")
		for _, edu := range tr.Education {
			inst := strField(edu, "institution")
			degree := strField(edu, "degree")
			field := strField(edu, "field")
			start := strField(edu, "start_date")
			end := strField(edu, "end_date")

			degreeField := joinNonEmpty(", ", degree, field)
			dateRange := joinNonEmpty(" – ", start, end)

			setFont("B", 10)
			f.CellFormat(contentW*0.7, lineHeight, inst, "", 0, "L", false, 0, "")
			setFont("", 9)
			f.CellFormat(contentW*0.3, lineHeight, dateRange, "", 1, "R", false, 0, "")
			if degreeField != "" {
				setFont("", 10)
				cell(lineHeight, degreeField)
			}
			f.Ln(1)
		}
	}

	// ── Certifications ─────────────────────────────────────────────────────────
	if len(tr.Certifications) > 0 {
		sectionHeader("Certifications")
		for _, cert := range tr.Certifications {
			name := strField(cert, "name")
			issuer := strField(cert, "issuer")
			date := strField(cert, "date")
			line := joinNonEmpty(" — ", name, joinNonEmpty(", ", issuer, date))
			setFont("", 10)
			cell(lineHeight, line)
		}
	}

	// ── Projects ───────────────────────────────────────────────────────────────
	if len(tr.Projects) > 0 {
		sectionHeader("Projects")
		for _, proj := range tr.Projects {
			name := strField(proj, "name")
			desc := strField(proj, "description")
			projURL := strField(proj, "url")
			techs := strSliceField(proj, "technologies")

			setFont("B", 10)
			header := name
			if projURL != "" {
				header += " (" + projURL + ")"
			}
			cell(lineHeight, header)

			if desc != "" {
				setFont("", 10)
				cell(lineHeight, desc)
			}
			if len(techs) > 0 {
				setFont("I", 9)
				cell(lineHeight, strings.Join(techs, ", "))
			}
			f.Ln(1)
		}
	}

	// Enforce max pages
	if f.PageNo() > maxPages {
		return nil, fmt.Errorf("resume content exceeds maximum %d pages", maxPages)
	}

	var buf bytes.Buffer
	if err := f.Output(&buf); err != nil {
		return nil, fmt.Errorf("pdf render: %w", err)
	}
	return buf.Bytes(), nil
}

// ── helpers ──────────────────────────────────────────────────────────────────

func strField(m map[string]any, key string) string {
	if m == nil {
		return ""
	}
	v, _ := m[key].(string)
	return sanitise.ResumeText(strings.TrimSpace(v))
}

func boolField(m map[string]any, key string) bool {
	if m == nil {
		return false
	}
	v, _ := m[key].(bool)
	return v
}

func strSliceField(m map[string]any, key string) []string {
	if m == nil {
		return nil
	}
	raw, ok := m[key].([]any)
	if !ok {
		return nil
	}
	out := make([]string, 0, len(raw))
	for _, v := range raw {
		if s, ok := v.(string); ok && s != "" {
			out = append(out, sanitise.ResumeText(s))
		}
	}
	return out
}

func joinNonEmpty(sep string, parts ...string) string {
	filtered := parts[:0]
	for _, p := range parts {
		if p != "" {
			filtered = append(filtered, p)
		}
	}
	return strings.Join(filtered, sep)
}
