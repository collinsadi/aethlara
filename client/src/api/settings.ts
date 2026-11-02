/**
 * Settings API calls. See server/docs.md "AI Settings".
 *
 * GET    /settings/ai                          → AISettings
 * PUT    /settings/ai                          → AISettings (422 PROVIDER_KEY_REQUIRED)
 * POST   /settings/api-key                     → ApiKeyMetadata (201, 422 INVALID_API_KEY)
 * DELETE /settings/api-key?provider=           → null
 * POST   /settings/api-key/validate?provider=  → ApiKeyMetadata
 * PATCH  /settings/profile                     → ProfileData
 * POST   /settings/email/request-change | confirm-change
 */
import { apiClient } from '@/api/client'
import type { ApiSuccessResponse } from '@/lib/types'

export type AIProviderId = 'anthropic' | 'openrouter'

export interface ApiKeyMetadata {
  id: string
  provider: AIProviderId
  key_prefix: string
  label?: string | null
  validation_status: 'unvalidated' | 'valid' | 'invalid' | 'revoked'
  last_used_at: string | null
  last_validated_at: string | null
  created_at: string
}

export interface AIProviderOption {
  id: AIProviderId
  label: string
  key_prefix: string
  supports_web_search: boolean
  suggested_models: string[]
}

export interface AISettings {
  /** The active provider (defaults to openrouter for older accounts). */
  provider: AIProviderId
  /** Override for the smart slot; null = server default. */
  smart_model: string | null
  fast_model: string | null
  effective_smart_model: string
  effective_fast_model: string
  keys: ApiKeyMetadata[]
  providers: AIProviderOption[]
}

export interface UpdateAISettingsPayload {
  provider: AIProviderId
  /** Omit to keep the current override; "" resets to the server default. */
  smart_model?: string
  fast_model?: string
}

export interface SaveApiKeyPayload {
  apiKey: string
  provider: AIProviderId
  label?: string
  makeActive?: boolean
}

export interface ProfileData {
  id: string
  full_name: string
  email: string
  updated_at: string
}

// ── AI provider settings ─────────────────────────────────────────────────────

export async function getAISettingsApi(): Promise<AISettings> {
  const res = await apiClient.get<ApiSuccessResponse<AISettings>>('/settings/ai')
  return res.data.data!
}

export async function updateAISettingsApi(payload: UpdateAISettingsPayload): Promise<AISettings> {
  const res = await apiClient.put<ApiSuccessResponse<AISettings>>('/settings/ai', payload)
  return res.data.data!
}

/** Validates the key with a live call to the provider before storing it. */
export async function saveApiKeyApi({
  apiKey,
  provider,
  label,
  makeActive = true,
}: SaveApiKeyPayload): Promise<ApiKeyMetadata> {
  const res = await apiClient.post<ApiSuccessResponse<ApiKeyMetadata>>(
    '/settings/api-key',
    {
      api_key: apiKey,
      provider,
      label: label || undefined,
      make_active: makeActive,
    },
    // The server makes a live validation call to the provider first.
    { timeout: 45_000 }
  )
  return res.data.data!
}

export async function deleteApiKeyApi(provider: AIProviderId): Promise<void> {
  await apiClient.delete('/settings/api-key', { params: { provider } })
}

export async function validateApiKeyApi(provider: AIProviderId): Promise<ApiKeyMetadata> {
  const res = await apiClient.post<ApiSuccessResponse<ApiKeyMetadata>>(
    '/settings/api-key/validate',
    undefined,
    { params: { provider }, timeout: 45_000 }
  )
  return res.data.data!
}

// ── Profile / email ──────────────────────────────────────────────────────────

export async function updateProfileApi(fullName: string): Promise<ProfileData> {
  const res = await apiClient.patch<ApiSuccessResponse<ProfileData>>('/settings/profile', {
    full_name: fullName,
  })
  return res.data.data!
}

export async function requestEmailChangeApi(newEmail: string): Promise<void> {
  await apiClient.post('/settings/email/request-change', { new_email: newEmail })
}

export async function confirmEmailChangeApi(newEmail: string, otp: string): Promise<void> {
  await apiClient.post('/settings/email/confirm-change', { new_email: newEmail, otp })
}
