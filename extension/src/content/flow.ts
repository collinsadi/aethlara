import { adapterFor, genericAdapter, type Adapter } from './adapters'
import { ExtensionGoneError, callBackground, errorCode, releasePort } from './bridge'
import { hideBadge, showBadge } from './badge'
import {
  captureBaseline,
  detectConfirmation,
  detectLoginWall,
  embeddedFormFrame,
  findBestFormRoot,
  findBlockingCaptcha,
  findVerificationInputs,
  hasLargeCrossOriginFrame,
  visibleErrors,
} from './detect'
import { dispatchChange, dispatchInput, fireClick, focusQuietly, keyboard, setNativeValue, sleep, waitFor, waitForQuiet, yieldTask } from './dom'
import { type ScannedField, prioritise, toFormField } from './fields'
import { attachFile, base64ToFile, fillField } from './filler'
import { readFilled, scanForm } from './scanner'
import { findNextButton, findSubmitButton, snapshotControls, waitForStepChange, watchOutcome } from './submit'
import { norm } from './text'
import { startWatch } from './watch'
import { clip } from '@/lib/util'
import {
  COVER_LETTER_TOKEN,
  RESUME_TOKEN,
  type FillResponse,
  type FlowJob,
  type FlowOutcome,
  type FlowProgressUpdate,
  type NeedsReason,
  type Question,
  type Verification,
} from '@/types'

/**
 * Application flow (runs in the application tab)
 * ----------------------------------------------
 *   find the form → scan → ask the server for values → attach files first →
 *   fill the rest → check required fields → Next (multi-step, ≤ 6) or Submit →
 *   watch the outcome (confirmation / security code / CAPTCHA / errors).
 *
 * The background persists the phase before anything that can navigate the
 * tab, so when a new document loads (Lever's /thanks page, server-side
 * validation, a multi-page form) this script resumes from that phase.
 * Every path ends in exactly one FLOW_RESULT, except a deliberate navigation.
 */

const MAX_STEPS = 6
const FORM_WAIT_MS = 20_000
const OUTCOME_WAIT_MS = 30_000
const VERIFICATION_WAIT_MS = 120_000
const VERIFICATION_POLL_MS = 5_000
const MAX_HOPS = 2

class FlowAborted extends Error {}

/** The server cannot answer right now (no AI key, rate limit…): hand the claim back. */
class ServerUnavailable extends Error {
  readonly reason: 'ai_unavailable' | 'rate_limited' | 'signed_out' | 'error'
  constructor(message: string, reason: 'ai_unavailable' | 'rate_limited' | 'signed_out' | 'error') {
    super(message)
    this.reason = reason
  }
}

class FlowFailure extends Error {}

interface FlowState {
  job: FlowJob
  adapter: Adapter
  aborted: boolean
  filled: number
  step: number
  submitAttempts: number
  correctivePasses: number
}

let active: FlowState | null = null
/** Runs this document already reported: never start them again (no double submits). */
const finishedRuns = new Set<string>()

export function activeRunId(): string | null {
  return active?.job.runId ?? null
}

export function activeJob(): FlowJob | null {
  return active?.job ?? null
}

export function abortFlow(runId: string): boolean {
  if (!active || active.job.runId !== runId) return false
  active.aborted = true
  hideBadge()
  return true
}

/** Starts a flow unless this document is already running it. */
export function startFlow(job: FlowJob): boolean {
  if (finishedRuns.has(job.runId)) return false
  if (active && active.job.runId === job.runId) return false
  if (active) active.aborted = true
  const state: FlowState = {
    job,
    adapter: adapterFor(location.href),
    aborted: false,
    filled: job.filled,
    step: job.step,
    submitAttempts: job.submitAttempts,
    correctivePasses: job.correctivePasses,
  }
  active = state
  void run(state).finally(() => {
    if (active === state) {
      active = null
      releasePort()
    }
  })
  return true
}

function checkAbort(s: FlowState): void {
  if (s.aborted) throw new FlowAborted()
}

