import { focusTab } from '@/background/tabs'
import { hostOf } from '@/lib/util'
import type { ActiveRun } from '@/types'
import { useNow } from '../hooks/useStorage'
import { Spinner } from './ui'

function elapsed(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

/** The application the extension is working on right now, step by step. */
export function LiveRun({ run, onStop, stopping }: { run: ActiveRun; onStop?: () => void; stopping?: boolean }) {
  const now = useNow(1000)
  const steps = run.steps.slice(-7)
  return (
    <div className="card brand stack" style={{ gap: 10 }}>
      <div className="row" style={{ alignItems: 'flex-start' }}>
        <Spinner />
        <div className="grow">
          <p className="item-title truncate">{run.title || 'Application'}</p>
          <p className="small muted truncate">
            {run.company}
            {run.ats ? ` · ${run.ats}` : ''} · {hostOf(run.applyUrl)}
          </p>
        </div>
        <span className="small faint" style={{ fontVariantNumeric: 'tabular-nums' }}>
          {elapsed(now - run.startedAt)}
        </span>
      </div>
      <ul className="steps">
        {steps.map((step, i) => (
          <li key={`${step.at}-${i}`} className={`step ${step.state}`}>
            <span className="step-dot" />
            <span className="step-label">{step.label}</span>
          </li>
        ))}
      </ul>
      <div className="row">
        {run.tabId != null && (
          <button className="btn btn-soft btn-sm" onClick={() => void focusTab(run.tabId!)}>
            Show tab
          </button>
        )}
        {onStop && (
          <button className="btn btn-ghost btn-sm" onClick={onStop} disabled={stopping}>
            {stopping ? 'Stopping…' : 'Stop'}
          </button>
        )}
        <span className="grow" />
        <span className="tiny faint">{run.mode === 'manual' ? 'Fill only' : run.autoSubmit ? 'Auto-submit on' : 'Stops before submit'}</span>
      </div>
    </div>
  )
}
