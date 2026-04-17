/**
 * Chat hooks backed by React Query.
 *
 * Core flows:
 *   - useChatSession(jobId)            → lazy create/get a session (disabled until open)
 *   - useListChatSessions()            → all sessions for the user (sidebar list)
 *   - useChatMessages(sessionId)       → infinite (cursor) pagination, load-earlier
 *   - useSendChatMessage(sessionId)    → optimistic user-bubble append + AI reply append
 *   - useDeleteChatSession()           → cache cleanup
 *
 * Key behaviour:
 *   - We never refetch the full message list after a send; we append to the
 *     infinite-cache directly. This preserves scroll position and prevents
 *     flicker.
 *   - On send error we replace the optimistic user message with an error bubble
 *     and preserve the typed content so the UI can offer "Retry".
 *   - In-flight send aborts on unmount.
 */
import { useCallback, useEffect, useMemo, useRef } from 'react'
import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
  type InfiniteData,
} from '@tanstack/react-query'
import {
  createOrGetChatSessionApi,
  deleteChatSessionApi,
  getChatMessagesApi,
  listChatSessionsApi,
  sendChatMessageApi,
} from '@/api/chat'
import { queryKeys } from '@/lib/queryKeys'
import type { ApiChatMessage, ChatMessagesPage, ChatSessionSummary } from '@/lib/types'

const DEFAULT_PAGE_LIMIT = 50

// ── Sessions ──────────────────────────────────────────────────────────────────

export function useListChatSessions() {
  return useQuery({
    queryKey: queryKeys.chat.sessions(),
    queryFn: listChatSessionsApi,
    staleTime: 1000 * 30,
    gcTime: 1000 * 60 * 10,
  })
}

/**
 * Create-or-get is a mutation (backend POSTs always, returning existing if any).
 * Callers pass { jobId } and get { sessionId, summary } back.
 */
export function useCreateOrGetChatSession() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (jobId: string) => createOrGetChatSessionApi(jobId),
    onSuccess: (summary) => {
      qc.setQueryData<ChatSessionSummary[] | undefined>(
        queryKeys.chat.sessions(),
        (prev) => {
          if (!prev) return [summary]
          const existing = prev.find((s) => s.id === summary.id)
          if (existing) {
            return prev.map((s) => (s.id === summary.id ? summary : s))
          }
          return [summary, ...prev]
        },
      )
    },
  })
}

// ── Messages (infinite / cursor-paginated) ────────────────────────────────────

export function useChatMessages(sessionId: string | null) {
  return useInfiniteQuery<
    ChatMessagesPage,
    Error,
    InfiniteData<ChatMessagesPage>,
    ReturnType<typeof queryKeys.chat.messages>,
    string | undefined
  >({
    queryKey: queryKeys.chat.messages(sessionId ?? ''),
    queryFn: ({ pageParam }) =>
      getChatMessagesApi(sessionId!, { before: pageParam, limit: DEFAULT_PAGE_LIMIT }),
    initialPageParam: undefined,
    getNextPageParam: (lastPage) =>
      lastPage.has_more ? lastPage.oldest_message_id : undefined,
    enabled: !!sessionId,
    staleTime: 1000 * 30,
    gcTime: 1000 * 60 * 10,
  })
}

/**
 * Flatten infinite pages into a single oldest-first list for rendering.
 * Older pages come AFTER the initial page (chronologically before it), so we
 * reverse the page order before flattening.
 */
export function flattenChatMessages(
  data: InfiniteData<ChatMessagesPage> | undefined,
): ApiChatMessage[] {
  if (!data) return []
  const out: ApiChatMessage[] = []
  // Pages are returned in fetch order: [newest-page, older-page, older-page...].
  // Render order must be oldest → newest, so walk backwards.
  for (let i = data.pages.length - 1; i >= 0; i--) {
    for (const m of data.pages[i].messages) out.push(m)
  }
  return out
}

// ── Send (optimistic) ─────────────────────────────────────────────────────────

/**
 * Generate a stable optimistic id. The backend id is a uuid so we prefix to
 * avoid accidental collision.
 */
function optimisticId() {
  return `optimistic-${Math.random().toString(36).slice(2)}-${Date.now()}`
}

function isoNow() {
  return new Date().toISOString()
}

