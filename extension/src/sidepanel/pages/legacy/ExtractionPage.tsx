import { useEffect, useMemo, useRef, useState } from 'react'
import { ApiError, jobsApi } from '@/background/api'
import { ensureContentScript } from '@/background/tabs'
import { DASHBOARD_LINKS } from '@/lib/config'
import { sendToTab } from '@/lib/messaging'
import { formatCountdown } from '@/lib/util'
import type { ExtMismatchData, ExtResume, ExtractionResult } from '@/types'
import { MismatchModal } from '../../components/MismatchModal'
import { Notice, Spinner, openTab } from '../../components/ui'
import { isRestrictedUrl } from '../../hooks/useActiveTab'
import { useResumes } from '../../hooks/useLegacy'

const MIN_TEXT_LENGTH = 200

/**
 * Copy shown during the AI pipeline. The backend doesn't stream stages, so
 * advance through these on a timer during the ~60–90s extraction.
 */
const EXTRACTING_STAGES: { title: string; hint: string }[] = [
  { title: 'Extracting job details…', hint: 'Reading the listing' },
  { title: 'Matching against your resume…', hint: 'This can take up to a minute' },
  { title: 'Still analysing…', hint: 'Hang on — writing up the breakdown' },
]

type ExtractionState =
  | { phase: 'pick_resume' }
  | { phase: 'reading' }
  | { phase: 'extracting' }
  | { phase: 'done'; result: ExtractionResult }
  | { phase: 'mismatch'; data: ExtMismatchData }
  | { phase: 'error'; message: string; retryable: boolean }
  | { phase: 'saving' }
  | { phase: 'saved'; jobId: string }

function sortResumes(list: ExtResume[]): ExtResume[] {
  return [...list.filter((r) => r.extraction_status === 'completed'), ...list.filter((r) => r.extraction_status !== 'completed')]
}

async function readActivePage(): Promise<{ text: string; url: string }> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
  if (!tab?.id || isRestrictedUrl(tab.url)) {
    throw new Error("This page can't be read (internal browser page or Web Store). Open a job listing and try again.")
  }
  if (!(await ensureContentScript(tab.id))) throw new Error('Aethlara cannot read this tab yet. Reload the page and try again.')
  const { text } = await sendToTab(tab.id, { type: 'EXTRACT_TEXT' })
  return { text, url: tab.url ?? '' }
}