function badgeText(s: FlowState, label: string): string {
  const step = s.step > 0 ? ` (step ${s.step + 1})` : ''
  return `Aethlara is applying… ${label}${step}`
}

async function progress(s: FlowState, update: FlowProgressUpdate): Promise<void> {
  checkAbort(s)
  if (update.label) showBadge(badgeText(s, update.label.toLowerCase()), update.tone === 'warn' ? 'attention' : 'working')
  try {
    await callBackground({ type: 'FLOW_PROGRESS', runId: s.job.runId, update })
  } catch (err) {
    if (err instanceof ExtensionGoneError) throw new FlowAborted()
    if (errorCode(err) === 'NOT_MANAGED') throw new FlowAborted()
    // progress is best effort otherwise
  }
}

function needs(s: FlowState, reason: NeedsReason, message: string, questions?: Question[]): FlowOutcome {
  return { status: 'needs_input', reason, message, questions, pageUrl: location.href, filled: s.filled }
}

async function report(s: FlowState, outcome: FlowOutcome): Promise<void> {
  if (s.aborted) return
  finishedRuns.add(s.job.runId)
  const tone = outcome.status === 'submitted' ? 'done' : outcome.status === 'needs_input' ? 'attention' : 'error'
  const text =
    outcome.status === 'submitted'
      ? 'Aethlara submitted this application'
      : outcome.status === 'needs_input'
        ? `Aethlara needs you: ${outcome.message}`
        : outcome.status === 'released'
          ? 'Aethlara paused this application'
          : `Aethlara couldn't finish: ${outcome.message}`
  showBadge(clip(text, 140), tone, outcome.status === 'needs_input' ? 15_000 : 6_000)
  try {
    await callBackground({ type: 'FLOW_RESULT', runId: s.job.runId, outcome })
  } catch {
    // The background enforces a deadline; it will time the run out.
    return
  }
  if (outcome.status === 'needs_input') {
    startWatch({
      appId: s.job.appId,
      title: s.job.title,
      company: s.job.company,
      reason: outcome.reason,
      pageUrl: location.href,
      since: Date.now(),
    })
  }
}

async function run(s: FlowState): Promise<void> {
  try {
    const outcome = await execute(s)
    if (outcome) await report(s, outcome)
  } catch (err) {
    if (s.aborted || err instanceof FlowAborted || err instanceof ExtensionGoneError) {
      hideBadge()
      return
    }
    if (err instanceof ServerUnavailable) {
      await report(s, { status: 'released', message: err.message, cause: err.reason })
      return
    }
    const message = err instanceof FlowFailure ? err.message : 'Something unexpected went wrong while filling the form.'
    await report(s, { status: 'failed', message, pageUrl: location.href, filled: s.filled })
  }
}

async function execute(s: FlowState): Promise<FlowOutcome | null> {
  const { job } = s
  showBadge(badgeText(s, 'starting'))
  if (job.phase === 'submitting' || job.phase === 'verifying') return afterSubmitNavigation(s)
  if (!job.allowedOrigins.includes(location.origin)) {
    return needs(s, 'review', `The application moved to ${location.hostname}, which Aethlara did not expect. Check the tab and finish there.`)
  }
  return fillAndSubmit(s)
}

// ── Finding the form ──────────────────────────────────────────────────────────

async function hop(s: FlowState, url: string): Promise<FlowOutcome | null> {
  if (s.job.hops >= MAX_HOPS) {
    return needs(s, 'unsupported_form', "Aethlara couldn't reach the application form from this page.")
  }
  try {
    await callBackground({ type: 'FLOW_PROGRESS', runId: s.job.runId, update: { hopTo: url, label: 'Opening the application form' } })
  } catch {
    let host = url
    try {
      host = new URL(url).hostname
    } catch {
      // keep raw
    }
    return needs(s, 'unsupported_form', `The application form is on ${host}, which Aethlara won't open on its own.`)
  }
  location.assign(url)
  return null
}

