import { API_BASE_URL } from '@/lib/config'
import { authStore, connectStore, type AccessToken, type DeviceAuth } from '@/lib/storage'
import { createLogger } from '@/lib/log'
import { sleep } from '@/lib/util'
import type { ApiUser, ExtensionAuthResponse } from '@/types'

/**
 * Extension authentication
 * ------------------------
 * The dashboard handshake gives us a single-use ext_token. Exchanging it
 * returns a short-lived access token (15 min) and a long-lived *device token*
 * that rotates on every refresh (POST /auth/extension/refresh).
 *
 *   device token  → chrome.storage.local   (survives restarts)
 *   access token  → chrome.storage.session (memory only)
 *
 * This module is shared by the service worker and the side panel. Refreshes
 * are single-flight inside a context (one shared promise) and serialised
 * across contexts with the Web Locks API, so two contexts never spend the same
 * device token: the second one re-reads storage after acquiring the lock and
 * finds the fresh token. Reusing an old device token after the server's
 * 2-minute grace window revokes the device, so this matters.
 */

const log = createLogger('auth')

/** Refresh this long before the access token expires. */
const REFRESH_SKEW_MS = 60_000
const LOCK_NAME = 'aethlara-auth-refresh'
const REQUEST_TIMEOUT_MS = 20_000

export class AuthError extends Error {
  /** signed_out: the device is gone, show the sign-in screen. transient: retry later. */
  readonly kind: 'signed_out' | 'transient'
  readonly code?: string
  constructor(kind: 'signed_out' | 'transient', message: string, code?: string) {
    super(message)
    this.name = 'AuthError'
    this.kind = kind
    this.code = code
  }
}

function isFresh(access: AccessToken | null): access is AccessToken {
  return !!access && access.expiresAt - Date.now() > REFRESH_SKEW_MS
}

