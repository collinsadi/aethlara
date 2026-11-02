import { settingsStore } from '@/lib/storage'
import { clip } from '@/lib/util'
import type { NeedsReason } from '@/types'

const NEEDS_PREFIX = 'aethlara.needs:'

export function needsLabel(reason: NeedsReason): string {
  switch (reason) {
    case 'missing_answers':
      return 'a few questions only you can answer'
    case 'captcha':
      return 'a CAPTCHA to solve'
    case 'login_required':
      return 'an account sign-in'
    case 'verification':
      return 'an email verification step'
    case 'unsupported_form':
      return 'a form the agent cannot fill on its own'
    case 'review':
      return 'a quick review before submitting'
  }
}

export async function notifyNeedsInput(appId: string, title: string, company: string, reason: NeedsReason): Promise<void> {
  const settings = await settingsStore.get()
  if (!settings.notifications) return
  try {
    await chrome.notifications.create(`${NEEDS_PREFIX}${appId}`, {
      type: 'basic',
      iconUrl: chrome.runtime.getURL('icons/icon.png'),
      title: clip(`${company || 'An application'} needs you`, 80),
      message: clip(`${title || 'Application'}: ${needsLabel(reason)}`, 180),
      priority: 1,
    })
  } catch {
    // notifications blocked at the OS level
  }
}

export function appIdFromNotification(notificationId: string): string | null {
  return notificationId.startsWith(NEEDS_PREFIX) ? notificationId.slice(NEEDS_PREFIX.length) : null
}

export async function clearNeedsNotification(appId: string): Promise<void> {
  try {
    await chrome.notifications.clear(`${NEEDS_PREFIX}${appId}`)
  } catch {
    // ignore
  }
}