async function locateForm(s: FlowState): Promise<{ root: Element } | { outcome: FlowOutcome | null }> {
  await progress(s, { label: 'Looking for the application form', phase: 'filling' })
  const prep = await s.adapter.prepare?.()
  if (prep?.navigateTo) return { outcome: await hop(s, prep.navigateTo) }
  let root = await waitFor(() => s.adapter.findForm(), FORM_WAIT_MS)
  checkAbort(s)
  if (!root && s.adapter.id !== 'generic') {
    const fallback = await genericAdapter.prepare?.()
    if (fallback?.navigateTo) return { outcome: await hop(s, fallback.navigateTo) }
    root = findBestFormRoot()
  }
  if (!root) {
    if (detectLoginWall()) return { outcome: needs(s, 'login_required', 'This site wants you to sign in or create an account before applying.') }
    if (findBlockingCaptcha()) return { outcome: needs(s, 'captcha', 'A CAPTCHA is blocking the application page.') }
    const frame = embeddedFormFrame()
    if (frame) return { outcome: await hop(s, frame.src) }
    const message = hasLargeCrossOriginFrame()
      ? 'The form is inside an embedded frame from another site, which Aethlara cannot fill.'
      : "Aethlara couldn't find an application form on this page."
    return { outcome: needs(s, 'unsupported_form', message) }
  }
  if (detectLoginWall()) return { outcome: needs(s, 'login_required', 'This site wants you to sign in or create an account before applying.') }
  return { root }
}

async function fillAndSubmit(s: FlowState): Promise<FlowOutcome | null> {
  const located = await locateForm(s)
  if ('outcome' in located) return located.outcome
  let root = located.root

  let corrective = false
  for (let step = s.step; step < MAX_STEPS; step++) {
    s.step = step
    const pass = await fillStep(s, root, corrective)
    corrective = false
    if (pass) return pass
    const submit = findSubmitButton(root, s.adapter)
    const next = submit ? null : findNextButton(root)
    if (next) {
      await progress(s, { label: `Moving to step ${step + 2}`, phase: 'filling', step: step + 1, filled: s.filled })
      const before = snapshotControls(root)
      fireClick(next)
      const change = await waitForStepChange(root, before, 12_000)
      checkAbort(s)
      if (change === 'unchanged') {
        if (s.correctivePasses < 1) {
          s.correctivePasses++
          await progress(s, { label: 'Fixing the fields the form flagged', correctivePasses: s.correctivePasses, step })
          corrective = true
          step-- // fill the same step again
          continue
        }
        const errors = visibleErrors(root)
        return needs(
          s,
          'review',
          errors.length ? `The form didn't accept step ${step + 1}: ${errors.slice(0, 3).join('; ')}` : `The form didn't move past step ${step + 1}.`,
        )
      }
      await waitForQuiet(document.body, 500, 4000)
      root = s.adapter.findForm() ?? findBestFormRoot() ?? root
      continue
    }
    if (!submit) {
      return needs(s, 'review', "Filled the form, but couldn't find its submit button. Review it and submit it yourself.")
    }
    return submitStage(s, root, submit)
  }
  return needs(s, 'review', `This form has more than ${MAX_STEPS} steps. Aethlara filled the first ${MAX_STEPS}; finish the rest yourself.`)
}

// ── Filling one step ──────────────────────────────────────────────────────────

const AI_TRANSIENT = new Set(['AI_TIMEOUT', 'TIMEOUT', 'NETWORK', 'AUTH_UNAVAILABLE', 'INTERNAL_ERROR', 'HTTP_502', 'HTTP_503', 'HTTP_504'])

