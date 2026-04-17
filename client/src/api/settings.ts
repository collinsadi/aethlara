import { apiClient } from '@/api/client'
import type { ApiSuccessResponse } from '@/lib/types'

export interface ApiKeyMetadata {
  id: string
  provider: string
  key_prefix: string
  label?: string
  validation_status: 'unvalidated' | 'valid' | 'invalid' | 'revoked'
  last_used_at: string | null
  last_validated_at: string | null
  created_at: string
}

export interface ProfileData {
  id: string
  full_name: string
  email: string
  updated_at: string
}

export async function getApiKeyApi(): Promise<ApiKeyMetadata | null> {
  const res = await apiClient.get<ApiSuccessResponse<ApiKeyMetadata | null>>('/settings/api-key')
  return res.data.data ?? null
}

export async function saveApiKeyApi(apiKey: string, label?: string): Promise<ApiKeyMetadata> {
  const res = await apiClient.post<ApiSuccessResponse<ApiKeyMetadata>>('/settings/api-key', {
    api_key: apiKey,
    label: label || undefined,
  })
  return res.data.data!
}

export async function deleteApiKeyApi(): Promise<void> {
  await apiClient.delete('/settings/api-key')
}

export async function validateApiKeyApi(): Promise<ApiKeyMetadata> {
  const res = await apiClient.post<ApiSuccessResponse<ApiKeyMetadata>>('/settings/api-key/validate')
  return res.data.data!
}

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
