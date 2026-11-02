/**
 * Autopilot applications: grouped lists, detail (with cover letter) and the
 * user actions — answer questions, retry, cancel, mark as applied by hand.
 */
import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
  type QueryClient,
} from '@tanstack/react-query'
import {
  answerApplicationApi,
  cancelApplicationApi,
  getApplicationApi,
  listApplicationsApi,
  markApplicationSubmittedApi,
  retryApplicationApi,
} from '@/api/agent'
import type { QuestionAnswer } from '@/lib/agentTypes'
import { queryKeys } from '@/lib/queryKeys'

const APPLICATIONS_PAGE_SIZE = 25

export function useApplicationList(status: string, options: { poll?: boolean; enabled?: boolean } = {}) {
  return useInfiniteQuery({
    queryKey: queryKeys.agent.applicationList({ status }),
    queryFn: ({ pageParam }) =>
      listApplicationsApi({ status, page: pageParam, page_size: APPLICATIONS_PAGE_SIZE }),
    initialPageParam: 1,
    getNextPageParam: (last) =>
      last.pagination.has_next ? last.pagination.page + 1 : undefined,
    staleTime: 20_000,
    refetchOnWindowFocus: true,
    // The extension claims and submits in the background.
    refetchInterval: options.poll ? 15_000 : false,
    enabled: options.enabled ?? true,
  })
}

export function useApplication(id: string | null) {
  return useQuery({
    queryKey: queryKeys.agent.application(id ?? ''),
    queryFn: () => getApplicationApi(id!),
    enabled: !!id,
    staleTime: 60_000,
  })
}

function refreshApplications(qc: QueryClient) {
  qc.invalidateQueries({ queryKey: queryKeys.agent.applications() })
  qc.invalidateQueries({ queryKey: queryKeys.agent.overview() })
  qc.invalidateQueries({ queryKey: queryKeys.agent.leads(), refetchType: 'none' })
}

export function useAnswerApplication() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, answers }: { id: string; answers: QuestionAnswer[] }) =>
      answerApplicationApi(id, answers),
    onSuccess: () => {
      refreshApplications(qc)
      qc.invalidateQueries({ queryKey: queryKeys.agent.answers() })
    },
  })
}

export function useRetryApplication() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => retryApplicationApi(id),
    onSettled: () => refreshApplications(qc),
  })
}

export function useCancelApplication() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => cancelApplicationApi(id),
    onSettled: () => refreshApplications(qc),
  })
}

export function useMarkApplicationSubmitted() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => markApplicationSubmittedApi(id),
    onSettled: () => {
      refreshApplications(qc)
      // The tracker job moves to "applied".
      qc.invalidateQueries({ queryKey: queryKeys.jobs.all() })
    },
  })
}
