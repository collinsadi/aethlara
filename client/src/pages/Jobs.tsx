import { useState, useEffect, useCallback } from 'react'
import { useSearchParams } from 'react-router-dom'
import { motion } from 'framer-motion'
import { Plus, Search, Briefcase, ChevronLeft, ChevronRight } from 'lucide-react'
import { useJobs } from '@/hooks/useJobs'
import { ApiJobCard } from '@/components/jobs/ApiJobCard'
import { CreateJobModal } from '@/components/jobs/CreateJobModal'
import { JobDetailDrawer } from '@/components/jobs/JobDetailDrawer'
import { ChatDrawer } from '@/components/chat'
import { ApiKeyStatusBanner } from '@/components/settings/ApiKeyStatusBanner'
import type { JobStatus } from '@/lib/types'
import { cn } from '@/lib/utils'

const STATUS_OPTIONS: { value: JobStatus | ''; label: string }[] = [
  { value: '', label: 'All' },
  { value: 'not_applied', label: 'Not Applied' },
  { value: 'applied', label: 'Applied' },
  { value: 'interview', label: 'Interview' },
  { value: 'offer', label: 'Offer' },
  { value: 'rejected', label: 'Rejected' },
  { value: 'withdrawn', label: 'Withdrawn' },
]

const PAGE_SIZE = 12