export function useSendChatMessage(sessionId: string | null) {
  const qc = useQueryClient()
  const abortRef = useRef<AbortController | null>(null)

  // Cancel in-flight on unmount (or session switch)
  useEffect(() => {
    return () => abortRef.current?.abort()
  }, [sessionId])

  const queryKey = useMemo(
    () => queryKeys.chat.messages(sessionId ?? ''),
    [sessionId],
  )

  const appendMessages = useCallback(
    (msgs: ApiChatMessage[]) => {
      qc.setQueryData<InfiniteData<ChatMessagesPage> | undefined>(queryKey, (prev) => {
        if (!prev || prev.pages.length === 0) {
          return {
            pages: [{ messages: msgs, has_more: false }],
            pageParams: [undefined],
          }
        }
        // Append into the FIRST page (the most-recent page from getNextPageParam
        // ordering — pages[0] is the initial fetch which is the newest window).
        const [head, ...rest] = prev.pages
        return {
          ...prev,
          pages: [{ ...head, messages: [...head.messages, ...msgs] }, ...rest],
        }
      })
    },
    [qc, queryKey],
  )

  const replaceMessage = useCallback(
    (id: string, next: ApiChatMessage) => {
      qc.setQueryData<InfiniteData<ChatMessagesPage> | undefined>(queryKey, (prev) => {
        if (!prev) return prev
        return {
          ...prev,
          pages: prev.pages.map((page) => ({
            ...page,
            messages: page.messages.map((m) => (m.id === id ? next : m)),
          })),
        }
      })
    },
    [qc, queryKey],
  )

  const removeMessage = useCallback(
    (id: string) => {
      qc.setQueryData<InfiniteData<ChatMessagesPage> | undefined>(queryKey, (prev) => {
        if (!prev) return prev
        return {
          ...prev,
          pages: prev.pages.map((page) => ({
            ...page,
            messages: page.messages.filter((m) => m.id !== id),
          })),
        }
      })
    },
    [qc, queryKey],
  )

  return useMutation<
    ApiChatMessage,
    Error & { code?: string },
    { content: string },
    { optimisticUserId: string; typingId: string; content: string }
  >({
    mutationFn: async ({ content }) => {
      if (!sessionId) throw new Error('no session')
      abortRef.current?.abort()
      const ctrl = new AbortController()
      abortRef.current = ctrl
      return sendChatMessageApi(sessionId, content, ctrl.signal)
    },
    onMutate: async ({ content }) => {
      await qc.cancelQueries({ queryKey })

      const optimisticUserId = optimisticId()
      const typingId = optimisticId()

      appendMessages([
        {
          id: optimisticUserId,
          role: 'user',
          content,
          created_at: isoNow(),
        },
        // Typing placeholder — removed when the real assistant reply lands
        {
          id: typingId,
          role: 'assistant',
          content: '',
          created_at: isoNow(),
          metadata: { finish_reason: '__typing__' },
        },
      ])

      return { optimisticUserId, typingId, content }
    },
    onSuccess: (assistantMsg, _vars, ctx) => {
      if (!ctx) return
      // Replace the typing placeholder with the real assistant message.
      replaceMessage(ctx.typingId, assistantMsg)
    },
    onError: (err, _vars, ctx) => {
      if (!ctx) return
      removeMessage(ctx.typingId)
      // Keep the optimistic user bubble but mark it visually as not-delivered.
      replaceMessage(ctx.optimisticUserId, {
        id: ctx.optimisticUserId,
        role: 'user',
        content: ctx.content,
        created_at: isoNow(),
        is_error: true,
        metadata: { finish_reason: err?.message ?? 'failed' },
      })
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: queryKeys.chat.sessions() })
    },
  })
}

// ── Delete session ────────────────────────────────────────────────────────────

export function useDeleteChatSession() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (sessionId: string) => deleteChatSessionApi(sessionId),
    onSuccess: (_data, sessionId) => {
      qc.removeQueries({ queryKey: queryKeys.chat.messages(sessionId) })
      qc.setQueryData<ChatSessionSummary[] | undefined>(
        queryKeys.chat.sessions(),
        (prev) => (prev ? prev.filter((s) => s.id !== sessionId) : prev),
      )
    },
  })
}
