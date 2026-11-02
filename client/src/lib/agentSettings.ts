/**
 * Autopilot settings: section field pickers, option lists and client-side
 * validation that mirrors the server's rules (server/internal/agent/service.go).
 */
import type {
  AgentProfile,
  ApplicationProfile,
  ApplySettings,
  SearchPrefs,
  WatchlistCompany,
} from '@/lib/agentTypes'

// ── Limits (keep in sync with sanitizeSearchPrefs / UpdateProfile) ──────────

export const LIMITS = {
  titles: { items: 10, length: 100 },
  keywords: { items: 20, length: 60 },
  excludeKeywords: { items: 30, length: 60 },
  locations: { items: 15, length: 100 },
  excludeCompanies: { items: 100, length: 100 },
  minSalary: { min: 0, max: 10_000_000 },
  maxAgeDays: { min: 0, max: 365 },
  minScore: { min: 0, max: 100 },
  dailyLimit: { min: 1, max: 100 },
  autoApprove: { min: 50, max: 100 },
  runInterval: { min: 1, max: 168 },
  yearsOfExperience: { min: 0, max: 60 },
  watchlist: 200,
  profileText: 200,
  workAuthorization: 500,
  additionalInfo: 2000,
  answerQuestion: 500,
  answer: 4000,
} as const

export const SLUG_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/
export const MAILBOX_RE = /^[a-z0-9](?:[a-z0-9._-]{0,38}[a-z0-9])?$/

function isInt(n: number) {
  return Number.isFinite(n) && Number.isInteger(n)
}

function rangeError(n: number, min: number, max: number, what: string): string | null {
  if (!isInt(n)) return `Enter a whole number for ${what}.`
  if (n < min || n > max) return `${what.charAt(0).toUpperCase() + what.slice(1)} must be between ${min} and ${max}.`
  return null
}

// ── Search ───────────────────────────────────────────────────────────────────

export type SearchDraft = Omit<SearchPrefs, 'sources' | 'watchlist'>

export function pickSearch(sp: SearchPrefs): SearchDraft {
  return {
    titles: sp.titles,
    keywords: sp.keywords,
    exclude_keywords: sp.exclude_keywords,
    locations: sp.locations,
    remote_only: sp.remote_only,
    seniority: sp.seniority,
    employment_types: sp.employment_types,
    min_salary: sp.min_salary,
    salary_currency: sp.salary_currency,
    exclude_companies: sp.exclude_companies,
    max_age_days: sp.max_age_days,
    min_score: sp.min_score,
  }
}

export function validateSearch(d: SearchDraft): Partial<Record<keyof SearchDraft, string>> {
  const errors: Partial<Record<keyof SearchDraft, string>> = {}
  if (d.min_salary !== null) {
    const e = rangeError(d.min_salary, LIMITS.minSalary.min, LIMITS.minSalary.max, 'minimum salary')
    if (e) errors.min_salary = e
  }
  if (d.salary_currency && !/^[A-Za-z]{3}$/.test(d.salary_currency)) {
    errors.salary_currency = 'Use a 3-letter currency code, like USD.'
  }
  const age = rangeError(d.max_age_days, LIMITS.maxAgeDays.min, LIMITS.maxAgeDays.max, 'posting age')
  if (age) errors.max_age_days = age
  const score = rangeError(d.min_score, LIMITS.minScore.min, LIMITS.minScore.max, 'minimum score')
  if (score) errors.min_score = score
  return errors
}

export const CURRENCIES = ['USD', 'EUR', 'GBP', 'CAD', 'AUD', 'CHF', 'SEK', 'NOK', 'DKK', 'PLN', 'INR', 'NGN', 'ZAR', 'KES', 'BRL', 'MXN', 'JPY', 'SGD', 'AED']

// ── Watchlist ────────────────────────────────────────────────────────────────

export function watchlistKey(c: WatchlistCompany) {
  return `${c.ats}:${c.slug.trim().toLowerCase()}`
}

export function validateWatchlistRow(c: WatchlistCompany): string | null {
  if (!c.slug.trim()) return 'Add the board slug.'
  if (!SLUG_RE.test(c.slug.trim())) return 'Slugs use letters, numbers, dots, dashes and underscores.'
  if ((c.name ?? '').length > 100) return 'Keep the name under 100 characters.'
  return null
}

// ── Application profile ──────────────────────────────────────────────────────