export function Jobs() {
  const [searchParams, setSearchParams] = useSearchParams()
  const [createOpen, setCreateOpen] = useState(false)
  const [selectedJobId, setSelectedJobId] = useState<string | null>(null)
  const [chatJobId, setChatJobId] = useState<string | null>(null)
  const [searchInput, setSearchInput] = useState(searchParams.get('search') ?? '')

  const page = Number(searchParams.get('page') ?? '1')
  const sort = (searchParams.get('sort') as 'recent' | 'best_match') || 'recent'
  const status = searchParams.get('status') ?? ''
  const search = searchParams.get('search') ?? ''
  const createRequested = searchParams.get('create') === 'true'

  useEffect(() => {
    if (!createRequested) return
    setCreateOpen(true)
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev)
      next.delete('create')
      return next
    }, { replace: true })
  }, [createRequested, setSearchParams])

  const { data, isLoading, isError } = useJobs({
    page,
    page_size: PAGE_SIZE,
    sort,
    ...(status ? { status } : {}),
    ...(search ? { search } : {}),
  })

  // Debounce search input → URL
  useEffect(() => {
    const id = setTimeout(() => {
      setSearchParams((prev) => {
        const next = new URLSearchParams(prev)
        if (searchInput) {
          next.set('search', searchInput)
        } else {
          next.delete('search')
        }
        next.set('page', '1')
        return next
      })
    }, 400)
    return () => clearTimeout(id)
  }, [searchInput, setSearchParams])

  const setSort = useCallback(
    (v: 'recent' | 'best_match') => {
      setSearchParams((prev) => {
        const next = new URLSearchParams(prev)
        next.set('sort', v)
        next.set('page', '1')
        return next
      })
    },
    [setSearchParams]
  )

  const setStatus = useCallback(
    (v: string) => {
      setSearchParams((prev) => {
        const next = new URLSearchParams(prev)
        if (v) next.set('status', v) ; else next.delete('status')
        next.set('page', '1')
        return next
      })
    },
    [setSearchParams]
  )

  const setPage = useCallback(
    (p: number) => {
      setSearchParams((prev) => {
        const next = new URLSearchParams(prev)
        next.set('page', String(p))
        return next
      })
    },
    [setSearchParams]
  )

  const jobs = data?.items ?? []
  const pagination = data?.pagination
  const totalLabel = isLoading ? null : (pagination?.total_items ?? 0)

  return (
    <div className="space-y-6">
      <ApiKeyStatusBanner variant="page" />

      {/* Header */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="flex flex-col sm:flex-row sm:items-center justify-between gap-4"
      >
        <div>
          <h1 className="text-2xl font-semibold text-foreground tracking-tight font-heading">
            Jobs
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            {totalLabel === null
              ? '\u00a0'
              : `${totalLabel} saved ${totalLabel === 1 ? 'position' : 'positions'}`}
          </p>
        </div>
        <motion.button
          type="button"
          whileHover={{ scale: 1.02 }}
          whileTap={{ scale: 0.98 }}
          onClick={() => setCreateOpen(true)}
          className="btn-tf animate-btn-shine inline-flex items-center gap-2 text-sm font-semibold px-5 py-2.5 min-h-0 self-start sm:self-auto"
        >
          <Plus className="w-4 h-4" />
          New Job
        </motion.button>
      </motion.div>

      {/* Search + Sort */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <input
            type="text"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder="Search by title or company…"
            className="field-input h-10 w-full pl-9 pr-4 text-sm"
          />
        </div>
        <div className="flex gap-2 shrink-0">
          {(['recent', 'best_match'] as const).map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => setSort(s)}
              className={cn(
                'px-4 py-2 rounded-xl text-sm font-medium transition-all border',
                sort === s
                  ? 'bg-muted text-foreground border-border'
                  : 'text-muted-foreground hover:text-foreground border-transparent'
              )}
            >
              {s === 'recent' ? 'Recent' : 'Best Match'}
            </button>
          ))}
        </div>
      </div>

      {/* Status filter pills */}
      <div className="flex flex-wrap gap-2">
        {STATUS_OPTIONS.map((opt) => (
          <button
            key={opt.value || 'all'}
            type="button"
            onClick={() => setStatus(opt.value)}
            className={cn(
              'px-3 py-1.5 rounded-full text-xs font-medium transition-all border',
              status === opt.value
                ? 'bg-brand text-white border-brand'
                : 'bg-muted/40 text-muted-foreground hover:text-foreground border-border'
            )}
          >
            {opt.label}
          </button>
        ))}
      </div>

      {/* Job Grid */}
      {isError ? (
        <div className="glass-card p-12 text-center">
          <p className="text-sm text-muted-foreground">
            Failed to load jobs. Please try again.
          </p>
        </div>
      ) : isLoading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {Array.from({ length: 6 }).map((_, i) => (
            <div
              key={i}
              className="glass-card p-5 space-y-3 animate-pulse"
              style={{ animationDelay: `${i * 60}ms` }}
            >
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-xl bg-muted" />
                <div className="space-y-1.5 flex-1">
                  <div className="h-3.5 rounded bg-muted w-3/4" />
                  <div className="h-3 rounded bg-muted w-1/2" />
                </div>
              </div>
              <div className="h-3 rounded bg-muted w-1/3" />
              <div className="h-px bg-border" />
              <div className="h-3 rounded bg-muted w-1/4" />
            </div>
          ))}
        </div>
      ) : jobs.length > 0 ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {jobs.map((job, i) => (
            <ApiJobCard
              key={job.id}
              job={job}
              index={i}
              onClick={(id) => setSelectedJobId(id)}
              onChat={(id) => setChatJobId(id)}
            />
          ))}
        </div>
      ) : (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="glass-card p-16 text-center"
        >
          <Briefcase className="w-12 h-12 text-muted-foreground/30 mx-auto mb-4" />
          <h3 className="text-base font-semibold text-foreground mb-2 font-heading">
            {search || status ? 'No matching jobs' : 'No jobs yet'}
          </h3>
          <p className="text-sm text-muted-foreground mb-6">
            {search || status
              ? 'Try clearing your filters'
              : 'Paste a job posting URL or description to get started'}
          </p>
          {!search && !status && (
            <motion.button
              type="button"
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
              onClick={() => setCreateOpen(true)}
              className="btn-tf animate-btn-shine inline-flex items-center gap-2 text-sm font-semibold px-5 py-2.5 min-h-0"
            >
              <Plus className="w-4 h-4" />
              Add Job
            </motion.button>
          )}
        </motion.div>
      )}

      {/* Pagination */}
      {pagination && pagination.total_pages > 1 && (
        <div className="flex items-center justify-center gap-3">
          <button
            type="button"
            onClick={() => setPage(page - 1)}
            disabled={!pagination.has_prev}
            className="p-2 rounded-lg border border-border text-muted-foreground hover:text-foreground disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
            aria-label="Previous page"
          >
            <ChevronLeft className="w-4 h-4" />
          </button>
          <span className="text-sm text-muted-foreground tabular-nums">
            Page {pagination.page} of {pagination.total_pages}
          </span>
          <button
            type="button"
            onClick={() => setPage(page + 1)}
            disabled={!pagination.has_next}
            className="p-2 rounded-lg border border-border text-muted-foreground hover:text-foreground disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
            aria-label="Next page"
          >
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Modals */}
      <CreateJobModal open={createOpen} onClose={() => setCreateOpen(false)} />
      <JobDetailDrawer
        jobId={selectedJobId}
        onClose={() => setSelectedJobId(null)}
        onOpenChat={(id) => setChatJobId(id)}
      />
      <ChatDrawer
        jobId={chatJobId}
        onClose={() => setChatJobId(null)}
        onOpenJob={(id) => {
          setChatJobId(null)
          setSelectedJobId(id)
        }}
      />
    </div>
  )
}