async function askServer(s: FlowState, fields: ScannedField[], corrective: boolean): Promise<FillResponse> {
  const payload = fields.map((f) => {
    const ff = toFormField(f)
    if (corrective) {
      const err = fieldError(f)
      if (err) ff.help = clip(`${ff.help ? `${ff.help} ` : ''}The form said: "${err}".`, 500)
    }
    return ff
  })
  for (let attempt = 0; ; attempt++) {
    try {
      return await callBackground({ type: 'FLOW_FILL', runId: s.job.runId, pageUrl: location.href, fields: payload }, 2)
    } catch (err) {
      if (err instanceof ExtensionGoneError) throw new FlowAborted()
      const code = errorCode(err) ?? 'ERROR'
      if (code === 'NOT_MANAGED') throw new FlowAborted()
      if (code === 'API_KEY_REQUIRED') {
        throw new ServerUnavailable('Add an AI provider key in the dashboard so the autopilot can fill forms.', 'ai_unavailable')
      }
      if (code === 'SIGNED_OUT') throw new ServerUnavailable('The extension is signed out.', 'signed_out')
      if (code === 'RATE_LIMITED') throw new ServerUnavailable('Reached the hourly form-filling limit; the autopilot will retry later.', 'rate_limited')
      if (code === 'NOT_FOUND') throw new FlowFailure('This application no longer exists.')
      if (code === 'INVALID_INPUT') throw new FlowFailure('Aethlara could not read this form (the server rejected the field list).')
      if (attempt === 0 && AI_TRANSIENT.has(code)) {
        await sleep(3000)
        continue
      }
      throw new ServerUnavailable(`Aethlara couldn't answer the form right now (${code}).`, 'ai_unavailable')
    }
  }
}

function fieldError(f: ScannedField): string | null {
  const el = f.handle.members[0] ?? f.handle.el
  const ids = `${el.getAttribute('aria-errormessage') ?? ''} ${el.getAttribute('aria-describedby') ?? ''}`.split(/\s+/).filter(Boolean)
  for (const id of ids) {
    const node = document.getElementById(id)
    if (node && /error/i.test(`${id} ${node.className}`)) {
      const text = (node.textContent ?? '').trim()
      if (text) return clip(text, 160)
    }
  }
  const scoped = f.handle.container?.querySelector('[class*="error" i], [role="alert"]')
  const text = scoped?.textContent?.trim()
  return text ? clip(text, 160) : null
}

interface FileAttempt {
  ok: boolean
  message?: string
}

async function attach(s: FlowState, f: ScannedField, kind: 'resume' | 'cover_letter'): Promise<FileAttempt> {
  const what = kind === 'resume' ? 'resume' : 'cover letter'
  let payload
  try {
    payload = await callBackground({ type: 'FLOW_FILE', runId: s.job.runId, kind })
  } catch (err) {
    if (err instanceof ExtensionGoneError) throw new FlowAborted()
    return { ok: false, message: `Couldn't download your ${what} from Aethlara.` }
  }
  if (!payload.ok) return { ok: false, message: `Couldn't download your ${what} from Aethlara (${payload.error}).` }
  const file = base64ToFile(payload.base64, payload.filename, payload.mime)
  const result = await attachFile(f, file)
  if (result.ok) {
    s.filled++
    return { ok: true }
  }
  if (result.error === 'type') return { ok: false, message: `The form doesn't accept your ${what} file type (${file.name}).` }
  return { ok: false, message: `The form didn't accept the ${what} upload${result.message ? `: ${result.message}` : ''}.` }
}

function toQuestion(f: ScannedField): Question {
  const ff = toFormField(f)
  return { field_id: f.id, label: f.label || ff.label, type: ff.type, ...(ff.options ? { options: ff.options } : {}) }
}

/**
 * Fills the visible step. Returns an outcome when the flow must stop here
 * (missing answers, resume problems…), or null to continue.
 */
