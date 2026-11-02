import { sendToTab } from '@/lib/messaging'
import { sleep } from '@/lib/util'

export async function getTab(tabId: number): Promise<chrome.tabs.Tab | null> {
  try {
    return await chrome.tabs.get(tabId)
  } catch {
    return null
  }
}

export async function closeTab(tabId: number): Promise<void> {
  try {
    await chrome.tabs.remove(tabId)
  } catch {
    // already closed
  }
}

export async function focusTab(tabId: number): Promise<boolean> {
  const tab = await getTab(tabId)
  if (!tab?.id) return false
  try {
    await chrome.tabs.update(tab.id, { active: true })
    if (tab.windowId !== undefined) await chrome.windows.update(tab.windowId, { focused: true })
    return true
  } catch {
    return false
  }
}

/** Polls until the tab finished loading (or is gone). */
export async function waitForTabComplete(tabId: number, timeoutMs: number): Promise<chrome.tabs.Tab | null> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const tab = await getTab(tabId)
    if (!tab) return null
    if (tab.status === 'complete') return tab
    await sleep(500)
  }
  return getTab(tabId)
}

/** Is our content script alive in the tab's top frame? */
export async function pingTab(tabId: number): Promise<{ alive: boolean; runId: string | null }> {
  try {
    const reply = await sendToTab(tabId, { type: 'PING' }, 3000)
    return { alive: true, runId: reply.runId }
  } catch {
    return { alive: false, runId: null }
  }
}

/**
 * Tabs opened before the extension was installed or updated have no content
 * script. Inject it when Chrome lets us (activeTab after a toolbar click).
 */
export async function ensureContentScript(tabId: number): Promise<boolean> {
  if ((await pingTab(tabId)).alive) return true
  try {
    await chrome.scripting.executeScript({ target: { tabId, frameIds: [0] }, files: ['content/index.js'] })
  } catch {
    return false
  }
  for (let i = 0; i < 10; i++) {
    if ((await pingTab(tabId)).alive) return true
    await sleep(200)
  }
  return false
}
