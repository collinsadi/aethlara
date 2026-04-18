import { useEffect, useMemo, useRef, useState } from 'react'
import { useJobsList } from '@/popup/hooks/useJobs'
import type { ExtJob } from '@/types'

const DASHBOARD_URL = import.meta.env.VITE_DASHBOARD_URL ?? 'https://app.aethlara.com'

interface Props {
  onSelect: (job: ExtJob) => void
  onCancel: () => void
}

function isEligible(job: ExtJob) {
  return job.alignment_status === 'completed' && job.match_score !== null
}

function isProcessing(job: ExtJob) {
  return job.alignment_status === 'processing' || job.alignment_status === 'pending'
}

function relativeDate(iso: string) {
  const diff = Date.now() - new Date(iso).getTime()
  const days = Math.floor(diff / 86400000)
  if (days === 0) return 'today'
  if (days === 1) return '1 day ago'
  if (days < 7) return `${days} days ago`
  const weeks = Math.floor(days / 7)
  return weeks === 1 ? '1 week ago' : `${weeks} weeks ago`
}

function statusLabel(job: ExtJob) {
  const map: Record<string, string> = {
    not_applied: 'Not Applied',
    applied: 'Applied',
    interview: 'Interview',
    offer: 'Offer',
    rejected: 'Rejected',
    withdrawn: 'Withdrawn',
  }
  return map[job.status] ?? job.status
}

export function JobSearchModal({ onSelect, onCancel }: Props) {
  const [search, setSearch] = useState('')
  const [selected, setSelected] = useState<ExtJob | null>(null)
  const [allJobs, setAllJobs] = useState<ExtJob[]>([])
  const searchRef = useRef<HTMLInputElement>(null)

  const { data, isLoading, isError, loadMore, page } = useJobsList(20)

  // Accumulate pages as the user loads more
  useEffect(() => {
    if (data?.items) {
      if (page === 1) {
        setAllJobs(data.items)
      } else {
        setAllJobs((prev) => {
          const ids = new Set(prev.map((j) => j.id))
          return [...prev, ...data.items.filter((j) => !ids.has(j.id))]
        })
      }
    }
  }, [data, page])

  useEffect(() => { searchRef.current?.focus() }, [])

  // Client-side search over accumulated jobs
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return allJobs
    return allJobs.filter(
      (j) =>
        j.job_title.toLowerCase().includes(q) ||
        j.company.toLowerCase().includes(q),
    )
  }, [allJobs, search])

  const scoreColor = (s: number) =>
    s >= 70 ? 'var(--success)' : s >= 40 ? 'var(--warning)' : 'var(--error)'

  const handleConfirm = () => {
    if (selected) onSelect(selected)
  }

  const hasNext = data?.pagination.has_next ?? false

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', maxHeight: 600 }}>
      {/* Header */}
      <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 8 }}>
        <button className="btn btn-ghost" style={{ fontSize: 11, padding: '4px 8px' }} onClick={onCancel}>
          ← Cancel
        </button>
        <span style={{ flex: 1, fontSize: 13, fontWeight: 600, color: 'var(--fg)' }}>
          Select a Job to Autofill
        </span>
      </div>

      {/* Search */}
      <div style={{ padding: '8px 16px' }}>
        <input
          ref={searchRef}
          type="text"
          placeholder="Search jobs…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="popup-search"
          style={{
            width: '100%', padding: '7px 10px', borderRadius: 'var(--radius)',
            border: '1px solid var(--border)', background: 'var(--muted-bg)',
            color: 'var(--fg)', fontSize: 12, outline: 'none',
          }}
        />
      </div>

      {/* List */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '0 16px' }}>
        {isLoading && (
          <p style={{ color: 'var(--muted)', fontSize: 12, textAlign: 'center', paddingTop: 20 }}>Loading jobs…</p>
        )}
        {isError && (
          <p style={{ color: 'var(--error)', fontSize: 12, textAlign: 'center', paddingTop: 20 }}>
            Couldn&apos;t load jobs. Check your connection.
          </p>
        )}
        {!isLoading && !isError && allJobs.length === 0 && (
          <div style={{ textAlign: 'center', paddingTop: 20 }}>
            <p style={{ color: 'var(--muted)', fontSize: 12 }}>No saved jobs yet.</p>
            <a
              href={`${DASHBOARD_URL}/jobs`}
              onClick={(e) => { e.preventDefault(); chrome.tabs.create({ url: `${DASHBOARD_URL}/jobs` }) }}
              style={{ fontSize: 11, color: 'var(--brand)' }}
            >
              Go to Dashboard →
            </a>
          </div>
        )}
        {!isLoading && !isError && filtered.length === 0 && allJobs.length > 0 && (
          <div style={{ textAlign: 'center', paddingTop: 20 }}>
            <p style={{ color: 'var(--muted)', fontSize: 12 }}>No jobs match your search.</p>
            <p style={{ color: 'var(--muted)', fontSize: 11, marginTop: 2 }}>Try a different name or company.</p>
          </div>
        )}

        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, paddingBottom: 12, marginTop: 4 }}>
          {filtered.map((job) => {
            const eligible = isEligible(job)
            const processing = isProcessing(job)
            const isSelected = selected?.id === job.id
            const score = job.match_score ?? 0

            return (
              <div
                key={job.id}
                onClick={() => eligible && setSelected(job)}
                title={processing ? 'AI processing not complete' : !eligible ? 'Not eligible for autofill' : undefined}
                style={{
                  padding: '10px 12px',
                  borderRadius: 'var(--radius)',
                  border: isSelected ? '1px solid var(--brand)' : '1px solid var(--border)',
                  background: isSelected ? 'var(--brand-light)' : 'var(--bg-surface)',
                  cursor: eligible ? 'pointer' : 'not-allowed',
                  opacity: eligible ? 1 : 0.5,
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 6 }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <p style={{ fontWeight: 600, fontSize: 13, color: 'var(--fg)', margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {job.job_title || 'Untitled'}
                      {isSelected && <span style={{ marginLeft: 6, fontSize: 10, color: 'var(--brand)' }}>✓ selected</span>}
                    </p>
                    <p style={{ fontSize: 11, color: 'var(--muted)', margin: '2px 0 0', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {job.company}{job.location ? ` · ${job.location}` : ''}
                    </p>
                    <p style={{ fontSize: 10, color: 'var(--muted)', margin: '3px 0 0' }}>
                      {processing ? 'Processing…' : `${statusLabel(job)} · ${relativeDate(job.created_at)}`}
                    </p>
                  </div>
                  {job.match_score != null && (
                    <span style={{ fontSize: 12, fontWeight: 700, color: scoreColor(score), flexShrink: 0 }}>
                      {score}%
                    </span>
                  )}
                </div>
              </div>
            )
          })}
        </div>

        {hasNext && !isLoading && (
          <div style={{ textAlign: 'center', paddingBottom: 12 }}>
            <p style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 6 }}>
              Showing {allJobs.length} of {data?.pagination.total_items ?? allJobs.length} jobs
            </p>
            <button className="btn btn-ghost" style={{ fontSize: 11 }} onClick={loadMore}>
              Load more
            </button>
          </div>
        )}
      </div>

      {/* Confirm bar — only visible when a job is selected */}
      {selected && (
        <div style={{ padding: '10px 16px', borderTop: '1px solid var(--border)' }}>
          <button className="btn btn-primary btn-full" style={{ fontSize: 12 }} onClick={handleConfirm}>
            Autofill with this job →
          </button>
        </div>
      )}
    </div>
  )
}
