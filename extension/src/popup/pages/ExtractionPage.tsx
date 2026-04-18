import { useState, useEffect, useRef, useMemo } from 'react'
import { extractFromExtensionApi, confirmFromExtensionApi } from '@/api/jobs'
import type { ExtResume } from '@/api/resumes'
import { useResumes } from '@/popup/hooks/useResumes'
import { MismatchModal } from '@/popup/components/MismatchModal'
import type { ExtractionResult, ExtMismatchData } from '@/types'

const DASHBOARD_URL = import.meta.env.VITE_DASHBOARD_URL ?? 'https://app.aethlara.com'
const MIN_TEXT_LENGTH = 200

/**
 * Copy shown during the AI pipeline. We don't stream real stages from the
 * backend (yet), so advance through these on a timer to reassure the user
 * that the popup is still working during the ~60–90s pipeline.
 */
const EXTRACTING_STAGES: { title: string; hint: string }[] = [
  { title: 'Extracting job details…', hint: 'Reading the listing' },
  { title: 'Matching against your resume…', hint: 'This can take up to a minute' },
  { title: 'Still analysing…', hint: 'Hang on — writing up the breakdown' },
]

interface Props {
  onBack: () => void
}

type ExtractionState =
  | { phase: 'pick_resume' }
  | { phase: 'reading' }
  | { phase: 'extracting' }
  | { phase: 'done'; result: ExtractionResult }
  | { phase: 'mismatch'; data: ExtMismatchData }
  | { phase: 'error'; message: string; retryable: boolean }
  | { phase: 'saving' }
  | { phase: 'saved'; jobId: string }

/**
 * Self-contained extractor injected into the active tab via
 * chrome.scripting.executeScript. Runs in the page context with no imports.
 * Kept in sync with src/content/extractor.ts but fully inlined so it doesn't
 * depend on the content script being present (many pages were loaded before
 * the extension installed, so the content script isn't there).
 */
function pageExtractorFn(): string {
  const REMOVE = [
    'script', 'style', 'noscript', 'iframe',
    'nav', 'header', 'footer',
    '[aria-hidden="true"]',
    '[role="navigation"]', '[role="banner"]',
  ].join(', ')
  const MAX = 50_000
  const body = document.body
  if (!body) return ''
  const clone = body.cloneNode(true) as HTMLElement
  clone.querySelectorAll(REMOVE).forEach((el) => el.remove())
  const text = (clone.innerText || clone.textContent || '').replace(/\s+/g, ' ').trim()
  return text.slice(0, MAX)
}

async function readPageText(tabId: number): Promise<string> {
  const results = await chrome.scripting.executeScript({
    target: { tabId, allFrames: false },
    func: pageExtractorFn,
    world: 'MAIN',
  })
  return results?.[0]?.result ?? ''
}

function isRestrictedUrl(url: string | undefined): boolean {
  if (!url) return true
  return (
    url.startsWith('chrome://') ||
    url.startsWith('chrome-extension://') ||
    url.startsWith('edge://') ||
    url.startsWith('about:') ||
    url.startsWith('view-source:') ||
    url.includes('chrome.google.com/webstore') ||
    url.includes('chromewebstore.google.com')
  )
}

function sortResumesForPicker(list: ExtResume[]): ExtResume[] {
  const ready = list.filter((r) => r.extraction_status === 'completed')
  const rest = list.filter((r) => r.extraction_status !== 'completed')
  return [...ready, ...rest]
}

