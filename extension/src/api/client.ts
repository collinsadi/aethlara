import axios from 'axios'
import { getSession, clearSession } from '@/lib/storage'

const API_BASE = import.meta.env.VITE_API_BASE_URL ?? 'https://api.aethlara.com/api/v1'

// The job extraction endpoint runs two sequential AI calls server-side
// (extract + align) and can realistically take 60–90s. A 30s timeout was
// the root cause of the "context canceled" errors we saw in prod. The
// server has an independent 120s deadline on the AI pipeline, so 150s
// here gives us a safe buffer over the worst case without leaving zombie
// requests hanging forever.
export const apiClient = axios.create({
  baseURL: API_BASE,
  timeout: 150_000,
})

// Inject auth token from session storage
apiClient.interceptors.request.use(async (config) => {
  const session = await getSession()
  if (session?.token) {
    config.headers.Authorization = `Bearer ${session.token}`
  }
  return config
})

// Clear session on 401
apiClient.interceptors.response.use(
  (res) => res,
  async (err) => {
    if (err.response?.status === 401) {
      await clearSession()
    }
    return Promise.reject(err)
  }
)
