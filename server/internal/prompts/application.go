package prompts

import "fmt"

// ApplicationFillV1 — version tag for filling application forms on behalf
// of the candidate (autopilot / extension).
const ApplicationFillV1 = "application_fill_v1.0.0"

// CoverLetterV1 — version tag for generated cover letters.
const CoverLetterV1 = "cover_letter_v1.0.0"

// Tokens the extension replaces with files when filling upload fields.
const (
	ResumeFileToken      = "__RESUME__"
	CoverLetterFileToken = "__COVER_LETTER__"
)

// ApplicationFillSystemPrompt instructs the model to answer the fields of
// one application form page.
func ApplicationFillSystemPrompt() string {
	return `You complete job application forms for a candidate who has explicitly asked you to apply on their behalf. You receive the candidate's application profile, answers they saved for earlier questions, their tailored resume, a cover letter, the job, and the form fields detected on the current page. Return the value to enter for every field you can answer truthfully.

RULES:
- Use only facts present in the context. Never invent employers, titles, dates, degrees, numbers, links or personal details.
- Contact fields: copy the profile values exactly. The email to use is the "Email" in the application profile.
- Name fields: derive first, last and preferred name from the full name.
- Fields with options (select, radio, checkbox, combobox): the value MUST be one of the listed options, copied exactly. For a checkbox group that allows several answers, join the chosen options with " | ".
- Yes/No questions: answer with the option text that means yes or no.
- Saved answers: when a question matches one the candidate already answered, reuse that answer.
- Voluntary self-identification (gender, race, ethnicity, veteran, disability, sexual orientation, age): use the candidate's stated preference; if none, choose the option meaning "decline to self-identify" or "prefer not to say". If no such option exists, use null.
- Required acknowledgements (privacy policy, data processing consent, accuracy attestation): choose the affirmative option. Never opt in to marketing, newsletters, talent communities, SMS or text messages.
- Open questions ("Why do you want to work here?", "Tell us about a project"): write 2-5 sentences in the first person, specific to this job and grounded in the resume. No cliches, no exaggeration.
- Cover letter text fields: use the provided cover letter.
- Salary expectations: use the profile's expectation; if there is none, null.
- "How did you hear about us": use the profile's answer, otherwise "Company website".
- File uploads: "` + ResumeFileToken + `" for resume/CV fields, "` + CoverLetterFileToken + `" for cover letter fields, null for any other file.
- If a REQUIRED field cannot be answered truthfully from the context, set its value to null and list it in "missing" with the question as the candidate would read it.
- "confidence": high when the value is copied from the context, medium when inferred, low when uncertain.
- Plain ASCII text only (no smart quotes, em dashes or bullets).`
}

// ApplicationFillUserMessage assembles the per-page context. All arguments
// are pre-rendered plain text blocks.
func ApplicationFillUserMessage(profile, savedAnswers, job, resume, coverLetter, pageURL, fieldsJSON string) string {
	return fmt.Sprintf(`<application_profile>
%s
</application_profile>

<saved_answers>
%s
</saved_answers>

<job>
%s
</job>

<tailored_resume>
%s
</tailored_resume>

<cover_letter>
%s
</cover_letter>

<form_page url=%q>
%s
</form_page>

Return a value for each field_id above.`,
		profile, orNone(savedAnswers), job, resume, orNone(coverLetter), pageURL, fieldsJSON)
}

// ApplicationFillSchema constrains the fill output.
func ApplicationFillSchema() map[string]any {
	return map[string]any{
		"type": "object",
		"properties": map[string]any{
			"fills": map[string]any{
				"type": "array",
				"items": map[string]any{
					"type": "object",
					"properties": map[string]any{
						"field_id":   map[string]any{"type": "string"},
						"value":      nullableString(),
						"confidence": map[string]any{"type": "string", "enum": []string{"high", "medium", "low"}},
					},
					"required":             []string{"field_id", "value", "confidence"},
					"additionalProperties": false,
				},
			},
			"missing": map[string]any{
				"type": "array",
				"items": map[string]any{
					"type": "object",
					"properties": map[string]any{
						"field_id": map[string]any{"type": "string"},
						"question": map[string]any{"type": "string"},
					},
					"required":             []string{"field_id", "question"},
					"additionalProperties": false,
				},
			},
		},
		"required":             []string{"fills", "missing"},
		"additionalProperties": false,
	}
}

// CoverLetterSystemPrompt instructs the model to write a short cover letter.
func CoverLetterSystemPrompt() string {
	return `You write cover letters for a job seeker. Write one for the job and resume provided.

RULES:
- 150 to 250 words, three or four short paragraphs, first person.
- Open with the specific role and one concrete reason the candidate fits it. Connect two or three real achievements from the resume to the job's requirements.
- Use only facts from the resume. Never invent metrics, employers, tools or credentials.
- No placeholders ("[Company]", "[Hiring Manager]"), no address block, no date line, no subject line.
- Start with "Dear Hiring Team," unless a hiring manager is named in the job. End with "Best regards," and the candidate's full name on the next line.
- Confident and plain; no cliches such as "I am writing to express my interest".
- Plain ASCII text only (no smart quotes, em dashes or bullets). Return only the letter.`
}

// CoverLetterUserMessage assembles cover letter context.
func CoverLetterUserMessage(fullName, job, resume string) string {
	return fmt.Sprintf("<candidate_name>%s</candidate_name>\n\n<job>\n%s\n</job>\n\n<resume>\n%s\n</resume>", fullName, job, resume)
}

func orNone(s string) string {
	if s == "" {
		return "(none)"
	}
	return s
}
