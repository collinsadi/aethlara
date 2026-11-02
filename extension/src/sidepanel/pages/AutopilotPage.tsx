import { useEffect, useRef, useState } from 'react'
import { ApiError } from '@/background/api'
import { DASHBOARD_LINKS } from '@/lib/config'
import { sendToBackground } from '@/lib/messaging'
import { errorMessage, relativeTime } from '@/lib/util'
import type { AgentOverview, AgentRun, LastTick, RunnerState } from '@/types'
import { LiveRun } from '../components/LiveRun'
import { QueueList } from '../components/QueueList'
import { ExternalLink, Notice, SectionHead, Spinner, Toggle } from '../components/ui'
import { useInvalidateAgent, useOverview, useQueue, useStartRun } from '../hooks/useAgent'
import { useNow, useSettings } from '../hooks/useStorage'

function runSummary(run: AgentRun): string {
  if (run.status === 'failed') return run.error ? `Failed: ${run.error}` : 'Failed'
  const s = run.stats
  const parts: string[] = []
  if (s.new_leads) parts.push(`${s.new_leads} new job${s.new_leads === 1 ? '' : 's'}`)
  if (s.strong_matches) parts.push(`${s.strong_matches} strong`)
  if (s.ready_for_browser) parts.push(`${s.ready_for_browser} ready for the extension`)
  if (s.emails_sent) parts.push(`${s.emails_sent} emailed`)
  return parts.length ? parts.join(' · ') : 'No new jobs'
}

function startRunError(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.code === 'RUN_IN_PROGRESS') return 'The agent is already running.'
    if (err.code === 'API_KEY_REQUIRED') return 'Add an AI provider key in the dashboard first.'
    if (err.code === 'RESUME_REQUIRED') return 'Upload a resume (and let it finish processing) first.'
    if (err.code === 'RATE_LIMITED') return 'Too many manual runs this hour. Try again later.'
  }
  return errorMessage(err, 'Could not start the agent.')
}

function tickSummary(tick: LastTick, now: number): string {
  const when = relativeTime(tick.at, now)
  const did = tick.processed ? `worked ${tick.processed} application${tick.processed === 1 ? '' : 's'}` : ''
  switch (tick.outcome) {
    case 'empty':
      return `Checked ${when}: ${did ? `${did}, ` : ''}nothing else waiting.`
    case 'limit':
      return `Checked ${when}: ${did}; the rest wait for the next check.`
    case 'stopped':
      return `Stopped ${when}.`
    case 'disabled':
      return `Paused ${when} (autopilot switched off).`
    case 'signed_out':
      return `Stopped ${when}: signed out.`
    case 'repeat':
      return `Checked ${when}: ${did || 'nothing new'}.`
    case 'error':
      return `Check ${when} stopped: ${tick.message ?? 'error'}`
  }
}

function AgentCard({ overview }: { overview: AgentOverview }) {
  const startRun = useStartRun()
  const now = useNow()
  const { profile, setup, running_run: running, last_run: last } = overview
  const missing: string[] = []
  if (!setup.has_ai_key) missing.push('an AI provider key')
  if (!setup.has_resume) missing.push('a processed resume')
  if (!setup.has_preferences) missing.push('target titles or keywords')

  return (
    <div className="card stack" style={{ gap: 8 }}>
      <div className="row between">
        <span className="bold">Job-search agent</span>
        {running ? (
          <span className="badge badge-brand">
            <Spinner /> Running
          </span>
        ) : profile.enabled ? (
          <span className="badge badge-green">On</span>
        ) : (
          <span className="badge badge-gray">Off</span>
        )}
      </div>
      <dl className="kv">
        <dt>Next run</dt>
        <dd>{profile.enabled ? (profile.next_run_at ? relativeTime(profile.next_run_at, now) : 'soon') : 'Only when you run it'}</dd>
        <dt>Last run</dt>
        <dd title={last ? runSummary(last) : undefined}>{last ? `${relativeTime(last.finished_at ?? last.started_at, now)} · ${runSummary(last)}` : 'Never'}</dd>
      </dl>
      {missing.length > 0 && (
        <Notice tone="warn">
          The agent needs {missing.join(', ')}.{' '}
          <ExternalLink href={!setup.has_ai_key ? DASHBOARD_LINKS.aiSettings : DASHBOARD_LINKS.agentSettings}>Open the dashboard</ExternalLink>
        </Notice>
      )}
      <div className="row">
        <button className="btn btn-primary btn-sm" disabled={!!running || startRun.isPending} onClick={() => startRun.mutate()}>
          {startRun.isPending ? 'Starting…' : 'Run agent now'}
        </button>
        <ExternalLink href={DASHBOARD_LINKS.agentSettings} className="btn btn-ghost btn-sm">
          Agent settings
        </ExternalLink>
      </div>
      {startRun.isError && <Notice tone="error">{startRunError(startRun.error)}</Notice>}
    </div>
  )
}

function Stats({ overview, onReview }: { overview: AgentOverview; onReview: () => void }) {
  const leads = overview.counts.leads.new ?? 0
  const apps = overview.counts.applications
  return (
    <div className="stat-grid">
      <button className={`stat${leads ? ' highlight' : ''}`} onClick={onReview} title="Review new leads">
        <span className="stat-value">{leads}</span>
        <span className="stat-label">New leads to review</span>
      </button>
      <div className="stat">
        <span className="stat-value">{(apps.ready ?? 0) + (apps.in_progress ?? 0)}</span>
        <span className="stat-label">Ready for the extension</span>
      </div>
      <div className={`stat${apps.needs_input ? ' highlight' : ''}`}>
        <span className="stat-value">{apps.needs_input ?? 0}</span>
        <span className="stat-label">Need you</span>
      </div>
      <div className="stat">
        <span className="stat-value">{overview.counts.submitted_today}</span>
        <span className="stat-label">Submitted today</span>
      </div>
    </div>
  )
}

