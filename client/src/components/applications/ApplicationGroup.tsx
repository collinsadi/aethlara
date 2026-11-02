import { useState } from 'react'
import { ChevronDown, Loader2 } from 'lucide-react'
import { ErrorState } from '@/components/ErrorState'
import { ApplicationRow } from '@/components/applications/ApplicationRow'
import { Skeleton } from '@/components/ui/skeleton'
import { useApplicationList } from '@/hooks/useAgentApplications'
import { useNow } from '@/hooks/useNow'
import type { AgentApplication } from '@/lib/agentTypes'
import { ui } from '@/lib/styles'
import { toneBadge, type Tone } from '@/lib/tones'
import { cn } from '@/lib/utils'

export interface ApplicationActions {
  highlightId: string | null
  retryingId: string | null
  onAnswer: (app: AgentApplication) => void
  onRetry: (app: AgentApplication) => void
  onCancel: (app: AgentApplication) => void
  onCoverLetter: (app: AgentApplication) => void
  onMarkSubmitted: (app: AgentApplication) => void
  markingId: string | null
}

interface Props {
  id: string
  title: string
  description: string
  /** Comma-separated application statuses for this group. */
  status: string
  /** Total from the overview, shown even while collapsed. */
  count?: number
  tone: Tone
  emptyText: string
  collapsible?: boolean
  /** Force the group open (e.g. it holds the highlighted application). */
  forceOpen?: boolean
  poll?: boolean
  actions: ApplicationActions
}

export function ApplicationGroup({
  id,
  title,
  description,
  status,
  count,
  tone,
  emptyText,
  collapsible,
  forceOpen,
  poll,
  actions,
}: Props) {
  const [userOpen, setUserOpen] = useState(!collapsible)
  const open = userOpen || !!forceOpen
  const now = useNow()
  const list = useApplicationList(status, { poll, enabled: open })
  const items = list.data?.pages.flatMap((p) => p.items) ?? []
  const total = list.data?.pages[0]?.pagination.total_items ?? count
  const headingId = `${id}-heading`

  return (
    <section aria-labelledby={headingId} className="space-y-3">
      <div className="flex items-end justify-between gap-3">
        <div className="min-w-0">
          <h2 id={headingId} className="flex items-center gap-2 font-heading text-base font-semibold text-foreground">
            {title}
            {total !== undefined && (
              <span
                className={cn(
                  'inline-flex h-5 min-w-5 items-center justify-center rounded-full border px-1.5 text-[11px] font-semibold tabular-nums',
                  total > 0 ? toneBadge[tone] : toneBadge.muted
                )}
              >
                {total}
              </span>
            )}
          </h2>
          <p className="mt-0.5 text-xs text-muted-foreground">{description}</p>
        </div>
        {collapsible && (
          <button
            type="button"
            onClick={() => setUserOpen((v) => !v)}
            aria-expanded={open}
            aria-controls={`${id}-list`}
            className={ui.ghost}
          >
            {open ? 'Hide' : 'Show'}
            <ChevronDown className={cn('size-3.5 transition-transform', open && 'rotate-180')} aria-hidden />
          </button>
        )}
      </div>

      {open && (
        <div id={`${id}-list`}>
          {list.isLoading ? (
            <div className="space-y-3" aria-busy="true">
              {Array.from({ length: 2 }).map((_, i) => (
                <div key={i} className="glass-card flex items-start gap-3 p-5">
                  <Skeleton className="size-10 rounded-xl" />
                  <div className="flex-1 space-y-2">
                    <Skeleton className="h-4 w-1/2" />
                    <Skeleton className="h-3 w-1/3" />
                    <Skeleton className="h-3 w-2/3" />
                  </div>
                </div>
              ))}
            </div>
          ) : list.isError ? (
            <div className="glass-card">
              <ErrorState compact error={list.error} title={`Couldn't load ${title.toLowerCase()}`} onRetry={() => list.refetch()} retrying={list.isRefetching} />
            </div>
          ) : items.length === 0 ? (
            <p className="rounded-2xl border border-dashed border-border px-4 py-5 text-center text-sm text-muted-foreground">
              {emptyText}
            </p>
          ) : (
            <>
              <ul className="space-y-3">
                {items.map((app) => (
                  <ApplicationRow
                    key={app.id}
                    app={app}
                    now={now}
                    highlighted={actions.highlightId === app.id}
                    retrying={actions.retryingId === app.id}
                    onAnswer={actions.onAnswer}
                    onRetry={actions.onRetry}
                    onCancel={actions.onCancel}
                    onMarkSubmitted={actions.onMarkSubmitted}
                    marking={actions.markingId === app.id}
                    onCoverLetter={actions.onCoverLetter}
                  />
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
      )}
    </section>
  )
}
