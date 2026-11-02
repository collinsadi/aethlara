import { useState } from 'react'
import { focusTab } from '@/background/tabs'
import { DASHBOARD_LINKS } from '@/lib/config'
import { errorMessage, isHttpUrl, relativeTime } from '@/lib/util'
import type { Application, RunnerState } from '@/types'
import { useApplicationAction } from '../hooks/useAgent'
import { EmptyState, ExternalLink, NEEDS_LABEL, Notice, StatusPill, openTab } from './ui'

const ORDER: Record<string, number> = { in_progress: 0, needs_input: 1, failed: 2, ready: 3 }

function QueueItem({ app, runner }: { app: Application; runner: RunnerState }) {
  const action = useApplicationAction()
  const [confirming, setConfirming] = useState(false)
  const watch = runner.watches.find((w) => w.appId === app.id)
  const isCurrent = runner.current?.appId === app.id
  const pageUrl = app.needs?.page_url && isHttpUrl(app.needs.page_url) ? app.needs.page_url : app.apply_url

  const open = async () => {
    if (watch && (await focusTab(watch.tabId))) return
    if (isCurrent && runner.current?.tabId != null && (await focusTab(runner.current.tabId))) return
    if (pageUrl && isHttpUrl(pageUrl)) openTab(pageUrl)
  }

  const run = (kind: 'retry' | 'cancel' | 'mark_submitted') => {
    setConfirming(false)
    action.mutate({ app, action: kind })
  }

  return (
    <div className="item">
      <div className="row" style={{ alignItems: 'flex-start' }}>
        <div className="grow">
          <p className="item-title truncate" title={app.lead.title}>
            {app.lead.title || 'Application'}
          </p>
          <p className="small muted truncate">
            {app.lead.company}
            {app.ats ? ` · ${app.ats}` : ''}
            {app.lead.score != null ? ` · ${app.lead.score}% match` : ''}
          </p>
        </div>
        <StatusPill status={app.status} />
      </div>

      {app.status === 'needs_input' && app.needs && (
        <p className="small">
          <span className="bold" style={{ color: 'var(--warning)' }}>
            {NEEDS_LABEL[app.needs.reason] ?? 'Needs you'}
          </span>
          {app.needs.message ? ` · ${app.needs.message}` : ''}
        </p>
      )}
      {app.status === 'needs_input' && app.needs?.questions?.length ? (
        <p className="tiny muted clamp-2">
          {app.needs.questions
            .slice(0, 3)
            .map((q) => q.label)
            .join(' · ')}
          {app.needs.questions.length > 3 ? ` · +${app.needs.questions.length - 3} more` : ''}
        </p>
      ) : null}
      {app.status === 'failed' && app.last_error && (
        <p className="small" style={{ color: '#fca5a5' }}>
          {app.last_error}
        </p>
      )}
      {app.status === 'in_progress' && !isCurrent && app.claim_expires_at && (
        <p className="tiny muted">Being applied to by an extension · lease ends {relativeTime(app.claim_expires_at)}</p>
      )}

      <div className="item-actions">
        {(pageUrl || watch) && (
          <button className="btn btn-soft btn-sm" onClick={() => void open()}>
            {watch || isCurrent ? 'Show tab' : 'Open'}
          </button>
        )}
        {(app.status === 'failed' || app.status === 'needs_input') && (
          <button className="btn btn-ghost btn-sm" disabled={action.isPending} onClick={() => run('retry')}>
            Retry
          </button>
        )}
        {app.status === 'needs_input' && app.needs?.reason === 'missing_answers' && (
          <ExternalLink href={DASHBOARD_LINKS.applications} className="btn btn-ghost btn-sm">
            Answer in dashboard
          </ExternalLink>
        )}
        {(app.status === 'needs_input' || app.status === 'ready') &&
          (confirming ? (
            <>
              <button className="btn btn-primary btn-sm" disabled={action.isPending} onClick={() => run('mark_submitted')}>
                Yes, I submitted it
              </button>
              <button className="btn btn-ghost btn-sm" onClick={() => setConfirming(false)}>
                No
              </button>
            </>
          ) : (
            app.status === 'needs_input' && (
              <button className="link-btn" onClick={() => setConfirming(true)}>
                Mark submitted
              </button>
            )
          ))}
      </div>
      {action.isError && <Notice tone="error">{errorMessage(action.error)}</Notice>}
    </div>
  )
}

export function QueueList({ apps, runner }: { apps: Application[]; runner: RunnerState }) {
  if (!apps.length) {
    return (
      <EmptyState title="Nothing in the queue">
        <p className="small">Approved jobs show up here once the agent has prepared them.</p>
      </EmptyState>
    )
  }
  const sorted = [...apps].sort((a, b) => (ORDER[a.status] ?? 9) - (ORDER[b.status] ?? 9))
  return (
    <div className="list">
      {sorted.map((app) => (
        <QueueItem key={app.id} app={app} runner={runner} />
      ))}
    </div>
  )
}
