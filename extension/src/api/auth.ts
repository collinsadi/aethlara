import axios from 'axios'
import type { ExtUser } from '@/types'

const API_BASE = import.meta.env.VITE_API_BASE_URL ?? 'https://api.aethlara.com/api/v1'

export interface ExchangeResult {
  access_token: string
  expires_at: string
  user: ExtUser
}

export async function exchangeExtensionToken(extToken: string): Promise<ExchangeResult> {
  // Use a bare axios instance — no auth headers needed for this pre-auth endpoint
  const res = await axios.post<{ data: ExchangeResult }>(
    `${API_BASE}/auth/extension-token/exchange`,
    { ext_token: extToken }
  )
  return res.data.data
}
