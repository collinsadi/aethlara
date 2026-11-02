/**
 * Scrolls to the element named by the URL hash once the page content is
 * ready, and again whenever the hash changes (e.g. /settings#ai while already
 * on /settings). `aliases` maps legacy anchors (#api-key → #ai).
 */
import { useEffect } from 'react'
import { useLocation } from 'react-router-dom'

export function useHashScroll(ready: boolean, aliases: Record<string, string> = {}) {
  const { hash } = useLocation()
  const raw = hash.replace(/^#/, '')
  const target = aliases[raw] ?? raw

  useEffect(() => {
    if (!ready || !target) return
    const t = setTimeout(() => {
      const el = document.getElementById(target)
      if (!el) return
      el.scrollIntoView({ behavior: 'smooth', block: 'start' })
      // Move focus for keyboard and screen-reader users without a second scroll.
      if (!el.hasAttribute('tabindex')) el.setAttribute('tabindex', '-1')
      el.focus({ preventScroll: true })
    }, 120)
    return () => clearTimeout(t)
  }, [ready, target])
}
