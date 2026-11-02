import { DASHBOARD_LINKS } from '@/lib/config'
import type { ExtJob } from '@/types'
import { Notice, openTab } from '../../components/ui'
import { useAutofill } from '../../hooks/useLegacy'

interface Props {
  job: ExtJob
}

/** Saved-job autofill: scan the open form, then fill after the on-page consent bar. */
export function JobDetailPage({ job }: Props) {
  const { state, scan, fill, reset } = useAutofill(job.id)
  const score = job.match_score ?? 0
  const scoreColor = score >= 70 ? 'var(--success)' : score >= 40 ? 'var(--warning)' : 'var(--error)'

  const label = () => {
    switch (state.status) {
      case 'scanning':
        return 'Scanning page…'
      case 'scanned':
        return `Fill ${state.fields.length} field${state.fields.length === 1 ? '' : 's'}`
      case 'filling':
        return 'Confirm on the page, then AI fills it…'
      case 'done':
        return state.cancelled ? 'Cancelled on the page' : `Filled ${state.filled} of ${state.total} fields`
      case 'error':
        return 'Try again'
      default:
        return 'Autofill this page'
    }
  }

  const onClick = () => {
    if (state.status === 'scanned') void fill()
    else if (state.status === 'error' || state.status === 'done') {
      reset()
      void scan()
    } else void scan()
  }

  return (
    <div className="page">
      <div>
        <p className="bold" style={{ fontSize: 14 }}>
          {job.job_title || 'Untitled'}
        </p>
        <p className="small muted">
          {job.company}
          {job.location ? ` · ${job.location}` : ''}
        </p>
      </div>

      {job.match_score != null && (
        <div className="card">
          <div className="row between" style={{ marginBottom: 6 }}>
            <span className="small muted">Match score</span>
            <span style={{ fontSize: 18, fontWeight: 700, color: scoreColor }}>{score}%</span>
          </div>
          <div className="score-bar">
            <div className="score-bar-fill" style={{ width: `${score}%`, background: scoreColor }} />
          </div>
        </div>
      )}

      {state.status === 'error' && <Notice tone="error">{state.message}</Notice>}

      {state.status === 'scanned' && (
        <div className="card small muted">
          <p className="bold" style={{ color: 'var(--fg)', marginBottom: 4 }}>
            Found {state.fields.length} field{state.fields.length === 1 ? '' : 's'}
          </p>
          <ul style={{ paddingLeft: 14, margin: 0 }}>
            {state.fields.slice(0, 6).map((f) => (
              <li key={f.field_id}>{f.label || f.type}</li>
            ))}
            {state.fields.length > 6 && <li style={{ opacity: 0.6 }}>+{state.fields.length - 6} more</li>}
          </ul>
        </div>
      )}

      <button
        className="btn btn-primary btn-full"
        onClick={onClick}
        disabled={state.status === 'scanning' || state.status === 'filling'}
        style={{ fontSize: 13 }}
      >
        {label()}
        {state.status === 'idle' && <span className="badge badge-beta">Beta</span>}
      </button>
      <p className="tiny faint center">Files are not uploaded in this mode. Nothing is typed until you click Fill on the page.</p>

      <button className="btn btn-ghost btn-full" onClick={() => openTab(DASHBOARD_LINKS.job(job.id))}>
        Open in dashboard
      </button>
    </div>
  )
}
