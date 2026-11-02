import { isOwnUi, isVisible, rawText } from './dom'
import { clip } from '@/lib/util'
import { collapse, norm } from './text'

/** Detection helpers: which ATS, what kind of page, and what happened after submit. */

export type AtsId = 'greenhouse' | 'lever' | 'ashby'

export function detectAts(url: string): AtsId | null {
  let host = ''
  try {
    host = new URL(url).hostname.toLowerCase()
  } catch {
    return null
  }
  if (/(^|\.)greenhouse\.io$/.test(host)) return 'greenhouse'
  if (/(^|\.)lever\.co$/.test(host)) return 'lever'
  if (/(^|\.)ashbyhq\.com$/.test(host)) return 'ashby'
  return null
}

/** ATS pages that are application forms in their own right (for embedded iframes / links). */
export const KNOWN_FORM_URL =
  /^https:\/\/((boards|job-boards)\.greenhouse\.io\/embed\/job_app|jobs\.lever\.co\/[^/]+\/[^/]+\/apply|jobs\.ashbyhq\.com\/[^/]+\/[^/]+\/application|apply\.workable\.com\/|jobs\.smartrecruiters\.com\/|[a-z0-9-]+\.recruitee\.com\/o\/)/i

export function pageText(max = 20_000): string {
  const body = document.body
  if (!body) return ''
  const text = rawText(body)
  return text.length > max ? text.slice(0, max) : text
}

// ── Forms ─────────────────────────────────────────────────────────────────────

const QUICK_FIELDS =
  'input:not([type="hidden"]):not([type="submit"]):not([type="button"]):not([type="search"]):not([type="password"]), select, textarea, [role="combobox"]'

export function quickFieldCount(root: Element): number {
  let n = 0
  for (const el of Array.from(root.querySelectorAll<HTMLElement>(QUICK_FIELDS))) {
    if (isOwnUi(el) || el.closest('header, nav, footer, [role="search"]')) continue
    if (el instanceof HTMLInputElement && el.type === 'file') {
      n++
      continue
    }
    if (isVisible(el)) n++
  }
  return n
}

/** The <form> with the most visible fields, or the body when the page has no <form>. */
export function findBestFormRoot(): Element | null {
  let best: Element | null = null
  let bestScore = 0
  for (const form of Array.from(document.querySelectorAll('form'))) {
    if (isOwnUi(form) || form.closest('header, nav, footer, [role="search"]')) continue
    const score = quickFieldCount(form)
    if (score > bestScore) {
      best = form
      bestScore = score
    }
  }
  if (best && bestScore >= 2) return best
  return document.body && quickFieldCount(document.body) >= 3 ? document.body : null
}

/** A cross-origin iframe that hosts a known ATS form. */
export function embeddedFormFrame(): HTMLIFrameElement | null {
  for (const frame of Array.from(document.querySelectorAll<HTMLIFrameElement>('iframe[src]'))) {
    if (KNOWN_FORM_URL.test(frame.src) && isVisible(frame)) return frame
  }
  return null
}

export function hasLargeCrossOriginFrame(): boolean {
  return Array.from(document.querySelectorAll<HTMLIFrameElement>('iframe[src]')).some((f) => {
    try {
      if (new URL(f.src).origin === location.origin) return false
    } catch {
      return false
    }
    const r = f.getBoundingClientRect()
    return isVisible(f) && r.width > 300 && r.height > 300
  })
}

// ── Page classification ──────────────────────────────────────────────────────

const POSTING_URL =
  /greenhouse\.io\/[^/]+\/jobs\/\d+|jobs\.lever\.co\/[^/]+\/[0-9a-f-]{36}\/?(\?|$)|jobs\.ashbyhq\.com\/[^/]+\/[0-9a-f-]{36}\/?(\?|$)|linkedin\.com\/jobs\/view|indeed\.[a-z.]+\/(viewjob|rc\/clk)|apply\.workable\.com\/[^/]+\/j\/|myworkdayjobs\.com\/.+\/job\/|\/careers?\/.+|\/jobs?\/.+/i

