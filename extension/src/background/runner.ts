import { ApiError, agentApi, downloadFile, isSignedOutError } from './api'
import { clearNeedsNotification, notifyNeedsInput } from './notifications'
import { closeTab, ensureContentScript, getTab, pingTab, waitForTabComplete } from './tabs'
import { createLogger, errorKind } from '@/lib/log'
import { sendToTab } from '@/lib/messaging'
import { authStore, runnerStore, settingsStore } from '@/lib/storage'
import { clip, hostOf, isHttpUrl, randomId, sleep } from '@/lib/util'
import {
  EMPTY_RUNNER_STATE,
  type ActiveRun,
  type ExtSettings,
  type FilePayload,
  type FillResponse,
  type FlowJob,
  type FlowMode,
  type FlowOutcome,
  type FlowProgressUpdate,
  type FormField,
  type HelloReply,
  type NeedsReason,
  type Packet,
  type ResultReport,
  type RunnerState,
  type TickOutcome,
  type Verification,
  type WatchEntry,
} from '@/types'

/**
 * Autopilot runner (service worker)
 * ---------------------------------
 * On an alarm (every N minutes while the extension autopilot is on) or
 * "Apply now", claim up to TICK_LIMIT browser applications and work them
 * strictly one at a time: open the apply URL in an inactive tab and let the
 * content script there run the form. The content script calls back here for
 * everything that needs the network (fills, files, verification codes), so
 * the API token never reaches a web page.
 *
 * State lives in chrome.storage.session and is written before every step
 * that matters, so a service-worker restart resumes the current application
 * (the content script keeps going and re-wakes us with its next message) or
 * releases the claim. Every claim gets exactly one result, including on
 * timeouts and closed tabs.
 */

const log = createLogger('runner')

export const ALARM_TICK = 'aethlara.autopilot.tick'
const ALARM_DEADLINE = 'aethlara.autopilot.deadline'
const ALARM_WATCHDOG = 'aethlara.autopilot.watchdog'

const TICK_LIMIT = 3
const APP_TIMEOUT_MS = 4 * 60_000
/** Extra time once a form is waiting for an emailed security code. */
const VERIFICATION_EXTENSION_MS = 3 * 60_000
const WATCH_TTL_MS = 3 * 60 * 60_000
const RECENT_LIMIT = 15
const MAX_HOPS = 2
const MAX_PENDING_REPORT_ATTEMPTS = 10

let state: RunnerState = structuredClone(EMPTY_RUNNER_STATE)
let loading: Promise<void> | null = null
let advancing = false
let deadlineTimer: ReturnType<typeof setTimeout> | null = null
let keepAliveTimer: ReturnType<typeof setInterval> | null = null
const finishing = new Set<string>()
const fileCache = new Map<string, FilePayload>()
/** A tab being created for the current run: FLOW_HELLO waits for it. */
let pendingTab: Promise<void> | null = null

// ── State ─────────────────────────────────────────────────────────────────────

export function ensureLoaded(): Promise<void> {
  if (!loading) {
    loading = runnerStore.get().then((s) => {
      state = s
    })
  }
  return loading
}

async function mutate(fn: (s: RunnerState) => void): Promise<void> {
  await ensureLoaded()
  fn(state)
  await runnerStore.set(state)
  syncTimers()
}

function activeRuns(): ActiveRun[] {
  return [...(state.current ? [state.current] : []), ...state.manual]
}

function findRun(runId: string): ActiveRun | null {
  return activeRuns().find((r) => r.runId === runId) ?? null
}

async function isSignedIn(): Promise<boolean> {
  return !!(await authStore.getDevice())
}

function pushStep(run: ActiveRun, label: string, tone: 'info' | 'warn' = 'info'): void {
  const last = run.steps[run.steps.length - 1]
  if (last?.label === label) return
  if (last && last.state === 'active') last.state = 'done'
  run.steps.push({ label: clip(label, 120), state: tone === 'warn' ? 'warn' : 'active', at: Date.now() })
  if (run.steps.length > 30) run.steps.splice(0, run.steps.length - 30)
}

// ── Timers: deadline, watchdog, keep-alive ───────────────────────────────────

function syncTimers(): void {
  const runs = activeRuns()
  if (runs.length && !keepAliveTimer) {
    // Extension API calls reset the service worker's idle timer while a form is being worked.
    keepAliveTimer = setInterval(() => void chrome.runtime.getPlatformInfo().catch(() => undefined), 20_000)
    void chrome.alarms.create(ALARM_WATCHDOG, { periodInMinutes: 1 })
  } else if (!runs.length && keepAliveTimer) {
    clearInterval(keepAliveTimer)
    keepAliveTimer = null
    void chrome.alarms.clear(ALARM_WATCHDOG)
  }
  armDeadline()
}

