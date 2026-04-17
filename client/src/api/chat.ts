/**
 * Chat API calls.
 *
 * POST   /chat/sessions                                   → { data: ChatSessionSummary }
 * GET    /chat/sessions                                   → { data: { items: ChatSessionSummary[] } }
 * GET    /chat/sessions/:id/messages?before=<id>&limit=50 → { data: ChatMessagesPage }
 * POST   /chat/sessions/:id/messages                      → { data: ApiChatMessage }
 * DELETE /chat/sessions/:id                               → { data: { id } }
 *
 * All endpoints require auth. POST endpoints additionally require a valid
 * per-user OpenRouter key on file — the backend returns:
 *   { error: { code: "API_KEY_REQUIRED", ... } }
 * which the UI layer converts into a gate prompt.
 */
import { apiClient } from '@/api/client'
import type {
  ApiSuccessResponse,
  ApiChatMessage,
  ChatMessagesPage,
  ChatSessionSummary,
} from '@/lib/types'

/** Chat send waits on the AI call — the backend allows up to JOB_AI_TIMEOUT_SECONDS. */
const CHAT_SEND_TIMEOUT_MS = 90_000

export async function createOrGetChatSessionApi(jobId: string): Promise<ChatSessionSummary> {
  const res = await apiClient.post<ApiSuccessResponse<ChatSessionSummary>>('/chat/sessions', {
    job_id: jobId,
  })
  return res.data.data!
}

export async function listChatSessionsApi(): Promise<ChatSessionSummary[]> {
  const res = await apiClient.get<ApiSuccessResponse<{ items: ChatSessionSummary[] }>>('/chat/sessions')
  return res.data.data?.items ?? []
}

export interface GetChatMessagesParams {
  /** Cursor — oldest currently-loaded message id, exclusive. */
  before?: string
  limit?: number
}

export async function getChatMessagesApi(
  sessionId: string,
  params: GetChatMessagesParams = {},
): Promise<ChatMessagesPage> {
  const qs: Record<string, string | number> = {}
  if (params.before) qs.before = params.before
  if (params.limit) qs.limit = Math.min(Math.max(params.limit, 1), 100)

  const res = await apiClient.get<ApiSuccessResponse<ChatMessagesPage>>(
    `/chat/sessions/${sessionId}/messages`,
    { params: qs },
  )
  const data = res.data.data!
  return {
    messages: data.messages ?? [],
    has_more: !!data.has_more,
    oldest_message_id: data.oldest_message_id,
  }
}

export async function sendChatMessageApi(
  sessionId: string,
  content: string,
  signal?: AbortSignal,
): Promise<ApiChatMessage> {
  const res = await apiClient.post<ApiSuccessResponse<ApiChatMessage>>(
    `/chat/sessions/${sessionId}/messages`,
    { content },
    { timeout: CHAT_SEND_TIMEOUT_MS, signal },
  )
  return res.data.data!
}

export async function deleteChatSessionApi(sessionId: string): Promise<{ id: string }> {
  const res = await apiClient.delete<ApiSuccessResponse<{ id: string }>>(
    `/chat/sessions/${sessionId}`,
  )
  return res.data.data!
}
