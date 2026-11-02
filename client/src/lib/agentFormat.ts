/**
 * Labels, tones and formatting helpers for autopilot data. Pure functions
 * only — anything time-relative takes `now` as an argument (see useNow).
 */
import type {
  AgentApplicationStatus,
  DismissReason,
  EmploymentType,
  EventLevel,
  LeadSalary,
  LeadStatus,
  MatchFit,
  MessageCategory,
  NeedsReason,
  Seniority,
  WatchlistAts,
} from '@/lib/agentTypes'
import type { Tone } from '@/lib/tones'

// ── Leads ────────────────────────────────────────────────────────────────────

export const LEAD_STATUS_META: Record<LeadStatus, { label: string; tone: Tone }> = {
  new: { label: 'To review', tone: 'brand' },
  approved: { label: 'Approved · queued', tone: 'neutral' },
  applying: { label: 'Applying', tone: 'warning' },
  applied: { label: 'Applied', tone: 'success' },
  failed: { label: 'Failed', tone: 'danger' },
  dismissed: { label: 'Dismissed', tone: 'muted' },
  expired: { label: 'Expired', tone: 'muted' },
}

export const DISMISS_REASON_META: Record<DismissReason | 'expired', { label: string; help: string }> = {
  user: { label: 'Dismissed by you', help: 'You passed on this job.' },
  low_score: {
    label: 'Below your minimum score',
    help: 'Scored under the minimum match score in your search settings.',
  },
  dealbreaker: {
    label: 'Deal-breaker',
    help: 'The agent found something you said you would not accept.',
  },
  cancelled: { label: 'Application cancelled', help: 'You cancelled the application.' },
  expired: { label: 'Not reviewed in 21 days', help: 'Left unreviewed for 21 days.' },
}

export const FIT_META: Record<MatchFit, { label: string; tone: Tone }> = {
  strong: { label: 'Strong fit', tone: 'success' },
  good: { label: 'Good fit', tone: 'success' },
  stretch: { label: 'Stretch', tone: 'warning' },
  poor: { label: 'Poor fit', tone: 'danger' },
}

// ── Applications ─────────────────────────────────────────────────────────────

export const APPLICATION_STATUS_META: Record<
  AgentApplicationStatus,
  { label: string; tone: Tone; help: string }
> = {
  queued: { label: 'Queued', tone: 'neutral', help: 'Will be prepared on the next run.' },
  preparing: { label: 'Preparing', tone: 'warning', help: 'Tailoring your resume and cover letter.' },
  ready: { label: 'Ready for extension', tone: 'brand', help: 'Waiting for the Chrome extension to pick it up.' },
  in_progress: { label: 'Extension applying', tone: 'warning', help: 'The extension is filling the form now.' },
  needs_input: { label: 'Needs you', tone: 'warning', help: 'The agent is waiting on you.' },
  submitted: { label: 'Submitted', tone: 'success', help: 'Application sent.' },
  failed: { label: 'Failed', tone: 'danger', help: 'Something went wrong. You can retry.' },
  cancelled: { label: 'Cancelled', tone: 'muted', help: 'You cancelled this application.' },
}

export const NEEDS_REASON_META: Record<NeedsReason, { label: string; help: string }> = {
  missing_answers: {
    label: 'Questions only you can answer',
    help: 'Answer once — the agent saves your answers and reuses them on every future form.',
  },
  captcha: {
    label: 'CAPTCHA on the form',
    help: 'Open the form, solve the CAPTCHA and submit it yourself, or click Retry to hand it back to the extension.',
  },
  login_required: {
    label: 'Sign-in required',
    help: 'The site wants you to sign in. Open it, sign in, then click Retry.',
  },
  verification: {
    label: 'Email verification',
    help: 'The form asked for a verification code. Check the Inbox for it, then click Retry.',
  },
  unsupported_form: {
    label: "A form the extension can't fill",
    help: 'Open the posting and apply yourself — or cancel this application.',
  },
  review: {
    label: 'Filled and waiting for your review',
    help: 'Auto-submit is off, so the extension filled the form and stopped. Open it, check it and submit.',
  },
}

