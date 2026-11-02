/**
 * Autopilot (agent) API shapes.
 *
 * Mirrors server/internal/agent/dto.go and server/docs.md "Autopilot (Agent)".
 * Field names are part of the public contract — do not rename.
 */
import type { Pagination } from '@/lib/types'

// ── Enumerations ─────────────────────────────────────────────────────────────

export type LeadStatus =
  | 'new'
  | 'approved'
  | 'applying'
  | 'applied'
  | 'failed'
  | 'dismissed'
  | 'expired'

export type DismissReason = 'user' | 'low_score' | 'dealbreaker' | 'cancelled'

export type ApplyChannel = 'browser' | 'email'

/** Fit labels produced by the lead-scoring prompt. */
export type MatchFit = 'strong' | 'good' | 'stretch' | 'poor'

export type AgentApplicationStatus =
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

export type RunStatus = 'running' | 'completed' | 'failed'
export type RunTrigger = 'manual' | 'schedule'

export type EventLevel = 'info' | 'success' | 'warning' | 'error'

export type EventKind =
  | 'run_started'
  | 'run_finished'
  | 'run_failed'
  | 'leads_found'
  | 'source_error'
  | 'lead_approved'
  | 'application_prepared'
  | 'application_emailed'
  | 'application_submitted'
  | 'application_needs_input'
  | 'application_failed'
  | 'mail_received'
  | 'status_changed'
  | 'digest_sent'

export type MessageCategory =
  | 'confirmation'
  | 'rejection'
  | 'interview'
  | 'assessment'
  | 'offer'
  | 'verification'
  | 'recruiter'
  | 'other'
  | 'application'

/** Values accepted by `GET /agent/inbox?category=` (categories + two views). */
export type InboxCategoryFilter = MessageCategory | 'important' | 'outbound'

export type MessageDirection = 'inbound' | 'outbound'

/** SPF/DKIM/DMARC result for inbound mail. */
export type SenderAuth = 'pass' | 'fail' | 'unknown'

export type WatchlistAts = 'greenhouse' | 'lever' | 'ashby'

export type SourceKind = 'ats' | 'board' | 'ai'

export type Seniority = 'entry' | 'mid' | 'senior' | 'lead' | 'executive'

export type EmploymentType =
  | 'full_time'
  | 'part_time'
  | 'contract'
  | 'freelance'
  | 'internship'
  | 'temporary'

// ── Profile ──────────────────────────────────────────────────────────────────

export interface WatchlistCompany {
  ats: WatchlistAts
  slug: string
  name?: string
}

export interface SearchPrefs {
  titles: string[]
  keywords: string[]
  exclude_keywords: string[]
  locations: string[]
  remote_only: boolean
  seniority: string[]
  employment_types: string[]
  min_salary: number | null
  salary_currency: string
  exclude_companies: string[]
  max_age_days: number
  min_score: number
  sources: Record<string, boolean>
  watchlist: WatchlistCompany[]
}

/** Voluntary self-identification answers. Empty string = decline to self-identify. */
export interface EeoAnswers {
  gender: string
  race: string
  veteran: string
  disability: string
  sexual_orientation: string
}

export interface ApplicationProfile {
  full_name: string
  phone: string
  location: string
  country: string
  linkedin: string
  github: string
  portfolio: string
  website: string
  work_authorization: string
  requires_sponsorship: boolean | null
  willing_to_relocate: boolean | null
  notice_period: string
  earliest_start_date: string
  salary_expectation: string
  years_of_experience: number | null
  pronouns: string
  how_did_you_hear: string
  additional_info: string
  eeo: EeoAnswers
}

export interface ApplySettings {
  auto_submit: boolean
  daily_limit: number
  /** Leads at or above this score are approved without review. null = always ask. */
  auto_approve_score: number | null
  cover_letters: boolean
  digest_emails: boolean
  important_alerts: boolean
}

export interface AgentProfile {
  enabled: boolean
  resume_id: string | null
  mailbox_address: string | null
  /** null when the server has no AGENT_MAIL_DOMAIN configured. */
  mailbox_domain: string | null
  search_prefs: SearchPrefs
  application_profile: ApplicationProfile
  apply_settings: ApplySettings
  run_interval_hours: number
  next_run_at: string | null
  last_run_at: string | null
  updated_at: string
}

/** `PUT /agent/profile` accepts any subset; objects are replaced whole. */
export interface AgentProfileUpdate {
  enabled?: boolean
  resume_id?: string
  mailbox_local_part?: string
  search_prefs?: SearchPrefs
  application_profile?: ApplicationProfile
  apply_settings?: ApplySettings
  run_interval_hours?: number
}

// ── Overview ─────────────────────────────────────────────────────────────────

