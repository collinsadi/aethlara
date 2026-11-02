import { ApiError } from './api'
import { AuthError, connectWithHandshake, signOutDevice } from './auth'
import { appIdFromNotification, clearNeedsNotification } from './notifications'
import {
  FlowRequestError,
  ensureLoaded,
  handleFile,
  handleFill,
  handleHello,
  handleProgress,
  handleResult,
  handleVerifications,
  handleWatchConfirmed,
  initRunner,
  onAlarm,
  onSettingsChanged,
  onSignedOut,
  onTabRemoved,
  releaseAll,
  requestTick,
  startManualFill,
  stopCurrent,
  syncTickAlarm,
} from './runner'
import { closeTab, focusTab } from './tabs'
import { DASHBOARD_LINKS, DASHBOARD_ORIGIN } from '@/lib/config'
import { createLogger, errorKind } from '@/lib/log'
import { KEYS, normaliseSettings, parseStoredDevice, removeLegacyKeys, runnerStore } from '@/lib/storage'
import { CONTENT_TO_BG, PAGE_TO_BG, type BgRequest, type BgResponse } from '@/types'

/**
 * Service worker
 * --------------
 *  - message router (content scripts and extension pages, our extension only)
 *  - dashboard handshake → device credential
 *  - autopilot runner wiring: alarms, tabs, notifications, settings changes
 *
 * Every listener is registered synchronously at the top level so Chrome can
 * wake the worker for it.
 */

const log = createLogger('bg')

// ── Sender checks ─────────────────────────────────────────────────────────────

/** Our own pages (side panel, or the same page opened in a tab). Content scripts carry the web page URL. */
function isExtensionPage(sender: chrome.runtime.MessageSender): boolean {
  return typeof sender.url === 'string' && sender.url.startsWith(chrome.runtime.getURL(''))
}

function isContentScript(sender: chrome.runtime.MessageSender): boolean {
  return !!sender.tab && sender.frameId === 0 && typeof sender.url === 'string' && /^https?:/.test(sender.url)
}

function isTrustedDashboard(sender: chrome.runtime.MessageSender): boolean {
  let url: URL
  try {
    url = new URL(sender.url ?? '')
  } catch {
    return false
  }
  if (!url.pathname.endsWith('/extension-handshake')) return false
  const origin = sender.origin && sender.origin !== 'null' ? sender.origin : url.origin
  if (origin === DASHBOARD_ORIGIN) return true
  // Any local port, but only in builds made for a local dashboard: a release
  // build must not accept handshakes from whatever runs on localhost.
  return LOCAL_ORIGIN.test(DASHBOARD_ORIGIN ?? '') && LOCAL_ORIGIN.test(origin)
}

const LOCAL_ORIGIN = /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/

function isBgRequest(message: unknown): message is BgRequest {
  if (typeof message !== 'object' || message === null) return false
  const type = (message as { type?: unknown }).type
  return typeof type === 'string' && (CONTENT_TO_BG.has(type as BgRequest['type']) || PAGE_TO_BG.has(type as BgRequest['type']))
}

function failure(err: unknown): BgResponse<never> {
  if (err instanceof ApiError) return { ok: false, error: err.message, code: err.code }
  if (err instanceof FlowRequestError) return { ok: false, error: err.message, code: err.code }
  if (err instanceof AuthError) return { ok: false, error: err.message, code: err.code ?? err.kind.toUpperCase() }
  return { ok: false, error: err instanceof Error ? err.message : 'Unexpected error', code: 'INTERNAL' }
}

// ── Handlers ──────────────────────────────────────────────────────────────────

async function handleHandshake(extToken: string, sender: chrome.runtime.MessageSender): Promise<{ connected: true }> {
  if (!isTrustedDashboard(sender)) {
    log.warn('handshake rejected: untrusted origin')
    throw new FlowRequestError('UNTRUSTED_ORIGIN', 'Handshake pages must come from the Aethlara dashboard.')
  }
  await connectWithHandshake(extToken)
  if (sender.tab?.id !== undefined) void closeTab(sender.tab.id)
  await syncTickAlarm()
  log.info('connected')
  return { connected: true }
}