let armedDeadline: number | null = null

function armDeadline(): void {
  const runs = activeRuns()
  const next = runs.length ? Math.min(...runs.map((r) => r.deadline)) : null
  if (next === armedDeadline && (next === null || deadlineTimer)) return
  armedDeadline = next
  if (deadlineTimer) clearTimeout(deadlineTimer)
  deadlineTimer = null
  if (next === null) {
    void chrome.alarms.clear(ALARM_DEADLINE)
    return
  }
  deadlineTimer = setTimeout(() => {
    deadlineTimer = null
    armedDeadline = null
    void checkDeadlines()
  }, Math.max(0, next - Date.now()) + 250)
  // Backup for a service-worker restart (timers do not survive it).
  void chrome.alarms.create(ALARM_DEADLINE, { when: Math.max(Date.now() + 1000, next + 1000) })
}

async function checkDeadlines(): Promise<void> {
  await ensureLoaded()
  for (const run of activeRuns()) {
    if (Date.now() < run.deadline) continue
    log.warn('application timed out', { phase: run.phase, mode: run.mode })
    if (run.tabId != null) void sendToTab(run.tabId, { type: 'FLOW_ABORT', runId: run.runId }, 3000).catch(() => undefined)
    const minutes = Math.round((run.deadline - run.startedAt) / 60_000)
    const host = hostOf(run.applyUrl) || 'the application site'
    let outcome: FlowOutcome
    if (run.phase === 'verifying') {
      outcome = { status: 'needs_input', reason: 'verification', message: 'Enter the security code the site emailed you, then submit.', pageUrl: run.applyUrl, filled: run.filled }
    } else if (run.phase === 'submitting') {
      outcome = { status: 'needs_input', reason: 'review', message: "Submitted, but no confirmation appeared in time. Check the tab to make sure it went through.", pageUrl: run.applyUrl, filled: run.filled }
    } else {
      outcome = { status: 'failed', message: `Timed out after ${minutes} minutes on ${host}.`, pageUrl: run.applyUrl, filled: run.filled }
    }
    await finishRun(run, outcome)
  }
  armDeadline()
}

// ── Ticks ─────────────────────────────────────────────────────────────────────

export async function requestTick(trigger: 'alarm' | 'manual'): Promise<{ started: boolean; reason?: 'signed_out' | 'busy' }> {
  await ensureLoaded()
  if (!(await isSignedIn())) return { started: false, reason: 'signed_out' }
  if (trigger === 'alarm' && !(await settingsStore.get()).autopilot) return { started: false }
  if (state.tick || state.current) {
    if (state.tick && trigger === 'manual') await mutate((s) => s.tick && (s.tick.trigger = 'manual'))
    if (!state.tick) void advance()
    return { started: false, reason: 'busy' }
  }
  await mutate((s) => {
    s.tick = { id: randomId(6), trigger, startedAt: Date.now(), processed: 0, seen: [] }
  })
  void advance()
  return { started: true }
}

async function endTick(outcome: TickOutcome, message?: string): Promise<void> {
  await mutate((s) => {
    if (!s.tick) return
    s.lastTick = { at: Date.now(), trigger: s.tick.trigger, processed: s.tick.processed, outcome, ...(message ? { message: clip(message, 300) } : {}) }
    s.tick = null
  })
}

async function advance(): Promise<void> {
  if (advancing) return
  advancing = true
  try {
    await ensureLoaded()
    await flushPendingReports()
    for (;;) {
      const tick = state.tick
      if (!tick || state.current) return
      if (!(await isSignedIn())) return endTick('signed_out')
      if (tick.processed >= TICK_LIMIT) return endTick('limit')
      if (tick.trigger === 'alarm' && !(await settingsStore.get()).autopilot) return endTick('disabled')
      let packet: Packet | null
      try {
        packet = await agentApi.claim()
      } catch (err) {
        log.warn('claim failed', { kind: errorKind(err) })
        return endTick(isSignedOutError(err) ? 'signed_out' : 'error', err instanceof Error ? err.message : 'Claim failed')
      }
      if (!packet) return endTick('empty')
      const appId = packet.application.id
      if (tick.seen.includes(appId) || state.manual.some((r) => r.appId === appId)) {
        // Same application again in one tick (or the user is filling it by hand): hand it back.
        await deliverReport(appId, { status: 'released' })
        return endTick('repeat')
      }
      await mutate((s) => s.tick?.seen.push(appId))
      const started = await beginApplication(packet)
      if (started) return
    }
  } finally {
    advancing = false
  }
}

// ── One application ───────────────────────────────────────────────────────────

