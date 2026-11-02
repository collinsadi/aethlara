import { OWN_UI_ATTR } from './dom'

/**
 * Small status pill in the page corner ("Aethlara is applying… step 2").
 * It lives in a closed shadow root so page CSS cannot restyle it, and it has
 * pointer-events: none so it never blocks a click on the form underneath.
 */

type Tone = 'working' | 'attention' | 'done' | 'error'

let host: HTMLElement | null = null
let textEl: HTMLElement | null = null
let dotEl: HTMLElement | null = null
let hideTimer: ReturnType<typeof setTimeout> | null = null

const COLORS: Record<Tone, string> = {
  working: '#fd3a25',
  attention: '#f59e0b',
  done: '#22c55e',
  error: '#ef4444',
}

function ensure(): void {
  if (host?.isConnected) return
  host = document.createElement('div')
  host.setAttribute(OWN_UI_ATTR, 'badge')
  host.style.cssText =
    'position:fixed!important;right:16px!important;bottom:16px!important;z-index:2147483646!important;pointer-events:none!important;margin:0!important;padding:0!important;'
  const shadow = host.attachShadow({ mode: 'closed' })
  const style = document.createElement('style')
  style.textContent = `
    .pill { display:flex; align-items:center; gap:8px; max-width:320px; padding:8px 12px; border-radius:999px;
      background:rgba(9,9,11,0.92); color:#fafafa; border:1px solid #27272a; box-shadow:0 4px 16px rgba(0,0,0,0.35);
      font:500 12px/1.3 Urbanist,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif; pointer-events:none; }
    .dot { width:8px; height:8px; border-radius:50%; flex-shrink:0; }
    .dot.pulse { animation:pulse 1.4s ease-in-out infinite; }
    .text { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
    @keyframes pulse { 0%,100% { opacity:1 } 50% { opacity:0.35 } }
  `
  const pill = document.createElement('div')
  pill.className = 'pill'
  dotEl = document.createElement('span')
  dotEl.className = 'dot'
  textEl = document.createElement('span')
  textEl.className = 'text'
  pill.append(dotEl, textEl)
  shadow.append(style, pill)
  ;(document.body ?? document.documentElement).appendChild(host)
}

export function showBadge(text: string, tone: Tone = 'working', autoHideMs?: number): void {
  try {
    ensure()
    if (!textEl || !dotEl) return
    textEl.textContent = text
    dotEl.style.background = COLORS[tone]
    dotEl.classList.toggle('pulse', tone === 'working')
    if (hideTimer) clearTimeout(hideTimer)
    hideTimer = autoHideMs ? setTimeout(hideBadge, autoHideMs) : null
  } catch {
    // never let the badge break the page or the flow
  }
}

export function hideBadge(): void {
  if (hideTimer) clearTimeout(hideTimer)
  hideTimer = null
  host?.remove()
  host = null
  textEl = null
  dotEl = null
}
