import { apiClient } from './client'
import type { AutofillField, AutofillResult } from '@/types'

export async function autofillJobApi(
  jobId: string,
  fields: AutofillField[],
  pageUrl: string
): Promise<AutofillResult> {
  const res = await apiClient.post<{ data: AutofillResult }>(`/jobs/${jobId}/autofill`, {
    fields,
    page_url: pageUrl,
  })
  return res.data.data
}