export function looksLikeJobPosting(): boolean {
  for (const script of Array.from(document.querySelectorAll('script[type="application/ld+json"]'))) {
    if (/"@type"\s*:\s*"JobPosting"/.test(script.textContent ?? '')) return true
  }
  const text = pageText(15_000)
  if (text.length < 600) return false
  const cues = [
    /responsibilit/i,
    /requirement/i,
    /qualification/i,
    /what you('|’)ll (do|bring)/i,
    /about (the|this) (role|job|position|team)/i,
    /years of (professional )?experience/i,
    /benefits|perks/i,
    /apply (now|for this)/i,
    /job description/i,
    /salary|compensation/i,
  ]
  const hits = cues.filter((r) => r.test(text)).length
  return hits >= 4 || (hits >= 2 && POSTING_URL.test(location.href))
}

// ── Blockers ──────────────────────────────────────────────────────────────────

export function detectLoginWall(): boolean {
  const password = Array.from(document.querySelectorAll('input[type="password"]')).some((el) => isVisible(el))
  if (password) return true
  const text = pageText(6000)
  return /\b((sign|log) ?in|create an account|register) to (apply|continue (with )?your application)\b|you (must|need to) (sign|log) ?in\b|please (sign|log) ?in to\b/i.test(text)
}

export interface CaptchaInfo {
  kind: 'recaptcha' | 'hcaptcha' | 'turnstile'
}

function responseFilled(name: string): boolean {
  const nodes = document.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>(`textarea[name="${name}"], input[name="${name}"], #${name}`)
  return Array.from(nodes).some((n) => n.value.trim().length > 0)
}

/** A CAPTCHA a person must solve right now (checkbox widget or challenge popup). */
export function findBlockingCaptcha(): CaptchaInfo | null {
  for (const frame of Array.from(document.querySelectorAll<HTMLIFrameElement>('iframe'))) {
    const src = frame.getAttribute('src') ?? ''
    if (!src || !isVisible(frame)) continue
    const rect = frame.getBoundingClientRect()
    if (rect.width < 40 || rect.height < 40) continue
    const title = (frame.getAttribute('title') ?? '').toLowerCase()
    if (/\/recaptcha\/(api2|enterprise)\/bframe/.test(src)) return { kind: 'recaptcha' }
    if (/\/recaptcha\/(api2|enterprise)\/anchor/.test(src) && !/[?&]size=invisible/.test(src) && !responseFilled('g-recaptcha-response')) {
      return { kind: 'recaptcha' }
    }
    if (/hcaptcha\.com/.test(src)) {
      if (/challenge/.test(title) && !/widget/.test(title)) return { kind: 'hcaptcha' }
      if (/checkbox|widget/.test(title) && !responseFilled('h-captcha-response')) return { kind: 'hcaptcha' }
    }
    if (/challenges\.cloudflare\.com/.test(src) && !responseFilled('cf-turnstile-response')) return { kind: 'turnstile' }
  }
  return null
}

// ── After submit ──────────────────────────────────────────────────────────────

const CONFIRMATION = [
  /thank(s| you)[,!.]?\s+(so much\s+)?for (your )?(applying|application|submitting|your application)/i,
  /\b(your )?application (has been |was |is )?(successfully )?(submitted|received|sent|completed?)\b/i,
  /\bwe('ve| have)? (successfully )?received your (application|submission|resume)\b/i,
  /\byour application (is|has been|was) (in|on its way|under review)\b/i,
  /\bsuccessfully (applied|submitted)\b/i,
  /\byou('ve| have) (successfully )?applied\b/i,
  /\bsubmission (received|successful)\b/i,
]

export function confirmationIn(text: string): string | null {
  for (const re of CONFIRMATION) {
    const m = re.exec(text)
    if (m) {
      const start = Math.max(0, text.lastIndexOf('.', m.index) + 1)
      const end = text.indexOf('.', m.index + m[0].length)
      return clip(collapse(text.slice(start, end > 0 ? end + 1 : m.index + m[0].length + 80)), 200)
    }
  }
  return null
}

export interface Baseline {
  url: string
  /** normalised page text before submitting */
  text: string
  errors: string[]
  hadVerification: boolean
}

function stripHash(url: string): string {
  return url.split('#')[0]
}

export function captureBaseline(root: Element): Baseline {
  return {
    url: location.href,
    text: norm(pageText(30_000)),
    errors: visibleErrors(root),
    hadVerification: !!findVerificationInputs(),
  }
}

/** Is an application form still on screen (fields + a submit button)? */
export function formStillActive(root: Element | null): boolean {
  const scope = root && root.isConnected ? root : findBestFormRoot()
  if (!scope) return false
  const visibleInputs = Array.from(
    scope.querySelectorAll<HTMLElement>('input[type="text"], input[type="email"], input:not([type]), textarea, select'),
  ).filter((el) => isVisible(el))
  return visibleInputs.length >= 2
}

/**
 * A success message that appeared because of our submit: ATS-specific
 * markers first, otherwise confirmation wording that is new since the
 * baseline (or, on a fresh page after navigation, with no form left).
 */
export function detectConfirmation(atsMarker: string | null, baseline: Baseline | null, root: Element | null): string | null {
  if (atsMarker) return atsMarker
  const text = pageText(20_000)
  const message = confirmationIn(text)
  if (!message) return null
  if (!baseline) return formStillActive(root) ? null : message
  const urlChanged = stripHash(location.href) !== stripHash(baseline.url)
  const isNew = !baseline.text.includes(norm(message))
  if (!urlChanged && !isNew) return null
  if (!urlChanged && formStillActive(root)) return null
  return message
}

const ERROR_SELECTOR = [
  '[role="alert"]',
  '[aria-live="assertive"]',
  '.error',
  '.errors',
  '.error-message',
  '.field-error',
  '.invalid-feedback',
  '[id$="-error"]',
  '[data-testid*="error" i]',
  '[class*="error" i]:not(input):not(select):not(textarea):not(form):not(button)',
  '[class*="invalid" i]:not(input):not(select):not(textarea):not(form):not(button)',
].join(', ')

/** Visible validation messages under root (deduplicated, short texts only). */
export function visibleErrors(root: Element): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  const nodes = Array.from(root.querySelectorAll<HTMLElement>(ERROR_SELECTOR))
  for (const el of nodes) {
    if (isOwnUi(el) || !isVisible(el)) continue
    if (el.querySelector('input, select, textarea')) continue
    if (nodes.some((other) => other !== el && el.contains(other) && isVisible(other))) continue
    const t = collapse(el.textContent)
    if (!t || t.length > 200 || seen.has(t)) continue
    seen.add(t)
    out.push(t)
    if (out.length >= 8) break
  }
  return out
}

export function newErrors(root: Element, baseline: Baseline): string[] {
  const before = new Set(baseline.errors)
  return visibleErrors(root).filter((e) => !before.has(e))
}

// ── Verification codes ───────────────────────────────────────────────────────

const CODE_HINT = /security[-_ ]?(code|input)|verification[-_ ]?code|one[-_ ]?time|\botp\b|passcode|confirmation[-_ ]?code|verify[-_ ]?code|access[-_ ]?code/i

/** Inputs for an emailed security code (Greenhouse shows 8 one-character boxes). */
export function findVerificationInputs(): HTMLInputElement[] | null {
  const inputs = Array.from(
    document.querySelectorAll<HTMLInputElement>(
      'input:not([type="hidden"]):not([type="checkbox"]):not([type="radio"]):not([type="file"]):not([type="submit"])',
    ),
  ).filter((i) => isVisible(i) && !isOwnUi(i))
  const coded = inputs.filter(
    (i) =>
      i.autocomplete === 'one-time-code' ||
      CODE_HINT.test(`${i.id} ${i.name} ${i.getAttribute('aria-label') ?? ''} ${i.placeholder} ${i.getAttribute('autocomplete') ?? ''}`),
  )
  if (coded.length) return coded
  const singles = inputs.filter((i) => i.maxLength === 1)
  if (singles.length >= 4) {
    let anc: HTMLElement | null = singles[0].parentElement
    while (anc && !singles.every((s) => anc!.contains(s))) anc = anc.parentElement
    const context = anc?.closest('form, section, div')?.textContent ?? ''
    if (/code/i.test(context)) return singles
  }
  return null
}

export function isBusy(root: Element): boolean {
  if (root.querySelector('[aria-busy="true"]')) return true
  const spinner = root.querySelector<HTMLElement>('[class*="spinner" i], [class*="loading" i], [class*="Loader"]')
  return !!spinner && isVisible(spinner)
}
