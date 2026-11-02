import {
  MessageError,
  isContextInvalidated,
  isTransientMessagingError,
  sendToBackground,
} from '@/lib/messaging'
import { sleep } from './dom'
import type { BgReplies, BgRequest } from '@/types'

/**
 * Content script → service worker calls. The content script never talks to
 * the API itself; the background does, with the user's token. Calls retry
 * when the service worker is restarting ("Receiving end does not exist").
 */

export class ExtensionGoneError extends Error {
  constructor() {
    super('The extension was reloaded or updated.')
    this.name = 'ExtensionGoneError'
  }
}

/** How long each request may take before it is treated as lost and retried. */
const TIMEOUT_MS: Record<BgRequest['type'], number> = {
  AUTH_HANDSHAKE: 30_000,
  FLOW_HELLO: 15_000,
  FLOW_FILL: 170_000, // AI-backed; the API client allows 150 s
  FLOW_FILE: 75_000,
  FLOW_VERIFICATIONS: 40_000,
  FLOW_PROGRESS: 15_000,
  FLOW_RESULT: 45_000,
  WATCH_CONFIRMED: 45_000,
  RUNNER_APPLY_NOW: 15_000,
  RUNNER_STOP: 15_000,
  MANUAL_FILL: 60_000,
  SIGN_OUT: 30_000,
}

export const FLOW_PORT = 'aethlara-flow'

/**
 * A long-lived port to the service worker. Chrome disconnects it the moment
 * the worker stops, which is the reliable signal that an in-flight request
 * will never be answered (its sendMessage promise can stay pending forever).
 */
let port: chrome.runtime.Port | null = null
const disconnectWaiters = new Set<() => void>()

function ensurePort(): chrome.runtime.Port | null {
  if (port) return port
  try {
    const p = chrome.runtime.connect({ name: FLOW_PORT })
    p.onDisconnect.addListener(() => {
      void chrome.runtime.lastError
      if (port === p) port = null
      for (const wake of [...disconnectWaiters]) wake()
    })
    port = p
  } catch {
    port = null
  }
  return port
}

class WorkerGoneError extends Error {
  constructor() {
    super('The service worker restarted (message channel closed)')
    this.name = 'WorkerGoneError'
  }
}

/** Requests made while a form is being worked; only these use the liveness port. */
const PORT_GUARDED = new Set<BgRequest['type']>(['FLOW_FILL', 'FLOW_FILE', 'FLOW_VERIFICATIONS', 'FLOW_PROGRESS', 'FLOW_RESULT'])

/** Closes the liveness port once this document has no flow running. */
export function releasePort(): void {
  const p = port
  port = null
  try {
    p?.disconnect()
  } catch {
    // already gone
  }
}

/** Rejects when the port drops (worker stopped) before the request settles. */
function untilDisconnect<T>(request: Promise<T>): Promise<T> {
  if (!ensurePort()) return request
  let wake: () => void = () => undefined
  const dropped = new Promise<never>((_, reject) => {
    wake = () => reject(new WorkerGoneError())
    disconnectWaiters.add(wake)
  })
  return Promise.race([request, dropped]).finally(() => disconnectWaiters.delete(wake))
}

export async function callBackground<K extends BgRequest['type']>(
  message: Extract<BgRequest, { type: K }>,
  retries = 3,
): Promise<BgReplies[K]> {
  for (let attempt = 0; ; attempt++) {
    try {
      const request = sendToBackground<K>(message, TIMEOUT_MS[message.type])
      return await (PORT_GUARDED.has(message.type) ? untilDisconnect(request) : request)
    } catch (err) {
      if (isContextInvalidated(err)) throw new ExtensionGoneError()
      const retryable =
        err instanceof WorkerGoneError || isTransientMessagingError(err) || (err instanceof MessageError && err.code === 'NO_RESPONSE')
      if (attempt < retries && retryable) {
        await sleep(600 * 2 ** attempt)
        continue
      }
      throw err
    }
  }
}

export function errorCode(err: unknown): string | undefined {
  return err instanceof MessageError ? err.code : undefined
}