/** A human label for this browser, sent as device_name ("Chrome on macOS"). */
export function deviceName(): string {
  type UAData = { platform?: string; brands?: { brand: string }[] }
  const uaData = (navigator as Navigator & { userAgentData?: UAData }).userAgentData
  const ua = navigator.userAgent || ''

  let browser = 'Chrome'
  const brands = (uaData?.brands ?? []).map((b) => b.brand)
  if (brands.some((b) => /edge/i.test(b)) || /Edg\//.test(ua)) browser = 'Edge'
  else if (brands.some((b) => /brave/i.test(b))) browser = 'Brave'
  else if (brands.some((b) => /opera/i.test(b)) || /OPR\//.test(ua)) browser = 'Opera'

  let platform = uaData?.platform || ''
  if (!platform) {
    if (/Mac OS X|Macintosh/.test(ua)) platform = 'macOS'
    else if (/Windows/.test(ua)) platform = 'Windows'
    else if (/CrOS/.test(ua)) platform = 'ChromeOS'
    else if (/Linux/.test(ua)) platform = 'Linux'
  }
  if (platform === 'Chrome OS') platform = 'ChromeOS'
  return platform ? `${browser} on ${platform}` : browser
}

async function postJson(path: string, body: unknown, bearer?: string): Promise<{ status: number; json: unknown }> {
  const res = await fetch(`${API_BASE_URL}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(bearer ? { Authorization: `Bearer ${bearer}` } : {}),
    },
    body: JSON.stringify(body),
    credentials: 'omit',
    cache: 'no-store',
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  })
  let json: unknown = null
  try {
    json = await res.json()
  } catch {
    json = null
  }
  return { status: res.status, json }
}

function authPayload(json: unknown): ExtensionAuthResponse | null {
  const data = (json as { data?: Partial<ExtensionAuthResponse> } | null)?.data
  if (
    !data ||
    typeof data.access_token !== 'string' ||
    typeof data.device_token !== 'string' ||
    typeof data.device_id !== 'string' ||
    !data.user
  ) {
    return null
  }
  return data as ExtensionAuthResponse
}

function errorCode(json: unknown): string | undefined {
  const code = (json as { error?: { code?: unknown } } | null)?.error?.code
  return typeof code === 'string' ? code : undefined
}

async function persist(data: ExtensionAuthResponse, connectedAt?: number): Promise<string> {
  // The rotated device token is written first: losing it means the next
  // refresh replays an old token, which the server treats as theft.
  const device: DeviceAuth = {
    deviceId: data.device_id,
    deviceToken: data.device_token,
    user: { id: data.user.id, full_name: data.user.full_name ?? '', email: data.user.email ?? '' },
    connectedAt: connectedAt ?? Date.now(),
  }
  await authStore.setDevice(device)
  const parsed = Date.parse(data.expires_at)
  const expiresAt = Number.isFinite(parsed) ? parsed : Date.now() + 10 * 60_000
  await authStore.setAccess({ token: data.access_token, expiresAt, deviceId: data.device_id })
  return data.access_token
}

async function withRefreshLock<T>(fn: () => Promise<T>): Promise<T> {
  const locks = (globalThis.navigator as Navigator | undefined)?.locks
  if (locks && typeof locks.request === 'function') {
    return locks.request(LOCK_NAME, { mode: 'exclusive' }, fn) as Promise<T>
  }
  return fn()
}

let inflight: Promise<string> | null = null

/**
 * Returns a valid access token, refreshing it when it expires within 60s.
 * With `rejectedToken`, the caller got a 401 using that token: a refresh is
 * forced unless another caller already replaced it.
 */
export async function getAccessToken(opts: { rejectedToken?: string } = {}): Promise<string> {
  const access = await authStore.getAccess()
  if (isFresh(access) && access.token !== opts.rejectedToken) return access.token
  if (!inflight) {
    inflight = withRefreshLock(() => refreshLocked(opts.rejectedToken)).finally(() => {
      inflight = null
    })
  }
  return inflight
}

async function refreshLocked(rejectedToken?: string): Promise<string> {
  // Another context may have refreshed while we waited for the lock.
  const current = await authStore.getAccess()
  if (isFresh(current) && current.token !== rejectedToken) return current.token

  let device = await authStore.getDevice()
  if (!device) throw new AuthError('signed_out', 'This browser is not connected to Aethlara.')

  for (let attempt = 0; attempt < 2; attempt++) {
    let status: number
    let json: unknown
    try {
      ;({ status, json } = await postJson('/auth/extension/refresh', { device_token: device.deviceToken }))
    } catch {
      throw new AuthError('transient', 'Could not reach Aethlara to refresh the session.', 'NETWORK')
    }

    const data = status === 200 ? authPayload(json) : null
    if (data) {
      log.debug('refreshed', { attempt })
      return persist(data, device.connectedAt)
    }

    const code = errorCode(json)
    if (code === 'DEVICE_TOKEN_ROTATED' && attempt === 0) {
      // Someone else (another extension context) rotated it a moment ago:
      // re-read storage and use what they stored, or retry once with it.
      await sleep(400)
      const latestAccess = await authStore.getAccess()
      if (isFresh(latestAccess) && latestAccess.token !== rejectedToken) return latestAccess.token
      const latestDevice = await authStore.getDevice()
      if (!latestDevice) throw new AuthError('signed_out', 'This browser is not connected to Aethlara.')
      device = latestDevice
      continue
    }
    if (code === 'DEVICE_TOKEN_ROTATED') {
      throw new AuthError('transient', 'The session is being refreshed elsewhere. Try again.', code)
    }
    if (code === 'DEVICE_REVOKED' || status === 401 || status === 400) {
      log.warn('device revoked', { status })
      await clearAuth()
      throw new AuthError('signed_out', 'This extension was disconnected. Connect it again from the dashboard.', 'DEVICE_REVOKED')
    }
    throw new AuthError('transient', `Session refresh failed (HTTP ${status}).`, code ?? `HTTP_${status}`)
  }
  throw new AuthError('transient', 'Session refresh failed.')
}

/** Exchange a dashboard handshake token for a device credential. */
export async function connectWithHandshake(extToken: string): Promise<ApiUser> {
  const previous = await authStore.getDevice()
  await connectStore.set({ state: 'connecting', at: Date.now() })
  let status: number
  let json: unknown
  try {
    ;({ status, json } = await postJson('/auth/extension-token/exchange', {
      ext_token: extToken,
      device_name: deviceName(),
    }))
  } catch {
    await connectStore.set({ state: 'error', message: 'Could not reach Aethlara. Check your connection and try again.', at: Date.now() })
    throw new AuthError('transient', 'Network error during the handshake.', 'NETWORK')
  }
  const data = status === 200 ? authPayload(json) : null
  if (!data) {
    const message =
      status === 401
        ? 'That connect link expired or was already used. Click "Connect extension" in the dashboard again.'
        : status === 429
          ? 'Too many connection attempts. Wait a minute and try again.'
          : `Connecting failed (HTTP ${status}).`
    await connectStore.set({ state: 'error', message, at: Date.now() })
    throw new AuthError('transient', message, errorCode(json))
  }
  await inflightSafeReplace(data)
  await connectStore.set({ state: 'connected', at: Date.now() })

  // Reconnecting creates a new device; retire the one this browser used before.
  if (previous && previous.deviceId !== data.device_id && previous.user.id === data.user.id) {
    void revokeDevice(previous.deviceId, data.access_token)
  }
  return data.user
}

async function inflightSafeReplace(data: ExtensionAuthResponse): Promise<void> {
  await withRefreshLock(async () => {
    await persist(data)
  })
}

async function revokeDevice(deviceId: string, accessToken: string): Promise<void> {
  try {
    await fetch(`${API_BASE_URL}/auth/extension/devices/${encodeURIComponent(deviceId)}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${accessToken}` },
      credentials: 'omit',
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    })
  } catch {
    // Best effort: the server also caps devices per user.
  }
}

export async function clearAuth(): Promise<void> {
  await authStore.clear()
}

/**
 * User-initiated sign out: disconnect this device on the server (best effort)
 * so the stored device token stops working, then forget everything locally.
 */
export async function signOutDevice(): Promise<void> {
  const device = await authStore.getDevice()
  if (device) {
    try {
      const token = await getAccessToken()
      await revokeDevice(device.deviceId, token)
    } catch {
      // Offline or already revoked: local sign-out still happens.
    }
  }
  await clearAuth()
}

export async function getSignedInUser(): Promise<ApiUser | null> {
  const device = await authStore.getDevice()
  return device?.user ?? null
}
