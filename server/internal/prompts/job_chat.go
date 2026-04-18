package prompts

import (
	"fmt"
	"strings"
)

// JobChatV1 — version tag logged with every chat message.
// Increment when the prompt text or assembly rules change.
const JobChatV1 = "job_chat_v1.1.0"

// JobChatContext is the structured input for JobChatSystemPrompt.
// All fields are plain strings/numbers — the full extracted_job_json and
// tailored_resume_json blobs are NEVER passed here. Callers extract only the
// safe summaries below from the server-side JSON.
type JobChatContext struct {
	// Job
	JobTitle         string
	Company          string
	Location         string
	RemoteStatus     string // "Remote", "Hybrid", "On-site", or ""
	EmploymentType   string
	ExperienceLevel  string
	SalaryRange      string // pre-formatted, e.g. "$120k – $160k USD" or "Not specified"
	JobSummary       string
	Responsibilities []string
	RequiredSkills   []string
	PreferredSkills  []string
	TechStack        []string

	// Resume (extracted fields ONLY — no email/phone)
	ResumeSummary string // short paragraph grounded in actual resume content

	// Match analysis
	MatchScore      int // 0 if unknown
	SkillsMatch     int
	ExperienceMatch int
	EducationMatch  int

	TailoredResumeSummary string   // short description of the key tailoring changes
	Gaps                  []string // identified gaps from alignment
}

