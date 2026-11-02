import { API_BASE_URL } from '@/lib/config'
import { AuthError, getAccessToken } from './auth'
import type {
  AgentOverview,
  AgentRun,
  Application,
  AutofillField,
  AutofillResult,
  ExtJob,
  ExtResume,
  ExtractionResult,
  FillResponse,
  FormField,
  Lead,
  LeadDecision,
  LeadWithApplication,
  Packet,
  Paginated,
  ResultReport,
  Verification,
} from '@/types'

/**
 * Aethlara API client (fetch based; works in the service worker and in
 * extension pages). Attaches the bearer token, refreshes it proactively via
 * getAccessToken(), and retries once with a forced refresh on 401.
 *
 * Content scripts never import this: they ask the background instead.
 */

export class ApiError extends Error {
  readonly status: number
  readonly code: string
  /** Extra error payload (e.g. RESUME_MISALIGNED carries match data). */
  readonly details?: unknown
  readonly retryAfterSec?: number
  constructor(status: number, code: string, message: string, details?: unknown, retryAfterSec?: number) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.code = code
    this.details = details
    this.retryAfterSec = retryAfterSec
  }
}

export function isSignedOutError(err: unknown): boolean {
  return err instanceof ApiError && err.code === 'SIGNED_OUT'
}

type Query = Record<string, string | number | boolean | undefined | null>

interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE'
  query?: Query
  body?: unknown
  timeoutMs?: number
}

const DEFAULT_TIMEOUT_MS = 30_000
/** AI-backed endpoints (fill, add lead, extraction) can take a while server-side. */
const AI_TIMEOUT_MS = 150_000
const MAX_FILE_BYTES = 20 * 1024 * 1024

function buildUrl(path: string, query?: Query): string {
  if (!path.startsWith('/') || path.startsWith('//')) throw new Error('API paths must be relative')
  const url = new URL(`${API_BASE_URL}${path}`)
  for (const [k, v] of Object.entries(query ?? {})) {
    if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, String(v))
  }
  return url.toString()
}

async function token(rejected?: string): Promise<string> {
  try {
    return await getAccessToken(rejected ? { rejectedToken: rejected } : {})
  } catch (err) {
    if (err instanceof AuthError && err.kind === 'signed_out') {
      throw new ApiError(401, 'SIGNED_OUT', err.message)
    }
    const message = err instanceof Error ? err.message : 'Could not refresh the session.'
    throw new ApiError(0, 'AUTH_UNAVAILABLE', message)
  }
}

async function send(url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  try {
    return await fetch(url, { ...init, credentials: 'omit', cache: 'no-store', signal: AbortSignal.timeout(timeoutMs) })
  } catch (err) {
    const name = err instanceof Error ? err.name : ''
    if (name === 'TimeoutError' || name === 'AbortError') {
      throw new ApiError(0, 'TIMEOUT', 'Aethlara took too long to respond.')
    }
    throw new ApiError(0, 'NETWORK', 'Could not reach Aethlara. Check your connection.')
  }
}

/** Sends an authenticated request; on 401 refreshes the token once and retries. */
async function authorized(url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  const headers = new Headers(init.headers)
  let bearer = await token()
  headers.set('Authorization', `Bearer ${bearer}`)
  let res = await send(url, { ...init, headers }, timeoutMs)
  if (res.status === 401) {
    bearer = await token(bearer)
    headers.set('Authorization', `Bearer ${bearer}`)
    res = await send(url, { ...init, headers }, timeoutMs)
  }
  return res
}

async function errorFrom(res: Response): Promise<ApiError> {
  let body: { error?: { code?: string; message?: string; data?: unknown } } | null = null
  try {
    body = await res.json()
  } catch {
    body = null
  }
  const retryAfter = Number(res.headers.get('Retry-After'))
  const code = body?.error?.code ?? `HTTP_${res.status}`
  const message = body?.error?.message ?? `Request failed (HTTP ${res.status}).`
  return new ApiError(res.status, code, message, body?.error?.data, Number.isFinite(retryAfter) ? retryAfter : undefined)
}

export async function request<T>(path: string, opts: RequestOptions = {}): Promise<T> {
  const url = buildUrl(path, opts.query)
  const headers: Record<string, string> = { Accept: 'application/json' }
  if (opts.body !== undefined) headers['Content-Type'] = 'application/json'
  const res = await authorized(
    url,
    {
      method: opts.method ?? 'GET',
      headers,
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    },
    opts.timeoutMs ?? DEFAULT_TIMEOUT_MS,
  )
  if (!res.ok) throw await errorFrom(res)
  const json = (await res.json().catch(() => null)) as { data?: T } | null
  if (!json || !('data' in json)) throw new ApiError(res.status, 'BAD_RESPONSE', 'Unexpected response from Aethlara.')
  return json.data as T
}