export function validateApplicationProfile(p: ApplicationProfile): Partial<Record<keyof ApplicationProfile, string>> {
  const errors: Partial<Record<keyof ApplicationProfile, string>> = {}
  const short: (keyof ApplicationProfile)[] = [
    'full_name', 'phone', 'location', 'country', 'linkedin', 'github', 'portfolio', 'website',
    'notice_period', 'earliest_start_date', 'salary_expectation', 'pronouns', 'how_did_you_hear',
  ]
  for (const key of short) {
    const v = p[key]
    if (typeof v === 'string' && v.length > LIMITS.profileText) errors[key] = `Keep this under ${LIMITS.profileText} characters.`
  }
  if (p.work_authorization.length > LIMITS.workAuthorization) {
    errors.work_authorization = `Keep this under ${LIMITS.workAuthorization} characters.`
  }
  if (p.additional_info.length > LIMITS.additionalInfo) {
    errors.additional_info = `Keep this under ${LIMITS.additionalInfo} characters.`
  }
  if (p.years_of_experience !== null) {
    const e = rangeError(p.years_of_experience, LIMITS.yearsOfExperience.min, LIMITS.yearsOfExperience.max, 'years of experience')
    if (e) errors.years_of_experience = e
  }
  for (const [label, url] of [['linkedin', p.linkedin], ['github', p.github], ['portfolio', p.portfolio], ['website', p.website]] as const) {
    if (url && !/^https?:\/\/\S+\.\S+/i.test(url)) errors[label] = 'Use a full link starting with https://'
  }
  return errors
}

/** Common self-identification answers; '' means "Decline to self-identify". */
export const EEO_OPTIONS: Record<keyof ApplicationProfile['eeo'], { label: string; options: string[] }> = {
  gender: { label: 'Gender', options: ['Male', 'Female', 'Non-binary'] },
  race: {
    label: 'Race / ethnicity',
    options: [
      'American Indian or Alaska Native',
      'Asian',
      'Black or African American',
      'Hispanic or Latino',
      'Native Hawaiian or Other Pacific Islander',
      'White',
      'Two or more races',
    ],
  },
  veteran: {
    label: 'Veteran status',
    options: ['I am not a protected veteran', 'I identify as one or more of the classifications of protected veteran'],
  },
  disability: {
    label: 'Disability',
    options: [
      'Yes, I have a disability (or previously had a disability)',
      'No, I do not have a disability and have not had one in the past',
    ],
  },
  sexual_orientation: {
    label: 'Sexual orientation',
    options: ['Heterosexual', 'Gay or lesbian', 'Bisexual', 'Queer'],
  },
}

// ── Apply rules ──────────────────────────────────────────────────────────────

export interface RulesDraft extends ApplySettings {
  run_interval_hours: number
}

export function pickRules(p: AgentProfile): RulesDraft {
  return { ...p.apply_settings, run_interval_hours: p.run_interval_hours }
}

export function validateRules(d: RulesDraft): Partial<Record<keyof RulesDraft, string>> {
  const errors: Partial<Record<keyof RulesDraft, string>> = {}
  const daily = rangeError(d.daily_limit, LIMITS.dailyLimit.min, LIMITS.dailyLimit.max, 'daily limit')
  if (daily) errors.daily_limit = daily
  if (d.auto_approve_score !== null) {
    const e = rangeError(d.auto_approve_score, LIMITS.autoApprove.min, LIMITS.autoApprove.max, 'auto-approve score')
    if (e) errors.auto_approve_score = e
  }
  const interval = rangeError(d.run_interval_hours, LIMITS.runInterval.min, LIMITS.runInterval.max, 'run interval')
  if (interval) errors.run_interval_hours = interval
  return errors
}

export const RUN_INTERVALS = [
  { hours: 6, label: 'Every 6 hours' },
  { hours: 12, label: 'Every 12 hours' },
  { hours: 24, label: 'Once a day' },
  { hours: 48, label: 'Every 2 days' },
  { hours: 72, label: 'Every 3 days' },
  { hours: 168, label: 'Once a week' },
]

// ── Mailbox ──────────────────────────────────────────────────────────────────

export function mailboxLocalPart(address: string | null): string {
  return address ? address.split('@')[0] ?? '' : ''
}

export function validateMailbox(local: string): string | null {
  const v = local.trim().toLowerCase()
  if (!v) return 'Choose a name for your agent address.'
  if (v.length > 40) return 'Use 40 characters or fewer.'
  if (!MAILBOX_RE.test(v)) return 'Use a–z, 0–9, dots, dashes or underscores, starting and ending with a letter or number.'
  return null
}
