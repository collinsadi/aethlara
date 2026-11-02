/**
 * Review queue hooks: lead lists, lead detail, decisions and "add by URL".
 *
 * Decisions are applied optimistically by the Review page (it hides the
 * lead immediately); these hooks only talk to the server and keep the
 * dependent caches honest:
 *   - every lead list is marked stale WITHOUT refetching the visible one
 *     (a refetch mid-triage would reshuffle the list under the cursor),
 *   - overview counts and applications are refreshed.
 */
import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
  type QueryClient,
} from '@tanstack/react-query'
import {
  addLeadApi,
  decideLeadApi,
  decideLeadsApi,
  getLeadApi,
  listLeadsApi,
} from '@/api/agent'
import type { LeadDecision } from '@/lib/agentTypes'
import { friendlyErrorMessage, tidyErrorText } from '@/lib/apiError'
import { queryKeys, type LeadFilters } from '@/lib/queryKeys'

export const LEADS_PAGE_SIZE = 50

export function useLeadList(filters: LeadFilters) {
  return useInfiniteQuery({
    queryKey: queryKeys.agent.leadList(filters),
    queryFn: ({ pageParam }) =>
      listLeadsApi({ ...filters, page: pageParam, page_size: LEADS_PAGE_SIZE }),
    initialPageParam: 1,
    getNextPageParam: (last) =>
      last.pagination.has_next ? last.pagination.page + 1 : undefined,
    staleTime: 60_000,
    // Keep showing the current list while a filter change loads — but never
    // carry one queue's leads over into another (status = the Review tab).
    placeholderData: (previous, previousQuery) =>
      (previousQuery?.queryKey[3] as LeadFilters | undefined)?.status === filters.status ? previous : undefined,
  })
}

export function useLead(id: string | null) {
  return useQuery({
    queryKey: queryKeys.agent.lead(id ?? ''),
    queryFn: () => getLeadApi(id!),
    enabled: !!id,
    staleTime: 60_000,
  })
}

/** Warm the detail cache (used for the next lead while triaging). */
export function prefetchLead(qc: QueryClient, id: string) {
  return qc.prefetchQuery({
    queryKey: queryKeys.agent.lead(id),
    queryFn: () => getLeadApi(id),
    staleTime: 60_000,
  })
}

export interface DecisionOutcome {
  ok: string[]
  failed: { id: string; error: string }[]
}

async function decide(ids: string[], decision: LeadDecision): Promise<DecisionOutcome> {
  if (ids.length === 1) {
    try {
      await decideLeadApi(ids[0], decision)
      return { ok: ids, failed: [] }
    } catch (err) {
      return { ok: [], failed: [{ id: ids[0], error: friendlyErrorMessage(err) }] }
    }
  }
  // The bulk endpoint takes 1-100 ids per call.
  const outcome: DecisionOutcome = { ok: [], failed: [] }
  for (let i = 0; i < ids.length; i += 100) {
    const { results } = await decideLeadsApi(ids.slice(i, i + 100), decision)
    for (const r of results) {
      if (r.ok) outcome.ok.push(r.id)
      else outcome.failed.push({ id: r.id, error: tidyErrorText(r.error ?? '') })
    }
  }
  return outcome
}

function markLeadDataStale(qc: QueryClient) {
  qc.invalidateQueries({ queryKey: queryKeys.agent.leads(), refetchType: 'none' })
  qc.invalidateQueries({ queryKey: queryKeys.agent.overview() })
  qc.invalidateQueries({ queryKey: queryKeys.agent.applications() })
}

/**
 * Approve / dismiss / reset one or many leads (single ids use the per-lead
 * endpoint, 2-100 ids the bulk endpoint). Resolves with per-id outcomes;
 * rejects only when the request itself failed.
 */
export function useLeadDecision() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ ids, decision }: { ids: string[]; decision: LeadDecision }) => decide(ids, decision),
    onSettled: () => markLeadDataStale(qc),
  })
}

export function useAddLead() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: addLeadApi,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.agent.leads() })
      qc.invalidateQueries({ queryKey: queryKeys.agent.overview() })
      qc.invalidateQueries({ queryKey: queryKeys.agent.applications() })
    },
  })
}