export function needsReasonMeta(reason: string): { label: string; help: string } {
  return (
    NEEDS_REASON_META[reason as NeedsReason] ?? {
      label: 'Waiting on you',
      help: 'Open the application to see what is needed.',
    }
  )
}

// ── Sources / ATS ────────────────────────────────────────────────────────────

export const ATS_LABELS: Record<string, string> = {
  greenhouse: 'Greenhouse',
  lever: 'Lever',
  ashby: 'Ashby',
  workable: 'Workable',
  smartrecruiters: 'SmartRecruiters',
  workday: 'Workday',
  bamboohr: 'BambooHR',
  recruitee: 'Recruitee',
  breezy: 'Breezy HR',
  jazzhr: 'JazzHR',
  teamtailor: 'Teamtailor',
  personio: 'Personio',
  icims: 'iCIMS',
  taleo: 'Taleo',
}

export function atsLabel(ats: string | null | undefined): string | null {
  if (!ats) return null
  return ATS_LABELS[ats] ?? ats.charAt(0).toUpperCase() + ats.slice(1)
}

export const WATCHLIST_ATS: { id: WatchlistAts; label: string; boardUrl: string }[] = [
  { id: 'greenhouse', label: 'Greenhouse', boardUrl: 'boards.greenhouse.io/' },
  { id: 'lever', label: 'Lever', boardUrl: 'jobs.lever.co/' },
  { id: 'ashby', label: 'Ashby', boardUrl: 'jobs.ashbyhq.com/' },
]

/** Source ids that are not discovery sources (no catalogue entry). */
export const EXTRA_SOURCE_LABELS: Record<string, string> = {
  manual: 'Added by you',
  extension: 'Saved from browser',
}

// ── Search preference options (server-validated values) ──────────────────────

export const SENIORITY_OPTIONS: { value: Seniority; label: string }[] = [
  { value: 'entry', label: 'Entry' },
  { value: 'mid', label: 'Mid' },
  { value: 'senior', label: 'Senior' },
  { value: 'lead', label: 'Lead / Staff' },
  { value: 'executive', label: 'Executive' },
]

export const EMPLOYMENT_TYPE_OPTIONS: { value: EmploymentType; label: string }[] = [
  { value: 'full_time', label: 'Full-time' },
  { value: 'part_time', label: 'Part-time' },
  { value: 'contract', label: 'Contract' },
  { value: 'freelance', label: 'Freelance' },
  { value: 'internship', label: 'Internship' },
  { value: 'temporary', label: 'Temporary' },
]

export function employmentTypeLabel(type: string | null | undefined): string | null {
  if (!type) return null
  return EMPLOYMENT_TYPE_OPTIONS.find((o) => o.value === type)?.label ?? type.replace(/_/g, ' ')
}

// ── Inbox ────────────────────────────────────────────────────────────────────

export const CATEGORY_META: Record<MessageCategory, { label: string; tone: Tone }> = {
  interview: { label: 'Interview', tone: 'success' },
  assessment: { label: 'Assessment', tone: 'brand' },
  offer: { label: 'Offer', tone: 'success' },
  rejection: { label: 'Rejection', tone: 'danger' },
  confirmation: { label: 'Confirmation', tone: 'neutral' },
  verification: { label: 'Verification', tone: 'warning' },
  recruiter: { label: 'Recruiter', tone: 'neutral' },
  other: { label: 'Other', tone: 'muted' },
  application: { label: 'Sent application', tone: 'muted' },
}

export const EVENT_LEVEL_TONE: Record<EventLevel, Tone> = {
  info: 'muted',
  success: 'success',
  warning: 'warning',
  error: 'danger',
}

// ── Formatting ───────────────────────────────────────────────────────────────

