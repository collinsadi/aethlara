import { useState, useEffect, useRef } from 'react'
import { getSession, clearSession } from '@/lib/storage'
import { MessageType, type ExtMessage, type Session } from '@/types'

const POLL_INTERVAL_MS = 2000
const POLL_TIMEOUT_MS = 120_000

export function useExtensionAuth(onAuthed: () => void) {
  const [timedOut, setTimedOut] = useState(false)
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const startTime = useRef(Date.now())
  const onAuthedRef = useRef(onAuthed)
  onAuthedRef.current = onAuthed

  useEffect(() => {
    let cancelled = false

    const stop = () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current)
        intervalRef.current = null
      }
    }

    const checkSession = async () => {
      const session = await getSession()
      if (cancelled) return false
      if (session) {
        stop()
        onAuthedRef.current()
        return true
      }
      return false
    }

    // Fast path: react immediately to background's AUTH_SUCCESS push
    const messageListener = (message: ExtMessage) => {
      if (message?.type === MessageType.AUTH_SUCCESS) {
        void checkSession()
      }
    }
    chrome.runtime.onMessage.addListener(messageListener)

    // Fallback path: poll storage in case the popup was closed during handshake
    intervalRef.current = setInterval(async () => {
      const gotSession = await checkSession()
      if (gotSession) return
      if (Date.now() - startTime.current >= POLL_TIMEOUT_MS) {
        stop()
        if (!cancelled) setTimedOut(true)
      }
    }, POLL_INTERVAL_MS)

    return () => {
      cancelled = true
      stop()
      chrome.runtime.onMessage.removeListener(messageListener)
    }
  }, [])

  return { timedOut }
}

export function useSession() {
  const [session, setSession] = useState<Session | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    getSession().then((s) => {
      setSession(s)
      setLoading(false)
    })
  }, [])

  const signOut = async () => {
    await clearSession()
    setSession(null)
  }

  return { session, loading, signOut }
}