export interface DownloadedFile {
  bytes: ArrayBuffer
  contentType: string
  filename: string | null
}

/** Only server-provided relative paths under /agent/ are fetched with the bearer token. */
export function isSafeFilePath(path: string): boolean {
  return /^\/agent\/applications\/[A-Za-z0-9-]+\/(resume|cover-letter\.pdf)$/.test(path)
}

export async function downloadFile(path: string): Promise<DownloadedFile> {
  if (!isSafeFilePath(path)) throw new ApiError(0, 'BAD_PATH', 'Unexpected file path.')
  const res = await authorized(buildUrl(path), { method: 'GET' }, 60_000)
  if (!res.ok) throw await errorFrom(res)
  const declared = Number(res.headers.get('Content-Length'))
  if (Number.isFinite(declared) && declared > MAX_FILE_BYTES) {
    throw new ApiError(res.status, 'FILE_TOO_LARGE', 'The file is too large to upload.')
  }
  const bytes = await res.arrayBuffer()
  if (bytes.byteLength === 0) throw new ApiError(res.status, 'EMPTY_FILE', 'The file is empty.')
  if (bytes.byteLength > MAX_FILE_BYTES) throw new ApiError(res.status, 'FILE_TOO_LARGE', 'The file is too large to upload.')
  return {
    bytes,
    contentType: (res.headers.get('Content-Type') ?? 'application/octet-stream').split(';')[0].trim(),
    filename: res.headers.get('X-File-Name'),
  }
}

const id = (value: string) => encodeURIComponent(value)

// ── Autopilot ─────────────────────────────────────────────────────────────────

export const agentApi = {
  overview: () => request<AgentOverview>('/agent/overview'),
  startRun: () => request<AgentRun>('/agent/runs', { method: 'POST' }),

  leads: (q: { status?: string; sort?: 'score' | 'recent'; page?: number; page_size?: number } = {}) =>
    request<Paginated<Lead>>('/agent/leads', { query: q }),
  decideLead: (leadId: string, decision: LeadDecision) =>
    request<LeadWithApplication>(`/agent/leads/${id(leadId)}/decision`, { method: 'POST', body: { decision } }),
  addLead: (body: { url: string; page_text?: string; approve: boolean; source: 'extension' }) =>
    request<LeadWithApplication>('/agent/leads', { method: 'POST', body, timeoutMs: AI_TIMEOUT_MS }),

  applications: (q: { status?: string; page?: number; page_size?: number } = {}) =>
    request<Paginated<Application>>('/agent/applications', { query: q }),
  application: (appId: string) => request<Application>(`/agent/applications/${id(appId)}`),
  retry: (appId: string) => request<Application>(`/agent/applications/${id(appId)}/retry`, { method: 'POST' }),
  cancel: (appId: string) => request<Application>(`/agent/applications/${id(appId)}/cancel`, { method: 'POST' }),

  // Extension protocol
  claim: () => request<Packet | null>('/agent/applications/claim', { method: 'POST' }),
  packet: (appId: string) => request<Packet>(`/agent/applications/${id(appId)}/packet`),
  fill: (appId: string, body: { page_url: string; fields: FormField[] }) =>
    request<FillResponse>(`/agent/applications/${id(appId)}/fill`, { method: 'POST', body, timeoutMs: AI_TIMEOUT_MS }),
  result: (appId: string, report: ResultReport) =>
    request<Application>(`/agent/applications/${id(appId)}/result`, { method: 'POST', body: report }),
  /** `since` must be RFC 3339; it is URL-encoded (a raw "+01:00" would turn into a space). */
  verifications: (since: string) => request<Verification[]>('/agent/inbox/verifications', { query: { since } }),
}

// ── Saved jobs (pre-autopilot flows) ─────────────────────────────────────────

export const jobsApi = {
  list: (params: { search?: string; page?: number; pageSize?: number } = {}) =>
    request<Paginated<ExtJob>>('/jobs', {
      query: { sort: 'recent', page_size: params.pageSize ?? 10, page: params.page ?? 1, search: params.search },
    }),
  autofill: (jobId: string, fields: AutofillField[], pageUrl: string) =>
    request<AutofillResult>(`/jobs/${id(jobId)}/autofill`, {
      method: 'POST',
      body: { fields, page_url: pageUrl },
      timeoutMs: AI_TIMEOUT_MS,
    }),
  extract: (body: { page_text: string; page_url: string; resume_id: string }) =>
    request<ExtractionResult>('/jobs/extract-from-extension', { method: 'POST', body, timeoutMs: AI_TIMEOUT_MS }),
  confirm: (previewToken: string) =>
    request<ExtJob>('/jobs/confirm-from-extension', { method: 'POST', body: { preview_token: previewToken } }),
}

export const resumesApi = {
  list: async () => (await request<ExtResume[] | null>('/resumes')) ?? [],
}