export interface AgentSetup {
  ai_provider: 'anthropic' | 'openrouter' | null
  has_ai_key: boolean
  web_search_available: boolean
  has_resume: boolean
  has_preferences: boolean
  mailbox_enabled: boolean
  inbound_enabled: boolean
  extension_connected: boolean
}

export interface AgentCounts {
  leads: Partial<Record<LeadStatus, number>>
  applications: Partial<Record<AgentApplicationStatus, number>>
  unread_important: number
  submitted_today: number
}

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
  trigger: RunTrigger
  status: RunStatus
  stats: RunStats
  error: string | null
  started_at: string
  finished_at: string | null
}

export interface AgentEvent {
  id: number
  kind: EventKind
  level: EventLevel
  message: string
  run_id: string | null
  lead_id: string | null
  application_id: string | null
  data: unknown
  created_at: string
}

export interface AgentOverview {
  profile: AgentProfile
  setup: AgentSetup
  counts: AgentCounts
  running_run: AgentRun | null
  last_run: AgentRun | null
  recent_events: AgentEvent[]
}

// ── Sources ──────────────────────────────────────────────────────────────────

export interface AgentSource {
  id: string
  label: string
  kind: SourceKind
  description: string
  /** Listings from this source must credit it and link to the posting. */
  attribution: boolean
}

export interface AgentSourcesCatalog {
  sources: AgentSource[]
  starter_watchlist: WatchlistCompany[]
}

// ── Leads ────────────────────────────────────────────────────────────────────

export interface LeadMatch {
  score: number | null
  fit: MatchFit | null
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
  /** The source's own posting page (attribution link). */
  url: string
  apply_url: string | null
  /** Where the resume is emailed when `apply_channel` is "email". */
  apply_email: string | null
  apply_channel: ApplyChannel
  ats: string | null
  auto_apply_supported: boolean
  posted_at: string | null
  /** null until the lead has been scored. */
  match: LeadMatch | null
  status: LeadStatus
  dismiss_reason: DismissReason | null
  decided_at: string | null
  job_id: string | null
  created_at: string
  /** Only present on `GET /agent/leads/:id`. Plain text. */
  description?: string
}

export type LeadDecision = 'approve' | 'dismiss' | 'reset'

export interface LeadDecisionResult {
  lead: Lead
  application: AgentApplication | null
}

export interface LeadDetailResponse {
  lead: Lead
  application: AgentApplication | null
}

export interface BulkDecisionResult {
  results: { id: string; ok: boolean; error?: string }[]
}

// ── Applications ─────────────────────────────────────────────────────────────

export interface NeedsQuestion {
  field_id: string
  label: string
  type?: string
  options?: string[]
}

export interface ApplicationNeeds {
  reason: NeedsReason | string
  message: string
  questions?: NeedsQuestion[]
  page_url?: string
}

export interface ApplicationResult {
  filled?: number
  final_url?: string
  message?: string
}

export interface AgentApplication {
  id: string
  lead_id: string
  job_id: string | null
  channel: ApplyChannel
  status: AgentApplicationStatus
  apply_url: string | null
  apply_email: string | null
  ats: string | null
  has_cover_letter: boolean
  /** Only present on `GET /agent/applications/:id` and lead detail. */
  cover_letter?: string | null
  use_original_resume: boolean
  attempts: number
  last_error: string | null
  needs: ApplicationNeeds | null
  result: ApplicationResult | null
  claim_expires_at: string | null
  submitted_at: string | null
  created_at: string
  updated_at: string
  lead: { title: string; company: string; score: number | null; url: string }
}

export interface QuestionAnswer {
  question: string
  answer: string
}

// ── Inbox ────────────────────────────────────────────────────────────────────

export interface TriageResult {
  category: MessageCategory
  company: string | null
  job_title: string | null
  summary: string
  action_required: boolean
  action: string | null
  deadline: string | null
  verification_code: string | null
  verification_link: string | null
  matched_application: string | null
}

export interface MessageAttachment {
  filename: string
  content_type: string
  size: number
}

export interface InboxMessage {
  id: string
  direction: MessageDirection
  from_address: string
  from_name: string | null
  to: string[]
  subject: string
  snippet: string
  category: MessageCategory | null
  summary: string | null
  important: boolean
  application_id: string | null
  job_id: string | null
  triage_status: string
  sender_auth?: SenderAuth
  read_at: string | null
  received_at: string
}

export interface InboxMessageDetail extends InboxMessage {
  /** Plain text only — HTML is never stored or rendered. */
  text_body?: string
  links?: string[]
  attachments?: MessageAttachment[] | null
  extracted?: TriageResult | null
}

// ── Saved answers ────────────────────────────────────────────────────────────

export interface SavedAnswer {
  id: string
  question: string
  answer: string
  source: string
  updated_at: string
}

// ── Lists ────────────────────────────────────────────────────────────────────

export interface Paginated<T> {
  items: T[]
  pagination: Pagination
}
