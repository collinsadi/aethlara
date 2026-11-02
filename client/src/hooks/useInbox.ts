/**
 * Agent mailbox hooks. Opening a message marks it read optimistically in
 * every cached list so unread styling clears instantly.
 */
import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
  type InfiniteData,
} from '@tanstack/react-query'
import { getInboxMessageApi, listInboxApi, markInboxReadApi } from '@/api/agent'
import type { InboxMessage, InboxMessageDetail, Paginated } from '@/lib/agentTypes'
import { queryKeys } from '@/lib/queryKeys'

const INBOX_PAGE_SIZE = 30

export function useInboxList(category: string) {
  return useInfiniteQuery({
    queryKey: queryKeys.agent.inboxList({ category }),
    queryFn: ({ pageParam }) =>
      listInboxApi({ category, page: pageParam, page_size: INBOX_PAGE_SIZE }),
    initialPageParam: 1,
    getNextPageParam: (last) =>
      last.pagination.has_next ? last.pagination.page + 1 : undefined,
    staleTime: 30_000,
    refetchOnWindowFocus: true,
  })
}

export function useInboxMessage(id: string | null) {
  return useQuery({
    queryKey: queryKeys.agent.message(id ?? ''),
    queryFn: () => getInboxMessageApi(id!),
    enabled: !!id,
    staleTime: 5 * 60_000,
  })
}

type InboxPages = InfiniteData<Paginated<InboxMessage>, number>

export function useMarkMessageRead() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, read }: { id: string; read: boolean }) => markInboxReadApi(id, read),
    onMutate: async ({ id, read }) => {
      await qc.cancelQueries({ queryKey: queryKeys.agent.inboxLists() })
      const readAt = read ? new Date().toISOString() : null
      const snapshots = qc.getQueriesData<InboxPages>({ queryKey: queryKeys.agent.inboxLists() })
      qc.setQueriesData<InboxPages>({ queryKey: queryKeys.agent.inboxLists() }, (old) =>
        old
          ? {
              ...old,
              pages: old.pages.map((page) => ({
                ...page,
                items: page.items.map((m) => (m.id === id ? { ...m, read_at: readAt } : m)),
              })),
            }
          : old
      )
      qc.setQueryData<InboxMessageDetail>(queryKeys.agent.message(id), (old) =>
        old ? { ...old, read_at: readAt } : old
      )
      return { snapshots }
    },
    onError: (_err, _vars, context) => {
      for (const [key, data] of context?.snapshots ?? []) qc.setQueryData(key, data)
    },
    onSettled: () => {
      // Unread-important count drives the nav badge and the home tile.
      qc.invalidateQueries({ queryKey: queryKeys.agent.overview() })
    },
  })
}