function originOf(url: string): string | null {
  try {
    return new URL(url).origin
  } catch {
    return null
  }
}

function makeRun(packet: Packet, mode: FlowMode, tabId: number | null, tabUrl?: string): ActiveRun {
  const now = Date.now()
  const applyUrl = packet.application.apply_url || packet.lead.apply_url || packet.lead.url || ''
  const origins = new Set<string>()
  for (const u of [applyUrl, tabUrl ?? '']) {
    const o = isHttpUrl(u) ? originOf(u) : null
    if (o) origins.add(o)
  }
  return {
    runId: randomId(),
    appId: packet.application.id,
    mode,
    title: packet.application.lead?.title || packet.lead.title,
    company: packet.application.lead?.company || packet.lead.company,
    ats: packet.application.ats ?? packet.lead.ats,
    applyUrl: tabUrl || applyUrl,
    allowedOrigins: [...origins],
    tabId,
    phase: 'opening',
    step: 0,
    filled: 0,
    submitAttempts: 0,
    correctivePasses: 0,
    hops: 0,
    baselineUrl: null,
    autoSubmit: mode === 'auto' && packet.auto_submit,
    coverLetter: packet.cover_letter ?? '',
    resumePath: packet.resume.path,
    resumeFilename: packet.resume.filename,
    coverLetterPath: packet.cover_letter_file?.path ?? null,
    coverLetterFilename: packet.cover_letter_file?.filename ?? null,
    verificationSince: packet.verification_since,
    startedAt: now,
    deadline: now + APP_TIMEOUT_MS,
    deadlineExtended: false,
    steps: [],
    lastProgressAt: now,
    helloAt: null,
  }
}

function toFlowJob(run: ActiveRun): FlowJob {
  return {
    runId: run.runId,
    appId: run.appId,
    mode: run.mode,
    title: run.title,
    company: run.company,
    ats: run.ats,
    applyUrl: run.applyUrl,
    allowedOrigins: run.allowedOrigins,
    autoSubmit: run.autoSubmit,
    coverLetter: run.coverLetter,
    resumeFilename: run.resumeFilename,
    coverLetterFilename: run.coverLetterFilename,
    phase: run.phase,
    step: run.step,
    filled: run.filled,
    submitAttempts: run.submitAttempts,
    correctivePasses: run.correctivePasses,
    hops: run.hops,
    baselineUrl: run.baselineUrl,
    deadline: run.deadline,
  }
}

/** Returns false when the application finished without needing a tab. */
async function beginApplication(packet: Packet): Promise<boolean> {
  const run = makeRun(packet, 'auto', null)
  if (!isHttpUrl(run.applyUrl)) {
    await deliverReport(run.appId, { status: 'failed', message: 'This application has no web form to open.' })
    await mutate((s) => {
      pushRecent(s, run, 'failed', 'This application has no web form to open.')
      if (s.tick) s.tick.processed += 1
    })
    return false
  }
  pushStep(run, 'Opening the application page')
  let resolvePending: () => void = () => undefined
  pendingTab = new Promise<void>((resolve) => {
    resolvePending = resolve
  })
  try {
    await mutate((s) => {
      s.current = run
    })
    let tab: chrome.tabs.Tab
    try {
      tab = await chrome.tabs.create({ url: run.applyUrl, active: false })
    } catch {
      await finishRun(run, { status: 'released', message: 'Could not open a browser tab.', cause: 'error' })
      return true
    }
    await mutate(() => {
      run.tabId = tab.id ?? null
    })
  } finally {
    resolvePending()
    pendingTab = null
  }
  log.info('application started', { ats: run.ats ?? 'generic' })
  void kick(run.runId)
  return true
}

/**
 * Hands the job to the tab's content script once the page has loaded,
 * unless the content script already asked for it (FLOW_HELLO).
 */
async function kick(runId: string): Promise<void> {
  const startedAt = Date.now()
  const first = findRun(runId)
  if (!first?.tabId) return
  const tab = await waitForTabComplete(first.tabId, 45_000)
  if (!tab) return // closed: onTabRemoved reports it
  for (let i = 0; i < 15; i++) {
    const run = findRun(runId)
    if (!run || run.tabId == null) return
    if (run.helloAt && run.helloAt >= startedAt) return
    const current = await getTab(run.tabId)
    if (current?.url) await mutate(() => admitRedirect(run, current.url))
    try {
      await sendToTab(run.tabId, { type: 'FLOW_START', job: toFlowJob(run) }, 5000)
      return
    } catch {
      await sleep(1000)
    }
  }
  const run = findRun(runId)
  if (run && !(run.helloAt && run.helloAt >= startedAt)) {
    await finishRun(run, {
      status: 'failed',
      message: `The application page on ${hostOf(run.applyUrl) || 'the site'} did not load.`,
      pageUrl: run.applyUrl,
      filled: run.filled,
    })
  }
}

