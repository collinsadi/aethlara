import { apiClient } from './client'
import type { ExtJob, ExtractionResult } from '@/types'

interface PaginatedJobs {
  items: ExtJob[]
  pagination: { page: number; page_size: number; total_items: number; has_next: boolean }
}

export async function getJobsApi(params: { search?: string; page?: number; pageSize?: number } = {}): Promise<PaginatedJobs> {
  const res = await apiClient.get<{ data: PaginatedJobs }>('/jobs', {
    params: {
      sort: 'recent',
      page_size: params.pageSize ?? 10,
      page: params.page ?? 1,
      ...(params.search ? { search: params.search } : {}),
    },
  })
  return res.data.data
}

export async function extractFromExtensionApi(params: {
  page_text: string
  page_url: string
  resume_id: string
}): Promise<ExtractionResult> {
  const res = await apiClient.post<{ data: ExtractionResult }>(
    '/jobs/extract-from-extension',
    params
  )
  return res.data.data
}

export async function confirmFromExtensionApi(previewToken: string): Promise<ExtJob> {
  const res = await apiClient.post<{ data: ExtJob }>('/jobs/confirm-from-extension', {
    preview_token: previewToken,
  })
  return res.data.data
}
