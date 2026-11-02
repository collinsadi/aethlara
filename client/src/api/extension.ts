/**
 * Chrome extension connection API calls. See server/docs.md "Extension Devices".
 *
 * POST   /auth/extension-token          → { token, expires_in } (single-use handshake token)
 * GET    /auth/extension/devices        → ExtensionDevice[]
 * DELETE /auth/extension/devices/:id    → null
 */
import { apiClient } from '@/api/client'
import type { ApiSuccessResponse } from '@/lib/types'

export interface ExtensionDevice {
  id: string
  name: string
  last_used_at: string | null
  created_at: string
}

export interface ExtensionHandshakeToken {
  token: string
  expires_in: number
}

export async function createExtensionTokenApi(): Promise<ExtensionHandshakeToken> {
  const res = await apiClient.post<ApiSuccessResponse<ExtensionHandshakeToken>>('/auth/extension-token')
  return res.data.data!
}

export async function listExtensionDevicesApi(): Promise<ExtensionDevice[]> {
  const res = await apiClient.get<ApiSuccessResponse<ExtensionDevice[]>>('/auth/extension/devices')
  return res.data.data ?? []
}

export async function revokeExtensionDeviceApi(id: string): Promise<void> {
  await apiClient.delete(`/auth/extension/devices/${id}`)
}
