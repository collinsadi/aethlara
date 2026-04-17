/**
 * Jobs API calls.
 *
 * POST   /jobs                        → { data: ApiJob }
 * GET    /jobs                        → { data: { items, pagination } }
 * GET    /jobs/:id                    → { data: ApiJobDetail }
 * PATCH  /jobs/:id/status             → { data: JobStatusUpdate }
 * GET    /jobs/:id/resume-preview     → { data: { url, expires_at } }
 * DELETE /jobs/:id                    → { data: { id, deleted_at } }
 *
 * Security: extracted_job_json, tailored_resume_json, pdf_r2_key, raw_input_ref
 * are never returned by the backend, but if they appear, they are stripped here.
 */
import { apiClient } from '@/api/client'
import type {
  ApiSuccessResponse,
  ApiJob,
  ApiJobDetail,
  JobStatus,
  JobStatusUpdate,
  JobPreviewUrl,
  PaginatedJobs,
} from '@/lib/types'
import type { JobFilters } from '@/lib/queryKeys'

/** Job creation waits on dual AI calls — extended timeout. */
const JOB_CREATE_TIMEOUT_MS = 180_000

// Strip internal server fields that must never reach the frontend cache.
const INTERNAL_FIELDS = [
  'extracted_job_json',
  'tailored_resume_json',
  'pdf_r2_key',
  'raw_input_ref',
] as const

function stripInternal<T extends Record<string, unknown>>(obj: T): T {
  const out = { ...obj }
  for (const field of INTERNAL_FIELDS) {
    delete out[field as keyof T]
  }
  return out
}

export interface CreateJobPayload {
  input_method: 'url' | 'text'
  job_url?: string
  job_text?: string
  company_name?: string
  role?: string
  resume_id: string
}

export async function createJobApi(payload: CreateJobPayload): Promise<ApiJob> {
  const res = await apiClient.post<ApiSuccessResponse<ApiJob>>('/jobs', payload, {
    timeout: JOB_CREATE_TIMEOUT_MS,
  })
  return stripInternal(res.data.data!)
}

export async function getJobsApi(filters: JobFilters = {}): Promise<PaginatedJobs> {
  const params: Record<string, string | number | boolean> = {}
  if (filters.page)            params.page = filters.page
  if (filters.page_size)       params.page_size = Math.min(filters.page_size, 100)
  if (filters.sort)            params.sort = filters.sort
  if (filters.status)          params.status = filters.status
  if (filters.employment_type) params.employment_type = filters.employment_type
  if (filters.is_remote !== undefined) params.is_remote = filters.is_remote
  if (filters.min_match !== undefined) params.min_match = filters.min_match
  if (filters.search)          params.search = filters.search.trim().slice(0, 200)

  const res = await apiClient.get<ApiSuccessResponse<PaginatedJobs>>('/jobs', { params })
  const data = res.data.data!
  return {
    items: (data.items ?? []).map((j) => stripInternal(j as Record<string, unknown>) as ApiJob),
    pagination: data.pagination,
  }
}

export async function getJobDetailApi(id: string): Promise<ApiJobDetail> {
  const res = await apiClient.get<ApiSuccessResponse<ApiJobDetail>>(`/jobs/${id}`)
  return stripInternal(res.data.data! as Record<string, unknown>) as ApiJobDetail
}

export async function updateJobStatusApi(
  id: string,
  status: JobStatus,
  notes?: string
): Promise<JobStatusUpdate> {
  const body: { status: JobStatus; notes?: string } = { status }
  if (notes !== undefined) body.notes = notes
  const res = await apiClient.patch<ApiSuccessResponse<JobStatusUpdate>>(
    `/jobs/${id}/status`,
    body
  )
  return res.data.data!
}

export async function getJobResumePreviewUrlApi(id: string): Promise<JobPreviewUrl> {
  const res = await apiClient.get<ApiSuccessResponse<JobPreviewUrl>>(
    `/jobs/${id}/resume-preview`
  )
  return res.data.data!
}

export async function deleteJobApi(id: string): Promise<{ id: string; deleted_at: string }> {
  const res = await apiClient.delete<ApiSuccessResponse<{ id: string; deleted_at: string }>>(
    `/jobs/${id}`
  )
  return res.data.data!
}
