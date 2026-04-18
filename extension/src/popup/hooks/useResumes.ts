import { useQuery } from '@tanstack/react-query'
import { getResumesApi } from '@/api/resumes'

export function useResumes(enabled = true) {
  return useQuery({
    queryKey: ['resumes'],
    queryFn: () => getResumesApi(),
    staleTime: 1000 * 60 * 5,
    enabled,
  })
}
