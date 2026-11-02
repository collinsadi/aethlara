/** Saved form answers the agent reuses on every application. */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { deleteSavedAnswerApi, listSavedAnswersApi, upsertSavedAnswerApi } from '@/api/agent'
import type { SavedAnswer } from '@/lib/agentTypes'
import { queryKeys } from '@/lib/queryKeys'

export function useSavedAnswers() {
  return useQuery({
    queryKey: queryKeys.agent.answers(),
    queryFn: listSavedAnswersApi,
    staleTime: 60_000,
  })
}

export function useUpsertSavedAnswer() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: upsertSavedAnswerApi,
    onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.agent.answers() }),
  })
}

export function useDeleteSavedAnswer() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => deleteSavedAnswerApi(id),
    onMutate: async (id) => {
      await qc.cancelQueries({ queryKey: queryKeys.agent.answers() })
      const previous = qc.getQueryData<SavedAnswer[]>(queryKeys.agent.answers())
      qc.setQueryData<SavedAnswer[]>(queryKeys.agent.answers(), (old) => old?.filter((a) => a.id !== id))
      return { previous }
    },
    onError: (_err, _id, context) => {
      if (context?.previous) qc.setQueryData(queryKeys.agent.answers(), context.previous)
    },
    onSettled: () => qc.invalidateQueries({ queryKey: queryKeys.agent.answers() }),
  })
}
