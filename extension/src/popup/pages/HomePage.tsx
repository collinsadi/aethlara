import { useEffect, useState } from 'react'
import { useJobsSearch } from '../hooks/useJobs'
import { useSession } from '../hooks/useExtensionAuth'
import type { ExtJob } from '@/types'

const MIN_SEARCH_CHARS = 2
const DEBOUNCE_MS = 300

interface Props {
  onSelectJob: (job: ExtJob) => void
  onExtract: () => void
  onAutofill: () => void
  onSignOut: () => void
}

export function HomePage({ onSelectJob, onExtract, onAutofill, onSignOut }: Props) {
  const { session, signOut } = useSession()
  const [search, setSearch] = useState('')
  const [debounced, setDebounced] = useState('')
  const [pageUrl, setPageUrl] = useState<string>('')

  useEffect(() => {
    const t = setTimeout(() => setDebounced(search.trim()), DEBOUNCE_MS)
    return () => clearTimeout(t)
  }, [search])

  useEffect(() => {
    void chrome.tabs.query({ active: true, currentWindow: true }).then((tabs) => {
      setPageUrl(tabs[0]?.url ?? '')
    })
  }, [])

  const { data, isLoading, isFetching, isError } = useJobsSearch(debounced, MIN_SEARCH_CHARS)

  const jobs = (data?.items ?? []).filter((j) => j.alignment_status === 'completed')

  const dashboardUrl = import.meta.env.VITE_DASHBOARD_URL ?? ''
  const canExtract =
    pageUrl.startsWith('http') &&
    !pageUrl.startsWith('chrome://') &&
    !pageUrl.startsWith('chrome-extension://') &&
    (!dashboardUrl || !pageUrl.includes(dashboardUrl))

  const handleSignOut = async () => {
    await signOut()
    onSignOut()
  }

  const handleExtract = () => {
    if (!canExtract) return
    onExtract()
  }

  const score = (j: ExtJob) => j.match_score ?? 0
  const scoreColor = (s: number) => (s >= 70 ? '#22c55e' : s >= 40 ? '#f59e0b' : '#ef4444')

  const hasQuery = debounced.length >= MIN_SEARCH_CHARS
  const loading = hasQuery && (isLoading || isFetching)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', maxHeight: 600 }}>
      {/* Header */}
      <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ flex: 1, fontSize: 13, fontWeight: 600, color: 'var(--fg)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {session?.user.full_name ?? 'Aethlara'}
        </span>
        <button className="btn btn-ghost" style={{ fontSize: 11, padding: '4px 8px' }} onClick={handleSignOut}>
          Sign out
        </button>
      </div>

      {/* Actions */}
      <div style={{ padding: '10px 16px', display: 'flex', flexDirection: 'column', gap: 6, borderBottom: '1px solid var(--border)' }}>
        <button
          className="btn btn-primary"
          style={{ width: '100%', fontSize: 12, opacity: canExtract ? 1 : 0.55, cursor: canExtract ? 'pointer' : 'not-allowed' }}
          onClick={handleExtract}
          disabled={!canExtract}
          title={canExtract ? 'Extract this job page' : "Open a job listing page first"}
        >
          ⚡ Extract Job from This Page
        </button>
        <button
          className="btn btn-ghost"
          style={{ width: '100%', fontSize: 12, opacity: canExtract ? 1 : 0.55, cursor: canExtract ? 'pointer' : 'not-allowed' }}
          onClick={() => canExtract && onAutofill()}
          disabled={!canExtract}
          title={canExtract ? 'Select a saved job to autofill this page' : "Open a job application page first"}
        >
          <span style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 8, width: '100%' }}>
            <span>✏ Autofill This Page</span>
            <span className="badge badge-beta">Beta</span>
          </span>
        </button>
        {!canExtract && (
          <p style={{ fontSize: 10, color: 'var(--muted)', margin: 0, textAlign: 'center' }}>
            Open a job listing page to extract or autofill.
          </p>
        )}
      </div>

      {/* Search */}
      <div style={{ padding: '8px 16px' }}>
        <input
          type="text"
          placeholder="Search your saved jobs…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          autoFocus
          style={{
            width: '100%', padding: '6px 10px', borderRadius: 8,
            border: '1px solid var(--border)', background: 'var(--muted-bg)',
            color: 'var(--fg)', fontSize: 12, outline: 'none',
          }}
        />
      </div>

      {/* Job list */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '0 16px 16px' }}>
        {!hasQuery && (
          <p style={{ color: 'var(--muted)', fontSize: 12, textAlign: 'center', paddingTop: 20, lineHeight: 1.5 }}>
            Type to search your saved jobs.
            <br />
            <span style={{ fontSize: 11, opacity: 0.75 }}>Or extract the current page above.</span>
          </p>
        )}

        {hasQuery && loading && (
          <p style={{ color: 'var(--muted)', fontSize: 12, textAlign: 'center', paddingTop: 20 }}>
            Searching…
          </p>
        )}

        {hasQuery && !loading && isError && (
          <p style={{ color: '#ef4444', fontSize: 12, textAlign: 'center', paddingTop: 20 }}>
            Couldn't load jobs. Check your connection and try again.
          </p>
        )}

        {hasQuery && !loading && !isError && jobs.length === 0 && (
          <p style={{ color: 'var(--muted)', fontSize: 12, textAlign: 'center', paddingTop: 20 }}>
            No matching jobs.
          </p>
        )}

        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 4 }}>
          {hasQuery && !loading && jobs.map((job) => (
            <div key={job.id} className="card" style={{ cursor: 'pointer' }} onClick={() => onSelectJob(job)}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <p style={{ fontWeight: 600, fontSize: 13, color: 'var(--fg)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {job.job_title || 'Untitled'}
                  </p>
                  <p style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {job.company}{job.location ? ` · ${job.location}` : ''}
                  </p>
                </div>
                {job.match_score != null && (
                  <span style={{ fontSize: 12, fontWeight: 700, color: scoreColor(score(job)), flexShrink: 0 }}>
                    {score(job)}%
                  </span>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