async function fillStep(s: FlowState, root: Element, corrective: boolean): Promise<FlowOutcome | null> {
  const scanOpts = { readComboOptions: true, skip: s.adapter.skip?.bind(s.adapter) }
  await progress(s, { label: s.step > 0 ? `Reading step ${s.step + 1}` : 'Reading the form', step: s.step })
  const scanned = await scanForm(root, scanOpts)
  checkAbort(s)
  if (!scanned.length) {
    return s.step === 0 && !corrective ? needs(s, 'unsupported_form', 'The form has no fields Aethlara can fill.') : null
  }
  const fields = prioritise(scanned, 150)
  await progress(s, { label: `Working out answers for ${fields.length} questions` })
  const response = await askServer(s, fields, corrective)
  checkAbort(s)
  const values = new Map<string, string>()
  for (const fill of response.fills) {
    if (fill.value != null && fill.value.trim() !== '') values.set(fill.field_id, fill.value)
  }
  const serverMissing = new Set(response.missing.map((m) => m.field_id))

  // 1) Files first: resume parsers (Lever, Ashby) rewrite the text fields.
  let resumeProblem: string | null = null
  let fileProblem: string | null = null
  const files = fields.filter((f) => f.handle.kind === 'file')
  if (files.length) {
    await progress(s, { label: 'Attaching your documents' })
    for (const f of files) {
      if (readFilled(f)) continue
      const token = values.get(f.id)
      const role = token === RESUME_TOKEN ? 'resume' : token === COVER_LETTER_TOKEN ? 'cover_letter' : f.handle.fileRole
      if (role === 'resume') {
        const r = await attach(s, f, 'resume')
        if (!r.ok) resumeProblem = r.message ?? "Couldn't attach your resume."
      } else if (role === 'cover_letter') {
        const r = s.job.coverLetterFilename ? await attach(s, f, 'cover_letter') : { ok: false }
        if (!r.ok) {
          const pasted = s.job.coverLetter ? await s.adapter.coverLetterAsText?.(root, s.job.coverLetter) : false
          if (pasted) s.filled++
          else if (f.required) fileProblem = r.message ?? 'This form requires a cover letter file.'
        }
      } else if (f.required) {
        fileProblem = `This form asks for a file only you can provide: ${f.label || 'an attachment'}.`
      }
      checkAbort(s)
    }
    await s.adapter.afterFiles?.(root)
    await waitForQuiet(root, 600, 6000)
  }

  // 2) Everything else.
  const textFields = fields.filter((f) => f.handle.kind !== 'file' && values.has(f.id))
  if (textFields.length) await progress(s, { label: `Filling ${textFields.length} answers` })
  for (const f of textFields) {
    const value = values.get(f.id)!
    try {
      const handled = await s.adapter.fill?.(f, value)
      const ok = handled ?? (await fillField(f, value))
      if (ok) s.filled++
    } catch {
      // checked below with the required-field pass
    }
    checkAbort(s)
  }

  // 3) Cover letter text box when there is no file upload for it.
  if (s.job.coverLetter) {
    for (const f of fields) {
      const isText = f.handle.kind === 'textarea' || f.handle.kind === 'richtext'
      if (!isText || readFilled(f)) continue
      if (/cover letter|motivation/.test(norm(`${f.label} ${f.placeholder} ${f.name}`))) {
        if (await fillField(f, s.job.coverLetter)) s.filled++
      }
    }
  }
  await waitForQuiet(root, 400, 3000)
  await progress(s, { label: 'Checking required fields', filled: s.filled })

  // 4) Never continue with required fields empty.
  const after = await scanForm(root, { skip: scanOpts.skip })
  const byId = new Map(fields.map((f) => [f.id, f]))
  const empty = after.filter((f) => f.required && !readFilled(f) && f.handle.kind !== 'file')
  const unanswered = empty.filter((f) => !values.has(f.id) || serverMissing.has(f.id))
  const notApplied = empty.filter((f) => values.has(f.id) && !serverMissing.has(f.id))
  const resumeStillMissing = after.some((f) => f.handle.kind === 'file' && f.handle.fileRole === 'resume' && !readFilled(f))
  if (resumeStillMissing && !resumeProblem) resumeProblem = "Couldn't attach your resume to the form."

  if (unanswered.length) {
    const questions = unanswered.slice(0, 40).map((f) => toQuestion(byId.get(f.id) ?? f))
    const extra = resumeProblem ? ` ${resumeProblem}` : ''
    return needs(
      s,
      'missing_answers',
      `${unanswered.length} required question${unanswered.length === 1 ? '' : 's'} need${unanswered.length === 1 ? 's' : ''} your answer.${extra}`,
      questions,
    )
  }
  if (resumeProblem) return needs(s, 'review', `${resumeProblem} Everything else is filled: attach it and submit.`)
  if (fileProblem) return needs(s, 'review', `${fileProblem} Attach it and submit.`)
  if (notApplied.length) {
    const labels = notApplied.slice(0, 4).map((f) => f.label || 'a field').join('; ')
    return needs(s, 'review', `Couldn't fill ${notApplied.length} required field${notApplied.length === 1 ? '' : 's'} (${labels}). Fill ${notApplied.length === 1 ? 'it' : 'them'} and submit.`)
  }
  return null
}

