import { exchangeExtensionToken } from '@/api/auth'
import { setSession } from '@/lib/storage'
import { MessageType, type ExtMessage } from '@/types'

/**
 * Handshake flow
 * --------------
 * The dashboard opens `/<dashboard>/extension-handshake?ext_token=<token>`.
 * The content script (injected on <all_urls>) detects that URL, reads the
 * token from window.location, and sends it to this service worker via
 * AUTH_HANDSHAKE. The service worker exchanges the token, stores the
 * session, closes the handshake tab, and notifies any open popup.
 *
 * This is deliberately decoupled from `chrome.tabs.onUpdated` so it works
 * regardless of which dashboard origin is used (localhost, prod, preview)
 * and does not require host_permissions for the dashboard — only for the
 * API, which is already granted.
 */

chrome.runtime.onMessage.addListener((message: ExtMessage, sender, sendResponse) => {
  // Only accept messages from our own extension
  if (sender.id !== chrome.runtime.id) return

  const validTypes = Object.values(MessageType) as string[]
  if (!validTypes.includes(message.type)) return

  if (message.type === MessageType.AUTH_HANDSHAKE) {
    const payload = message.payload as { ext_token?: string } | undefined
    const extToken = payload?.ext_token
    const tabId = sender.tab?.id
    if (!extToken) {
      sendResponse({ ok: false, error: 'missing_token' })
      return
    }
    void handleHandshake(extToken, tabId).then((result) => sendResponse(result))
    return true // async response
  }

  if (
    message.type === MessageType.SCAN_FIELDS ||
    message.type === MessageType.FILL_FIELDS ||
    message.type === MessageType.EXTRACT_TEXT
  ) {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const tab = tabs[0]
      if (!tab?.id) {
        sendResponse({ error: 'No active tab' })
        return
      }
      chrome.tabs.sendMessage(tab.id, message, (response) => {
        sendResponse(response)
      })
    })
    return true // async response
  }
})

async function handleHandshake(
  extToken: string,
  tabId: number | undefined,
): Promise<{ ok: boolean; error?: string }> {
  try {
    const result = await exchangeExtensionToken(extToken)
    await setSession(result.access_token, result.user, result.expires_at)

    // Close the handshake tab (best effort — may already be closed)
    if (tabId !== undefined) {
      await chrome.tabs.remove(tabId).catch(() => undefined)
    }

    // Notify any open popup that auth succeeded
    chrome.runtime
      .sendMessage({ type: MessageType.AUTH_SUCCESS })
      .catch(() => undefined) // popup may not be open — ignore

    return { ok: true }
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'exchange_failed'
    return { ok: false, error: msg }
  }
}

// Alarm for session cleanup (not strictly needed — chrome.storage.session clears on browser close)
chrome.alarms.create('session-check', { periodInMinutes: 15 })
chrome.alarms.onAlarm.addListener(() => {
  // No-op — session storage handles expiry automatically in getSession()
})
