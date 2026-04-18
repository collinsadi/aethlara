import { useAutofill } from '../hooks/useAutofill'
import type { ExtJob } from '@/types'

const DASHBOARD_URL = import.meta.env.VITE_DASHBOARD_URL ?? 'https://app.aethlara.com'

interface Props {
  job: ExtJob
  onBack: () => void
}

export function JobDetailPage({ job, onBack }: Props) {
  const { state, scan, fill } = useAutofill(job.id)
  const score = job.match_score ?? 0
  const scoreColor = score >= 70 ? '#22c55e' : score >= 40 ? '#f59e0b' : '#ef4444'

  const openInDashboard = () => {
    chrome.tabs.create({ url: `${DASHBOARD_URL}/jobs/${job.id}` })
  }

  const handleAutofill = async () => {
    if (state.status === 'scanned') {
      await fill(state.fields)
      return
    }
    const fields = await scan()
    if (fields && fields.length === 0) {
      // No fillable fields found
    }
  }

  const autofillLabel = () => {
    switch (state.status) {
      case 'scanning': return 'Scanning page…'
      case 'scanned': return `Fill ${state.fields.length} field${state.fields.length !== 1 ? 's' : ''}`
      case 'filling': return 'AI is filling your form…'
      case 'done': return `Filled ${state.filled} of ${state.total} fields`
      case 'error': return 'Failed — try again'
      default: return '⚡ Autofill This Page'
    }
  }

  return (
    <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 14 }}>
      {/* Back */}
      <button
        className="btn btn-ghost"
        style={{ alignSelf: 'flex-start', fontSize: 12, padding: '4px 8px' }}
        onClick={onBack}
      >
        ← Back
      </button>

      {/* Job info */}
      <div>
        <p style={{ fontWeight: 700, fontSize: 14, color: 'var(--fg)' }}>{job.job_title || 'Untitled'}</p>
        <p style={{ fontSize: 12, color: 'var(--muted)', marginTop: 2 }}>
          {job.company}{job.location ? ` · ${job.location}` : ''}
        </p>
      </div>

      {/* Score */}
      {job.match_score != null && (
        <div className="card">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
            <span style={{ fontSize: 12, color: 'var(--muted)' }}>Match Score</span>
            <span style={{ fontSize: 18, fontWeight: 700, color: scoreColor }}>{score}%</span>
          </div>
          <div className="score-bar">
            <div className="score-bar-fill" style={{ width: `${score}%`, background: scoreColor }} />
          </div>
        </div>
      )}

      {/* Error */}
      {state.status === 'error' && (
        <p style={{ fontSize: 11, color: '#ef4444' }}>{state.message}</p>
      )}

      {/* Scanned fields preview */}
      {state.status === 'scanned' && (
        <div className="card" style={{ fontSize: 11, color: 'var(--muted)' }}>
          <p style={{ fontWeight: 600, marginBottom: 4, color: 'var(--fg)' }}>
            Found {state.fields.length} field{state.fields.length !== 1 ? 's' : ''}
          </p>
          <ul style={{ paddingLeft: 14, margin: 0 }}>
            {state.fields.slice(0, 5).map((f) => (
              <li key={f.field_id} style={{ marginTop: 2 }}>{f.label || f.name || f.type}</li>
            ))}
            {state.fields.length > 5 && <li style={{ marginTop: 2, opacity: 0.6 }}>+{state.fields.length - 5} more</li>}
          </ul>
        </div>
      )}

      {/* Autofill button */}
      <button
        className="btn btn-primary btn-full"
        onClick={handleAutofill}
        disabled={state.status === 'scanning' || state.status === 'filling' || state.status === 'done'}
        style={{ fontSize: 13 }}
      >
        {state.status === 'idle' ? (
          <span style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 8, width: '100%' }}>
            <span>⚡ Autofill This Page</span>
            <span className="badge badge-beta">Beta</span>
          </span>
        ) : (
          autofillLabel()
        )}
      </button>

      {/* Dashboard link */}
      <button
        className="btn btn-ghost btn-full"
        onClick={openInDashboard}
        style={{ fontSize: 12 }}
      >
        Open in Dashboard →
      </button>
    </div>
  )
}