// ── Submitting ────────────────────────────────────────────────────────────────

async function captchaAfterGrace(ms: number): Promise<boolean> {
  // Managed widgets (Turnstile) often solve themselves within a few seconds.
  const clear = await waitFor(() => !findBlockingCaptcha(), ms)
  return !clear
}

async function submitStage(s: FlowState, root: Element, submit: HTMLElement): Promise<FlowOutcome | null> {
  await progress(s, { label: 'Checking the form before submitting' })
  if (findBlockingCaptcha() && (await captchaAfterGrace(6000))) {
    return needs(s, 'captcha', 'Filled. Solve the CAPTCHA, then submit.')
  }
  if (!s.job.autoSubmit) return needs(s, 'review', 'Filled. Review the answers and submit.')

  // Final guard: never press submit with a required field empty.
  const final = await scanForm(root, { skip: s.adapter.skip?.bind(s.adapter) })
  const empty = final.filter((f) => f.required && !readFilled(f))
  if (empty.length) {
    const files = empty.filter((f) => f.handle.kind === 'file')
    if (files.length) return needs(s, 'review', `A required upload is empty (${files[0].label || 'file'}). Attach it and submit.`)
    return needs(s, 'missing_answers', `${empty.length} required question${empty.length === 1 ? ' is' : 's are'} still empty.`, empty.slice(0, 40).map(toQuestion))
  }

  const baseline = captureBaseline(root)
  s.submitAttempts++
  await progress(s, {
    label: 'Submitting the application',
    phase: 'submitting',
    submitAttempts: s.submitAttempts,
    baselineUrl: location.href,
    filled: s.filled,
  })
  fireClick(submit)
  await progress(s, { label: 'Waiting for confirmation' })
  const outcome = await watchOutcome(root, baseline, s.adapter, OUTCOME_WAIT_MS)
  checkAbort(s)
  switch (outcome.kind) {
    case 'confirmed':
      return { status: 'submitted', finalUrl: location.href, message: outcome.message, filled: s.filled }
    case 'verification':
      return verifyStage(s, root)
    case 'captcha':
      return needs(s, 'captcha', 'A CAPTCHA appeared after submitting. Solve it, then submit again.')
    case 'errors':
      return correctAndResubmit(s, root, outcome.errors)
    case 'unknown':
      return needs(s, 'review', "Submitted, but Aethlara couldn't see a confirmation. Check the tab to make sure it went through.")
  }
}

async function correctAndResubmit(s: FlowState, root: Element, errors: string[]): Promise<FlowOutcome | null> {
  if (s.correctivePasses >= 1 || s.submitAttempts >= 2 || !s.job.allowedOrigins.includes(location.origin)) {
    return needs(s, 'review', `The form reported problems: ${errors.slice(0, 4).join('; ') || 'see the tab'}.`)
  }
  s.correctivePasses++
  await progress(s, { label: 'Fixing the fields the form flagged', phase: 'filling', correctivePasses: s.correctivePasses })
  const pass = await fillStep(s, root, true)
  if (pass) return pass
  const submit = findSubmitButton(root, s.adapter)
  if (!submit) return needs(s, 'review', `The form reported problems: ${errors.slice(0, 4).join('; ')}.`)
  return submitStage(s, root, submit)
}

