import type { ApiUser, ExtSettings, RunnerState } from '@/types'
import { DEFAULT_SETTINGS, EMPTY_RUNNER_STATE, MAX_INTERVAL_MINUTES, MIN_INTERVAL_MINUTES } from '@/types'

/**
 * Typed wrappers around chrome.storage.
 *
 *  local   (persists, survives browser restarts)
 *    aethlara.device    long-lived rotating device credential + user
 *    aethlara.settings  extension autopilot settings
 *  session (memory only, cleared when the browser closes; trusted contexts
 *           only — content scripts cannot read it)
 *    aethlara.access    short-lived access token
 *    aethlara.runner    autopilot runner state (written by the background)
 *    aethlara.connect   handshake status for the sign-in screen
 */

export const KEYS = {
  device: 'aethlara.device',
  settings: 'aethlara.settings',
  access: 'aethlara.access',
  runner: 'aethlara.runner',
  connect: 'aethlara.connect',
} as const

/** Keys written by extension v1 (15-minute sessions, no device token). */
const LEGACY_SESSION_KEYS = ['__ext_at', '__ext_u', '__ext_exp']

export interface DeviceAuth {
  deviceId: string
  deviceToken: string
  user: ApiUser
  connectedAt: number
}

export interface AccessToken {
  token: string
  /** epoch ms */
  expiresAt: number
  deviceId: string
}

export interface ConnectStatus {
  state: 'connecting' | 'connected' | 'error'
  message?: string
  at: number
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null
}

function parseDevice(v: unknown): DeviceAuth | null {
  if (!isObject(v)) return null
  const user = v.user
  if (typeof v.deviceId !== 'string' || typeof v.deviceToken !== 'string' || !v.deviceToken) return null
  if (!isObject(user) || typeof user.id !== 'string') return null
  return {
    deviceId: v.deviceId,
    deviceToken: v.deviceToken,
    user: {
      id: user.id,
      full_name: typeof user.full_name === 'string' ? user.full_name : '',
      email: typeof user.email === 'string' ? user.email : '',
    },
    connectedAt: typeof v.connectedAt === 'number' ? v.connectedAt : Date.now(),
  }
}

function parseAccess(v: unknown): AccessToken | null {
  if (!isObject(v)) return null
  if (typeof v.token !== 'string' || !v.token || typeof v.expiresAt !== 'number') return null
  return { token: v.token, expiresAt: v.expiresAt, deviceId: typeof v.deviceId === 'string' ? v.deviceId : '' }
}

export function normaliseSettings(v: unknown): ExtSettings {
  const s = isObject(v) ? v : {}
  const interval = typeof s.intervalMinutes === 'number' ? Math.round(s.intervalMinutes) : DEFAULT_SETTINGS.intervalMinutes
  return {
    autopilot: typeof s.autopilot === 'boolean' ? s.autopilot : DEFAULT_SETTINGS.autopilot,
    intervalMinutes: Math.min(MAX_INTERVAL_MINUTES, Math.max(MIN_INTERVAL_MINUTES, interval)),
    notifications: typeof s.notifications === 'boolean' ? s.notifications : DEFAULT_SETTINGS.notifications,
  }
}

export function normaliseRunnerState(v: unknown): RunnerState {
  if (!isObject(v)) return structuredClone(EMPTY_RUNNER_STATE)
  const base = structuredClone(EMPTY_RUNNER_STATE)
  return {
    tick: isObject(v.tick) ? (v.tick as unknown as RunnerState['tick']) : base.tick,
    current: isObject(v.current) ? (v.current as unknown as RunnerState['current']) : base.current,
    manual: Array.isArray(v.manual) ? (v.manual as RunnerState['manual']) : base.manual,
    watches: Array.isArray(v.watches) ? (v.watches as RunnerState['watches']) : base.watches,
    recent: Array.isArray(v.recent) ? (v.recent as RunnerState['recent']) : base.recent,
    pendingReports: Array.isArray(v.pendingReports) ? (v.pendingReports as RunnerState['pendingReports']) : base.pendingReports,
    lastTick: isObject(v.lastTick) ? (v.lastTick as unknown as RunnerState['lastTick']) : base.lastTick,
  }
}

export const authStore = {
  async getDevice(): Promise<DeviceAuth | null> {
    const data = await chrome.storage.local.get(KEYS.device)
    return parseDevice(data[KEYS.device])
  },
  async setDevice(device: DeviceAuth): Promise<void> {
    await chrome.storage.local.set({ [KEYS.device]: device })
  },
  async getAccess(): Promise<AccessToken | null> {
    const data = await chrome.storage.session.get(KEYS.access)
    return parseAccess(data[KEYS.access])
  },
  async setAccess(access: AccessToken): Promise<void> {
    await chrome.storage.session.set({ [KEYS.access]: access })
  },
  async clear(): Promise<void> {
    await chrome.storage.session.remove([KEYS.access, ...LEGACY_SESSION_KEYS])
    await chrome.storage.local.remove(KEYS.device)
  },
}

export const settingsStore = {
  async get(): Promise<ExtSettings> {
    const data = await chrome.storage.local.get(KEYS.settings)
    return normaliseSettings(data[KEYS.settings])
  },
  async update(patch: Partial<ExtSettings>): Promise<ExtSettings> {
    const next = normaliseSettings({ ...(await settingsStore.get()), ...patch })
    await chrome.storage.local.set({ [KEYS.settings]: next })
    return next
  },
}

export const runnerStore = {
  async get(): Promise<RunnerState> {
    const data = await chrome.storage.session.get(KEYS.runner)
    return normaliseRunnerState(data[KEYS.runner])
  },
  async set(state: RunnerState): Promise<void> {
    await chrome.storage.session.set({ [KEYS.runner]: state })
  },
}

export const connectStore = {
  async get(): Promise<ConnectStatus | null> {
    const data = await chrome.storage.session.get(KEYS.connect)
    const v = data[KEYS.connect]
    return isObject(v) && typeof v.state === 'string' ? (v as unknown as ConnectStatus) : null
  },
  async set(status: ConnectStatus): Promise<void> {
    await chrome.storage.session.set({ [KEYS.connect]: status })
  },
}

export async function removeLegacyKeys(): Promise<void> {
  await chrome.storage.session.remove(LEGACY_SESSION_KEYS).catch(() => undefined)
}

export function parseStoredDevice(v: unknown): DeviceAuth | null {
  return parseDevice(v)
}

/** Subscribe to one storage key. Returns an unsubscribe function. */
export function onStorageKey(
  area: 'local' | 'session',
  key: string,
  callback: (newValue: unknown) => void,
): () => void {
  const listener = (changes: Record<string, chrome.storage.StorageChange>, areaName: string) => {
    if (areaName !== area || !(key in changes)) return
    callback(changes[key].newValue)
  }
  chrome.storage.onChanged.addListener(listener)
  return () => chrome.storage.onChanged.removeListener(listener)
}
