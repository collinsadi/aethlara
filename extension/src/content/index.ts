import { scanFields } from './scanner'
import { fillFields } from './filler'
import { extractPageText } from './extractor'
import { MessageType, type ExtMessage, type ScannedField } from '@/types'

// ── Handshake relay ────────────────────────────────────────────────────────────
// When the dashboard opens /extension-handshake?ext_token=..., we read the token
// from the URL and forward it to the service worker. This runs independently of
// the dashboard origin so it works on localhost, prod, preview, etc.
void (function relayHandshakeIfPresent() {
  try {
    if (!window.location.pathname.endsWith('/extension-handshake')) return
    const token = new URLSearchParams(window.location.search).get('ext_token')
    if (!token) return
    chrome.runtime
      .sendMessage({ type: MessageType.AUTH_HANDSHAKE, payload: { ext_token: token } })
      .catch(() => undefined) // extension context may be unavailable — ignore
  } catch {
    // Never let handshake relay errors break the content script
  }
})()

// Consent overlay state
let overlayEl: HTMLElement | null = null
let pendingFillCallback: (() => void) | null = null

function showOverlay(fieldCount: number, onConfirm: () => void, onCancel: () => void): void {
  removeOverlay()

  const overlay = document.createElement('div')
  overlay.id = '__aethlara_overlay__'
  overlay.style.cssText = `
    position: fixed; top: 0; left: 0; right: 0; z-index: 2147483647;
    background: #18181b; color: #fff; font-family: system-ui, sans-serif;
    font-size: 13px; padding: 10px 16px;
    display: flex; align-items: center; justify-content: space-between;
    gap: 12px; box-shadow: 0 2px 8px rgba(0,0,0,0.3);
  `
  overlay.innerHTML = `
    <span>Aethlara is about to fill <strong>${fieldCount}</strong> field${fieldCount !== 1 ? 's' : ''}.</span>
    <span style="display:flex;gap:8px;">
      <button id="__aethlara_fill__" style="background:#7c3aed;color:#fff;border:none;border-radius:6px;padding:4px 12px;cursor:pointer;font-size:12px;">Fill</button>
      <button id="__aethlara_cancel__" style="background:transparent;color:#a1a1aa;border:1px solid #3f3f46;border-radius:6px;padding:4px 12px;cursor:pointer;font-size:12px;">Cancel</button>
    </span>
  `

  document.body.appendChild(overlay)
  overlayEl = overlay
  pendingFillCallback = onConfirm

  overlay.querySelector('#__aethlara_fill__')!.addEventListener('click', () => {
    removeOverlay()
    onConfirm()
  })
  overlay.querySelector('#__aethlara_cancel__')!.addEventListener('click', () => {
    removeOverlay()
    onCancel()
  })
}

function removeOverlay(): void {
  overlayEl?.remove()
  overlayEl = null
  pendingFillCallback = null
}

const VALID_TYPES = new Set(Object.values(MessageType))

chrome.runtime.onMessage.addListener((message: ExtMessage, sender, sendResponse) => {
  // Reject messages not from our extension
  if (sender.id !== chrome.runtime.id) return

  if (!VALID_TYPES.has(message.type)) return

  switch (message.type) {
    case MessageType.SCAN_FIELDS: {
      const fields = scanFields()
      sendResponse({ type: MessageType.FIELDS_RESULT, payload: fields })
      break
    }

    case MessageType.FILL_FIELDS: {
      const { fields, fillMap } = message.payload as {
        fields: ScannedField[]
        fillMap: Record<string, string | null>
      }
      const toFill = fields.filter((f) => fillMap[f.field_id] != null)

      showOverlay(
        toFill.length,
        async () => {
          const summary = await fillFields(fields, fillMap)
          sendResponse({ type: MessageType.FILL_RESULT, payload: summary })
        },
        () => {
          sendResponse({ type: MessageType.FILL_RESULT, payload: { filled: 0, skipped: toFill.length, failed: [], cancelled: true } })
        }
      )
      return true // async response
    }

    case MessageType.EXTRACT_TEXT: {
      const text = extractPageText()
      sendResponse({ type: MessageType.TEXT_RESULT, payload: text })
      break
    }

    case MessageType.HIDE_OVERLAY: {
      removeOverlay()
      sendResponse({})
      break
    }
  }
})