async function afterSubmitNavigation(s: FlowState): Promise<FlowOutcome | null> {
  await progress(s, { label: 'Checking the result' })
  await waitForQuiet(document.body, 800, 6000)
  const root = s.adapter.findForm() ?? findBestFormRoot()
  const message = await waitFor(() => detectConfirmation(s.adapter.confirmation?.() ?? null, null, root), 8000)
  checkAbort(s)
  if (message) return { status: 'submitted', finalUrl: location.href, message, filled: s.filled }
  if (findVerificationInputs()) return verifyStage(s, root ?? document.body)
  if (findBlockingCaptcha()) return needs(s, 'captcha', 'A CAPTCHA appeared after submitting. Solve it, then submit again.')
  // Only a form that came back *with errors* is corrected and re-submitted;
  // anything else could be a success page we failed to recognise.
  if (root && s.job.allowedOrigins.includes(location.origin)) {
    const errors = visibleErrors(root)
    if (errors.length) return correctAndResubmit(s, root, errors)
  }
  return needs(s, 'review', "Submitted, but Aethlara couldn't confirm it went through. Check the tab.")
}

// ── Email verification codes ──────────────────────────────────────────────────

function pickVerification(items: Verification[], ats: string | null, tried: Set<string>): Verification | null {
  const sorted = [...items].sort((a, b) => Date.parse(b.received_at) - Date.parse(a.received_at))
  const fresh = sorted.filter((v) => (v.code ? !tried.has(v.code) : !!v.link))
  const preferred = ats ? fresh.filter((v) => `${v.from} ${v.subject}`.toLowerCase().includes(ats)) : []
  const pool = preferred.length ? preferred : fresh
  return pool.find((v) => v.code) ?? pool.find((v) => v.link) ?? null
}

async function typeCode(inputs: HTMLInputElement[], code: string): Promise<void> {
  const chars = code.replace(/\s+/g, '')
  if (inputs.length > 1 && inputs.length >= chars.length) {
    for (let i = 0; i < chars.length; i++) {
      const el = inputs[i]
      focusQuietly(el)
      keyboard(el, chars[i])
      setNativeValue(el, chars[i])
      dispatchInput(el, chars[i])
      keyboard(el, chars[i], 'keyup')
      dispatchChange(el)
      await yieldTask()
    }
    return
  }
  const el = inputs[0]
  focusQuietly(el)
  setNativeValue(el, chars)
  dispatchInput(el, chars)
  dispatchChange(el)
  await yieldTask()
}

async function verifyStage(s: FlowState, root: Element): Promise<FlowOutcome | null> {
  await progress(s, { label: 'Waiting for the verification email', phase: 'verifying' })
  const deadline = Date.now() + VERIFICATION_WAIT_MS
  const tried = new Set<string>()
  while (Date.now() < deadline) {
    checkAbort(s)
    let items: Verification[] = []
    try {
      items = await callBackground({ type: 'FLOW_VERIFICATIONS', runId: s.job.runId })
    } catch (err) {
      if (err instanceof ExtensionGoneError) throw new FlowAborted()
    }
    const pick = pickVerification(items, s.job.ats, tried)
    if (pick?.code) {
      tried.add(pick.code)
      const inputs = findVerificationInputs()
      if (!inputs) break
      await progress(s, { label: 'Entering the verification code' })
      await typeCode(inputs, pick.code)
      const scope = root.isConnected ? root : document.body
      const baseline = captureBaseline(scope)
      const button = findSubmitButton(scope, s.adapter) ?? findSubmitButton(document.body)
      if (button) fireClick(button)
      const outcome = await watchOutcome(scope, baseline, s.adapter, 25_000, { ignoreVerification: true })
      checkAbort(s)
      if (outcome.kind === 'confirmed') return { status: 'submitted', finalUrl: location.href, message: outcome.message, filled: s.filled }
      if (outcome.kind === 'captcha') return needs(s, 'captcha', 'A CAPTCHA appeared after the verification code. Solve it, then submit.')
      continue // wrong or expired code: try a newer one
    }
    if (pick?.link) {
      return needs(s, 'verification', 'The site emailed a verification link to your agent inbox. Open it, then submit the form.')
    }
    await sleep(VERIFICATION_POLL_MS)
  }
  return needs(s, 'verification', 'Enter the security code the site emailed you, then submit.')
}
