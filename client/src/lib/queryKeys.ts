/**
 * Centralised React Query key factory.
 *
 * All query keys live here — no inline string keys anywhere in the codebase.
 * Key hierarchy:
 *   jobs → jobs/list → jobs/list/{filters}
 *                   → jobs/detail/{id}
 *                   → jobs/pdf/{id}
 *   analytics → analytics/dashboard
 *
 * Invalidation rules:
 *   - job created     → invalidate jobs.lists() + analytics.dashboard()
 *   - job status update → invalidate jobs.detail(id) + jobs.lists() + analytics.dashboard()
 *   - job deleted     → invalidate jobs.lists() + analytics.dashboard(), remove jobs.detail(id)
 *   - chat session created → invalidate chat.sessions()
 *   - chat message sent    → append to chat.messages(sessionId) infinite cache; do NOT refetch
 *   - chat session deleted → invalidate chat.sessions(); remove chat.messages(sessionId)
 *   - logout          → queryClient.clear()
 */

export interface JobFilters {
  page?: number
  page_size?: number
  sort?: 'recent' | 'best_match'
  status?: string
  employment_type?: string
  is_remote?: boolean
  min_match?: number
  search?: string
}

export const queryKeys = {
  jobs: {
    all:    () => ['jobs'] as const,
    lists:  () => [...queryKeys.jobs.all(), 'list'] as const,
    list:   (filters: JobFilters) => [...queryKeys.jobs.lists(), filters] as const,
    detail: (id: string) => [...queryKeys.jobs.all(), 'detail', id] as const,
    pdf:    (id: string) => [...queryKeys.jobs.all(), 'pdf', id] as const,
  },
  analytics: {
    all:       () => ['analytics'] as const,
    dashboard: () => [...queryKeys.analytics.all(), 'dashboard'] as const,
  },
  settings: {
    all:     () => ['settings'] as const,
    apiKey:  () => [...queryKeys.settings.all(), 'api-key'] as const,
    profile: () => [...queryKeys.settings.all(), 'profile'] as const,
  },
  user: {
    all: () => ['user'] as const,
    me:  () => [...queryKeys.user.all(), 'me'] as const,
  },
  chat: {
    all:      () => ['chat'] as const,
    sessions: () => [...queryKeys.chat.all(), 'sessions'] as const,
    session:  (sessionId: string) => [...queryKeys.chat.sessions(), sessionId] as const,
    messages: (sessionId: string) => [...queryKeys.chat.session(sessionId), 'messages'] as const,
  },
} as const
