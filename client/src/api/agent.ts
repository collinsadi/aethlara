/**
 * Autopilot (agent) API calls. See server/docs.md "Autopilot (Agent)".
 *
 * GET    /agent/overview                  → AgentOverview
 * GET    /agent/profile · PUT /agent/profile → AgentProfile
 * GET    /agent/sources                   → AgentSourcesCatalog
 * POST   /agent/runs                      → AgentRun (202, AI gate)
 * GET    /agent/events?before=&limit=     → AgentEvent[]
 * GET    /agent/leads                     → Paginated<Lead>
 * GET    /agent/leads/:id                 → { lead, application }
 * POST   /agent/leads/:id/decision        → { lead, application }
 * POST   /agent/leads/decisions           → { results }
 * POST   /agent/leads                     → { lead, application } (201, AI gate)
 * GET    /agent/applications              → Paginated<AgentApplication>
 * GET    /agent/applications/:id          → AgentApplication (+ cover_letter)
 * POST   /agent/applications/:id/answers|retry|cancel → AgentApplication
 * GET    /agent/inbox · GET /agent/inbox/:id · POST /agent/inbox/:id/read
 * GET    /agent/answers · PUT /agent/answers · DELETE /agent/answers/:id
 */
import { apiClient } from '@/api/client'
import type { ApiSuccessResponse } from '@/lib/types'
import type {
  AgentApplication,
  AgentEvent,
  AgentOverview,
  AgentProfile,
  AgentProfileUpdate,
  AgentRun,
  AgentSourcesCatalog,
  BulkDecisionResult,
  InboxMessage,
  InboxMessageDetail,
  LeadDecision,
  LeadDecisionResult,
  LeadDetailResponse,
  Lead,
  Paginated,
  QuestionAnswer,
  SavedAnswer,
} from '@/lib/agentTypes'
import type { LeadFilters } from '@/lib/queryKeys'

/** Adding a job scrapes the page, extracts it with AI and scores it. */
const ADD_LEAD_TIMEOUT_MS = 120_000

// ── Overview / profile / sources ─────────────────────────────────────────────

export async function getAgentOverviewApi(): Promise<AgentOverview> {
  const res = await apiClient.get<ApiSuccessResponse<AgentOverview>>('/agent/overview')
  return res.data.data!
}

export async function getAgentProfileApi(): Promise<AgentProfile> {
  const res = await apiClient.get<ApiSuccessResponse<AgentProfile>>('/agent/profile')
  return res.data.data!
}

export async function updateAgentProfileApi(update: AgentProfileUpdate): Promise<AgentProfile> {
  const res = await apiClient.put<ApiSuccessResponse<AgentProfile>>('/agent/profile', update)
  return res.data.data!
}

export async function getAgentSourcesApi(): Promise<AgentSourcesCatalog> {
  const res = await apiClient.get<ApiSuccessResponse<AgentSourcesCatalog>>('/agent/sources')
  return res.data.data!
}

// ── Runs / events ────────────────────────────────────────────────────────────

export async function startAgentRunApi(): Promise<AgentRun> {
  const res = await apiClient.post<ApiSuccessResponse<AgentRun>>('/agent/runs')
  return res.data.data!
}

export async function listAgentEventsApi(params: {
  before?: number
  limit?: number
}): Promise<AgentEvent[]> {
  const res = await apiClient.get<ApiSuccessResponse<AgentEvent[]>>('/agent/events', {
    params: {
      ...(params.before ? { before: params.before } : {}),
      limit: params.limit ?? 20,
    },
  })
  return res.data.data ?? []
}

// ── Leads ────────────────────────────────────────────────────────────────────

export async function listLeadsApi(
  filters: LeadFilters & { page: number; page_size: number }
): Promise<Paginated<Lead>> {
  const params: Record<string, string | number> = {
    status: filters.status,
    page: filters.page,
    page_size: filters.page_size,
    sort: filters.sort ?? 'score',
  }
  if (filters.min_score !== undefined) params.min_score = filters.min_score
  if (filters.source) params.source = filters.source
  if (filters.remote !== undefined) params.remote = String(filters.remote)
  if (filters.search) params.search = filters.search
  const res = await apiClient.get<ApiSuccessResponse<Paginated<Lead>>>('/agent/leads', { params })
  return res.data.data!
}