function compactMoney(n: number, currency: string | null): string {
  if (currency && /^[A-Z]{3}$/.test(currency)) {
    try {
      return new Intl.NumberFormat(undefined, {
        style: 'currency',
        currency,
        notation: 'compact',
        maximumFractionDigits: 1,
      }).format(n)
    } catch {
      // fall through to the plain format
    }
  }
  const compact = new Intl.NumberFormat(undefined, { notation: 'compact', maximumFractionDigits: 1 }).format(n)
  return currency ? `${currency} ${compact}` : compact
}

/** "$175K–$220K", "$90K+", or the posting's own salary text. */
export function formatSalary(salary: LeadSalary | null | undefined): string | null {
  if (!salary) return null
  const { min, max, currency, text } = salary
  if (min && max && min !== max) return `${compactMoney(min, currency)}–${compactMoney(max, currency)}`
  if (min && max) return compactMoney(min, currency)
  if (min) return `${compactMoney(min, currency)}+`
  if (max) return `Up to ${compactMoney(max, currency)}`
  return text?.trim() || null
}

const MINUTE = 60_000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

/** "just now", "5m ago", "3h ago", "yesterday", "4d ago", or a date. Future: "in 3h". */
export function formatRelative(iso: string | null | undefined, now: number): string {
  if (!iso) return ''
  const t = new Date(iso).getTime()
  if (Number.isNaN(t)) return ''
  const diff = now - t
  if (diff < 0) {
    const ahead = -diff
    if (ahead < MINUTE) return 'in a moment'
    if (ahead < HOUR) return `in ${Math.round(ahead / MINUTE)}m`
    if (ahead < DAY) return `in ${Math.round(ahead / HOUR)}h`
    const days = Math.round(ahead / DAY)
    return days === 1 ? 'tomorrow' : `in ${days}d`
  }
  if (diff < 45_000) return 'just now'
  if (diff < HOUR) return `${Math.max(1, Math.round(diff / MINUTE))}m ago`
  if (diff < DAY) return `${Math.round(diff / HOUR)}h ago`
  const days = Math.floor(diff / DAY)
  if (days === 1) return 'yesterday'
  if (days < 7) return `${days}d ago`
  return formatDate(iso)
}

export function formatDate(iso: string | null | undefined): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
}

export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
}

/** "2m 14s" style elapsed duration. */
export function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return ''
  const s = Math.round(ms / 1000)
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m ${s % 60}s`
  return `${Math.floor(m / 60)}h ${m % 60}m`
}

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return ''
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

export function pluralize(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`
}

/** Host name for display ("jobs.ashbyhq.com"), or the raw value if unparsable. */
export function hostOf(url: string | null | undefined): string {
  if (!url) return ''
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return url
  }
}

/** Only http(s) URLs are ever rendered as links. */
export function safeHref(url: string | null | undefined): string | undefined {
  if (!url) return undefined
  try {
    const u = new URL(url)
    return u.protocol === 'https:' || u.protocol === 'http:' ? u.toString() : undefined
  } catch {
    return undefined
  }
}

/** One-line run summary: "12 new jobs to review · 2 ready for the extension". */
export function summarizeRunStats(stats: {
  new_leads: number
  emails_sent: number
  ready_for_browser: number
  failed: number
  auto_approved: number
}): string {
  const parts: string[] = []
  if (stats.new_leads > 0) parts.push(`${pluralize(stats.new_leads, 'new job')} to review`)
  if (stats.auto_approved > 0) parts.push(`${stats.auto_approved} auto-approved`)
  if (stats.emails_sent > 0) parts.push(`${pluralize(stats.emails_sent, 'application')} emailed`)
  if (stats.ready_for_browser > 0) parts.push(`${stats.ready_for_browser} ready for the extension`)
  if (stats.failed > 0) parts.push(`${stats.failed} failed`)
  return parts.length ? parts.join(' · ') : 'Nothing new this time'
}
