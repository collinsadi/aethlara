/**
 * Analytics dashboard data hook.
 *
 * - staleTime 5 min — matches backend cache TTL
 * - refetchInterval 5 min — auto-refresh to stay in sync
 * - refetchOnWindowFocus false — avoids disruptive re-renders during work
 * - Invalidated on: job create, status update, delete (see useJobs.ts mutations)
 */
import { useQuery } from '@tanstack/react-query'
import { getDashboardAnalyticsApi } from '@/api/analytics'
import { queryKeys } from '@/lib/queryKeys'

export function useAnalytics() {
  return useQuery({
    queryKey: queryKeys.analytics.dashboard(),
    queryFn: getDashboardAnalyticsApi,
    staleTime: 1000 * 60 * 5,
    gcTime: 1000 * 60 * 10,
    refetchOnWindowFocus: false,
    refetchInterval: 1000 * 60 * 5,
  })
}
