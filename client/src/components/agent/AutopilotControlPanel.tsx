import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Bot, Loader2, Play, Settings2 } from 'lucide-react'
import { Switch } from '@/components/ui/switch'
import { useStartRun, useToggleAutopilot } from '@/hooks/useAgent'
import { useNow, useNowEverySecond } from '@/hooks/useNow'
import type { AgentOverview } from '@/lib/agentTypes'
import { formatDateTime, formatDuration, formatRelative } from '@/lib/agentFormat'
import { errorAction, friendlyErrorMessage, hasErrorCode } from '@/lib/apiError'
import { ui } from '@/lib/styles'
import { toast } from '@/lib/toast'
import { cn } from '@/lib/utils'

interface Props {
  overview: AgentOverview
}

/** The on/off switch, schedule summary and "Run now" for the autopilot. */
export function AutopilotControlPanel({ overview }: Props) {
  const { profile, running_run: running } = overview
  const toggle = useToggleAutopilot()
  const startRun = useStartRun()
  const [toggleError, setToggleError] = useState<{ message: string; action: { label: string; path: string } | null } | null>(null)

  const onToggle = (enabled: boolean) => {
    setToggleError(null)
    toggle.mutate(enabled, {
      onSuccess: (p) => {
        toast.success(p.enabled ? 'Autopilot is on' : 'Autopilot is off', {
          description: p.enabled
            ? `The first run starts shortly, then every ${intervalText(p.run_interval_hours)}.`
            : 'It will only run when you press Run now.',
        })
      },
      onError: (err) => {
        let action = errorAction(err)
        if (!action && hasErrorCode(err, 'INVALID_INPUT')) {
          action = { label: 'Set preferences', path: '/agent/settings#search' }
        }
        setToggleError({ message: friendlyErrorMessage(err), action })
      },
    })
  }

  const onRunNow = () => {
    startRun.mutate(undefined, {
      onSuccess: () => toast.info('Run started', { description: 'Searching job boards and scoring postings…' }),
      onError: (err) => {
        if (hasErrorCode(err, 'RUN_IN_PROGRESS')) {
          toast.info('A run is already in progress', { description: 'Watch it live below.' })
          return
        }
        let link = errorAction(err)
        if (!link && hasErrorCode(err, 'INVALID_INPUT')) {
          link = { label: 'Set preferences', path: '/agent/settings#search' }
        }
        toast.error("Couldn't start a run", {
          description: friendlyErrorMessage(err),
          link: link ? { label: link.label, to: link.path } : undefined,
        })
      },
    })
  }

  const titles = profile.search_prefs.titles
  const keywords = profile.search_prefs.keywords
  const lookingFor = titles.length ? titles : keywords

  return (
    <section aria-labelledby="autopilot-status" className="glass-card relative overflow-hidden p-5 md:p-6">
      <div className="pointer-events-none absolute inset-0 bg-gradient-to-br from-brand/[0.05] via-transparent to-transparent" />
      <div className="relative flex flex-col gap-5 md:flex-row md:items-start md:justify-between">
        <div className="flex min-w-0 items-start gap-4">
          <div
            className={cn(
              'flex size-12 shrink-0 items-center justify-center rounded-2xl border',
              running ? 'border-brand/30 bg-brand/10' : profile.enabled ? 'border-success/25 bg-success/10' : 'border-border bg-muted'
            )}
          >
            <Bot
              className={cn('size-6', running ? 'text-brand animate-pulse' : profile.enabled ? 'text-success' : 'text-muted-foreground')}
              aria-hidden
            />
          </div>
          <div className="min-w-0">
            <h1 id="autopilot-status" className="font-heading text-xl font-semibold tracking-tight text-foreground md:text-2xl">
              {running ? 'Autopilot is running' : profile.enabled ? 'Autopilot is on' : 'Autopilot is off'}
            </h1>
            <div className="mt-1 text-sm text-muted-foreground" aria-live="polite">
              {running ? (
                <RunningLine startedAt={running.started_at} />
              ) : (
                <ScheduleLine overview={overview} />
              )}
            </div>
            {lookingFor.length > 0 && (
              <p className="mt-2 text-xs text-muted-foreground">
                Looking for{' '}
                <span className="font-medium text-foreground">
                  {lookingFor.slice(0, 3).join(', ')}
                  {lookingFor.length > 3 && ` +${lookingFor.length - 3} more`}
                </span>
                {profile.search_prefs.remote_only && ' · remote only'}
                {' · '}
                <Link to="/agent/settings#search" className={ui.link}>
                  edit
                </Link>
              </p>
            )}
          </div>
        </div>

        <div className="flex shrink-0 flex-col gap-3 md:items-end">
          <label className="inline-flex cursor-pointer items-center gap-3 self-start md:self-end">
            <span className="text-sm font-medium text-foreground">{profile.enabled ? 'On' : 'Off'}</span>
            <Switch
              checked={profile.enabled}
              onCheckedChange={onToggle}
              disabled={toggle.isPending}
              aria-label="Autopilot on or off"
            />
          </label>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={onRunNow}
              disabled={!!running || startRun.isPending}
              className={ui.primary}
            >
              {startRun.isPending || running ? (
                <Loader2 className="size-4 animate-spin" aria-hidden />
              ) : (
                <Play className="size-4" aria-hidden />
              )}
              {running ? 'Running…' : 'Run now'}
            </button>
            <Link to="/agent/settings" className={ui.secondary} aria-label="Autopilot settings">
              <Settings2 className="size-4" aria-hidden />
              <span className="hidden sm:inline">Settings</span>
            </Link>
          </div>
        </div>
      </div>

      {toggleError && (
        <div
          role="alert"
          className="relative mt-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-warning/30 bg-warning/[0.08] px-4 py-3 text-sm text-foreground"
        >
          <span>{toggleError.message}</span>
          {toggleError.action && (
            <Link to={toggleError.action.path} className={ui.primarySm}>
              {toggleError.action.label}
            </Link>
          )}
        </div>
      )}

      {running && (
        <div className="relative mt-5 h-1 overflow-hidden rounded-full bg-muted" aria-hidden>
          <div className="absolute inset-y-0 w-1/3 animate-[autopilot-progress_1.6s_ease-in-out_infinite] rounded-full bg-brand motion-reduce:animate-none" />
        </div>
      )}
    </section>
  )
}

function intervalText(hours: number): string {
  if (hours === 24) return 'day'
  if (hours === 168) return 'week'
  if (hours % 24 === 0) return `${hours / 24} days`
  return hours === 1 ? 'hour' : `${hours} hours`
}

function RunningLine({ startedAt }: { startedAt: string }) {
  const now = useNowEverySecond()
  const elapsed = now - new Date(startedAt).getTime()
  return (
    <span>
      Running for {formatDuration(Math.max(0, elapsed))} — applying to approved jobs, searching job boards and scoring
      new postings.
    </span>
  )
}

function ScheduleLine({ overview }: { overview: AgentOverview }) {
  const now = useNow()
  const { profile } = overview
  if (!profile.enabled) {
    return <span>Turn it on to run every {intervalText(profile.run_interval_hours)}, or press Run now for a one-off search.</span>
  }
  const next = profile.next_run_at
  let nextText = 'soon'
  if (next) nextText = new Date(next).getTime() <= now ? 'any moment now' : formatRelative(next, now)
  return (
    <span>
      Runs every {intervalText(profile.run_interval_hours)} · next run{' '}
      <span className="font-medium text-foreground" title={next ? formatDateTime(next) : undefined}>
        {nextText}
      </span>
    </span>
  )
}
