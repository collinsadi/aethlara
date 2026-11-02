import { Link } from 'react-router-dom'
import {
  Activity,
  ArrowRightLeft,
  CheckCircle2,
  CircleHelp,
  FileCheck2,
  Flag,
  Loader2,
  Mail,
  MailCheck,
  Play,
  Send,
  Sparkles,
  ThumbsUp,
  WifiOff,
  XCircle,
  type LucideIcon,
} from 'lucide-react'
import { EmptyState } from '@/components/EmptyState'
import { ErrorState } from '@/components/ErrorState'
import { Skeleton } from '@/components/ui/skeleton'
import { useAgentEvents } from '@/hooks/useAgent'
import { useNow } from '@/hooks/useNow'
import type { AgentEvent, EventKind } from '@/lib/agentTypes'
import { EVENT_LEVEL_TONE, formatDateTime, formatRelative } from '@/lib/agentFormat'
import { ui } from '@/lib/styles'
import { toneBadge } from '@/lib/tones'
import { cn } from '@/lib/utils'

const KIND_ICON: Record<EventKind, LucideIcon> = {
  run_started: Play,
  run_finished: Flag,
  run_failed: XCircle,
  leads_found: Sparkles,
  source_error: WifiOff,
  lead_approved: ThumbsUp,
  application_prepared: FileCheck2,
  application_emailed: Send,
  application_submitted: CheckCircle2,
  application_needs_input: CircleHelp,
  application_failed: XCircle,
  mail_received: Mail,
  status_changed: ArrowRightLeft,
  digest_sent: MailCheck,
}

/** Where an event should take the user, if anywhere. */
function eventLink(e: AgentEvent): { to: string; label: string } | null {
  if (e.kind === 'mail_received') return { to: '/inbox', label: 'Open inbox' }
  if (e.kind === 'leads_found') return { to: '/review', label: 'Review' }
  if (e.application_id) return { to: `/applications?highlight=${e.application_id}`, label: 'View application' }
  if (e.lead_id) return { to: `/review?lead=${e.lead_id}`, label: 'View job' }
  return null
}

export function ActivityFeed({
  seed,
  className,
}: {
  /** The overview's recent_events, used as the first page. */
  seed?: { events: AgentEvent[]; updatedAt: number }
  className?: string
}) {
  const now = useNow()
  const { data, isLoading, isError, error, refetch, isRefetching, hasNextPage, fetchNextPage, isFetchingNextPage } =
    useAgentEvents(seed)
  const events = data?.pages.flat() ?? []

  return (
    <section aria-labelledby="activity-heading" className={cn('glass-card p-5', className)}>
      <h2 id="activity-heading" className="font-heading text-sm font-semibold text-foreground">
        Recent activity
      </h2>

      {isLoading ? (
        <ul className="mt-4 space-y-4" aria-label="Loading activity">
          {Array.from({ length: 5 }).map((_, i) => (
            <li key={i} className="flex items-start gap-3">
              <Skeleton className="size-7 rounded-full" />
              <div className="flex-1 space-y-1.5">
                <Skeleton className="h-3.5 w-4/5" />
                <Skeleton className="h-3 w-1/4" />
              </div>
            </li>
          ))}
        </ul>
      ) : isError ? (
        <ErrorState compact error={error} title="Couldn't load activity" onRetry={() => refetch()} retrying={isRefetching} />
      ) : events.length === 0 ? (
        <EmptyState
          compact
          icon={Activity}
          title="No activity yet"
          description="Everything the agent does — searches, applications, replies — will show up here."
        />
      ) : (
        <>
          <ol className="relative mt-4 space-y-1">
            {events.map((event) => {
              const Icon = KIND_ICON[event.kind] ?? Activity
              const tone = EVENT_LEVEL_TONE[event.level] ?? 'muted'
              const link = eventLink(event)
              return (
                <li key={event.id} className="flex items-start gap-3 rounded-xl px-2 py-2 transition-colors hover:bg-muted/40">
                  <span
                    className={cn('mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full border', toneBadge[tone])}
                    aria-hidden
                  >
                    <Icon className="size-3.5" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm leading-snug text-foreground">{event.message}</p>
                    <p className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
                      <time dateTime={event.created_at} title={formatDateTime(event.created_at)}>
                        {formatRelative(event.created_at, now)}
                      </time>
                      {link && (
                        <Link to={link.to} className="font-medium text-foreground underline-offset-2 hover:text-brand hover:underline">
                          {link.label}
                        </Link>
                      )}
                    </p>
                  </div>
                </li>
              )
            })}
          </ol>
          {hasNextPage && (
            <div className="mt-3 flex justify-center">
              <button type="button" onClick={() => fetchNextPage()} disabled={isFetchingNextPage} className={ui.outline}>
                {isFetchingNextPage && <Loader2 className="size-3.5 animate-spin" aria-hidden />}
                {isFetchingNextPage ? 'Loading…' : 'Load more'}
              </button>
            </div>
          )}
        </>
      )}
    </section>
  )
}
