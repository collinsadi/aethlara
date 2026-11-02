import { Link } from 'react-router-dom'
import { Skeleton } from '@/components/ui/skeleton'
import { useAgentOverview } from '@/hooks/useAgent'
import { useNow } from '@/hooks/useNow'
import { formatRelative } from '@/lib/agentFormat'
import { toneDot, type Tone } from '@/lib/tones'
import { cn } from '@/lib/utils'

/** Compact autopilot state for the top bar; links to the Autopilot page. */
export function AgentStatusPill() {
  const { data, isLoading } = useAgentOverview()
  const now = useNow()
  // Reserve the pill's space while loading so the top bar doesn't shift.
  if (isLoading) return <Skeleton className="h-8 w-28 rounded-full" />
  if (!data) return null

  const running = !!data.running_run
  const { enabled, next_run_at } = data.profile
  let tone: Tone = 'muted'
  let detail = 'Off'
  if (running) {
    tone = 'brand'
    detail = 'Running now'
  } else if (enabled) {
    tone = 'success'
    if (!next_run_at) detail = 'On'
    else if (new Date(next_run_at).getTime() <= now) detail = 'On · run due'
    else detail = `On · next run ${formatRelative(next_run_at, now)}`
  }

  return (
    <Link
      to="/agent"
      className="inline-flex items-center gap-2 rounded-full border border-border bg-card/60 px-3 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-muted focus-visible:outline-2 focus-visible:outline-brand"
      aria-label={`Autopilot: ${detail}`}
    >
      <span className="relative flex size-2" aria-hidden>
        {running && <span className="absolute inline-flex size-full animate-ping rounded-full bg-brand opacity-60" />}
        <span className={cn('relative inline-flex size-2 rounded-full', toneDot[tone])} />
      </span>
      <span>Autopilot</span>
      <span className="hidden text-muted-foreground sm:inline">{detail}</span>
    </Link>
  )
}