function ExtensionAutopilot({ runner, autoSubmit }: { runner: RunnerState; autoSubmit: boolean | undefined }) {
  const { settings, update } = useSettings()
  const now = useNow()
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const busy = !!runner.tick || !!runner.current

  const applyNow = async () => {
    setPending(true)
    setError(null)
    try {
      const reply = await sendToBackground({ type: 'RUNNER_APPLY_NOW' })
      if (!reply.started && reply.reason === 'signed_out') setError('Sign in again to apply.')
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setPending(false)
    }
  }

  return (
    <div className="card stack" style={{ gap: 10 }}>
      <div className="row" style={{ alignItems: 'flex-start' }}>
        <div className="grow">
          <p className="bold">Apply automatically</p>
          <p className="small muted">
            Checks for approved applications every {settings.intervalMinutes} min and fills them in background tabs, one at a
            time, up to 3 per check.
          </p>
        </div>
        <Toggle label="Apply automatically" on={settings.autopilot} onChange={(next) => void update({ autopilot: next })} />
      </div>
      <div className="row">
        <button className="btn btn-primary btn-sm" disabled={pending || busy} onClick={() => void applyNow()}>
          {busy ? 'Working…' : pending ? 'Starting…' : 'Apply now'}
        </button>
        <span className="small muted grow">
          {runner.tick && !runner.current ? 'Checking the queue…' : runner.lastTick ? tickSummary(runner.lastTick, now) : 'Not run yet.'}
        </span>
      </div>
      {autoSubmit === false && (
        <p className="tiny faint">Auto-submit is off in your agent settings: forms are filled and left open for you to submit.</p>
      )}
      {runner.pendingReports.length > 0 && (
        <p className="tiny faint">
          {runner.pendingReports.length} result{runner.pendingReports.length === 1 ? '' : 's'} waiting to sync with Aethlara.
        </p>
      )}
      {error && <Notice tone="error">{error}</Notice>}
    </div>
  )
}

export function AutopilotPage({ runner, onReview }: { runner: RunnerState; onReview: () => void }) {
  const overview = useOverview()
  const queue = useQueue()
  const invalidate = useInvalidateAgent()
  const [stopping, setStopping] = useState(false)

  // Refresh server data whenever the runner finishes something.
  const lastResultAt = runner.recent[0]?.at ?? 0
  const currentId = runner.current?.runId ?? null
  const first = useRef(true)
  useEffect(() => {
    if (first.current) {
      first.current = false
      return
    }
    invalidate()
  }, [lastResultAt, currentId])

  const stop = async () => {
    setStopping(true)
    try {
      await sendToBackground({ type: 'RUNNER_STOP' })
    } finally {
      setStopping(false)
    }
  }

  const live = [...(runner.current ? [runner.current] : []), ...runner.manual]

  return (
    <div className="page">
      {overview.isLoading && (
        <div className="row muted small">
          <Spinner /> Loading your agent…
        </div>
      )}
      {overview.isError && <Notice tone="error">Couldn't load the agent: {errorMessage(overview.error)}</Notice>}
      {overview.data && <AgentCard overview={overview.data} />}
      {overview.data && <Stats overview={overview.data} onReview={onReview} />}

      <div className="section">
        <SectionHead title="Extension autopilot" />
        <ExtensionAutopilot runner={runner} autoSubmit={overview.data?.profile.apply_settings?.auto_submit} />
      </div>

      {live.length > 0 && (
        <div className="section">
          <SectionHead title="Applying now" />
          {live.map((run) => (
            <LiveRun key={run.runId} run={run} onStop={run.mode === 'auto' ? () => void stop() : undefined} stopping={stopping} />
          ))}
        </div>
      )}

      <div className="section">
        <SectionHead
          title={`Queue${queue.data ? ` (${queue.data.pagination.total_items})` : ''}`}
          action={
            <ExternalLink href={DASHBOARD_LINKS.applications} className="small">
              Dashboard
            </ExternalLink>
          }
        />
        {queue.isLoading && (
          <div className="row muted small">
            <Spinner /> Loading…
          </div>
        )}
        {queue.isError && <Notice tone="error">Couldn't load the queue: {errorMessage(queue.error)}</Notice>}
        {queue.data && <QueueList apps={queue.data.items} runner={runner} />}
      </div>

      {runner.recent.length > 0 && (
        <div className="section">
          <SectionHead title="Recent" />
          <div className="list">
            {runner.recent.slice(0, 6).map((r) => (
              <div key={`${r.appId}-${r.at}`} className="row small" style={{ alignItems: 'flex-start' }}>
                <span
                  className={`badge ${r.status === 'submitted' ? 'badge-green' : r.status === 'needs_input' ? 'badge-amber' : r.status === 'failed' ? 'badge-red' : 'badge-gray'}`}
                >
                  {r.status === 'submitted' ? 'Sent' : r.status === 'needs_input' ? 'Needs you' : r.status === 'failed' ? 'Failed' : 'Paused'}
                </span>
                <div className="grow">
                  <p className="truncate">
                    {r.title} · <span className="muted">{r.company}</span>
                  </p>
                  <p className="tiny faint clamp-2">
                    {relativeTime(r.at)} · {r.message}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
