/**
 * Tracker board state.
 *
 * Reuses the jobs list cache (queryKeys.jobs.list) — no separate fetch.
 * Loads page_size=100 to get all jobs for client-side grouping.
 * Status updates go through useUpdateJobStatus() with optimistic updates + rollback.
 */
import { useMemo } from 'react'
import { useJobs } from '@/hooks/useJobs'
import { useUpdateJobStatus } from '@/hooks/useJobs'
import type { ApiJob, JobStatus } from '@/lib/types'
import { ALLOWED_TRANSITIONS } from '@/lib/types'

export type TrackerColumns = Record<JobStatus, ApiJob[]>

const ALL_STATUSES: JobStatus[] = [
  'not_applied',
  'applied',
  'interview',
  'offer',
  'rejected',
  'withdrawn',
]

export function useTracker() {
  const { data, isLoading, isError } = useJobs({ page_size: 100 })
  const updateStatus = useUpdateJobStatus()

  const jobs = data?.items ?? []

  const columns: TrackerColumns = useMemo(() => {
    const cols = Object.fromEntries(
      ALL_STATUSES.map((s) => [s, [] as ApiJob[]])
    ) as TrackerColumns

    for (const job of jobs) {
      cols[job.status].push(job)
    }

    // Sort each column by created_at desc
    for (const status of ALL_STATUSES) {
      cols[status].sort(
        (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
      )
    }

    return cols
  }, [jobs])

  const canMoveTo = (job: ApiJob, targetStatus: JobStatus): boolean => {
    return ALLOWED_TRANSITIONS[job.status].includes(targetStatus)
  }

  const moveJob = (jobId: string, fromStatus: JobStatus, toStatus: JobStatus) => {
    const job = jobs.find((j) => j.id === jobId)
    if (!job) return

    if (!canMoveTo(job, toStatus)) {
      return { error: `Cannot move from "${fromStatus}" to "${toStatus}"` as const }
    }

    updateStatus.mutate({ id: jobId, status: toStatus })
    return null
  }

  return {
    columns,
    jobs,
    isLoading,
    isError,
    moveJob,
    canMoveTo,
    isPending: updateStatus.isPending,
    ALL_STATUSES,
  }
}
