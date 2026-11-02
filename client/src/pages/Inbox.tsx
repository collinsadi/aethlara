import { useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Inbox as InboxIcon, Loader2, Mail } from 'lucide-react'
import { EmptyState } from '@/components/EmptyState'
import { ErrorState } from '@/components/ErrorState'
import { PageHeader } from '@/components/PageHeader'
import { InboundDisabledNotice, MailboxAddress, MailboxDisabledState } from '@/components/inbox/MailboxStatus'
import { MessageDetail } from '@/components/inbox/MessageDetail'
import { MessageListItem } from '@/components/inbox/MessageListItem'
import { Skeleton } from '@/components/ui/skeleton'
import { useAgentOverview } from '@/hooks/useAgent'
import { useInboxList, useInboxMessage, useMarkMessageRead } from '@/hooks/useInbox'
import { useNow } from '@/hooks/useNow'
import { ui } from '@/lib/styles'
import { cn } from '@/lib/utils'

const FILTERS = [
  { id: 'all', label: 'All', category: '' },
  { id: 'important', label: 'Important', category: 'important' },
  { id: 'interviews', label: 'Interviews', category: 'interview' },
  { id: 'rejections', label: 'Rejections', category: 'rejection' },
  { id: 'confirmations', label: 'Confirmations', category: 'confirmation' },
  { id: 'verification', label: 'Verification', category: 'verification' },
  { id: 'sent', label: 'Sent', category: 'outbound' },
] as const

const EMPTY_COPY: Record<string, string> = {
  all: 'Nothing here yet. Replies to your applications land here, sorted by AI.',
  important: 'No important mail. Interviews, assessments and offers show up here.',
  interviews: 'No interview invitations yet.',
  rejections: 'No rejections. Good news travels slower, but it travels.',
  confirmations: 'No application confirmations yet.',
  verification: 'No verification codes. When a form emails a code, the extension picks it up from here.',
  sent: 'No emailed applications yet. Applications sent by email appear here.',
}

