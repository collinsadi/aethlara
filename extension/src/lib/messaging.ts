import type {
  BgReplies,
  BgRequest,
  BgResponse,
  ContentReplies,
  ContentRequest,
  ContentResponse,
} from '@/types'

export class MessageError extends Error {
  readonly code?: string
  constructor(message: string, code?: string) {
    super(message)
    this.name = 'MessageError'
    this.code = code
  }
}

export class MessageTimeoutError extends Error {
  constructor(type: string) {
    super(`No reply to ${type} in time`)
    this.name = 'MessageTimeoutError'
  }
}

/**
 * Chrome does not always settle a sendMessage promise when the service worker
 * is terminated mid-reply; every call that matters gets a deadline.
 */
export function withTimeout<T>(promise: Promise<T>, ms: number, type: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new MessageTimeoutError(type)), ms)
    promise.then(
      (value) => {
        clearTimeout(timer)
        resolve(value)
      },
      (err: unknown) => {
        clearTimeout(timer)
        reject(err)
      },
    )
  })
}

/** True for errors Chrome raises while the service worker (re)starts or a page unloads. */
export function isTransientMessagingError(err: unknown): boolean {
  if (err instanceof MessageTimeoutError) return true
  const msg = err instanceof Error ? err.message : String(err)
  return (
    /Could not establish connection/i.test(msg) ||
    /Receiving end does not exist/i.test(msg) ||
    /message port closed/i.test(msg) ||
    /message channel closed/i.test(msg)
  )
}

export function isContextInvalidated(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err)
  return /Extension context invalidated/i.test(msg)
}

function unwrap<T>(response: unknown): T {
  const r = response as BgResponse<T> | undefined
  if (!r || typeof r !== 'object' || !('ok' in r)) {
    throw new MessageError('No response from the extension', 'NO_RESPONSE')
  }
  if (!r.ok) throw new MessageError(r.error, r.code)
  return r.data
}

/** Send a request to the background service worker and unwrap its reply. */
export async function sendToBackground<K extends BgRequest['type']>(
  message: Extract<BgRequest, { type: K }>,
  timeoutMs?: number,
): Promise<BgReplies[K]> {
  const pending = chrome.runtime.sendMessage(message) as Promise<unknown>
  const response = timeoutMs ? await withTimeout(pending, timeoutMs, message.type) : await pending
  return unwrap<BgReplies[K]>(response)
}

/** Send a request to the content script of a tab (top frame) and unwrap its reply. */
export async function sendToTab<K extends ContentRequest['type']>(
  tabId: number,
  message: Extract<ContentRequest, { type: K }>,
  timeoutMs?: number,
): Promise<ContentReplies[K]> {
  const pending = chrome.tabs.sendMessage(tabId, message, { frameId: 0 }) as Promise<unknown>
  const response = timeoutMs ? await withTimeout(pending, timeoutMs, message.type) : await pending
  return unwrap<ContentReplies[K]>(response as ContentResponse<ContentReplies[K]>)
}
