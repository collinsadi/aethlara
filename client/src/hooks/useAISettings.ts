/**
 * AI provider settings (GET/PUT /settings/ai).
 *
 * The settings payload is the single source of truth for which provider is
 * active, which keys are stored (metadata only) and which models are used.
 * Every mutation here also refreshes the autopilot overview, whose setup
 * checklist depends on the active provider's key.
 */
import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query'
import { getAISettingsApi, updateAISettingsApi, type AISettings } from '@/api/settings'
import { queryKeys } from '@/lib/queryKeys'

export function useAISettings() {
  return useQuery({
    queryKey: queryKeys.settings.ai(),
    queryFn: getAISettingsApi,
    staleTime: 1000 * 60 * 5,
  })
}

export function refreshAIDependents(qc: QueryClient) {
  qc.invalidateQueries({ queryKey: queryKeys.settings.ai() })
  qc.invalidateQueries({ queryKey: queryKeys.agent.overview() })
}

export function useUpdateAISettings() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: updateAISettingsApi,
    onSuccess: (data: AISettings) => {
      qc.setQueryData(queryKeys.settings.ai(), data)
      qc.invalidateQueries({ queryKey: queryKeys.agent.overview() })
    },
  })
}
