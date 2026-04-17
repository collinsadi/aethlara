package resume

import (
	"archive/zip"
	"bytes"
	"encoding/xml"
	"fmt"
	"io"
	"path/filepath"
	"strings"
	"unicode"
	"unicode/utf8"

	"github.com/ledongthuc/pdf"
)

// Magic byte signatures
var (
	pdfMagic = []byte{0x25, 0x50, 0x44, 0x46} // %PDF
	zipMagic = []byte{0x50, 0x4B, 0x03, 0x04} // PK (ZIP = DOCX)
	oleMagic = []byte{0xD0, 0xCF, 0x11, 0xE0} // OLE2 compound = DOC
)

// DetectAndValidateFormat reads magic bytes from file content and verifies they
// match the format declared by the file extension. Returns the confirmed format.
func DetectAndValidateFormat(data []byte, filename string) (string, error) {
	ext := strings.ToLower(strings.TrimPrefix(filepath.Ext(filename), "."))

	switch {
	case bytes.HasPrefix(data, pdfMagic):
		if ext != "pdf" {
			return "", fmt.Errorf("file content is PDF but extension is .%s", ext)
		}
		return "pdf", nil

	case bytes.HasPrefix(data, zipMagic):
		if ext != "docx" {
			return "", fmt.Errorf("file content is DOCX (ZIP-based) but extension is .%s", ext)
		}
		return "docx", nil

	case bytes.HasPrefix(data, oleMagic):
		if ext != "doc" {
			return "", fmt.Errorf("file content is DOC (OLE2) but extension is .%s", ext)
		}
		return "doc", nil

	default:
		// No binary magic bytes — expect plain text (Markdown)
		if ext != "md" {
			return "", fmt.Errorf("unrecognised file format for extension .%s", ext)
		}
		if !utf8.Valid(data) {
			return "", fmt.Errorf("file declared as .md but content is not valid UTF-8")
		}
		return "md", nil
	}
}

// SanitizeFilename strips directory components and replaces unsafe characters.
func SanitizeFilename(name string) string {
	name = filepath.Base(name)
	var sb strings.Builder
	for _, r := range name {
		if unicode.IsLetter(r) || unicode.IsDigit(r) || r == '-' || r == '_' || r == '.' {
			sb.WriteRune(r)
		} else {
			sb.WriteRune('_')
		}
	}
	s := sb.String()
	if len(s) > 128 {
		s = s[:128]
	}
	return s
}

// ContentTypeFor returns the MIME type for a given file format.
func ContentTypeFor(format string) string {
	switch format {
	case "pdf":
		return "application/pdf"
	case "docx":
		return "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
	case "doc":
		return "application/msword"
	case "md":
		return "text/markdown; charset=utf-8"
	}
	return "application/octet-stream"
}

// ExtractText extracts plain text from a file given its content and format.
func ExtractText(data []byte, format string) (string, error) {
	switch format {
	case "pdf":
		return extractPDF(data)
	case "docx":
		return extractDOCX(data)
	case "doc":
		return extractDOC(data)
	case "md":
		return string(data), nil
	}
	return "", fmt.Errorf("unsupported format: %s", format)
}

func extractPDF(data []byte) (string, error) {
	r, err := pdf.NewReader(bytes.NewReader(data), int64(len(data)))
	if err != nil {
		return "", fmt.Errorf("open pdf: %w", err)
	}

	var buf strings.Builder
	for i := 1; i <= r.NumPage(); i++ {
		p := r.Page(i)
		if p.V.IsNull() {
			continue
		}
		text, err := p.GetPlainText(nil)
		if err != nil {
			continue
		}
		buf.WriteString(text)
		buf.WriteByte('\n')
	}

	result := strings.TrimSpace(buf.String())
	if result == "" {
		return "", fmt.Errorf("no text could be extracted from PDF")
	}
	return result, nil
}

func extractDOCX(data []byte) (string, error) {
	zr, err := zip.NewReader(bytes.NewReader(data), int64(len(data)))
	if err != nil {
		return "", fmt.Errorf("open docx zip: %w", err)
	}

	for _, f := range zr.File {
		if f.Name != "word/document.xml" {
			continue
		}
		rc, err := f.Open()
		if err != nil {
			return "", fmt.Errorf("open document.xml: %w", err)
		}
		defer rc.Close()

		var buf strings.Builder
		dec := xml.NewDecoder(rc)
		inText := false

		for {
			tok, err := dec.Token()
			if err == io.EOF {
				break
			}
			if err != nil {
				break
			}
			switch t := tok.(type) {
			case xml.StartElement:
				// <w:t> holds the actual text; <w:br> is a line break
				if t.Name.Local == "t" {
					inText = true
				} else if t.Name.Local == "br" || t.Name.Local == "p" {
					buf.WriteByte('\n')
				}
			case xml.EndElement:
				if t.Name.Local == "t" {
					inText = false
				}
			case xml.CharData:
				if inText {
					buf.Write(t)
				}
			}
		}

		result := strings.TrimSpace(buf.String())
		if result == "" {
			return "", fmt.Errorf("no text could be extracted from DOCX")
		}
		return result, nil
	}

	return "", fmt.Errorf("word/document.xml not found in DOCX archive")
}

// extractDOC performs best-effort ASCII text extraction from OLE2 .doc files.
// For production-quality extraction, install antiword and use an OS-level call.
func extractDOC(data []byte) (string, error) {
	var buf strings.Builder
	var run []byte

	for _, b := range data {
		if (b >= 0x20 && b < 0x7F) || b == '\n' || b == '\r' || b == '\t' {
			run = append(run, b)
		} else {
			if len(run) >= 5 {
				buf.Write(run)
				buf.WriteByte(' ')
			}
			run = run[:0]
		}
	}
	if len(run) >= 5 {
		buf.Write(run)
	}

	result := strings.TrimSpace(buf.String())
	if len(result) < 50 {
		return "", fmt.Errorf(
			"insufficient text extracted from .doc file; " +
				"for better results convert to .docx or .pdf",
		)
	}
	return result, nil
}
