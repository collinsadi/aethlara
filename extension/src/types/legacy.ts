/**
 * Types for the job-based flows that predate the autopilot (saved-job
 * autofill and job extraction). They talk to /jobs and /resumes.
 */

export interface ExtMismatchData {
  job_title: string
  company: string
  match_score: number
  match_breakdown: {
    skills_match: number
    experience_match: number
    education_match: number
  } | null
  reason: string
  gaps: string[]
  suggestion: string
  learn_more_url: string
}

export type JobStatus = 'not_applied' | 'applied' | 'interview' | 'offer' | 'rejected' | 'withdrawn'
export type AlignmentStatus = 'pending' | 'processing' | 'completed' | 'failed' | 'misaligned'
export type ExtractionStatus = 'pending' | 'processing' | 'completed' | 'failed'

export interface ExtJob {
  id: string
  job_title: string
  company: string
  location: string | null
  is_remote: boolean
  employment_type: string | null
  match_score: number | null
  status: JobStatus
  alignment_status: AlignmentStatus
  extraction_status: ExtractionStatus
  pdf_generated_at: string | null
  resume_id: string
  created_at: string
  applied_at: string | null
}

export interface MatchBreakdown {
  skills_match: number
  experience_match: number
  education_match: number
  overall_notes: string
}

/** One field sent to POST /jobs/:id/autofill (max 100 per call). */
export interface AutofillField {
  field_id: string
  label: string
  type: string
  placeholder: string | null
  required: boolean
  options: string[] | null
}

export interface AutofillResult {
  fills: Record<string, string | null>
  confidence: 'high' | 'medium' | 'low'
  unfilled_count: number
  model_used: string
}

export interface ExtractedJobPreview {
  title: string
  company: string
  location: string
  employment_type: string
  required_skills: string[]
}

export interface ExtractionResult {
  job: ExtractedJobPreview
  match_score: number
  match_breakdown: MatchBreakdown | null
  gaps: string[]
  preview_token: string
  preview_expires_at: string
}

export interface ExtResume {
  id: string
  name: string
  file_format: string
  file_size_bytes: number
  extraction_status: 'pending' | 'processing' | 'completed' | 'failed'
  uploaded_at: string
}
