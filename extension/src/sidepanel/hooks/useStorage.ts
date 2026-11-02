import { useCallback, useEffect, useRef, useState } from 'react'
import {
  KEYS,
  normaliseRunnerState,
  normaliseSettings,
  onStorageKey,
  parseStoredDevice,
  settingsStore,
  type ConnectStatus,
  type DeviceAuth,
} from '@/lib/storage'
import type { ExtSettings, RunnerState } from '@/types'

/** A chrome.storage key as React state, kept in sync with storage.onChanged. */
export function useStorageValue<T>(area: 'local' | 'session', key: string, parse: (raw: unknown) => T): { value: T; loaded: boolean } {
  const parseRef = useRef(parse)
  parseRef.current = parse
  const [state, setState] = useState<{ value: T; loaded: boolean }>(() => ({ value: parse(undefined), loaded: false }))

  useEffect(() => {
    let alive = true
    void chrome.storage[area].get(key).then((data) => {
      if (alive) setState({ value: parseRef.current(data[key]), loaded: true })
    })
    const off = onStorageKey(area, key, (raw) => setState({ value: parseRef.current(raw), loaded: true }))
    return () => {
      alive = false
      off()
    }
  }, [area, key])

  return state
}

function parseConnect(raw: unknown): ConnectStatus | null {
  if (!raw || typeof raw !== 'object' || typeof (raw as ConnectStatus).state !== 'string') return null
  return raw as ConnectStatus
}

export function useAuth(): { device: DeviceAuth | null; loaded: boolean; connect: ConnectStatus | null } {
  const device = useStorageValue('local', KEYS.device, parseStoredDevice)
  const connect = useStorageValue('session', KEYS.connect, parseConnect)
  return { device: device.value, loaded: device.loaded, connect: connect.value }
}

export function useRunnerState(): RunnerState {
  return useStorageValue('session', KEYS.runner, normaliseRunnerState).value
}

export function useSettings(): { settings: ExtSettings; loaded: boolean; update: (patch: Partial<ExtSettings>) => Promise<void> } {
  const { value, loaded } = useStorageValue('local', KEYS.settings, normaliseSettings)
  const update = useCallback(async (patch: Partial<ExtSettings>) => {
    await settingsStore.update(patch)
  }, [])
  return { settings: value, loaded, update }
}

/** Re-renders every `ms` (for "3 min ago" labels and elapsed timers). */
export function useNow(ms = 15_000): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), ms)
    return () => clearInterval(t)
  }, [ms])
  return now
}
