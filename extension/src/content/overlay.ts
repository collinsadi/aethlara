import { OWN_UI_ATTR } from './dom'

/**
 * Consent bar for the manual "autofill with a saved job" flow: nothing is
 * typed into the page until the user clicks Fill. The autopilot does not use
 * it (the user approved those applications in the dashboard).
 */

let current: { host: HTMLElement; resolve: (ok: boolean) => void } | null = null

export function askToFill(fieldCount: number): Promise<boolean> {
  closeConsent(false)
  return new Promise((resolve) => {
    const host = document.createElement('div')
    host.setAttribute(OWN_UI_ATTR, 'consent')
    host.style.cssText = 'position:fixed!important;top:0!important;left:0!important;right:0!important;z-index:2147483647!important;'
    const shadow = host.attachShadow({ mode: 'closed' })
    const style = document.createElement('style')
    style.textContent = `
      .bar { display:flex; align-items:center; justify-content:space-between; gap:12px; padding:10px 16px;
        background:#18181b; color:#fafafa; border-bottom:1px solid #27272a; box-shadow:0 2px 8px rgba(0,0,0,0.3);
        font:13px/1.4 Urbanist,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif; }
      .actions { display:flex; gap:8px; }
      button { font:600 12px/1 inherit; border-radius:999px; padding:7px 14px; cursor:pointer; }
      .fill { background:#fd3a25; color:#fff; border:none; }
      .cancel { background:transparent; color:#a1a1aa; border:1px solid #3f3f46; }
    `
    const bar = document.createElement('div')
    bar.className = 'bar'
    const message = document.createElement('span')
    const strong = document.createElement('strong')
    strong.textContent = String(fieldCount)
    message.append('Aethlara is about to fill ', strong, ` field${fieldCount === 1 ? '' : 's'} on this page.`)
    const actions = document.createElement('span')
    actions.className = 'actions'
    const fill = document.createElement('button')
    fill.className = 'fill'
    fill.type = 'button'
    fill.textContent = 'Fill'
    const cancel = document.createElement('button')
    cancel.className = 'cancel'
    cancel.type = 'button'
    cancel.textContent = 'Cancel'
    actions.append(fill, cancel)
    bar.append(message, actions)
    shadow.append(style, bar)
    ;(document.body ?? document.documentElement).appendChild(host)
    current = { host, resolve }
    fill.addEventListener('click', () => closeConsent(true))
    cancel.addEventListener('click', () => closeConsent(false))
  })
}

export function closeConsent(result: boolean): void {
  if (!current) return
  const { host, resolve } = current
  current = null
  host.remove()
  resolve(result)
}
