import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { queryKeys } from '@/lib/queryKeys'
import {
  getApiKeyApi,
  saveApiKeyApi,
  deleteApiKeyApi,
  validateApiKeyApi,
} from '@/api/settings'

export function useApiKey() {
  return useQuery({
    queryKey: queryKeys.settings.apiKey(),
    queryFn: getApiKeyApi,
    staleTime: 1000 * 60 * 5,
  })
}

export function useSaveApiKey() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ apiKey, label }: { apiKey: string; label?: string }) =>
      saveApiKeyApi(apiKey, label),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.settings.apiKey() })
    },
  })
}

export function useDeleteApiKey() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: deleteApiKeyApi,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.settings.apiKey() })
    },
  })
}

export function useValidateApiKey() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: validateApiKeyApi,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.settings.apiKey() })
    },
  })
}
