import type { Session, ExtUser } from '@/types'

// Non-descriptive key names for session storage
const K = {
  TOKEN:   '__ext_at',
  USER:    '__ext_u',
  EXPIRES: '__ext_exp',
} as const

export async function setSession(token: string, user: ExtUser, expiresAt: string): Promise<void> {
  await chrome.storage.session.set({
    [K.TOKEN]:   token,
    [K.USER]:    user,
    [K.EXPIRES]: expiresAt,
  })
}

export async function getSession(): Promise<Session | null> {
  const data = await chrome.storage.session.get([K.TOKEN, K.USER, K.EXPIRES])
  const token = data[K.TOKEN] as string | undefined
  if (!token) return null

  const expiresAt = data[K.EXPIRES] as string | undefined
  if (expiresAt && new Date(expiresAt) < new Date()) {
    await clearSession()
    return null
  }

  return {
    token,
    expiresAt: expiresAt ?? '',
    user: data[K.USER] as ExtUser,
  }
}

export async function clearSession(): Promise<void> {
  await chrome.storage.session.remove(Object.values(K))
}
