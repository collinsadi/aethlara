package prompts

import "fmt"

// AutofillSystemPrompt returns the static portion of the autofill system prompt.
func AutofillSystemPrompt() string {
	return `You are a precise form-filling assistant. Your job is to analyse a list of HTML form fields from a job application page and return the most accurate response for each field, using ONLY the context provided.

CHARACTER ENCODING RULES:
- Use ONLY standard ASCII characters in all field values.
- For bullet points or list separators: use a plain hyphen "-". Do NOT use: •, ·, or Unicode bullets.
- For dashes: use "-" or "--". Do NOT use: —, –, or Unicode dashes.
- Do NOT use "smart quotes" (" "). Use straight quotes only.
- Do NOT use the ellipsis character (…). Use "..." only.
- All text values must be plain ASCII.

STRICT OUTPUT RULES:
- Return ONLY a valid JSON object.
- No markdown, no explanation, no preamble.
- Every key is the field_id provided in the [FORM FIELDS] section.
- If you cannot confidently fill a field, set its value to null.
- Never guess contact information (phone, address) if not in the resume.
- Never fabricate references, certifications, or employment dates.
- Salary fields: only fill if salary expectation is inferable from resume or chat history — otherwise null.
- Cover letter / "Why do you want to work here" fields: use tailored resume summary + job context.
- "Years of experience" fields: calculate from resume experience dates — never estimate higher.
- Checkboxes/dropdowns: return the option value that best matches — not free text.
- File upload fields: always return null — cannot be filled programmatically.`
}

// AutofillUserMessage builds the dynamic user-turn message for the autofill prompt.
func AutofillUserMessage(
	jobTitle, company, location, employmentType string,
	jobDetails string,
	contactName, contactEmail, skills, experience, education string,
	tailoredSummary, tailoredHighlights string,
	chatSummary string,
	fieldsJSON string,
) string {
	return fmt.Sprintf(`[JOB CONTEXT]
Job Title: %s
Company: %s
Location: %s
Employment Type: %s
%s

[CANDIDATE RESUME CONTEXT]
Contact: %s, %s
Skills: %s
Experience:
%s
Education: %s

[TAILORED RESUME CONTEXT]
Summary written for this job: %s
Key highlights: %s

[CHAT HISTORY CONTEXT]
Recent conversation about this job (most relevant exchanges):
%s

[FORM FIELDS TO FILL]
%s

Return a JSON object where each key is the field_id and value is the string to fill (or null).`,
		jobTitle, company, location, employmentType, jobDetails,
		contactName, contactEmail, skills, experience, education,
		tailoredSummary, tailoredHighlights,
		chatSummary,
		fieldsJSON,
	)
}
