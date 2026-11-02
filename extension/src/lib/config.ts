/**
 * Build-time configuration (Vite inlines import.meta.env at build time).
 * Keep the API fallback in sync with DEFAULT_API_BASE_URL in vite.config.ts,
 * which also derives the manifest host permission from it.
 */

function trimSlash(url: string): string {
  return url.replace(/\/+$/, '')
}

export const API_BASE_URL = trimSlash(import.meta.env.VITE_API_BASE_URL || 'https://aethlara-api.collinsadi.xyz/api/v1')
export const DASHBOARD_URL = trimSlash(import.meta.env.VITE_DASHBOARD_URL || 'https://aethlara.collinsadi.xyz')
export const EXTENSION_TOKEN_PARAM = import.meta.env.VITE_EXTENSION_TOKEN_PARAM || 'ext_token'

function originOf(url: string): string | null {
  try {
    return new URL(url).origin
  } catch {
    return null
  }
}

export const DASHBOARD_ORIGIN = originOf(DASHBOARD_URL)
export const API_ORIGIN = originOf(API_BASE_URL)

/**
 * Dashboard pages the extension links to (the dashboard's /agent, /review,
 * /applications and /inbox routes; the last three also appear in the
 * server's digest emails).
 */
export const DASHBOARD_LINKS = {
  home: `${DASHBOARD_URL}/dashboard`,
  agent: `${DASHBOARD_URL}/agent`,
  agentSettings: `${DASHBOARD_URL}/agent/settings`,
  connectExtension: `${DASHBOARD_URL}/settings#extension`,
  review: `${DASHBOARD_URL}/review`,
  applications: `${DASHBOARD_URL}/applications`,
  inbox: `${DASHBOARD_URL}/inbox`,
  aiSettings: `${DASHBOARD_URL}/settings#ai`,
  jobs: `${DASHBOARD_URL}/jobs`,
  job: (id: string) => `${DASHBOARD_URL}/jobs/${encodeURIComponent(id)}`,
} as const

export const EXTENSION_VERSION: string = (() => {
  try {
    return chrome.runtime.getManifest().version
  } catch {
    return ''
  }
})()