export async function getLeadApi(id: string): Promise<LeadDetailResponse> {
  const res = await apiClient.get<ApiSuccessResponse<LeadDetailResponse>>(`/agent/leads/${id}`)
  return res.data.data!
}

export async function decideLeadApi(id: string, decision: LeadDecision): Promise<LeadDecisionResult> {
  const res = await apiClient.post<ApiSuccessResponse<LeadDecisionResult>>(
    `/agent/leads/${id}/decision`,
    { decision }
  )
  return res.data.data!
}

export async function decideLeadsApi(ids: string[], decision: LeadDecision): Promise<BulkDecisionResult> {
  const res = await apiClient.post<ApiSuccessResponse<BulkDecisionResult>>('/agent/leads/decisions', {
    ids,
    decision,
  })
  return res.data.data!
}

export async function addLeadApi(input: { url: string; approve: boolean }): Promise<LeadDecisionResult> {
  const res = await apiClient.post<ApiSuccessResponse<LeadDecisionResult>>(
    '/agent/leads',
    { url: input.url, approve: input.approve, source: 'manual' },
    { timeout: ADD_LEAD_TIMEOUT_MS }
  )
  return res.data.data!
}

// ── Applications ─────────────────────────────────────────────────────────────

export async function listApplicationsApi(params: {
  status: string
  page: number
  page_size: number
}): Promise<Paginated<AgentApplication>> {
  const res = await apiClient.get<ApiSuccessResponse<Paginated<AgentApplication>>>(
    '/agent/applications',
    { params }
  )
  return res.data.data!
}

export async function getApplicationApi(id: string): Promise<AgentApplication> {
  const res = await apiClient.get<ApiSuccessResponse<AgentApplication>>(`/agent/applications/${id}`)
  return res.data.data!
}

export async function answerApplicationApi(
  id: string,
  answers: QuestionAnswer[]
): Promise<AgentApplication> {
  const res = await apiClient.post<ApiSuccessResponse<AgentApplication>>(
    `/agent/applications/${id}/answers`,
    { answers }
  )
  return res.data.data!
}

export async function retryApplicationApi(id: string): Promise<AgentApplication> {
  const res = await apiClient.post<ApiSuccessResponse<AgentApplication>>(`/agent/applications/${id}/retry`)
  return res.data.data!
}

export async function cancelApplicationApi(id: string): Promise<AgentApplication> {
  const res = await apiClient.post<ApiSuccessResponse<AgentApplication>>(`/agent/applications/${id}/cancel`)
  return res.data.data!
}

/** The user finished this application by hand (CAPTCHA, sign-in, unusual form). */
export async function markApplicationSubmittedApi(id: string): Promise<AgentApplication> {
  const res = await apiClient.post<ApiSuccessResponse<AgentApplication>>(`/agent/applications/${id}/result`, {
    status: 'submitted',
    message: 'Submitted manually by the user',
  })
  return res.data.data!
}

// ── Inbox ────────────────────────────────────────────────────────────────────

export async function listInboxApi(params: {
  category: string
  page: number
  page_size: number
}): Promise<Paginated<InboxMessage>> {
  const res = await apiClient.get<ApiSuccessResponse<Paginated<InboxMessage>>>('/agent/inbox', {
    params: {
      ...(params.category ? { category: params.category } : {}),
      page: params.page,
      page_size: params.page_size,
    },
  })
  return res.data.data!
}

export async function getInboxMessageApi(id: string): Promise<InboxMessageDetail> {
  const res = await apiClient.get<ApiSuccessResponse<InboxMessageDetail>>(`/agent/inbox/${id}`)
  return res.data.data!
}

export async function markInboxReadApi(id: string, read: boolean): Promise<void> {
  await apiClient.post(`/agent/inbox/${id}/read`, { read })
}

// ── Saved answers ────────────────────────────────────────────────────────────

export async function listSavedAnswersApi(): Promise<SavedAnswer[]> {
  const res = await apiClient.get<ApiSuccessResponse<SavedAnswer[]>>('/agent/answers')
  return res.data.data ?? []
}

export async function upsertSavedAnswerApi(input: QuestionAnswer): Promise<SavedAnswer> {
  const res = await apiClient.put<ApiSuccessResponse<SavedAnswer>>('/agent/answers', input)
  return res.data.data!
}

export async function deleteSavedAnswerApi(id: string): Promise<void> {
  await apiClient.delete(`/agent/answers/${id}`)
}