// ── Results ───────────────────────────────────────────────────────────────────

function toReport(outcome: FlowOutcome): ResultReport {
  switch (outcome.status) {
    case 'submitted':
      return { status: 'submitted', filled: outcome.filled, final_url: clip(outcome.finalUrl, 2048), message: clip(outcome.message, 1000) }
    case 'needs_input':
      return {
        status: 'needs_input',
        reason: outcome.reason,
        message: clip(outcome.message, 500),
        questions: (outcome.questions ?? []).slice(0, 40).map((q) => ({
          field_id: q.field_id,
          label: clip(q.label, 500),
          ...(q.type ? { type: q.type } : {}),
          ...(q.options?.length ? { options: q.options.slice(0, 150) } : {}),
        })),
        page_url: clip(outcome.pageUrl, 2048),
        filled: outcome.filled,
      }
    case 'failed':
      return { status: 'failed', message: clip(outcome.message, 500), filled: outcome.filled, ...(outcome.pageUrl ? { page_url: clip(outcome.pageUrl, 2048) } : {}) }
    case 'released':
      return { status: 'released' }
  }
}

function isFinalRejection(err: unknown): boolean {
  // The application moved on (cancelled in the dashboard, already submitted…)
  // or the report itself is invalid: retrying cannot help.
  return err instanceof ApiError && (err.code === 'NOT_CLAIMABLE' || err.status === 404 || err.status === 400)
}

/**
 * Results go through an outbox in session storage: the report is persisted
 * together with the state change, then sent. A service-worker restart in
 * between re-sends it instead of losing it (or re-running the form).
 */
async function sendPending(appId: string, tries: number): Promise<boolean> {
  for (let attempt = 0; attempt < tries; attempt++) {
    const pending = state.pendingReports.find((p) => p.appId === appId)
    if (!pending) return true
    let done = false
    try {
      await agentApi.result(appId, pending.report)
      done = true
    } catch (err) {
      done = isFinalRejection(err)
      if (done) log.warn('result not accepted', { code: (err as ApiError).code, status: pending.report.status })
      if (isSignedOutError(err)) return false
    }
    await mutate((s) => {
      const entry = s.pendingReports.find((p) => p.appId === appId)
      if (!entry) return
      entry.attempts += 1
      if (done || entry.attempts >= MAX_PENDING_REPORT_ATTEMPTS) s.pendingReports = s.pendingReports.filter((p) => p !== entry)
    })
    if (done) return true
    if (attempt < tries - 1) await sleep(1000 * (attempt + 1))
  }
  return false
}

async function deliverReport(appId: string, report: ResultReport): Promise<boolean> {
  await mutate((s) => {
    s.pendingReports = [...s.pendingReports.filter((p) => p.appId !== appId), { appId, report, attempts: 0, firstAt: Date.now() }]
  })
  return sendPending(appId, 3)
}

async function flushPendingReports(): Promise<void> {
  for (const pending of [...state.pendingReports]) await sendPending(pending.appId, 1)
}

function pushRecent(s: RunnerState, run: ActiveRun, status: 'submitted' | 'needs_input' | 'failed' | 'released', message: string, reason?: NeedsReason): void {
  s.recent = [
    { appId: run.appId, title: run.title, company: run.company, status, ...(reason ? { reason } : {}), message: clip(message, 300), at: Date.now() },
    ...s.recent.filter((r) => r.appId !== run.appId),
  ].slice(0, RECENT_LIMIT)
}

