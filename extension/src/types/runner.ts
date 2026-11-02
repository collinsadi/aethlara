import type { NeedsReason, Question, ResultReport } from './api'

// ── Local settings (chrome.storage.local) ─────────────────────────────────────

export interface ExtSettings {
  /** When on, the background works the application queue on a timer. */
  autopilot: boolean
  /** How often the queue is checked, 5–60 minutes. */
  intervalMinutes: number
  /** Chrome notifications when an application needs the user. */
  notifications: boolean
}

export const DEFAULT_SETTINGS: ExtSettings = {
  autopilot: false,
  intervalMinutes: 10,
  notifications: true,
}

export const MIN_INTERVAL_MINUTES = 5
export const MAX_INTERVAL_MINUTES = 60

// ── Application flow (background ⇄ content script) ───────────────────────────

/**
 * Where an application attempt is. Persisted before every action that may
 * navigate the page, so the content script on the next document can resume.
 */
export type FlowPhase = 'opening' | 'filling' | 'submitting' | 'verifying'

export type FlowMode = 'auto' | 'manual'

/** Everything the content script needs to work one application. No tokens. */
export interface FlowJob {
  runId: string
  appId: string
  mode: FlowMode
  title: string
  company: string
  ats: string | null
  applyUrl: string
  /** Origins the flow may type personal data into. */
  allowedOrigins: string[]
  /** manual sessions never press the final submit button */
  autoSubmit: boolean
  coverLetter: string
  resumeFilename: string
  coverLetterFilename: string | null
  phase: FlowPhase
  /** 0-based index of the form step to fill next. */
  step: number
  filled: number
  submitAttempts: number
  correctivePasses: number
  hops: number
  baselineUrl: string | null
  deadline: number
}

export type FlowOutcome =
  | { status: 'submitted'; finalUrl: string; message: string; filled: number }
  | {
      status: 'needs_input'
      reason: NeedsReason
      message: string
      questions?: Question[]
      pageUrl: string
      filled: number
    }
  | { status: 'failed'; message: string; pageUrl?: string; filled: number }
  | {
      status: 'released'
      message: string
      /** Why the claim is handed back; the runner stops claiming for this tick. */
      cause: 'ai_unavailable' | 'rate_limited' | 'signed_out' | 'stopped' | 'error'
    }

export interface FlowProgressUpdate {
  label?: string
  tone?: 'info' | 'warn'
  phase?: FlowPhase
  step?: number
  filled?: number
  submitAttempts?: number
  correctivePasses?: number
  baselineUrl?: string | null
  /** The flow is about to navigate the tab to this URL (apply link / embedded form). */
  hopTo?: string
}

/** A needs_input tab the extension keeps an eye on for a manual submission. */
export interface WatchInfo {
  appId: string
  title: string
  company: string
  reason: NeedsReason
  pageUrl: string
  since: number
}

// ── Runner state (chrome.storage.session, written by the background only) ────

export interface ProgressStep {
  label: string
  state: 'active' | 'done' | 'warn' | 'error'
  at: number
}

export interface ActiveRun {
  runId: string
  appId: string
  mode: FlowMode
  title: string
  company: string
  ats: string | null
  applyUrl: string
  allowedOrigins: string[]
  tabId: number | null
  phase: FlowPhase
  step: number
  filled: number
  submitAttempts: number
  correctivePasses: number
  hops: number
  baselineUrl: string | null
  autoSubmit: boolean
  coverLetter: string
  resumePath: string
  resumeFilename: string
  coverLetterPath: string | null
  coverLetterFilename: string | null
  verificationSince: string
  startedAt: number
  deadline: number
  deadlineExtended: boolean
  steps: ProgressStep[]
  lastProgressAt: number
  helloAt: number | null
}

export interface WatchEntry extends WatchInfo {
  tabId: number
  mode: FlowMode
}

export interface RecentResult {
  appId: string
  title: string
  company: string
  status: 'submitted' | 'needs_input' | 'failed' | 'released'
  reason?: NeedsReason
  message: string
  at: number
}

export interface TickInfo {
  id: string
  trigger: 'alarm' | 'manual'
  startedAt: number
  processed: number
  seen: string[]
}

export type TickOutcome = 'empty' | 'limit' | 'error' | 'stopped' | 'disabled' | 'repeat' | 'signed_out'

export interface LastTick {
  at: number
  trigger: 'alarm' | 'manual'
  processed: number
  outcome: TickOutcome
  message?: string
}

export interface PendingReport {
  appId: string
  report: ResultReport
  attempts: number
  firstAt: number
}

export interface RunnerState {
  tick: TickInfo | null
  current: ActiveRun | null
  manual: ActiveRun[]
  watches: WatchEntry[]
  recent: RecentResult[]
  pendingReports: PendingReport[]
  lastTick: LastTick | null
}

export const EMPTY_RUNNER_STATE: RunnerState = {
  tick: null,
  current: null,
  manual: [],
  watches: [],
  recent: [],
  pendingReports: [],
  lastTick: null,
}

// ── Page classification (content script → side panel) ───────────────────────

export interface PageInfo {
  url: string
  title: string
  ats: string | null
  isJobPosting: boolean
  isApplicationForm: boolean
  fieldCount: number
  hasResumeField: boolean
  loginWall: boolean
  managed: { mode: FlowMode } | null
}

/** Serializable field returned by the legacy (saved job) scan. */
export interface LegacyScannedField {
  field_id: string
  label: string
  type: string
  placeholder: string | null
  required: boolean
  options: string[] | null
}

export interface LegacyFillSummary {
  filled: number
  skipped: number
  failed: string[]
  cancelled?: boolean
}
