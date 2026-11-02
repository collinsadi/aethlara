import { adapterFor } from './adapters'
import { callBackground } from './bridge'
import { detectAts, detectLoginWall, findBestFormRoot, looksLikeJobPosting } from './detect'
import { extractPageText } from './extractor'
import { prioritise, toFormField, type ScannedField } from './fields'
import { fillField } from './filler'
import { abortFlow, activeJob, activeRunId, startFlow } from './flow'
import { askToFill } from './overlay'
import { scanForm } from './scanner'
import { startWatch } from './watch'
import { EXTENSION_TOKEN_PARAM } from '@/lib/config'
import { randomId } from '@/lib/util'
import type { ContentReplies, ContentRequest, LegacyFillSummary, LegacyScannedField, PageInfo } from '@/types'

/**
 * Content script (top frame of every http(s) page)
 *  - relays the dashboard handshake token to the service worker
 *  - runs autopilot applications in tabs the service worker manages
 *  - answers side-panel questions about the page (job posting? form?)
 *  - the saved-job autofill with an explicit consent bar
 * It never calls the Aethlara API itself and never sees tokens.
 */

const isTopFrame = window.top === window
const isWebPage = /^https?:$/.test(location.protocol)

// ── Dashboard handshake ───────────────────────────────────────────────────────

function relayHandshake(): void {
  try {
    if (!location.pathname.endsWith('/extension-handshake')) return
    const token = new URLSearchParams(location.search).get(EXTENSION_TOKEN_PARAM)
    if (!token || !/^[A-Za-z0-9._~-]{16,512}$/.test(token)) return
    // The background checks that this page is on the dashboard origin.
    void callBackground({ type: 'AUTH_HANDSHAKE', extToken: token }, 2).catch(() => undefined)
  } catch {
    // never break the page
  }
}

// ── Autopilot pick-up after navigation ───────────────────────────────────────

async function hello(): Promise<void> {
  try {
    const reply = await callBackground({ type: 'FLOW_HELLO', url: location.href }, 1)
    if (reply.flow) startFlow(reply.flow)
    else if (reply.watch) startWatch(reply.watch)
  } catch {
    // extension reloading or not signed in: nothing to do on this page
  }
}

// ── Side panel: page info & saved-job autofill ───────────────────────────────

const legacyScans = new Map<string, ScannedField[]>()

async function pageInfo(): Promise<PageInfo> {
  const adapter = adapterFor(location.href)
  const root = adapter.findForm() ?? findBestFormRoot()
  let fieldCount = 0
  let hasResume = false
  let identity = false
  if (root) {
    const fields = await scanForm(root, { skip: adapter.skip?.bind(adapter) })
    fieldCount = fields.length
    hasResume = fields.some((f) => f.handle.kind === 'file' && f.handle.fileRole === 'resume')
    identity = fields.some((f) => /\b(name|e-?mail|phone)\b/i.test(`${f.label} ${f.name} ${f.inputType}`))
  }
  const job = activeJob()
  return {
    url: location.href,
    title: document.title,
    ats: detectAts(location.href),
    isJobPosting: looksLikeJobPosting(),
    isApplicationForm: fieldCount >= 2 && (hasResume || (identity && fieldCount >= 3)),
    fieldCount,
    hasResumeField: hasResume,
    loginWall: detectLoginWall(),
    managed: job ? { mode: job.mode } : null,
  }
}

async function legacyScan(): Promise<{ scanId: string; fields: LegacyScannedField[] }> {
  const adapter = adapterFor(location.href)
  const root = adapter.findForm() ?? findBestFormRoot() ?? document.body
  const scanned = await scanForm(root, { readComboOptions: true, excludeFiles: true, skip: adapter.skip?.bind(adapter) })
  const fields = prioritise(scanned, 100)
  const scanId = randomId(8)
  legacyScans.set(scanId, fields)
  while (legacyScans.size > 3) legacyScans.delete(legacyScans.keys().next().value as string)
  return {
    scanId,
    fields: fields.map((f) => {
      const ff = toFormField(f)
      return {
        field_id: ff.field_id,
        label: ff.label,
        type: ff.type,
        placeholder: ff.placeholder ?? null,
        required: ff.required,
        options: ff.options ?? null,
      }
    }),
  }
}

async function legacyFill(scanId: string, fills: Record<string, string | null>): Promise<LegacyFillSummary> {
  const fields = legacyScans.get(scanId)
  if (!fields) throw new Error('The page changed since it was scanned. Scan it again.')
  const toFill = fields.filter((f) => typeof fills[f.id] === 'string' && fills[f.id]!.trim() !== '')
  if (!toFill.length) return { filled: 0, skipped: fields.length, failed: [] }
  const confirmed = await askToFill(toFill.length)
  if (!confirmed) return { filled: 0, skipped: toFill.length, failed: [], cancelled: true }
  let filled = 0
  const failed: string[] = []
  for (const f of toFill) {
    try {
      if (await fillField(f, fills[f.id]!)) filled++
      else failed.push(f.id)
    } catch {
      failed.push(f.id)
    }
  }
  return { filled, skipped: fields.length - toFill.length, failed }
}

// ── Message handling ──────────────────────────────────────────────────────────

const REQUEST_TYPES = new Set<ContentRequest['type']>([
  'PING',
  'FLOW_START',
  'FLOW_ABORT',
  'WATCH_START',
  'PAGE_INFO',
  'EXTRACT_TEXT',
  'LEGACY_SCAN',
  'LEGACY_FILL',
])

function isRequest(message: unknown): message is ContentRequest {
  return (
    typeof message === 'object' &&
    message !== null &&
    REQUEST_TYPES.has((message as { type?: ContentRequest['type'] }).type as ContentRequest['type'])
  )
}

async function handle(message: ContentRequest): Promise<ContentReplies[ContentRequest['type']]> {
  switch (message.type) {
    case 'PING':
      return { alive: true, runId: activeRunId() }
    case 'FLOW_START':
      return { accepted: startFlow(message.job) }
    case 'FLOW_ABORT':
      return { aborted: abortFlow(message.runId) }
    case 'WATCH_START':
      return { watching: startWatch(message.watch) }
    case 'PAGE_INFO':
      return pageInfo()
    case 'EXTRACT_TEXT':
      return { text: extractPageText() }
    case 'LEGACY_SCAN':
      return legacyScan()
    case 'LEGACY_FILL':
      return legacyFill(message.scanId, message.fills)
  }
}

if (isTopFrame) {
  chrome.runtime.onMessage.addListener((message: unknown, sender, sendResponse) => {
    // Only our own extension (service worker / side panel) may drive this script.
    if (sender.id !== chrome.runtime.id || !isRequest(message)) return false
    handle(message).then(
      (data) => sendResponse({ ok: true, data }),
      (err: unknown) => sendResponse({ ok: false, error: err instanceof Error ? err.message : 'Content script error' }),
    )
    return true
  })

  if (isWebPage) {
    relayHandshake()
    void hello()
  }
}
