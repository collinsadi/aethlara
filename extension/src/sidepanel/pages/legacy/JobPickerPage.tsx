import { useEffect, useMemo, useRef, useState } from 'react'
import { DASHBOARD_LINKS } from '@/lib/config'
import { relativeTime } from '@/lib/util'
import type { ExtJob } from '@/types'
import { EmptyState, ExternalLink, Notice, Spinner } from '../../components/ui'
import { useJobsList } from '../../hooks/useLegacy'

interface Props {
  onSelect: (job: ExtJob) => void
}

function isEligible(job: ExtJob) {
  return job.alignment_status === 'completed' && job.match_score !== null
}

function isProcessing(job: ExtJob) {
  return job.alignment_status === 'processing' || job.alignment_status === 'pending'
}

const STATUS: Record<string, string> = {
  not_applied: 'Not applied',
  applied: 'Applied',
  interview: 'Interview',
  offer: 'Offer',
  rejected: 'Rejected',
  withdrawn: 'Withdrawn',
}

const scoreColor = (s: number) => (s >= 70 ? 'var(--success)' : s >= 40 ? 'var(--warning)' : 'var(--error)')

/** Pick a saved job (/jobs) whose tailored resume fills the open form. */
export function JobPickerPage({ onSelect }: Props) {
  const [search, setSearch] = useState('')
  const [selected, setSelected] = useState<ExtJob | null>(null)
  const [allJobs, setAllJobs] = useState<ExtJob[]>([])
  const searchRef = useRef<HTMLInputElement>(null)
  const { data, isLoading, isError, loadMore, page } = useJobsList(20)

  useEffect(() => {
    if (!data?.items) return
    if (page === 1) setAllJobs(data.items)
    else
      setAllJobs((prev) => {
        const ids = new Set(prev.map((j) => j.id))
        return [...prev, ...data.items.filter((j) => !ids.has(j.id))]
      })
  }, [data, page])

  useEffect(() => searchRef.current?.focus(), [])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return allJobs
    return allJobs.filter((j) => j.job_title.toLowerCase().includes(q) || j.company.toLowerCase().includes(q))
  }, [allJobs, search])

  return (
    <div className="page">
      <div className="stack">
        <p className="bold">Autofill with a saved job</p>
        <p className="small muted">Pick the job this form is for. Its tailored resume answers the questions.</p>
      </div>
      <input
        ref={searchRef}
        type="text"
        placeholder="Search saved jobs…"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        className="input"
      />

      {isLoading && (
        <div className="row small muted">
          <Spinner /> Loading jobs…
        </div>
      )}
      {isError && <Notice tone="error">Couldn't load jobs. Check your connection.</Notice>}
      {!isLoading && !isError && allJobs.length === 0 && (
        <EmptyState title="No saved jobs yet">
          <ExternalLink href={DASHBOARD_LINKS.jobs} className="small">
            Go to the dashboard
          </ExternalLink>
        </EmptyState>
      )}
      {!isLoading && !isError && filtered.length === 0 && allJobs.length > 0 && (
        <EmptyState title="No jobs match your search">
          <p className="small">Try a different title or company.</p>
        </EmptyState>
      )}

      <div className="list">
        {filtered.map((job) => {
          const eligible = isEligible(job)
          const isSelected = selected?.id === job.id
          const score = job.match_score ?? 0
          return (
            <button
              key={job.id}
              type="button"
              className="item"
              disabled={!eligible}
              onClick={() => eligible && setSelected(job)}
              title={isProcessing(job) ? 'AI processing not complete' : !eligible ? 'Not eligible for autofill' : undefined}
              style={{
                textAlign: 'left',
                color: 'var(--fg)',
                cursor: eligible ? 'pointer' : 'not-allowed',
                opacity: eligible ? 1 : 0.5,
                borderColor: isSelected ? 'var(--brand)' : undefined,
                background: isSelected ? 'var(--brand-light)' : undefined,
              }}
            >
              <div className="row" style={{ alignItems: 'flex-start' }}>
                <div className="grow">
                  <p className="item-title truncate">{job.job_title || 'Untitled'}</p>
                  <p className="small muted truncate">
                    {job.company}
                    {job.location ? ` · ${job.location}` : ''}
                  </p>
                  <p className="tiny faint">{isProcessing(job) ? 'Processing…' : `${STATUS[job.status] ?? job.status} · ${relativeTime(job.created_at)}`}</p>
                </div>
                {job.match_score != null && <span style={{ fontWeight: 700, color: scoreColor(score) }}>{score}%</span>}
              </div>
            </button>
          )
        })}
      </div>

      {data?.pagination.has_next && !isLoading && (
        <button className="btn btn-ghost btn-full" onClick={loadMore}>
          Load more ({allJobs.length} of {data.pagination.total_items})
        </button>
      )}

      {selected && (
        <button className="btn btn-primary btn-full" style={{ position: 'sticky', bottom: 12 }} onClick={() => onSelect(selected)}>
          Autofill with this job
        </button>
      )}
    </div>
  )
}
