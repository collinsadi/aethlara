/**
 * Analytics API calls.
 *
 * GET /analytics/dashboard → { data: DashboardAnalytics }
 */
import { apiClient } from '@/api/client'
import type { ApiSuccessResponse, DashboardAnalytics } from '@/lib/types'

export async function getDashboardAnalyticsApi(): Promise<DashboardAnalytics> {
  const res = await apiClient.get<ApiSuccessResponse<DashboardAnalytics>>(
    '/analytics/dashboard'
  )
  return res.data.data!
}
