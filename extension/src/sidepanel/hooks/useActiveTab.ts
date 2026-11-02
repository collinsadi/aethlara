import { useCallback, useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { ensureContentScript } from '@/background/tabs'
import { sendToTab } from '@/lib/messaging'
import { isHttpUrl } from '@/lib/util'
import type { PageInfo } from '@/types'

/** The active tab of the window this side panel belongs to. */
export function useActiveTab(): { tab: chrome.tabs.Tab | null; refresh: () => void } {
  const [tab, setTab] = useState<chrome.tabs.Tab | null>(null)

  const refresh = useCallback(() => {
    void chrome.tabs.query({ active: true, currentWindow: true }).then(([t]) => setTab(t ?? null))
  }, [])

  useEffect(() => {
    refresh()
    const onActivated = () => refresh()
    const onUpdated = (_id: number, info: chrome.tabs.TabChangeInfo, t: chrome.tabs.Tab) => {
      if (t.active && (info.status === 'complete' || info.url !== undefined || info.title !== undefined)) refresh()
    }
    chrome.tabs.onActivated.addListener(onActivated)
    chrome.tabs.onUpdated.addListener(onUpdated)
    return () => {
      chrome.tabs.onActivated.removeListener(onActivated)
      chrome.tabs.onUpdated.removeListener(onUpdated)
    }
  }, [refresh])

  return { tab, refresh }
}

export function isRestrictedUrl(url: string | undefined): boolean {
  if (!url || !isHttpUrl(url)) return true
  return /^https:\/\/(chrome\.google\.com\/webstore|chromewebstore\.google\.com)/.test(url)
}

export class NoContentScriptError extends Error {
  constructor() {
    super('Aethlara cannot read this page yet. Reload it and try again.')
    this.name = 'NoContentScriptError'
  }
}

/** Asks the tab's content script what kind of page it is. */
export function usePageInfo(tab: chrome.tabs.Tab | null) {
  const tabId = tab?.id
  const url = tab?.url
  return useQuery<PageInfo>({
    queryKey: ['page-info', tabId, url, tab?.status],
    enabled: tabId !== undefined && !isRestrictedUrl(url) && tab?.status === 'complete',
    retry: false,
    staleTime: 10_000,
    queryFn: async () => {
      if (tabId === undefined) throw new NoContentScriptError()
      if (!(await ensureContentScript(tabId))) throw new NoContentScriptError()
      return sendToTab(tabId, { type: 'PAGE_INFO' }, 20_000)
    },
  })
}
