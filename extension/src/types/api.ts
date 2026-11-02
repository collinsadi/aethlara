/**
 * JSON shapes of the Aethlara API used by the extension.
 * Source of truth: server/docs.md and server/internal/agent/dto.go.
 */

export interface ApiUser {
  id: string
  full_name: string
  email: string
}

/** POST /auth/extension-token/exchange and POST /auth/extension/refresh */
export interface ExtensionAuthResponse {
  access_token: string
  expires_at: string
  device_id: string
  device_token: string
  user: ApiUser
}

export interface Pagination {
  page: number
  page_size: number
  total_items: number
  total_pages: number
  has_next: boolean
  has_prev: boolean
}

export interface Paginated<T> {
  items: T[]
  pagination: Pagination
}

// ── Agent: leads ──────────────────────────────────────────────────────────────

export type LeadStatus = 'new' | 'approved' | 'applying' | 'applied' | 'failed' | 'dismissed' | 'expired'

export interface LeadMatch {
  score: number | null
  fit: string | null
  summary: string | null
  pros: string[]
  gaps: string[]
  dealbreaker: string | null
}

export interface LeadSalary {
  min: number | null
  max: number | null
  currency: string | null
  text: string | null
}

export interface Lead {
  id: string
  source: string
  source_label: string
  title: string
  company: string
  location: string | null
  is_remote: boolean
  employment_type: string | null
  salary: LeadSalary
  url: string
  apply_url: string | null
  apply_channel: 'browser' | 'email'
  ats: string | null
  auto_apply_supported: boolean
  posted_at: string | null
  match: LeadMatch | null
  status: LeadStatus
  dismiss_reason: string | null
  decided_at: string | null
  job_id: string | null
  created_at: string
  description?: string
}

export type LeadDecision = 'approve' | 'dismiss' | 'reset'

// ── Agent: applications ───────────────────────────────────────────────────────

export type ApplicationStatus =
  | 'queued'
  | 'preparing'
  | 'ready'
  | 'in_progress'
  | 'needs_input'
  | 'submitted'
  | 'failed'
  | 'cancelled'

export type NeedsReason =
  | 'missing_answers'
  | 'captcha'
  | 'login_required'
  | 'verification'
  | 'unsupported_form'
  | 'review'

export interface Question {
  field_id: string
  label: string
  type?: string
  options?: string[]
}

export interface Needs {
  reason: NeedsReason
  message: string
  questions?: Question[]
  page_url?: string
}

export interface ApplicationResult {
  filled?: number
  final_url?: string
  message?: string
}

export interface Application {
  id: string
  lead_id: string
  job_id: string | null
  channel: 'browser' | 'email'
  status: ApplicationStatus
  apply_url: string | null
  apply_email: string | null
  ats: string | null
  has_cover_letter: boolean
  cover_letter?: string | null
  use_original_resume: boolean
  attempts: number
  last_error: string | null
  needs: Needs | null
  result: ApplicationResult | null
  claim_expires_at: string | null
  submitted_at: string | null
  created_at: string
  updated_at: string
  lead: { title: string; company: string; score: number | null; url: string }
}

export interface LeadWithApplication {
  lead: Lead
  application: Application | null
}

// ── Agent: extension protocol ─────────────────────────────────────────────────

export interface Identity {
  full_name: string
  first_name: string
  last_name: string
  email: string
  phone: string
  location: string
  linkedin: string
  github: string
  portfolio: string
  website: string
}

export interface SavedAnswer {
  id: string
  question: string
  answer: string
  source: string
  updated_at: string
}

export interface FileRef {
  filename: string
  /** Relative to the API base URL, e.g. /agent/applications/<id>/resume */
  path: string
}

export interface Packet {
  application: Application
  lead: Lead
  identity: Identity
  profile: Record<string, unknown>
  answers: SavedAnswer[]
  cover_letter: string
  resume: FileRef
  cover_letter_file: FileRef | null
  auto_submit: boolean
  verification_since: string
}

/** One field sent to POST /agent/applications/:id/fill (max 150 per call). */
export interface FormField {
  field_id: string
  label: string
  type: string
  name?: string
  placeholder?: string
  required: boolean
  options?: string[]
  section?: string
  help?: string
}

export interface FieldFill {
  field_id: string
  value: string | null
  confidence: string
}

export interface FillResponse {
  fills: FieldFill[]
  missing: Question[]
}

export const RESUME_TOKEN = '__RESUME__'
export const COVER_LETTER_TOKEN = '__COVER_LETTER__'

/** POST /agent/applications/:id/result */
export type ResultReport =
  | { status: 'submitted'; filled?: number; final_url?: string; message?: string }
  | {
      status: 'needs_input'
      reason: NeedsReason
      message: string
      questions?: Question[]
      page_url?: string
      filled?: number
    }
  | { status: 'failed'; message: string; filled?: number; page_url?: string }
  | { status: 'released' }

export interface Verification {
  message_id: string
  from: string
  subject: string
  code: string | null
  link: string | null
  received_at: string
}

// ── Agent: overview / runs ────────────────────────────────────────────────────

export interface RunStats {
  sources_queried: number
  source_errors?: Record<string, string>
  postings_fetched: number
  new_leads: number
  scored: number
  strong_matches: number
  auto_approved: number
  prepared: number
  emails_sent: number
  ready_for_browser: number
  failed: number
  messages_triaged: number
}

export interface AgentRun {
  id: string
  trigger: string
  status: string
  stats: RunStats
  error: string | null
  started_at: string
  finished_at: string | null
}

export interface AgentEvent {
  id: number
  kind: string
  level: string
  message: string
  run_id: string | null
  lead_id: string | null
  application_id: string | null
  data: unknown
  created_at: string
}

export interface ApplySettings {
  auto_submit: boolean
  daily_limit: number
  auto_approve_score: number | null
  cover_letters: boolean
  digest_emails: boolean
  important_alerts: boolean
}

export interface AgentProfile {
  enabled: boolean
  resume_id: string | null
  mailbox_address: string | null
  mailbox_domain: string | null
  apply_settings: ApplySettings
  run_interval_hours: number
  next_run_at: string | null
  last_run_at: string | null
  updated_at: string
}

export interface AgentSetup {
  ai_provider: string | null
  has_ai_key: boolean
  web_search_available: boolean
  has_resume: boolean
  has_preferences: boolean
  mailbox_enabled: boolean
  inbound_enabled: boolean
  extension_connected: boolean
}

export interface AgentOverview {
  profile: AgentProfile
  setup: AgentSetup
  counts: {
    leads: Record<string, number>
    applications: Record<string, number>
    unread_important: number
    submitted_today: number
  }
  running_run: AgentRun | null
  last_run: AgentRun | null
  recent_events: AgentEvent[]
}
