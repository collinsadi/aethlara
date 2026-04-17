/**
 * Job CRUD hooks backed by React Query.
 *
 * - useJobs(filters)          → paginated list query (2 min stale, 10 min gc)
 * - useJobDetail(id)          → single job detail (5 min stale, 15 min gc)
 * - useJobPreviewUrl(id)      → pre-signed PDF URL (cached until near-expiry)
 * - useCreateJob()            → mutation with list + analytics invalidation
 * - useUpdateJobStatus()      → optimistic status update with rollback
 * - useDeleteJob()            → soft delete with list + detail cache cleanup
 *
 * Cache invalidation on every mutation:
 *   - jobs.lists() — always
 *   - analytics.dashboard() — always
 *   - jobs.detail(id) — on status update and delete
 */
import {
  useQuery,
  useInfiniteQuery,
  useMutation,
  useQueryClient,
} from '@tanstack/react-query'
import {
  getJobsApi,
  getJobDetailApi,
  getJobResumePreviewUrlApi,
  createJobApi,
  updateJobStatusApi,
  deleteJobApi,
  type CreateJobPayload,
} from '@/api/jobs'
import { queryKeys, type JobFilters } from '@/lib/queryKeys'
import type { ApiJob, JobStatus, PaginatedJobs } from '@/lib/types'

// ── List (paginated, finite) ──────────────────────────────────────────────────

export function useJobs(filters: JobFilters = {}) {
  return useQuery({
    queryKey: queryKeys.jobs.list(filters),
    queryFn: () => getJobsApi(filters),
    staleTime: 1000 * 60 * 2,
    gcTime: 1000 * 60 * 10,
    placeholderData: (prev) => prev,
  })
}

// ── Infinite list (for tracker — load all) ────────────────────────────────────

export function useJobsInfinite(filters: Omit<JobFilters, 'page'> = {}) {
  return useInfiniteQuery({
    queryKey: queryKeys.jobs.list({ ...filters, _infinite: true } as JobFilters),
    queryFn: ({ pageParam = 1 }) =>
      getJobsApi({ ...filters, page: pageParam as number }),
    initialPageParam: 1,
    getNextPageParam: (last: PaginatedJobs) =>
      last.pagination.has_next ? last.pagination.page + 1 : undefined,
    staleTime: 1000 * 60 * 2,
    gcTime: 1000 * 60 * 10,
  })
}

// ── Detail ────────────────────────────────────────────────────────────────────

export function useJobDetail(id: string | null) {
  return useQuery({
    queryKey: queryKeys.jobs.detail(id!),
    queryFn: () => getJobDetailApi(id!),
    staleTime: 1000 * 60 * 5,
    gcTime: 1000 * 60 * 15,
    enabled: !!id,
  })
}

// ── PDF preview URL ───────────────────────────────────────────────────────────

export function useJobPreviewUrl(id: string | null, enabled = false) {
  return useQuery({
    queryKey: queryKeys.jobs.pdf(id!),
    queryFn: () => getJobResumePreviewUrlApi(id!),
    // Cache until 60s before the pre-signed URL expires
    staleTime: (() => {
      // We don't know expiry until we fetch, so default to 14 minutes (expiry is 15 min)
      return 1000 * 60 * 14
    })(),
    gcTime: 1000 * 60 * 15,
    enabled: !!id && enabled,
  })
}

// ── Create ────────────────────────────────────────────────────────────────────

export function useCreateJob() {
  const qc = useQueryClient()

  return useMutation({
    mutationFn: (payload: CreateJobPayload) => createJobApi(payload),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.jobs.lists() })
      qc.invalidateQueries({ queryKey: queryKeys.analytics.dashboard() })
    },
  })
}

// ── Update status (optimistic) ────────────────────────────────────────────────

export function useUpdateJobStatus() {
  const qc = useQueryClient()

  return useMutation({
    mutationFn: ({
      id,
      status,
      notes,
    }: {
      id: string
      status: JobStatus
      notes?: string
    }) => updateJobStatusApi(id, status, notes),

    onMutate: async ({ id, status }) => {
      // Cancel in-flight queries that could overwrite optimistic update
      await qc.cancelQueries({ queryKey: queryKeys.jobs.lists() })
      await qc.cancelQueries({ queryKey: queryKeys.jobs.detail(id) })

      // Snapshot previous detail for rollback
      const prevDetail = qc.getQueryData(queryKeys.jobs.detail(id))

      // Optimistically update detail cache
      qc.setQueryData(queryKeys.jobs.detail(id), (old: ApiJob | undefined) =>
        old ? { ...old, status } : old
      )

      // Optimistically update list caches
      qc.setQueriesData<PaginatedJobs>(
        { queryKey: queryKeys.jobs.lists() },
        (old) => {
          if (!old) return old
          return {
            ...old,
            items: old.items.map((j) => (j.id === id ? { ...j, status } : j)),
          }
        }
      )

      return { prevDetail, id }
    },

    onError: (_err, { id }, context) => {
      // Roll back optimistic updates
      if (context?.prevDetail) {
        qc.setQueryData(queryKeys.jobs.detail(id), context.prevDetail)
      }
      qc.invalidateQueries({ queryKey: queryKeys.jobs.lists() })
    },

    onSettled: (_data, _err, { id }) => {
      qc.invalidateQueries({ queryKey: queryKeys.jobs.detail(id) })
      qc.invalidateQueries({ queryKey: queryKeys.jobs.lists() })
      qc.invalidateQueries({ queryKey: queryKeys.analytics.dashboard() })
    },
  })
}

// ── Delete ────────────────────────────────────────────────────────────────────

export function useDeleteJob() {
  const qc = useQueryClient()

  return useMutation({
    mutationFn: (id: string) => deleteJobApi(id),
    onMutate: async (id) => {
      await qc.cancelQueries({ queryKey: queryKeys.jobs.lists() })
      const snapshots = qc.getQueriesData<PaginatedJobs>({ queryKey: queryKeys.jobs.lists() })

      qc.setQueriesData<PaginatedJobs>(
        { queryKey: queryKeys.jobs.lists() },
        (old) => {
          if (!old) return old
          return { ...old, items: old.items.filter((j) => j.id !== id) }
        }
      )
      return { snapshots, id }
    },
    onError: (_err, _id, context) => {
      if (context?.snapshots) {
        for (const [key, data] of context.snapshots) {
          qc.setQueryData(key, data)
        }
      }
    },
    onSettled: (_data, _err, id) => {
      qc.removeQueries({ queryKey: queryKeys.jobs.detail(id) })
      qc.invalidateQueries({ queryKey: queryKeys.jobs.lists() })
      qc.invalidateQueries({ queryKey: queryKeys.analytics.dashboard() })
    },
  })
}
