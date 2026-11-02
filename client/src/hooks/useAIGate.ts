import { useAISettings } from '@/hooks/useAISettings'

/**
 * Whether AI features can run: the ACTIVE provider (Anthropic or OpenRouter)
 * must have a valid key — the same rule as the server's AIGate middleware.
 *
 * If the settings request itself fails we don't block the UI: the server
 * still enforces the gate and answers 403 API_KEY_REQUIRED.
 */
export function useAIGate() {
  const { data, isLoading, isError } = useAISettings()
  const provider = data?.provider ?? null
  const activeKey = data?.keys.find((k) => k.provider === provider) ?? null
  const providerLabel =
    data?.providers.find((p) => p.id === provider)?.label ?? (provider === 'anthropic' ? 'Anthropic' : 'OpenRouter')

  return {
    hasKey: isError || activeKey?.validation_status === 'valid',
    isLoading,
    provider,
    providerLabel,
    /** A key exists for the active provider but is not usable (invalid / revoked / unvalidated). */
    keyNeedsAttention: !!activeKey && activeKey.validation_status !== 'valid',
    keyPrefix: activeKey?.key_prefix ?? null,
    validationStatus: activeKey?.validation_status ?? null,
  }
}
