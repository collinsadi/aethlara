import { apiClient } from './client'

export interface ExtResume {
  id: string
  name: string
  file_format: string
  file_size_bytes: number
  extraction_status: 'pending' | 'processing' | 'completed' | 'failed'
  uploaded_at: string
}

export async function getResumesApi(): Promise<ExtResume[]> {
  const res = await apiClient.get<{ data: ExtResume[] }>('/resumes')
  return res.data.data ?? []
}
