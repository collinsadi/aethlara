import type { FormField, FillResponse, Verification } from './api'
import type {
  FlowJob,
  FlowOutcome,
  FlowProgressUpdate,
  LegacyFillSummary,
  LegacyScannedField,
  PageInfo,
  WatchInfo,
} from './runner'

/**
 * Runtime messages between the extension's contexts.
 *
 *  - BgRequest: sent to the service worker with chrome.runtime.sendMessage,
 *    either by our content scripts (`content`) or by extension pages such as
 *    the side panel (`page`). The background checks the sender class.
 *  - ContentRequest: sent to a tab's content script with chrome.tabs.sendMessage.
 *
 * Every reply is a BgResponse / ContentResponse envelope.
 */

export type BgRequest =
  // from content scripts
  | { type: 'AUTH_HANDSHAKE'; extToken: string }
  | { type: 'FLOW_HELLO'; url: string }
  | { type: 'FLOW_FILL'; runId: string; pageUrl: string; fields: FormField[] }
  | { type: 'FLOW_FILE'; runId: string; kind: 'resume' | 'cover_letter' }
  | { type: 'FLOW_VERIFICATIONS'; runId: string }
  | { type: 'FLOW_PROGRESS'; runId: string; update: FlowProgressUpdate }
  | { type: 'FLOW_RESULT'; runId: string; outcome: FlowOutcome }
  | { type: 'WATCH_CONFIRMED'; appId: string; url: string; message: string }
  // from extension pages
  | { type: 'RUNNER_APPLY_NOW' }
  | { type: 'RUNNER_STOP' }
  | { type: 'MANUAL_FILL'; tabId: number; appId: string }
  | { type: 'SIGN_OUT' }

export type BgRequestType = BgRequest['type']

export const CONTENT_TO_BG: ReadonlySet<BgRequestType> = new Set<BgRequestType>([
  'AUTH_HANDSHAKE',
  'FLOW_HELLO',
  'FLOW_FILL',
  'FLOW_FILE',
  'FLOW_VERIFICATIONS',
  'FLOW_PROGRESS',
  'FLOW_RESULT',
  'WATCH_CONFIRMED',
])

export const PAGE_TO_BG: ReadonlySet<BgRequestType> = new Set<BgRequestType>([
  'RUNNER_APPLY_NOW',
  'RUNNER_STOP',
  'MANUAL_FILL',
  'SIGN_OUT',
])

export type BgResponse<T = unknown> = { ok: true; data: T } | { ok: false; error: string; code?: string }

export interface HelloReply {
  flow: FlowJob | null
  watch: WatchInfo | null
}

/** Resume / cover letter bytes for a file field, base64 because runtime messages are JSON. */
export type FilePayload =
  | { ok: true; base64: string; filename: string; mime: string }
  | { ok: false; error: string }

export interface ApplyNowReply {
  started: boolean
  reason?: 'signed_out' | 'busy'
}

export interface BgReplies {
  AUTH_HANDSHAKE: { connected: true }
  FLOW_HELLO: HelloReply
  FLOW_FILL: FillResponse
  FLOW_FILE: FilePayload
  FLOW_VERIFICATIONS: Verification[]
  FLOW_PROGRESS: { ok: true }
  FLOW_RESULT: { ok: true }
  WATCH_CONFIRMED: { ok: true }
  RUNNER_APPLY_NOW: ApplyNowReply
  RUNNER_STOP: { stopped: boolean }
  MANUAL_FILL: { started: true }
  SIGN_OUT: { signedOut: true }
}

export type ContentRequest =
  | { type: 'PING' }
  | { type: 'FLOW_START'; job: FlowJob }
  | { type: 'FLOW_ABORT'; runId: string }
  | { type: 'WATCH_START'; watch: WatchInfo }
  | { type: 'PAGE_INFO' }
  | { type: 'EXTRACT_TEXT' }
  | { type: 'LEGACY_SCAN' }
  | { type: 'LEGACY_FILL'; scanId: string; fills: Record<string, string | null> }

export interface ContentReplies {
  PING: { alive: true; runId: string | null }
  FLOW_START: { accepted: boolean }
  FLOW_ABORT: { aborted: boolean }
  WATCH_START: { watching: boolean }
  PAGE_INFO: PageInfo
  EXTRACT_TEXT: { text: string }
  LEGACY_SCAN: { scanId: string; fields: LegacyScannedField[] }
  LEGACY_FILL: LegacyFillSummary
}

export type ContentResponse<T = unknown> = BgResponse<T>
