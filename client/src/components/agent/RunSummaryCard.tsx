import { CalendarClock, History, Loader2, WifiOff } from 'lucide-react'
import { ToneBadge } from '@/components/ToneBadge'
import { useNow } from '@/hooks/useNow'
import type { AgentOverview, AgentRun } from '@/lib/agentTypes'
import { formatDateTime, formatDuration, formatRelative } from '@/lib/agentFormat'
import { cn } from '@/lib/utils'

interface Props {
  overview: AgentOverview
  className?: string
}

/** Next scheduled run and the outcome of the last one. */
export function RunSummaryCard({ overview, className }: Props) {
  const now = useNow()
  const { profile, running_run: running, last_run: last } = overview

  let nextLabel = 'Off'
  let nextDetail = 'Runs only when you press Run now.'
  if (running) {
    nextLabel = 'Running now'
    nextDetail = `Started ${formatRelative(running.started_at, now)}.`
  } else if (profile.enabled) {
    const next = profile.next_run_at
    nextLabel = !next ? 'Soon' : new Date(next).getTime() <= now ? 'Due now' : formatRelative(next, now)
    nextDetail = next ? formatDateTime(next) : 'Waiting for the scheduler.'
  }

  return (
    <section aria-labelledby="runs-heading" className={cn('glass-card p-5', className)}>
      <h2 id="runs-heading" className="font-heading text-sm font-semibold text-foreground">
        Runs
      </h2>

      <div className="mt-4 flex items-start gap-3 rounded-xl border border-border bg-muted/30 p-3">
        {running ? (
          <Loader2 className="mt-0.5 size-4 shrink-0 animate-spin text-brand" aria-hidden />
        ) : (
          <CalendarClock className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
        )}
        <div className="min-w-0">
          <p className="text-xs text-muted-foreground">Next run</p>
          <p className="text-sm font-semibold text-foreground">{nextLabel}</p>
          <p className="text-xs text-muted-foreground">{nextDetail}</p>
        </div>
      </div>

      <div className="mt-4">
        <div className="flex items-center justify-between gap-2">
          <p className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
            <History className="size-3.5" aria-hidden />
            Last run
          </p>
          {last && <LastRunBadge run={last} />}
        </div>
        {last ? <LastRunDetails run={last} now={now} /> : (
          <p className="mt-2 text-sm text-muted-foreground">
            No runs yet. Press <span className="font-medium text-foreground">Run now</span> to search for the first time.
          </p>
        )}
      </div>
    </section>
  )
}

function LastRunBadge({ run }: { run: AgentRun }) {
  if (run.status === 'failed') return <ToneBadge tone="danger">Failed</ToneBadge>
  if (run.status === 'running') return <ToneBadge tone="brand">Running</ToneBadge>
  return <ToneBadge tone="success">Completed</ToneBadge>
}

function LastRunDetails({ run, now }: { run: AgentRun; now: number }) {
  const s = run.stats
  const finished = run.finished_at ?? run.started_at
  const duration = run.finished_at
    ? formatDuration(new Date(run.finished_at).getTime() - new Date(run.started_at).getTime())
    : ''
  const stats: { label: string; value: number }[] = [
    { label: 'New jobs', value: s.new_leads },
    { label: 'Strong matches', value: s.strong_matches },
    { label: 'Postings scanned', value: s.postings_fetched },
    { label: 'Scored', value: s.scored },
    { label: 'Prepared', value: s.prepared },
    { label: 'Emailed', value: s.emails_sent },
    { label: 'For extension', value: s.ready_for_browser },
    { label: 'Failed', value: s.failed },
  ]
  const sourceErrors = Object.entries(s.source_errors ?? {})

  return (
    <div className="mt-2">
      <p className="text-xs text-muted-foreground" title={formatDateTime(finished)}>
        {run.trigger === 'manual' ? 'Started by you' : 'Scheduled'} · finished {formatRelative(finished, now)}
        {duration && ` · took ${duration}`}
        {s.sources_queried > 0 && ` · ${s.sources_queried} sources`}
      </p>

      {run.status === 'failed' && run.error && (
        <p role="alert" className="mt-2 rounded-lg border border-destructive/25 bg-destructive/[0.07] px-3 py-2 text-xs text-destructive">
          {run.error}
        </p>
      )}

      <dl className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-2 xl:grid-cols-4">
        {stats.map((stat) => (
          <div key={stat.label} className="rounded-lg border border-border px-2.5 py-2">
            <dt className="text-[11px] text-muted-foreground">{stat.label}</dt>
            <dd
              className={cn(
                'font-heading text-lg font-semibold tabular-nums',
                stat.label === 'Failed' && stat.value > 0 ? 'text-destructive' : 'text-foreground'
              )}
            >
              {stat.value}
            </dd>
          </div>
        ))}
      </dl>

      {sourceErrors.length > 0 && (
        <div className="mt-3 rounded-lg border border-warning/30 bg-warning/[0.08] px-3 py-2">
          <p className="flex items-center gap-1.5 text-xs font-medium text-foreground">
            <WifiOff className="size-3.5 text-warning" aria-hidden />
            Some sources couldn't be reached
          </p>
          <ul className="mt-1 space-y-0.5">
            {sourceErrors.map(([source, message]) => (
              <li key={source} className="text-[11px] text-muted-foreground">
                <span className="font-medium text-foreground">{source}</span>: {message}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}
