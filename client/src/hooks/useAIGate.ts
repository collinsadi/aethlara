import { useApiKey } from '@/hooks/useApiKey'

export function useAIGate() {
  const { data: apiKey, isLoading } = useApiKey()

  return {
    hasKey: !!apiKey && apiKey.validation_status === 'valid',
    isLoading,
    keyPrefix: apiKey?.key_prefix ?? null,
    validationStatus: apiKey?.validation_status ?? null,
  }
}
