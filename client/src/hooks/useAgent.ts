/**
 * Autopilot core hooks: overview (home + nav badges), profile, sources,
 * runs and the activity feed.
 *
 * Polling: while `running_run` is set the overview refetches every 4s. The
 * run watcher (mounted once in AppLayout) notices when a run finishes and
 * refreshes leads, applications, inbox and the feed.
 */
import { useEffect, useRef } from 'react'
import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query'
import {
  getAgentOverviewApi,
  getAgentProfileApi,
  getAgentSourcesApi,
  listAgentEventsApi,
  startAgentRunApi,
  updateAgentProfileApi,
} from '@/api/agent'
import type { AgentEvent, AgentOverview, AgentProfile, AgentProfileUpdate, AgentRun } from '@/lib/agentTypes'
import { summarizeRunStats } from '@/lib/agentFormat'
import { hasErrorCode } from '@/lib/apiError'
import { queryKeys } from '@/lib/queryKeys'
import { toast } from '@/lib/toast'

export const RUN_POLL_MS = 4000
const DUE_POLL_MS = 10_000
/** Matches the overview's `recent_events` window, which seeds the first page. */
const EVENTS_PAGE_SIZE = 12

// ── Overview ─────────────────────────────────────────────────────────────────

/** Poll fast while a run is live, gently while a scheduled run is due. */
function overviewPollInterval(data: AgentOverview | undefined): number | false {
  if (!data) return false
  if (data.running_run) return RUN_POLL_MS
  const next = data.profile.next_run_at
  if (data.profile.enabled && next && new Date(next).getTime() <= Date.now() + 60_000) return DUE_POLL_MS
  return false
}

export function useAgentOverview() {
  return useQuery({
    queryKey: queryKeys.agent.overview(),
    queryFn: getAgentOverviewApi,
    staleTime: 30_000,
    refetchOnWindowFocus: true,
    refetchInterval: (query) => overviewPollInterval(query.state.data),
  })
}

/** Writes a fresh profile into both the profile and overview caches. */
function writeProfile(qc: ReturnType<typeof useQueryClient>, profile: AgentProfile) {
  qc.setQueryData(queryKeys.agent.profile(), profile)
  qc.setQueryData<AgentOverview>(queryKeys.agent.overview(), (old) => (old ? { ...old, profile } : old))
}

// ── Profile ──────────────────────────────────────────────────────────────────

export function useAgentProfile() {
  const qc = useQueryClient()
  return useQuery({
    queryKey: queryKeys.agent.profile(),
    queryFn: getAgentProfileApi,
    staleTime: 60_000,
    placeholderData: () => qc.getQueryData<AgentOverview>(queryKeys.agent.overview())?.profile,
  })
}

export function useUpdateAgentProfile() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (update: AgentProfileUpdate) => updateAgentProfileApi(update),
    onSuccess: (profile) => {
      writeProfile(qc, profile)
      // Setup flags (preferences, mailbox) are derived from the profile.
      qc.invalidateQueries({ queryKey: queryKeys.agent.overview() })
    },
  })
}

/** Optimistic on/off switch for the autopilot. */
export function useToggleAutopilot() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (enabled: boolean) => updateAgentProfileApi({ enabled }),
    onMutate: async (enabled) => {
      await qc.cancelQueries({ queryKey: queryKeys.agent.overview() })
      const previous = qc.getQueryData<AgentOverview>(queryKeys.agent.overview())
      qc.setQueryData<AgentOverview>(queryKeys.agent.overview(), (old) =>
        old ? { ...old, profile: { ...old.profile, enabled } } : old
      )
      return { previous }
    },
    onError: (_err, _enabled, context) => {
      if (context?.previous) qc.setQueryData(queryKeys.agent.overview(), context.previous)
    },
    onSuccess: (profile) => writeProfile(qc, profile),
    onSettled: () => {
      qc.invalidateQueries({ queryKey: queryKeys.agent.overview() })
    },
  })
}

// ── Sources ──────────────────────────────────────────────────────────────────

export function useAgentSources() {
  return useQuery({
    queryKey: queryKeys.agent.sources(),
    queryFn: getAgentSourcesApi,
    staleTime: 1000 * 60 * 60,
    gcTime: 1000 * 60 * 60,
  })
}

// ── Runs ─────────────────────────────────────────────────────────────────────

export function useStartRun() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: startAgentRunApi,
    onSuccess: (run: AgentRun) => {
      // Flip the home screen into its live state right away; polling takes over.
      qc.setQueryData<AgentOverview>(queryKeys.agent.overview(), (old) =>
        old ? { ...old, running_run: run } : old
      )
      qc.invalidateQueries({ queryKey: queryKeys.agent.overview() })
      qc.invalidateQueries({ queryKey: queryKeys.agent.events() })
    },
    onError: (err) => {
      if (hasErrorCode(err, 'RUN_IN_PROGRESS')) {
        qc.invalidateQueries({ queryKey: queryKeys.agent.overview() })
      }
    },
  })
}

// ── Activity feed ────────────────────────────────────────────────────────────

/**
 * Activity feed. The first page is seeded from the overview's
 * `recent_events`; "Load more" pages back with `?before=<event id>`.
 */
export function useAgentEvents(seed?: { events: AgentEvent[]; updatedAt: number }) {
  return useInfiniteQuery({
    queryKey: queryKeys.agent.events(),
    queryFn: ({ pageParam }) =>
      listAgentEventsApi({ before: pageParam || undefined, limit: EVENTS_PAGE_SIZE }),
    initialPageParam: 0,
    getNextPageParam: (last) =>
      last.length === EVENTS_PAGE_SIZE ? last[last.length - 1].id : undefined,
    initialData: seed ? { pages: [seed.events], pageParams: [0] } : undefined,
    initialDataUpdatedAt: seed?.updatedAt,
    staleTime: 30_000,
  })
}

/**
 * Mount once (AppLayout). Refreshes dependent data when a run finishes and
 * keeps the activity feed in step with the overview's newest event.
 */
export function useAgentRunWatcher() {
  const qc = useQueryClient()
  const { data } = useAgentOverview()
  const runningId = data?.running_run?.id ?? null
  const lastRun = data?.last_run ?? null
  const latestEventId = data?.recent_events[0]?.id ?? null

  const prevRunning = useRef<string | null>(null)
  useEffect(() => {
    const finishedId = prevRunning.current
    prevRunning.current = runningId
    if (!finishedId || runningId) return

    for (const queryKey of [
      queryKeys.agent.leads(),
      queryKeys.agent.applications(),
      queryKeys.agent.inbox(),
      queryKeys.agent.events(),
      queryKeys.jobs.lists(),
      queryKeys.analytics.dashboard(),
    ]) {
      qc.invalidateQueries({ queryKey })
    }

    if (lastRun?.id !== finishedId) return
    if (lastRun.status === 'failed') {
      toast.error('Autopilot run failed', {
        description: lastRun.error ?? 'Open Autopilot for details.',
        link: { label: 'View activity', to: '/agent' },
      })
    } else {
      toast.success('Autopilot run finished', {
        description: summarizeRunStats(lastRun.stats),
        link: lastRun.stats.new_leads > 0 ? { label: 'Review jobs', to: '/review' } : undefined,
      })
    }
  }, [runningId, lastRun, qc])

  const prevEvent = useRef<number | null>(null)
  useEffect(() => {
    if (prevEvent.current !== null && latestEventId !== prevEvent.current) {
      qc.invalidateQueries({ queryKey: queryKeys.agent.events() })
    }
    prevEvent.current = latestEventId
  }, [latestEventId, qc])
}
