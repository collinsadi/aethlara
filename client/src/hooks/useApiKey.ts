/**
 * Provider API keys (Anthropic / OpenRouter). Keys are write-only: the
 * dashboard only ever sees metadata from GET /settings/ai.
 */
import { useMutation, useQueryClient } from '@tanstack/react-query'
import {
  deleteApiKeyApi,
  saveApiKeyApi,
  validateApiKeyApi,
  type AIProviderId,
  type ApiKeyMetadata,
} from '@/api/settings'
import { refreshAIDependents, useAISettings } from '@/hooks/useAISettings'

/** Stored key metadata for `provider` (default: the active provider). */
export function useApiKey(provider?: AIProviderId): {
  data: ApiKeyMetadata | null
  isLoading: boolean
  isError: boolean
} {
  const { data, isLoading, isError } = useAISettings()
  const target = provider ?? data?.provider
  return {
    data: data?.keys.find((k) => k.provider === target) ?? null,
    isLoading,
    isError,
  }
}

export function useSaveApiKey() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: saveApiKeyApi,
    onSuccess: () => refreshAIDependents(qc),
  })
}

export function useDeleteApiKey() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (provider: AIProviderId) => deleteApiKeyApi(provider),
    onSuccess: () => refreshAIDependents(qc),
  })
}

export function useValidateApiKey() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (provider: AIProviderId) => validateApiKeyApi(provider),
    onSettled: () => refreshAIDependents(qc),
  })
}