async function finishRun(run: ActiveRun, outcome: FlowOutcome): Promise<void> {
  if (finishing.has(run.runId)) return
  finishing.add(run.runId)
  try {
    const auto = run.mode === 'auto'
    // Manual sessions only report "needs you" (which takes the job out of the
    // queue); a failed manual fill must not mark the user's application failed.
    const report = auto || outcome.status === 'needs_input' ? toReport(outcome) : null
    const message = outcome.status === 'submitted' ? outcome.message || 'Submitted' : outcome.message
    await mutate((s) => {
      const last = run.steps[run.steps.length - 1]
      if (last?.state === 'active') last.state = outcome.status === 'failed' ? 'error' : 'done'
      if (s.current?.runId === run.runId) s.current = null
      s.manual = s.manual.filter((r) => r.runId !== run.runId)
      if (report) {
        s.pendingReports = [...s.pendingReports.filter((p) => p.appId !== run.appId), { appId: run.appId, report, attempts: 0, firstAt: Date.now() }]
      }
      if (outcome.status === 'needs_input' && run.tabId != null) {
        const watch: WatchEntry = {
          tabId: run.tabId,
          appId: run.appId,
          title: run.title,
          company: run.company,
          reason: outcome.reason,
          pageUrl: outcome.pageUrl,
          since: Date.now(),
          mode: run.mode,
        }
        s.watches = [...s.watches.filter((w) => w.tabId !== run.tabId && w.appId !== run.appId), watch]
      }
      pushRecent(s, run, outcome.status, message, outcome.status === 'needs_input' ? outcome.reason : undefined)
      if (auto && s.tick) {
        if (outcome.status === 'released') {
          // Handing a claim back means something is wrong right now (no AI
          // key, rate limit, stopped by the user): stop this tick.
          s.lastTick = {
            at: Date.now(),
            trigger: s.tick.trigger,
            processed: s.tick.processed,
            outcome: outcome.cause === 'stopped' ? 'stopped' : 'error',
            message: clip(outcome.message, 300),
          }
          s.tick = null
        } else {
          s.tick.processed += 1
        }
      }
    })
    for (const key of [...fileCache.keys()]) if (key.startsWith(`${run.runId}:`)) fileCache.delete(key)
    if (report) await sendPending(run.appId, 3)

    if (auto && run.tabId != null && outcome.status !== 'needs_input') await closeTab(run.tabId)
    if (auto && outcome.status === 'needs_input') void notifyNeedsInput(run.appId, run.title, run.company, outcome.reason)
    log.info('application finished', { status: outcome.status, mode: run.mode })
  } finally {
    finishing.delete(run.runId)
  }
  void advance()
}

// ── Origins ───────────────────────────────────────────────────────────────────

const KNOWN_ATS_HOST =
  /(^|\.)(greenhouse\.io|lever\.co|ashbyhq\.com|workable\.com|smartrecruiters\.com|recruitee\.com|bamboohr\.com|breezy\.hr|jobvite\.com|teamtailor\.com|personio\.(de|com)|rippling\.com|applytojob\.com|pinpointhq\.com)$/i

function siteOf(host: string): string {
  const parts = host.toLowerCase().split('.')
  if (parts.length <= 2) return parts.join('.')
  const last2 = parts.slice(-2).join('.')
  return /^(co|com|org|net|ac|gov|edu)\.[a-z]{2}$/.test(last2) ? parts.slice(-3).join('.') : last2
}

function relatedOrigin(run: ActiveRun, url: URL): boolean {
  if (KNOWN_ATS_HOST.test(url.hostname)) return true
  return run.allowedOrigins.some((o) => {
    try {
      return siteOf(new URL(o).hostname) === siteOf(url.hostname)
    } catch {
      return false
    }
  })
}

/**
 * Apply URLs redirect (http → https, boards.greenhouse.io → job-boards…).
 * Before the form is touched, a same-site or known-ATS origin is admitted.
 */
function admitRedirect(run: ActiveRun, pageUrl: string | undefined): void {
  if (!pageUrl || !isHttpUrl(pageUrl) || (run.phase !== 'opening' && run.phase !== 'filling') || run.filled > 0) return
  const url = new URL(pageUrl)
  if (!run.allowedOrigins.includes(url.origin) && relatedOrigin(run, url)) run.allowedOrigins.push(url.origin)
}

function hopAllowed(run: ActiveRun, target: string): string | null {
  if (!isHttpUrl(target) || run.hops >= MAX_HOPS) return null
  const url = new URL(target)
  return relatedOrigin(run, url) ? url.origin : null
}

// ── Content-script requests ───────────────────────────────────────────────────

export class FlowRequestError extends Error {
  readonly code: string
  constructor(code: string, message: string) {
    super(message)
    this.code = code
  }
}

function senderOrigin(sender: chrome.runtime.MessageSender): string | null {
  if (sender.origin && sender.origin !== 'null') return sender.origin
  return sender.url ? originOf(sender.url) : null
}

function authorize(runId: string, sender: chrome.runtime.MessageSender, opts: { sameOrigin?: boolean } = {}): ActiveRun {
  const run = findRun(runId)
  if (!run || run.tabId == null || sender.tab?.id !== run.tabId || sender.frameId !== 0) {
    throw new FlowRequestError('NOT_MANAGED', 'This tab is not running an Aethlara application.')
  }
  if (opts.sameOrigin) {
    const origin = senderOrigin(sender)
    if (!origin || !run.allowedOrigins.includes(origin)) {
      throw new FlowRequestError('ORIGIN_NOT_ALLOWED', 'The application moved to a site Aethlara did not open.')
    }
  }
  return run
}