export function ExtractionPage({ onDone }: { onDone: () => void }) {
  const { data: resumes = [], isLoading: resumesLoading, isError: resumesError } = useResumes()
  const [state, setState] = useState<ExtractionState>({ phase: 'pick_resume' })
  const [search, setSearch] = useState('')
  const [selectedResumeId, setSelectedResumeId] = useState('')
  const [countdown, setCountdown] = useState(0)
  const [stage, setStage] = useState(0)
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const stageTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const activeResumeRef = useRef('')

  useEffect(() => {
    if (!resumes.length || selectedResumeId) return
    const first = resumes.find((r) => r.extraction_status === 'completed')
    if (first) setSelectedResumeId(first.id)
  }, [resumes, selectedResumeId])

  useEffect(
    () => () => {
      if (timerRef.current) clearInterval(timerRef.current)
      if (stageTimerRef.current) clearInterval(stageTimerRef.current)
    },
    [],
  )

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return sortResumes(q ? resumes.filter((r) => r.name.toLowerCase().includes(q)) : resumes)
  }, [resumes, search])

  const canExtract =
    state.phase === 'pick_resume' && !!selectedResumeId && resumes.some((r) => r.id === selectedResumeId && r.extraction_status === 'completed')

  const stopStages = () => {
    if (stageTimerRef.current) clearInterval(stageTimerRef.current)
    stageTimerRef.current = null
  }

  const start = async (resumeId: string) => {
    activeResumeRef.current = resumeId
    setState({ phase: 'reading' })
    let page: { text: string; url: string }
    try {
      page = await readActivePage()
    } catch (err) {
      setState({ phase: 'error', message: err instanceof Error ? err.message : 'Could not read this page.', retryable: true })
      return
    }
    if (page.text.length < MIN_TEXT_LENGTH) {
      setState({ phase: 'error', message: 'Not enough text on this page to extract a job. Scroll to the full description and try again.', retryable: true })
      return
    }

    setState({ phase: 'extracting' })
    setStage(0)
    stopStages()
    stageTimerRef.current = setInterval(() => setStage((s) => Math.min(s + 1, EXTRACTING_STAGES.length - 1)), 12_000)
    try {
      const result = await jobsApi.extract({ page_text: page.text, page_url: page.url, resume_id: resumeId })
      stopStages()
      setState({ phase: 'done', result })
      const expiresAt = new Date(result.preview_expires_at).getTime()
      setCountdown(Math.max(0, Math.floor((expiresAt - Date.now()) / 1000)))
      if (timerRef.current) clearInterval(timerRef.current)
      timerRef.current = setInterval(() => {
        const remaining = Math.max(0, Math.floor((expiresAt - Date.now()) / 1000))
        setCountdown(remaining)
        if (remaining === 0 && timerRef.current) clearInterval(timerRef.current)
      }, 1000)
    } catch (err) {
      stopStages()
      if (err instanceof ApiError) {
        if (err.code === 'RESUME_MISALIGNED' && err.details) {
          setState({ phase: 'mismatch', data: err.details as ExtMismatchData })
          return
        }
        if (err.code === 'TIMEOUT') {
          setState({ phase: 'error', message: 'This took longer than expected. Open the dashboard and try creating the job there.', retryable: true })
          return
        }
        if (err.code === 'AI_TIMEOUT' || err.status === 504) {
          setState({ phase: 'error', message: 'The AI is busy right now. Please try again in a moment.', retryable: true })
          return
        }
        setState({ phase: 'error', message: err.message, retryable: true })
        return
      }
      setState({ phase: 'error', message: 'Extraction failed. This might not be a job page.', retryable: true })
    }
  }

  const save = async () => {
    if (state.phase !== 'done') return
    const token = state.result.preview_token
    setState({ phase: 'saving' })
    try {
      const saved = await jobsApi.confirm(token)
      setState({ phase: 'saved', jobId: saved.id })
      openTab(DASHBOARD_LINKS.job(saved.id))
    } catch {
      setState({ phase: 'error', message: 'Failed to save job. Try again.', retryable: true })
    }
  }

  const retry = () => {
    const id = activeResumeRef.current || selectedResumeId
    if (id) void start(id)
  }

  const score = state.phase === 'done' ? state.result.match_score : 0
  const scoreColor = score >= 70 ? 'var(--success)' : score >= 40 ? 'var(--warning)' : 'var(--error)'

  return (
    <div className="page">
      {state.phase === 'pick_resume' && (
        <div className="stack" style={{ gap: 10 }}>
          <div>
            <p className="bold">Extract this job</p>
            <p className="small muted">Choose the resume to match against, then save the job to your tracker.</p>
          </div>
          {resumesLoading && (
            <div className="row small muted">
              <Spinner /> Loading resumes…
            </div>
          )}
          {resumesError && <Notice tone="error">Could not load resumes. Check your connection.</Notice>}
          {!resumesLoading && !resumesError && resumes.length === 0 && <Notice>No resumes yet. Upload one in the dashboard first.</Notice>}
          {!resumesLoading && !resumesError && resumes.length > 0 && (
            <>
              <input type="search" placeholder="Search resumes…" value={search} onChange={(e) => setSearch(e.target.value)} className="input" />
              <div className="list" style={{ maxHeight: 260, overflowY: 'auto' }}>
                {filtered.length === 0 && <p className="small muted center">No resumes match your search.</p>}
                {filtered.map((r) => {
                  const ready = r.extraction_status === 'completed'
                  const selected = selectedResumeId === r.id
                  return (
                    <button
                      key={r.id}
                      type="button"
                      className="item"
                      disabled={!ready}
                      title={!ready ? 'This resume is still being processed' : undefined}
                      onClick={() => ready && setSelectedResumeId(r.id)}
                      style={{
                        textAlign: 'left',
                        color: 'var(--fg)',
                        opacity: ready ? 1 : 0.55,
                        cursor: ready ? 'pointer' : 'not-allowed',
                        borderColor: selected ? 'var(--brand)' : undefined,
                        background: selected ? 'var(--brand-light)' : undefined,
                      }}
                    >
                      <span className="item-title" style={{ wordBreak: 'break-word' }}>
                        {r.name}
                      </span>
                      <span className="tiny muted">
                        {r.file_format.toUpperCase()} · {new Date(r.uploaded_at).toLocaleDateString()}
                        {!ready && ' · Processing…'}
                      </span>
                    </button>
                  )
                })}
              </div>
              <button className="btn btn-primary btn-full" disabled={!canExtract} onClick={() => canExtract && void start(selectedResumeId)}>
                Extract job from this page
              </button>
            </>
          )}
        </div>
      )}

      {(state.phase === 'reading' || state.phase === 'extracting') && (
        <div className="stack center" style={{ alignItems: 'center', paddingTop: 20, gap: 12 }}>
          <Spinner large />
          <p className="bold">{state.phase === 'extracting' ? EXTRACTING_STAGES[stage].title : 'Reading page…'}</p>
          <p className="small muted">{state.phase === 'extracting' ? EXTRACTING_STAGES[stage].hint : 'Pulling the job description'}</p>
        </div>
      )}

      {state.phase === 'error' && (
        <div className="stack">
          <Notice tone="error">
            <p className="bold">Extraction failed</p>
            <p>{state.message}</p>
          </Notice>
          {state.retryable && (
            <button className="btn btn-ghost btn-full" onClick={retry}>
              Try again
            </button>
          )}
        </div>
      )}

      {state.phase === 'done' && (
        <>
          <div>
            <p className="bold" style={{ fontSize: 14 }}>
              {state.result.job?.title ?? 'Job'}
            </p>
            <p className="small muted">
              {state.result.job?.company}
              {state.result.job?.location ? ` · ${state.result.job.location}` : ''}
            </p>
          </div>
          <div className="card">
            <div className="row between" style={{ marginBottom: 6 }}>
              <span className="small muted">Match score</span>
              <span style={{ fontSize: 18, fontWeight: 700, color: scoreColor }}>{score}%</span>
            </div>
            <div className="score-bar">
              <div className="score-bar-fill" style={{ width: `${score}%`, background: scoreColor }} />
            </div>
          </div>
          {state.result.gaps.length > 0 && (
            <div>
              <p className="small muted bold" style={{ marginBottom: 4 }}>
                Gaps
              </p>
              <ul style={{ paddingLeft: 14, margin: 0 }}>
                {state.result.gaps.map((g) => (
                  <li key={g} className="small">
                    {g}
                  </li>
                ))}
              </ul>
            </div>
          )}
          <button className="btn btn-primary btn-full" onClick={() => void save()} disabled={countdown === 0}>
            Save to dashboard
          </button>
          <p className="small muted center">{countdown > 0 ? `Preview expires in ${formatCountdown(countdown)}` : 'Preview expired — re-extract to save.'}</p>
        </>
      )}

      {state.phase === 'saving' && <p className="center small muted">Saving…</p>}
      {state.phase === 'saved' && (
        <p className="center small bold" style={{ color: 'var(--success)' }}>
          Saved! Opening in the dashboard…
        </p>
      )}
      {state.phase === 'mismatch' && <MismatchModal data={state.data} onClose={onDone} />}
    </div>
  )
}