// JobChatSystemPrompt assembles the full system prompt for a chat session.
// Every placeholder is populated from server-side data; the prompt is fresh-built
// on each request and never cached in the DB. Resume contact info (email, phone)
// MUST be stripped by the caller before this function is called.
func JobChatSystemPrompt(c JobChatContext) string {
	title := fallback(c.JobTitle, "this role")
	company := fallback(c.Company, "this company")
	location := fallback(c.Location, "Not specified")
	remote := fallback(c.RemoteStatus, "Not specified")
	empType := fallback(c.EmploymentType, "Not specified")
	expLevel := fallback(c.ExperienceLevel, "Not specified")
	salary := fallback(c.SalaryRange, "Not specified")
	jobSummary := fallback(c.JobSummary, "No summary provided.")
	resumeSummary := fallback(c.ResumeSummary, "Resume details are unavailable.")
	tailored := fallback(c.TailoredResumeSummary, "No tailoring changes recorded.")

	scoreLine := "Overall Match Score: not scored"
	if c.MatchScore > 0 {
		scoreLine = fmt.Sprintf("Overall Match Score: %d%%", c.MatchScore)
	}

	var b strings.Builder

	// ── [CHARACTER ENCODING RULES] ──────────────────────────────────────
	b.WriteString("[CHARACTER ENCODING RULES]\n")
	b.WriteString("Use ONLY standard ASCII characters for punctuation and structure.\n")
	b.WriteString("For bullet points: use \"-\" only. Do NOT use: •, ·, or Unicode bullets.\n")
	b.WriteString("For dashes: use \"-\" or \"--\". Do NOT use: —, –, or Unicode dashes.\n")
	b.WriteString("Do NOT use smart quotes or the ellipsis character (…). Use straight quotes and \"...\" only.\n\n")

	// ── [IDENTITY BLOCK] ────────────────────────────────────────────────
	b.WriteString("[IDENTITY]\n")
	b.WriteString("You are a focused job application assistant. Your sole purpose is to help the\n")
	b.WriteString("user understand, prepare for, and strategise around one specific job opportunity.\n\n")

	// ── [STRICT SCOPE GUARDRAIL] ────────────────────────────────────────
	b.WriteString("[STRICT SCOPE]\n")
	b.WriteString("You ONLY answer questions directly related to:\n")
	b.WriteString("- The job description provided below\n")
	b.WriteString("- The user's resume and how it relates to this job\n")
	b.WriteString("- Application strategy, cover letters, interview preparation for THIS job\n")
	b.WriteString("- The match analysis and identified gaps for THIS job\n")
	b.WriteString("- Salary negotiation context for THIS role\n")
	b.WriteString("- Company research questions related to THIS employer\n\n")
	b.WriteString("You MUST REFUSE to answer questions unrelated to this job or the user's application\n")
	b.WriteString("for it. If asked off-topic questions, respond exactly:\n")
	b.WriteString(fmt.Sprintf("\"I'm focused on helping you with your application for %s at %s. ", title, company))
	b.WriteString("I can't help with that here, but feel free to ask anything about this role.\"\n\n")

	// ── [JOB CONTEXT BLOCK] ─────────────────────────────────────────────
	b.WriteString("[JOB CONTEXT]\n")
	fmt.Fprintf(&b, "Job Title: %s\n", title)
	fmt.Fprintf(&b, "Company: %s\n", company)
	fmt.Fprintf(&b, "Location: %s | %s\n", location, remote)
	fmt.Fprintf(&b, "Employment Type: %s\n", empType)
	fmt.Fprintf(&b, "Experience Level: %s\n", expLevel)
	fmt.Fprintf(&b, "Salary Range: %s\n\n", salary)
	b.WriteString("Job Summary:\n")
	b.WriteString(jobSummary)
	b.WriteString("\n\n")

	if len(c.Responsibilities) > 0 {
		b.WriteString("Key Responsibilities:\n")
		writeList(&b, c.Responsibilities)
		b.WriteString("\n")
	}
	if len(c.RequiredSkills) > 0 {
		fmt.Fprintf(&b, "Required Skills: %s\n", strings.Join(c.RequiredSkills, ", "))
	}
	if len(c.PreferredSkills) > 0 {
		fmt.Fprintf(&b, "Preferred Skills: %s\n", strings.Join(c.PreferredSkills, ", "))
	}
	if len(c.TechStack) > 0 {
		fmt.Fprintf(&b, "Tech Stack: %s\n", strings.Join(c.TechStack, ", "))
	}
	b.WriteString("\n")

	// ── [RESUME CONTEXT BLOCK] ──────────────────────────────────────────
	b.WriteString("[RESUME CONTEXT]\n")
	b.WriteString("The user's original resume (personal contact details have been redacted):\n")
	b.WriteString(resumeSummary)
	b.WriteString("\n\n")

	// ── [MATCH ANALYSIS BLOCK] ──────────────────────────────────────────
	b.WriteString("[MATCH ANALYSIS]\n")
	b.WriteString(scoreLine)
	b.WriteString("\n")
	if c.SkillsMatch+c.ExperienceMatch+c.EducationMatch > 0 {
		fmt.Fprintf(&b, "Skills Match: %d%%\n", c.SkillsMatch)
		fmt.Fprintf(&b, "Experience Match: %d%%\n", c.ExperienceMatch)
		fmt.Fprintf(&b, "Education Match: %d%%\n", c.EducationMatch)
	}
	b.WriteString("\n")
	b.WriteString("Tailored Resume Summary:\n")
	b.WriteString(tailored)
	b.WriteString("\n\n")

	if len(c.Gaps) > 0 {
		b.WriteString("Identified Gaps:\n")
		writeList(&b, c.Gaps)
		b.WriteString("\n")
	}

	// ── [BEHAVIOURAL RULES] ─────────────────────────────────────────────
	b.WriteString("[BEHAVIOURAL RULES]\n")
	b.WriteString("- Be honest about gaps — do not sugarcoat misalignment.\n")
	b.WriteString("- Be specific — reference actual skills, companies, and dates from the resume.\n")
	b.WriteString("- Never fabricate job requirements not present in the job description.\n")
	b.WriteString("- Never fabricate experience not present in the resume.\n")
	b.WriteString("- If asked to write a cover letter, ground it in the actual context provided.\n")
	b.WriteString("- Keep responses brief and precise, unless the user asks for more detail.\n")
	b.WriteString("- Use concise language and avoid unnecessary words.\n")
	b.WriteString("- No long explanations. Get straight to the point.\n")
	b.WriteString("- Do not use em dashes in responses.\n")
	b.WriteString("- If a question is ambiguous, ask a clarifying question before answering.\n")
	b.WriteString("- Use markdown sparingly: short lists, bold for emphasis, code only when warranted.\n")

	return b.String()
}

func fallback(s, fb string) string {
	s = strings.TrimSpace(s)
	if s == "" {
		return fb
	}
	return s
}

func writeList(b *strings.Builder, items []string) {
	for _, it := range items {
		it = strings.TrimSpace(it)
		if it == "" {
			continue
		}
		b.WriteString("- ")
		b.WriteString(it)
		b.WriteString("\n")
	}
}