export async function handleHello(sender: chrome.runtime.MessageSender): Promise<HelloReply> {
  await ensureLoaded()
  const tabId = sender.tab?.id
  if (tabId == null || sender.frameId !== 0) return { flow: null, watch: null }
  if (pendingTab) await pendingTab
  const run = activeRuns().find((r) => r.tabId === tabId)
  if (run) {
    await mutate(() => {
      run.helloAt = Date.now()
      admitRedirect(run, sender.url)
    })
    return { flow: toFlowJob(run), watch: null }
  }
  const watch = state.watches.find((w) => w.tabId === tabId)
  if (watch && Date.now() - watch.since < WATCH_TTL_MS) {
    return {
      flow: null,
      watch: { appId: watch.appId, title: watch.title, company: watch.company, reason: watch.reason, pageUrl: watch.pageUrl, since: watch.since },
    }
  }
  return { flow: null, watch: null }
}

const MAX_FIELD_ID = 120

function sanitizeFields(fields: FormField[]): FormField[] {
  const seen = new Set<string>()
  const out: FormField[] = []
  for (const f of fields.slice(0, 150)) {
    if (!f || typeof f.field_id !== 'string') continue
    const id = f.field_id.trim().slice(0, MAX_FIELD_ID)
    if (!id || seen.has(id)) continue
    seen.add(id)
    out.push({ ...f, field_id: id, label: String(f.label ?? '').slice(0, 500), type: String(f.type ?? 'text').slice(0, 40), required: !!f.required })
  }
  return out
}

export async function handleFill(runId: string, pageUrl: string, fields: FormField[], sender: chrome.runtime.MessageSender): Promise<FillResponse> {
  await ensureLoaded()
  const run = authorize(runId, sender, { sameOrigin: true })
  run.lastProgressAt = Date.now()
  const clean = sanitizeFields(fields)
  if (!clean.length) return { fills: [], missing: [] }
  const url = isHttpUrl(pageUrl) ? pageUrl.split('#')[0] : run.applyUrl
  return agentApi.fill(run.appId, { page_url: clip(url, 2048), fields: clean })
}

function toBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer)
  let binary = ''
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(binary)
}

const MIME_BY_EXT: Record<string, string> = {
  pdf: 'application/pdf',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  txt: 'text/plain',
  rtf: 'application/rtf',
}

export async function handleFile(runId: string, kind: 'resume' | 'cover_letter', sender: chrome.runtime.MessageSender): Promise<FilePayload> {
  await ensureLoaded()
  const run = authorize(runId, sender, { sameOrigin: true })
  const path = kind === 'resume' ? run.resumePath : run.coverLetterPath
  if (!path) return { ok: false, error: 'no cover letter for this application' }
  const key = `${run.runId}:${kind}`
  const cached = fileCache.get(key)
  if (cached) return cached
  let payload: FilePayload
  try {
    const file = await downloadFile(path)
    const fallbackName = (kind === 'resume' ? run.resumeFilename : run.coverLetterFilename) || (kind === 'resume' ? 'Resume.pdf' : 'Cover_Letter.pdf')
    const headerName = file.filename && /\.[a-z0-9]{2,5}$/i.test(file.filename) ? file.filename : null
    const filename = headerName ?? fallbackName
    const ext = filename.split('.').pop()?.toLowerCase() ?? ''
    const mime = file.contentType && file.contentType !== 'application/octet-stream' ? file.contentType : MIME_BY_EXT[ext] ?? 'application/octet-stream'
    payload = { ok: true, base64: toBase64(file.bytes), filename, mime }
  } catch (err) {
    log.warn('file download failed', { kind, err: errorKind(err) })
    const reason = err instanceof ApiError ? (err.status ? `HTTP ${err.status}` : err.code) : 'download failed'
    payload = { ok: false, error: reason }
  }
  fileCache.set(key, payload)
  return payload
}

export async function handleVerifications(runId: string, sender: chrome.runtime.MessageSender): Promise<Verification[]> {
  await ensureLoaded()
  const run = authorize(runId, sender)
  run.lastProgressAt = Date.now() // polling counts as activity for the watchdog
  return agentApi.verifications(run.verificationSince)
}

