import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { agentApi } from '@/background/api'
import type { Application, LeadDecision } from '@/types'

export const agentKeys = {
  overview: ['agent', 'overview'] as const,
  queue: ['agent', 'queue'] as const,
  leads: ['agent', 'leads'] as const,
  fillable: ['agent', 'fillable'] as const,
}

export const QUEUE_STATUSES = 'ready,in_progress,needs_input,failed'

export function useOverview(enabled = true) {
  return useQuery({
    queryKey: agentKeys.overview,
    queryFn: () => agentApi.overview(),
    refetchInterval: 30_000,
    enabled,
  })
}

export function useQueue(enabled = true) {
  return useQuery({
    queryKey: agentKeys.queue,
    queryFn: () => agentApi.applications({ status: QUEUE_STATUSES, page_size: 50 }),
    refetchInterval: 20_000,
    enabled,
  })
}

export function useNewLeads(sort: 'score' | 'recent', pageSize: number) {
  return useQuery({
    queryKey: [...agentKeys.leads, sort, pageSize],
    queryFn: () => agentApi.leads({ status: 'new', sort, page: 1, page_size: pageSize }),
    refetchInterval: 60_000,
    placeholderData: (prev) => prev,
  })
}

/** Applications the user can fill by hand on an open form. */
export function useFillableApplications(enabled: boolean) {
  return useQuery({
    queryKey: agentKeys.fillable,
    queryFn: async () => (await agentApi.applications({ status: 'ready,needs_input,failed', page_size: 50 })).items,
    enabled,
    staleTime: 15_000,
  })
}

export function useInvalidateAgent() {
  const qc = useQueryClient()
  return () => {
    void qc.invalidateQueries({ queryKey: ['agent'] })
  }
}

export function useDecideLead() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, decision }: { id: string; decision: LeadDecision }) => agentApi.decideLead(id, decision),
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: agentKeys.leads })
      void qc.invalidateQueries({ queryKey: agentKeys.overview })
    },
  })
}

export function useStartRun() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: () => agentApi.startRun(),
    onSettled: () => void qc.invalidateQueries({ queryKey: agentKeys.overview }),
  })
}

export function useApplicationAction() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ app, action }: { app: Application; action: 'retry' | 'cancel' | 'mark_submitted' }) => {
      if (action === 'retry') return agentApi.retry(app.id)
      if (action === 'cancel') return agentApi.cancel(app.id)
      return agentApi.result(app.id, { status: 'submitted', message: 'Marked as submitted in the extension' })
    },
    onSettled: () => void qc.invalidateQueries({ queryKey: ['agent'] }),
  })
}
