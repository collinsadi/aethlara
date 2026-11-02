/**
 * Centralised React Query key factory.
 *
 * All query keys live here — no inline string keys anywhere in the codebase.
 * Key hierarchy:
 *   jobs → jobs/list → jobs/list/{filters}
 *                   → jobs/detail/{id}
 *                   → jobs/pdf/{id}
 *   analytics → analytics/dashboard
 *   resumes → resumes/list, resumes/preview/{id}
 *   agent → agent/overview, agent/profile, agent/sources, agent/events,
 *           agent/leads/{list|detail}, agent/applications/{list|detail},
 *           agent/inbox/{list|detail}, agent/answers
 *
 * Invalidation rules:
 *   - job created     → invalidate jobs.lists() + analytics.dashboard()
 *   - job status update → invalidate jobs.detail(id) + jobs.lists() + analytics.dashboard()
 *   - job deleted     → invalidate jobs.lists() + analytics.dashboard(), remove jobs.detail(id)
 *   - chat session created → invalidate chat.sessions()
 *   - chat message sent    → append to chat.messages(sessionId) infinite cache; do NOT refetch
 *   - chat session deleted → invalidate chat.sessions(); remove chat.messages(sessionId)
 *   - agent profile saved → write agent.profile() + agent.overview().profile, invalidate agent.overview()
 *   - lead decision   → optimistic removal from agent.leadList(*), mark agent.leads() stale,
 *                       invalidate agent.overview() + agent.applications()
 *   - run finished    → invalidate agent.leads() + agent.applications() + agent.events() + agent.inbox()
 *   - application answered/retried/cancelled → invalidate agent.applications() + agent.overview()
 *   - message read    → patch agent.inboxList(*) in place, invalidate agent.overview()
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

/** Filters for `GET /agent/leads` (page params are handled by the infinite query). */
export interface LeadFilters {
  /** Comma-separated lead statuses. */
  status: string
  min_score?: number
  source?: string
  remote?: boolean
  search?: string
  sort?: 'score' | 'recent'
}

/** Filters for `GET /agent/applications`. */
export interface ApplicationFilters {
  /** Comma-separated application statuses. */
  status: string
}

/** Filters for `GET /agent/inbox`. */
export interface InboxFilters {
  category: string
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
  resumes: {
    all:        () => ['resumes'] as const,
    list:       () => [...queryKeys.resumes.all(), 'list'] as const,
    previewUrl: (id: string) => [...queryKeys.resumes.all(), 'preview', id] as const,
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
  agent: {
    all:             () => ['agent'] as const,
    overview:        () => [...queryKeys.agent.all(), 'overview'] as const,
    profile:         () => [...queryKeys.agent.all(), 'profile'] as const,
    sources:         () => [...queryKeys.agent.all(), 'sources'] as const,
    events:          () => [...queryKeys.agent.all(), 'events'] as const,
    leads:           () => [...queryKeys.agent.all(), 'leads'] as const,
    leadLists:       () => [...queryKeys.agent.leads(), 'list'] as const,
    leadList:        (filters: LeadFilters) => [...queryKeys.agent.leadLists(), filters] as const,
    lead:            (id: string) => [...queryKeys.agent.leads(), 'detail', id] as const,
    applications:    () => [...queryKeys.agent.all(), 'applications'] as const,
    applicationList: (filters: ApplicationFilters) =>
      [...queryKeys.agent.applications(), 'list', filters] as const,
    application:     (id: string) => [...queryKeys.agent.applications(), 'detail', id] as const,
    inbox:           () => [...queryKeys.agent.all(), 'inbox'] as const,
    inboxLists:      () => [...queryKeys.agent.inbox(), 'list'] as const,
    inboxList:       (filters: InboxFilters) => [...queryKeys.agent.inboxLists(), filters] as const,
    message:         (id: string) => [...queryKeys.agent.inbox(), 'detail', id] as const,
    answers:         () => [...queryKeys.agent.all(), 'answers'] as const,
  },
} as const