export async function handleProgress(runId: string, update: FlowProgressUpdate, sender: chrome.runtime.MessageSender): Promise<{ ok: true }> {
  await ensureLoaded()
  const run = authorize(runId, sender)
  let hopError: FlowRequestError | null = null
  await mutate(() => {
    if (update.hopTo) {
      const origin = hopAllowed(run, update.hopTo)
      if (!origin) {
        hopError = new FlowRequestError('HOP_NOT_ALLOWED', 'That page is outside the application site.')
        return
      }
      if (!run.allowedOrigins.includes(origin)) run.allowedOrigins.push(origin)
      run.hops += 1
      run.helloAt = null
    }
    if (update.phase) run.phase = update.phase
    if (typeof update.step === 'number') run.step = Math.max(0, Math.min(10, update.step))
    if (typeof update.filled === 'number') run.filled = update.filled
    if (typeof update.submitAttempts === 'number') run.submitAttempts = update.submitAttempts
    if (typeof update.correctivePasses === 'number') run.correctivePasses = update.correctivePasses
    if (update.baselineUrl !== undefined) run.baselineUrl = update.baselineUrl
    if (update.label) pushStep(run, update.label, update.tone === 'warn' ? 'warn' : 'info')
    if (update.phase === 'verifying' && !run.deadlineExtended) {
      run.deadline = Math.max(run.deadline, Date.now() + VERIFICATION_EXTENSION_MS)
      run.deadlineExtended = true
    }
    run.lastProgressAt = Date.now()
  })
  if (hopError) throw hopError
  return { ok: true }
}

export async function handleResult(runId: string, outcome: FlowOutcome, sender: chrome.runtime.MessageSender): Promise<{ ok: true }> {
  await ensureLoaded()
  const run = authorize(runId, sender)
  await finishRun(run, outcome)
  return { ok: true }
}

export async function handleWatchConfirmed(appId: string, url: string, message: string, sender: chrome.runtime.MessageSender): Promise<{ ok: true }> {
  await ensureLoaded()
  const watch = state.watches.find((w) => w.tabId === sender.tab?.id && w.appId === appId)
  if (!watch) throw new FlowRequestError('NOT_MANAGED', 'This tab is not being watched.')
  await deliverReport(appId, { status: 'submitted', final_url: clip(isHttpUrl(url) ? url : '', 2048), message: clip(message, 1000) })
  await mutate((s) => {
    s.watches = s.watches.filter((w) => w !== watch)
    s.recent = [
      { appId, title: watch.title, company: watch.company, status: 'submitted' as const, message: clip(message || 'Submitted by you', 300), at: Date.now() },
      ...s.recent.filter((r) => r.appId !== appId),
    ].slice(0, RECENT_LIMIT)
  })
  void clearNeedsNotification(appId)
  return { ok: true }
}

// ── Side panel commands ───────────────────────────────────────────────────────

export async function stopCurrent(): Promise<boolean> {
  await ensureLoaded()
  const run = state.current
  if (!run) {
    if (state.tick) await endTick('stopped')
    return false
  }
  if (run.tabId != null) void sendToTab(run.tabId, { type: 'FLOW_ABORT', runId: run.runId }, 3000).catch(() => undefined)
  await finishRun(run, { status: 'released', message: 'Stopped from the side panel.', cause: 'stopped' })
  return true
}

export async function startManualFill(tabId: number, appId: string): Promise<{ started: true }> {
  await ensureLoaded()
  if (!(await isSignedIn())) throw new FlowRequestError('SIGNED_OUT', 'Connect the extension first.')
  if (activeRuns().some((r) => r.tabId === tabId)) throw new FlowRequestError('BUSY', 'Aethlara is already working in this tab.')
  if (state.current?.appId === appId) throw new FlowRequestError('BUSY', 'The autopilot is applying to this job right now.')
  const tab = await getTab(tabId)
  if (!tab || !isHttpUrl(tab.url)) throw new FlowRequestError('BAD_TAB', 'Open the application form in a normal web page first.')
  if (!(await ensureContentScript(tabId))) {
    throw new FlowRequestError('NO_CONTENT_SCRIPT', 'Reload the page, then try again.')
  }
  let packet = await agentApi.packet(appId)
  if (packet.application.status === 'failed') {
    await agentApi.retry(appId)
    packet = await agentApi.packet(appId)
  }
  if (packet.application.status !== 'ready' && packet.application.status !== 'needs_input') {
    throw new FlowRequestError('BAD_STATUS', `This application is ${packet.application.status.replace('_', ' ')} and can't be filled now.`)
  }
  const run = makeRun(packet, 'manual', tabId, tab.url)
  pushStep(run, 'Filling the form in this tab')
  await mutate((s) => {
    s.manual = [...s.manual.filter((r) => r.tabId !== tabId), run]
    s.watches = s.watches.filter((w) => w.tabId !== tabId)
  })
  try {
    await sendToTab(tabId, { type: 'FLOW_START', job: toFlowJob(run) }, 5000)
  } catch {
    await mutate((s) => {
      s.manual = s.manual.filter((r) => r.runId !== run.runId)
    })
    throw new FlowRequestError('NO_CONTENT_SCRIPT', 'Reload the page, then try again.')
  }
  return { started: true }
}

