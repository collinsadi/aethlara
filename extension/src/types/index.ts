// ── Mismatch ──────────────────────────────────────────────────────────────────

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

// ── Auth ──────────────────────────────────────────────────────────────────────

export interface ExtUser {
  id: string
  full_name: string
  email: string
}

export interface Session {
  token: string
  expiresAt: string
  user: ExtUser
}

// ── Jobs ──────────────────────────────────────────────────────────────────────

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

// ── Autofill ──────────────────────────────────────────────────────────────────

export interface ScannedField {
  field_id: string
  label: string
  type: string
  name: string | null
  placeholder: string | null
  required: boolean
  options: string[] | null
  selector: string
  value: string
  visible: boolean
}

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

// ── Extension Extraction ──────────────────────────────────────────────────────

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

// ── Message Passing ───────────────────────────────────────────────────────────

export enum MessageType {
  SCAN_FIELDS    = 'SCAN_FIELDS',
  FIELDS_RESULT  = 'FIELDS_RESULT',
  FILL_FIELDS    = 'FILL_FIELDS',
  FILL_RESULT    = 'FILL_RESULT',
  EXTRACT_TEXT   = 'EXTRACT_TEXT',
  TEXT_RESULT    = 'TEXT_RESULT',
  SHOW_OVERLAY   = 'SHOW_OVERLAY',
  HIDE_OVERLAY   = 'HIDE_OVERLAY',
  AUTH_HANDSHAKE = 'AUTH_HANDSHAKE',
  AUTH_SUCCESS   = 'AUTH_SUCCESS',
}

export interface ExtMessage {
  type: MessageType
  payload?: unknown
}
