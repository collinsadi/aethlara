/**
 * Single-key keyboard shortcuts (e.g. J/K/A/X on the Review page).
 *
 * Ignored while typing (inputs, textareas, selects, contenteditable), with
 * modifier keys held, or when focus is inside a dialog/menu, so shortcuts
 * never fire behind a modal.
 */
import { useEffect, useRef } from 'react'

export type HotkeyMap = Record<string, (event: KeyboardEvent) => void>

function shouldIgnore(event: KeyboardEvent): boolean {
  if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey || event.isComposing) return true
  const target = event.target as HTMLElement | null
  if (!target || !(target instanceof HTMLElement)) return false
  if (target.isContentEditable) return true
  if (['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)) return true
  return Boolean(target.closest('[role="dialog"],[role="alertdialog"],[role="menu"],[aria-modal="true"]'))
}

/** Keys are matched case-insensitively against `event.key` ("j", "?", "Escape"). */
export function useHotkeys(map: HotkeyMap, enabled = true) {
  const latest = useRef(map)
  useEffect(() => {
    latest.current = map
  })

  useEffect(() => {
    if (!enabled) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (shouldIgnore(event)) return
      const key = event.key.length === 1 ? event.key.toLowerCase() : event.key
      const handler = latest.current[key]
      if (!handler) return
      event.preventDefault()
      handler(event)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [enabled])
}