// ── Lifecycle ─────────────────────────────────────────────────────────────────

export async function syncTickAlarm(settings?: ExtSettings): Promise<void> {
  const s = settings ?? (await settingsStore.get())
  if (s.autopilot && (await isSignedIn())) {
    const existing = await chrome.alarms.get(ALARM_TICK)
    if (!existing || existing.periodInMinutes !== s.intervalMinutes) {
      await chrome.alarms.create(ALARM_TICK, { periodInMinutes: s.intervalMinutes, delayInMinutes: s.intervalMinutes })
    }
  } else {
    await chrome.alarms.clear(ALARM_TICK)
  }
}

export async function onSettingsChanged(next: ExtSettings, previous: ExtSettings | null): Promise<void> {
  await syncTickAlarm(next)
  if (next.autopilot && !previous?.autopilot) void requestTick('alarm')
}

export async function onAlarm(name: string): Promise<void> {
  await ensureLoaded()
  if (name === ALARM_TICK) {
    void requestTick('alarm')
  } else if (name === ALARM_DEADLINE) {
    await checkDeadlines()
  } else if (name === ALARM_WATCHDOG) {
    await checkDeadlines()
    await recover()
    if (state.tick && !state.current) void advance()
  }
}

export async function onTabRemoved(tabId: number): Promise<void> {
  await ensureLoaded()
  for (const run of activeRuns()) {
    if (run.tabId !== tabId) continue
    if (run.mode === 'auto') {
      await finishRun(run, {
        status: 'needs_input',
        reason: 'review',
        message: 'The application tab was closed before it finished. Retry it, or open it to finish yourself.',
        pageUrl: run.applyUrl,
        filled: run.filled,
      })
    } else {
      await mutate((s) => {
        s.manual = s.manual.filter((r) => r.runId !== run.runId)
      })
    }
  }
  if (state.watches.some((w) => w.tabId === tabId)) {
    await mutate((s) => {
      s.watches = s.watches.filter((w) => w.tabId !== tabId)
    })
  }
}

/** After a service-worker restart: reconcile runs and watches with the open tabs. */
async function recover(): Promise<void> {
  for (const run of activeRuns()) {
    if (finishing.has(run.runId)) continue
    if (run.tabId == null) {
      if (pendingTab || Date.now() - run.startedAt < 30_000) continue
      // Claimed, but the tab was never opened: hand the claim back.
      if (run.mode === 'auto') await finishRun(run, { status: 'released', message: 'Interrupted before the tab opened.', cause: 'error' })
      else await mutate((s) => (s.manual = s.manual.filter((r) => r.runId !== run.runId)))
      continue
    }
    const tab = await getTab(run.tabId)
    if (!tab) {
      await onTabRemoved(run.tabId)
      continue
    }
    const ping = await pingTab(run.tabId)
    if (!ping.alive || ping.runId !== run.runId) {
      // The content script lost track (or never started): resume it from the persisted phase.
      if (Date.now() - run.lastProgressAt > 15_000) void kick(run.runId)
    }
  }
  const watches = state.watches
  const alive: WatchEntry[] = []
  for (const w of watches) {
    if (Date.now() - w.since > WATCH_TTL_MS) continue
    if (await getTab(w.tabId)) alive.push(w)
  }
  if (alive.length !== watches.length) await mutate((s) => (s.watches = alive))
}

export async function initRunner(): Promise<void> {
  await ensureLoaded()
  syncTimers()
  await syncTickAlarm()
  await recover()
  if (state.pendingReports.length && (await isSignedIn())) await flushPendingReports()
  if (state.tick && !state.current) void advance()
}

/** The device was revoked or the user signed out: stop everything locally. */
export async function onSignedOut(): Promise<void> {
  await ensureLoaded()
  for (const run of activeRuns()) {
    if (run.tabId != null) {
      void sendToTab(run.tabId, { type: 'FLOW_ABORT', runId: run.runId }, 3000).catch(() => undefined)
      if (run.mode === 'auto') void closeTab(run.tabId)
    }
  }
  fileCache.clear()
  await mutate((s) => {
    s.tick = null
    s.current = null
    s.manual = []
    s.watches = []
    s.pendingReports = []
  })
  await chrome.alarms.clear(ALARM_TICK)
}

/** Before a user sign-out: give claims back while we still have a token. */
export async function releaseAll(): Promise<void> {
  await ensureLoaded()
  const run = state.current
  if (run) {
    if (run.tabId != null) void sendToTab(run.tabId, { type: 'FLOW_ABORT', runId: run.runId }, 3000).catch(() => undefined)
    await finishRun(run, { status: 'released', message: 'Signed out.', cause: 'signed_out' })
  }
  await flushPendingReports()
}
