/**
 * Current time as React state, shared by every caller on the same clock.
 * Keeps render functions pure (no Date.now() during render) while letting
 * relative timestamps ("3m ago", "in 2h") and elapsed timers stay fresh.
 */
import { useSyncExternalStore } from 'react'

function createClock(intervalMs: number) {
  let now = Date.now()
  let timer: ReturnType<typeof setInterval> | null = null
  const listeners = new Set<() => void>()

  return {
    subscribe(onChange: () => void) {
      listeners.add(onChange)
      if (!timer) {
        now = Date.now()
        timer = setInterval(() => {
          now = Date.now()
          listeners.forEach((l) => l())
        }, intervalMs)
      }
      return () => {
        listeners.delete(onChange)
        if (listeners.size === 0 && timer) {
          clearInterval(timer)
          timer = null
        }
      }
    },
    getSnapshot() {
      return now
    },
  }
}

const minuteClock = createClock(30_000)
const secondClock = createClock(1_000)

/** Milliseconds since epoch, refreshed every 30 seconds. */
export function useNow(): number {
  return useSyncExternalStore(minuteClock.subscribe, minuteClock.getSnapshot, minuteClock.getSnapshot)
}

/** Milliseconds since epoch, refreshed every second (for live elapsed timers). */
export function useNowEverySecond(): number {
  return useSyncExternalStore(secondClock.subscribe, secondClock.getSnapshot, secondClock.getSnapshot)
}