export function ExtractionPage({ onBack }: Props) {
  const { data: resumes = [], isLoading: resumesLoading, isError: resumesError } = useResumes()
  const [state, setState] = useState<ExtractionState>({ phase: 'pick_resume' })
  const [search, setSearch] = useState('')
  const [selectedResumeId, setSelectedResumeId] = useState('')
  const [countdown, setCountdown] = useState(0)
  // Staged progress indicator for the long (up to ~120s) AI pipeline.
  // Drives reassuring copy like "Extracting job details…" → "Matching against
  // your resume…" so the user doesn't think the popup is stuck.
  const [extractingStage, setExtractingStage] = useState(0)
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const stageTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const activeResumeIdRef = useRef<string>('')

  useEffect(() => {
    document.body.classList.add('popup-extract')
    return () => document.body.classList.remove('popup-extract')
  }, [])

  useEffect(() => {
    if (!resumes.length || selectedResumeId) return
    const first = resumes.find((r) => r.extraction_status === 'completed')
    if (first) setSelectedResumeId(first.id)
  }, [resumes, selectedResumeId])

  const filteredResumes = useMemo(() => {
    const q = search.trim().toLowerCase()
    const base = q ? resumes.filter((r) => r.name.toLowerCase().includes(q)) : resumes
    return sortResumesForPicker(base)
  }, [resumes, search])

  const canExtract =
    state.phase === 'pick_resume' &&
    !!selectedResumeId &&
    resumes.some((r) => r.id === selectedResumeId && r.extraction_status === 'completed')

  const startExtraction = async (resumeId: string) => {
    activeResumeIdRef.current = resumeId
    setState({ phase: 'reading' })

    try {
      const tabs = await chrome.tabs.query({ active: true, currentWindow: true })
      const tab = tabs[0]
      const tabId = tab?.id
      const pageUrl = tab?.url ?? ''

      if (!tabId || isRestrictedUrl(pageUrl)) {
        setState({
          phase: 'error',
          message: "This page can't be read (internal browser page or Web Store). Open a job listing and try again.",
          retryable: false,
        })
        return
      }

      let pageText = ''
      try {
        pageText = await readPageText(tabId)
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Could not read this page.'
        setState({ phase: 'error', message: msg, retryable: true })
        return
      }

      if (!pageText || pageText.length < MIN_TEXT_LENGTH) {
        setState({
          phase: 'error',
          message: 'Not enough text on this page to extract a job. Scroll to the full description and try again.',
          retryable: true,
        })
        return
      }

      setState({ phase: 'extracting' })
      setExtractingStage(0)
      // Advance the copy every ~12s so the user sees visible progress
      // through the pipeline even though we don't stream real stages.
      if (stageTimerRef.current) clearInterval(stageTimerRef.current)
      stageTimerRef.current = setInterval(() => {
        setExtractingStage((s) => Math.min(s + 1, EXTRACTING_STAGES.length - 1))
      }, 12_000)

      let result: ExtractionResult
      try {
        result = await extractFromExtensionApi({
          page_text: pageText,
          page_url: pageUrl,
          resume_id: resumeId,
        })
      } finally {
        if (stageTimerRef.current) {
          clearInterval(stageTimerRef.current)
          stageTimerRef.current = null
        }
      }

      setState({ phase: 'done', result })

      const expiresAt = new Date(result.preview_expires_at).getTime()
      setCountdown(Math.max(0, Math.floor((expiresAt - Date.now()) / 1000)))
      timerRef.current = setInterval(() => {
        const remaining = Math.max(0, Math.floor((expiresAt - Date.now()) / 1000))
        setCountdown(remaining)
        if (remaining === 0 && timerRef.current) clearInterval(timerRef.current)
      }, 1000)
    } catch (err: unknown) {
      if (stageTimerRef.current) {
        clearInterval(stageTimerRef.current)
        stageTimerRef.current = null
      }
      type ApiError = {
        code?: string
        response?: {
          status?: number
          data?: { error?: { code?: string; message?: string; data?: ExtMismatchData } }
        }
      }
      const axiosErr = err as ApiError
      const apiErr = axiosErr?.response?.data?.error
      if (apiErr?.code === 'RESUME_MISALIGNED' && apiErr.data) {
        setState({ phase: 'mismatch', data: apiErr.data })
        return
      }
      // Distinguish transport-level timeouts (axios ECONNABORTED) from the
      // server's 504 AI_TIMEOUT so the user gets an accurate message.
      if (axiosErr?.code === 'ECONNABORTED') {
        setState({
          phase: 'error',
          message: 'This took longer than expected. Open the dashboard and try creating the job there.',
          retryable: true,
        })
        return
      }
      if (apiErr?.code === 'AI_TIMEOUT' || axiosErr?.response?.status === 504) {
        setState({
          phase: 'error',
          message: 'The AI is busy right now. Please try again in a moment.',
          retryable: true,
        })
        return
      }
      const msg = apiErr?.message
      setState({ phase: 'error', message: msg ?? 'Extraction failed. This might not be a job page.', retryable: true })
    }
  }

  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current)
      if (stageTimerRef.current) clearInterval(stageTimerRef.current)
    }
  }, [])

  const handleSave = async () => {
    if (state.phase !== 'done') return
    setState({ phase: 'saving' })
    try {
      const saved = await confirmFromExtensionApi(state.result.preview_token)
      setState({ phase: 'saved', jobId: saved.id })
      chrome.tabs.create({ url: `${DASHBOARD_URL}/jobs/${saved.id}` })
    } catch {
      setState({ phase: 'error', message: 'Failed to save job. Try again.', retryable: true })
    }
  }

  const handleRetry = () => {
    const id = activeResumeIdRef.current || selectedResumeId
    if (id) void startExtraction(id)
  }

  const formatTime = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
  const score = state.phase === 'done' ? state.result.match_score : 0
  const scoreColor = score >= 70 ? '#22c55e' : score >= 40 ? '#f59e0b' : '#ef4444'

  return (
    <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 14, minHeight: 320 }}>
      <button className="btn btn-ghost" style={{ alignSelf: 'flex-start', fontSize: 12, padding: '4px 8px' }} onClick={onBack}>
        ← Back
      </button>

      {state.phase === 'pick_resume' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div>
            <p style={{ fontWeight: 700, fontSize: 14, color: 'var(--fg)', marginBottom: 4 }}>Select resume</p>
            <p style={{ fontSize: 11, color: 'var(--muted)', lineHeight: 1.4 }}>
              Choose which resume to match this job against, then extract the listing.
            </p>
          </div>

          {resumesLoading && (
            <p style={{ fontSize: 12, color: 'var(--muted)', textAlign: 'center', padding: 20 }}>Loading resumes…</p>
          )}

          {resumesError && (
            <p style={{ fontSize: 12, color: '#ef4444', textAlign: 'center' }}>Could not load resumes. Check your connection.</p>
          )}

          {!resumesLoading && !resumesError && resumes.length === 0 && (
            <div className="card" style={{ textAlign: 'center', padding: 16 }}>
              <p style={{ fontSize: 12, color: 'var(--muted)' }}>No resumes yet. Upload one in the dashboard first.</p>
            </div>
          )}

          {!resumesLoading && !resumesError && resumes.length > 0 && (
            <>
              <input
                type="search"
                placeholder="Search resumes…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                autoComplete="off"
                className="popup-search"
                style={{
                  width: '100%',
                  padding: '10px 12px',
                  borderRadius: 'var(--radius)',
                  border: '1px solid var(--border)',
                  background: 'var(--muted-bg)',
                  color: 'var(--fg)',
                  fontSize: 12,
                  outline: 'none',
                }}
              />
              <div
                style={{
                  maxHeight: 220,
                  overflowY: 'auto',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 6,
                  paddingRight: 2,
                }}
              >
                {filteredResumes.length === 0 && (
                  <p style={{ fontSize: 12, color: 'var(--muted)', textAlign: 'center', padding: 12 }}>No resumes match your search.</p>
                )}
                {filteredResumes.map((r) => {
                  const ready = r.extraction_status === 'completed'
                  const selected = selectedResumeId === r.id
                  return (
                    <button
                      key={r.id}
                      type="button"
                      disabled={!ready}
                      title={!ready ? 'This resume is still being processed' : undefined}
                      onClick={() => ready && setSelectedResumeId(r.id)}
                      style={{
                        width: '100%',
                        textAlign: 'left',
                        padding: '10px 12px',
                        borderRadius: 'var(--radius)',
                        border: selected ? '1px solid var(--brand)' : '1px solid var(--border)',
                        background: selected ? 'var(--brand-light)' : 'var(--muted-bg)',
                        cursor: ready ? 'pointer' : 'not-allowed',
                        opacity: ready ? 1 : 0.55,
                        display: 'flex',
                        flexDirection: 'column',
                        gap: 2,
                      }}
                    >
                      <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--fg)', wordBreak: 'break-word' }}>{r.name}</span>
                      <span style={{ fontSize: 10, color: 'var(--muted)' }}>
                        {r.file_format.toUpperCase()} · {new Date(r.uploaded_at).toLocaleDateString()}
                        {!ready && ' · Processing…'}
                      </span>
                    </button>
                  )
                })}
              </div>
              <button
                type="button"
                className="btn btn-primary btn-full"
                style={{ fontSize: 13 }}
                disabled={!canExtract}
                onClick={() => selectedResumeId && canExtract && void startExtraction(selectedResumeId)}
              >
                Extract job from this page
              </button>
            </>
          )}
        </div>
      )}

      {(state.phase === 'reading' || state.phase === 'extracting') && (() => {
        const stage = state.phase === 'extracting'
          ? EXTRACTING_STAGES[Math.min(extractingStage, EXTRACTING_STAGES.length - 1)]
          : { title: 'Reading page…', hint: 'Pulling the job description' }
        return (
          <div style={{ textAlign: 'center', paddingTop: 20, display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div style={{ width: 32, height: 32, border: '2px solid #7c3aed', borderTopColor: 'transparent', borderRadius: '50%', animation: 'spin 0.8s linear infinite', margin: '0 auto' }} />
            <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
            <p style={{ fontSize: 13, fontWeight: 600, color: 'var(--fg)' }}>{stage.title}</p>
            <p style={{ fontSize: 11, color: 'var(--muted)' }}>{stage.hint}</p>
          </div>
        )
      })()}

      {state.phase === 'error' && (
        <div style={{ textAlign: 'center', paddingTop: 12 }}>
          <p style={{ fontSize: 13, fontWeight: 600, color: '#ef4444' }}>Extraction failed</p>
          <p style={{ fontSize: 11, color: 'var(--muted)', marginTop: 6 }}>{state.message}</p>
          {state.retryable && (
            <button className="btn btn-ghost btn-full" style={{ marginTop: 12, fontSize: 12 }} onClick={handleRetry}>
              Try again
            </button>
          )}
        </div>
      )}

      {state.phase === 'done' && (
        <>
          <div>
            <p style={{ fontWeight: 700, fontSize: 14, color: 'var(--fg)' }}>
              {state.result.job?.title ?? 'Job'}
            </p>
            <p style={{ fontSize: 12, color: 'var(--muted)', marginTop: 2 }}>
              {state.result.job?.company}{state.result.job?.location ? ` · ${state.result.job.location}` : ''}
            </p>
          </div>

          <div className="card">
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
              <span style={{ fontSize: 12, color: 'var(--muted)' }}>Match Score</span>
              <span style={{ fontSize: 18, fontWeight: 700, color: scoreColor }}>{score}%</span>
            </div>
            <div className="score-bar">
              <div className="score-bar-fill" style={{ width: `${score}%`, background: scoreColor }} />
            </div>
          </div>

          {state.result.gaps.length > 0 && (
            <div>
              <p style={{ fontSize: 11, fontWeight: 600, color: 'var(--muted)', marginBottom: 4 }}>Gaps</p>
              <ul style={{ paddingLeft: 14, margin: 0 }}>
                {state.result.gaps.map((g) => (
                  <li key={g} style={{ fontSize: 11, color: 'var(--fg)', marginTop: 2 }}>{g}</li>
                ))}
              </ul>
            </div>
          )}

          <button
            className="btn btn-primary btn-full"
            onClick={handleSave}
            disabled={countdown === 0}
            style={{ fontSize: 13 }}
          >
            Save to Dashboard →
          </button>
          <p style={{ fontSize: 11, color: 'var(--muted)', textAlign: 'center' }}>
            {countdown > 0 ? `Preview expires in ${formatTime(countdown)}` : 'Preview expired — re-extract to save.'}
          </p>
        </>
      )}

      {state.phase === 'saving' && (
        <p style={{ textAlign: 'center', fontSize: 12, color: 'var(--muted)' }}>Saving…</p>
      )}

      {state.phase === 'saved' && (
        <p style={{ textAlign: 'center', fontSize: 12, color: 'var(--success)', fontWeight: 600 }}>
          Saved! Opening in dashboard…
        </p>
      )}

      {state.phase === 'mismatch' && (
        <MismatchModal data={state.data} onClose={onBack} />
      )}
    </div>
  )
}