/** /inbox — the agent mailbox. */
export function Inbox() {
  const now = useNow()
  const [params, setParams] = useSearchParams()
  const filterId = FILTERS.some((f) => f.id === params.get('filter')) ? params.get('filter')! : 'all'
  const filter = FILTERS.find((f) => f.id === filterId)!
  const selectedId = params.get('message')
  const [mobileOpen, setMobileOpen] = useState(!!selectedId)

  const overview = useAgentOverview()
  const list = useInboxList(filter.category)
  const selectedDetail = useInboxMessage(selectedId)
  const { mutate: markRead } = useMarkMessageRead()

  const messages = list.data?.pages.flatMap((p) => p.items) ?? []
  const selectedFromList = messages.find((m) => m.id === selectedId) ?? null
  const selected = selectedFromList ?? selectedDetail.data ?? null

  // Opening an unread email marks it read (once per email, so "Mark as unread" sticks).
  const autoMarked = useRef(new Set<string>())
  useEffect(() => {
    if (!selected || autoMarked.current.has(selected.id)) return
    autoMarked.current.add(selected.id)
    if (selected.direction === 'inbound' && !selected.read_at) markRead({ id: selected.id, read: true })
  }, [selected, markRead])

  const detailRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    detailRef.current?.scrollTo({ top: 0 })
  }, [selectedId])

  const open = (id: string) => {
    const next = new URLSearchParams(window.location.search)
    next.set('message', id)
    setParams(next, { replace: true })
    setMobileOpen(true)
    if (window.matchMedia('(max-width: 1023px)').matches) {
      requestAnimationFrame(() => detailRef.current?.scrollIntoView({ block: 'start' }))
    }
  }

  const setFilter = (id: string) => {
    const next = new URLSearchParams(window.location.search)
    if (id === 'all') next.delete('filter')
    else next.set('filter', id)
    next.delete('message')
    setParams(next)
    setMobileOpen(false)
  }

  const setup = overview.data?.setup
  const mailboxOff = setup ? !setup.mailbox_enabled : false
  const unreadImportant = overview.data?.counts.unread_important ?? 0

  if (mailboxOff && !list.isLoading && messages.length === 0 && filterId === 'all') {
    return (
      <div className="space-y-6">
        <PageHeader title="Inbox" description="Replies to your applications, sorted by AI." />
        <div className="glass-card">
          <MailboxDisabledState />
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-5">
      <PageHeader
        title="Inbox"
        description="Replies to your applications, sorted by AI. Confirmations, rejections and interviews update your tracker automatically."
        actions={overview.data ? <MailboxAddress overview={overview.data} /> : undefined}
      />

      {setup && setup.mailbox_enabled && !setup.inbound_enabled && <InboundDisabledNotice />}

      <nav aria-label="Inbox filters" className="flex gap-2 overflow-x-auto pb-1">
        {FILTERS.map((f) => {
          const active = f.id === filterId
          return (
            <button
              key={f.id}
              type="button"
              onClick={() => setFilter(f.id)}
              aria-pressed={active}
              className={cn(ui.pill, 'shrink-0', active ? ui.pillActive : ui.pillIdle)}
            >
              {f.label}
              {f.id === 'important' && unreadImportant > 0 && (
                <span
                  className={cn(
                    'inline-flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[10px] font-semibold tabular-nums',
                    active ? 'bg-primary-foreground/20 text-primary-foreground' : 'bg-brand text-primary-foreground'
                  )}
                >
                  {unreadImportant}
                  <span className="sr-only"> unread</span>
                </span>
              )}
            </button>
          )
        })}
      </nav>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,26rem)_minmax(0,1fr)]">
        <div className={cn('min-w-0', mobileOpen && selectedId && 'hidden lg:block')}>
          {list.isLoading ? (
            <ul className="space-y-1" aria-busy="true" aria-label="Loading inbox">
              {Array.from({ length: 6 }).map((_, i) => (
                <li key={i} className="space-y-2 px-3.5 py-3">
                  <Skeleton className="h-3.5 w-2/5" />
                  <Skeleton className="h-3.5 w-4/5" />
                  <Skeleton className="h-3 w-3/5" />
                </li>
              ))}
            </ul>
          ) : list.isError ? (
            <div className="glass-card">
              <ErrorState compact error={list.error} title="Couldn't load your inbox" onRetry={() => list.refetch()} retrying={list.isRefetching} />
            </div>
          ) : messages.length === 0 ? (
            <div className="glass-card">
              <EmptyState compact icon={InboxIcon} title="No email here" description={EMPTY_COPY[filterId]} />
            </div>
          ) : (
            <>
              <ul className="space-y-1" aria-label="Emails">
                {messages.map((m) => (
                  <MessageListItem key={m.id} message={m} now={now} active={m.id === selectedId} onOpen={() => open(m.id)} />
                ))}
              </ul>
              {list.hasNextPage && (
                <div className="flex justify-center pt-3">
                  <button type="button" onClick={() => list.fetchNextPage()} disabled={list.isFetchingNextPage} className={ui.outline}>
                    {list.isFetchingNextPage && <Loader2 className="size-3.5 animate-spin" aria-hidden />}
                    {list.isFetchingNextPage ? 'Loading…' : 'Load more'}
                  </button>
                </div>
              )}
            </>
          )}
        </div>

        <div
          ref={detailRef}
          className={cn(
            'glass-card min-w-0 scroll-mt-20 lg:sticky lg:top-20 lg:max-h-[calc(100dvh-6.5rem)] lg:overflow-y-auto',
            !(mobileOpen && selectedId) && 'hidden lg:block'
          )}
        >
          {selectedId ? (
            <MessageDetail
              key={selectedId}
              messageId={selectedId}
              fallback={selected}
              onBack={() => setMobileOpen(false)}
            />
          ) : (
            <div className="flex min-h-[320px] flex-col items-center justify-center px-6 text-center">
              <Mail className="mb-3 size-6 text-muted-foreground/50" aria-hidden />
              <p className="text-sm text-muted-foreground">Select an email to read it.</p>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