async function route(message: BgRequest, sender: chrome.runtime.MessageSender): Promise<unknown> {
  switch (message.type) {
    case 'AUTH_HANDSHAKE':
      return handleHandshake(message.extToken, sender)
    case 'FLOW_HELLO':
      return handleHello(sender)
    case 'FLOW_FILL':
      return handleFill(message.runId, message.pageUrl, message.fields, sender)
    case 'FLOW_FILE':
      return handleFile(message.runId, message.kind, sender)
    case 'FLOW_VERIFICATIONS':
      return handleVerifications(message.runId, sender)
    case 'FLOW_PROGRESS':
      return handleProgress(message.runId, message.update, sender)
    case 'FLOW_RESULT':
      return handleResult(message.runId, message.outcome, sender)
    case 'WATCH_CONFIRMED':
      return handleWatchConfirmed(message.appId, message.url, message.message, sender)
    case 'RUNNER_APPLY_NOW':
      return requestTick('manual')
    case 'RUNNER_STOP':
      return { stopped: await stopCurrent() }
    case 'MANUAL_FILL':
      return startManualFill(message.tabId, message.appId)
    case 'SIGN_OUT':
      await releaseAll()
      await signOutDevice()
      await onSignedOut()
      return { signedOut: true }
  }
}

chrome.runtime.onMessage.addListener((message: unknown, sender, sendResponse) => {
  // Only our own extension; web pages cannot reach onMessage without externally_connectable.
  if (sender.id !== chrome.runtime.id || !isBgRequest(message)) return false
  const fromPage = isExtensionPage(sender)
  const fromContent = isContentScript(sender)
  if ((CONTENT_TO_BG.has(message.type) && !fromContent) || (PAGE_TO_BG.has(message.type) && !fromPage)) {
    return false
  }
  route(message, sender).then(
    (data) => sendResponse({ ok: true, data } satisfies BgResponse),
    (err: unknown) => {
      if (!(err instanceof FlowRequestError && err.code === 'NOT_MANAGED')) log.warn('request failed', { type: message.type, err: errorKind(err) })
      sendResponse(failure(err))
    },
  )
  return true
})

// Content scripts keep a port open while they work a form: when this worker
// stops, Chrome disconnects it and they retry their in-flight request at once.
chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== 'aethlara-flow' || port.sender?.id !== chrome.runtime.id) port.disconnect()
})

// ── Lifecycle ─────────────────────────────────────────────────────────────────

// The toolbar icon opens popup.html in every browser (Arc has no extension
// side panels); the popup can move into the side panel where one exists.
// Earlier versions opened the side panel on click, and Chrome remembers
// that, so switch it off explicitly.
async function configureSidePanel(): Promise<void> {
  try {
    await chrome.sidePanel?.setPanelBehavior({ openPanelOnActionClick: false })
  } catch {
    // no side panel support: nothing to reset
  }
}

chrome.runtime.onInstalled.addListener(() => {
  void configureSidePanel()
  void removeLegacyKeys()
})

chrome.runtime.onStartup.addListener(() => {
  void configureSidePanel()
})

chrome.alarms.onAlarm.addListener((alarm) => {
  void onAlarm(alarm.name)
})

chrome.tabs.onRemoved.addListener((tabId) => {
  void onTabRemoved(tabId)
})

chrome.notifications.onClicked.addListener((notificationId) => {
  const appId = appIdFromNotification(notificationId)
  if (!appId) return
  void (async () => {
    await clearNeedsNotification(appId)
    await ensureLoaded()
    const state = await runnerStore.get()
    const watch = state.watches.find((w) => w.appId === appId)
    if (watch && (await focusTab(watch.tabId))) return
    await chrome.tabs.create({ url: DASHBOARD_LINKS.applications })
  })()
})

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') return
  const settings = changes[KEYS.settings]
  if (settings) {
    void onSettingsChanged(normaliseSettings(settings.newValue), settings.oldValue ? normaliseSettings(settings.oldValue) : null)
  }
  const device = changes[KEYS.device]
  if (device && !parseStoredDevice(device.newValue) && parseStoredDevice(device.oldValue)) {
    // Signed out or revoked (possibly from the side panel): stop all work.
    void onSignedOut()
  } else if (device && parseStoredDevice(device.newValue) && !parseStoredDevice(device.oldValue)) {
    void syncTickAlarm()
  }
})

void configureSidePanel()
void initRunner().catch((err: unknown) => log.warn('init failed', { err: errorKind(err) }))
