import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { getJobsApi } from '@/api/jobs'

export function useJobsSearch(search: string, minChars = 2) {
  const trimmed = search.trim()
  const enabled = trimmed.length >= minChars

  return useQuery({
    queryKey: ['jobs', 'search', trimmed],
    queryFn: () => getJobsApi({ search: trimmed, pageSize: 10 }),
    enabled,
    staleTime: 1000 * 30,
  })
}

export function useJobsList(pageSize = 20) {
  const [page, setPage] = useState(1)

  const query = useQuery({
    queryKey: ['jobs', 'list', page, pageSize],
    queryFn: () => getJobsApi({ pageSize, page }),
    staleTime: 1000 * 30,
    placeholderData: (prev) => prev,
  })

  const loadMore = () => {
    if (query.data?.pagination.has_next) setPage((p) => p + 1)
  }

  return { ...query, page, loadMore }
}
