import { useState } from 'react'
import { motion } from 'framer-motion'
import { KanbanSquare, List } from 'lucide-react'
import { useTracker } from '@/hooks/useTracker'
import { ApiKanbanBoard } from '@/components/tracker/ApiKanbanBoard'
import { JobDetailDrawer } from '@/components/jobs/JobDetailDrawer'
import { ApiJobCard } from '@/components/jobs/ApiJobCard'
import { cn } from '@/lib/utils'
import type { JobStatus } from '@/lib/types'

const STATUS_LABELS: Record<JobStatus, string> = {
  not_applied: 'Not Applied',
  applied: 'Applied',
  interview: 'Interview',
  offer: 'Offer',
  rejected: 'Rejected',
  withdrawn: 'Withdrawn',
}

const STATUS_DOT: Record<JobStatus, string> = {
  not_applied: 'bg-muted-foreground/40',
  applied: 'bg-brand',
  interview: 'bg-neutral-500 dark:bg-neutral-400',
  offer: 'bg-emerald-500',
  rejected: 'bg-red-500',
  withdrawn: 'bg-neutral-400',
}

const STATUS_PILL: Record<JobStatus, string> = {
  not_applied: 'bg-muted text-muted-foreground',
  applied: 'bg-brand/15 text-brand',
  interview: 'bg-neutral-200 text-neutral-800 dark:bg-neutral-800 dark:text-neutral-200',
  offer: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-400',
  rejected: 'bg-red-500/15 text-red-600 dark:text-red-400',
  withdrawn: 'bg-neutral-100 text-neutral-500 dark:bg-neutral-900 dark:text-neutral-400',
}

const ACTIVE_STATUSES: JobStatus[] = ['not_applied', 'applied', 'interview', 'offer']
const ALL_STATUSES: JobStatus[] = [...ACTIVE_STATUSES, 'rejected', 'withdrawn']

export function Tracker() {
  const { columns, isLoading, isError, moveJob, isPending, ALL_STATUSES: _ } = useTracker()
  const [view, setView] = useState<'kanban' | 'list'>('kanban')
  const [selectedJobId, setSelectedJobId] = useState<string | null>(null)

  const totalByStatus = Object.fromEntries(
    ALL_STATUSES.map((s) => [s, columns[s].length])
  ) as Record<JobStatus, number>

  const totalActive = ACTIVE_STATUSES.reduce((n, s) => n + totalByStatus[s], 0)

  return (
    <div className="space-y-6">
      {/* Header */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="flex flex-col sm:flex-row sm:items-center justify-between gap-4"
      >
        <div>
          <h1 className="text-2xl font-semibold text-foreground tracking-tight font-heading">
            Application Tracker
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            {isLoading
              ? '\u00a0'
              : `${totalActive} active application${totalActive === 1 ? '' : 's'}`}
          </p>
        </div>

        <div className="flex items-center gap-2">
          {(['kanban', 'list'] as const).map((v) => (
            <button
              key={v}
              type="button"
              onClick={() => setView(v)}
              className={cn(
                'flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-medium transition-all border',
                view === v
                  ? 'bg-muted text-foreground border-border'
                  : 'text-muted-foreground hover:text-foreground border-transparent'
              )}
            >
              {v === 'kanban' ? (
                <KanbanSquare className="w-4 h-4" />
              ) : (
                <List className="w-4 h-4" />
              )}
              {v === 'kanban' ? 'Board' : 'List'}
            </button>
          ))}
        </div>
      </motion.div>

      {/* Status summary pills */}
      <div className="flex flex-wrap gap-2">
        {ALL_STATUSES.filter((s) => totalByStatus[s] > 0).map((status) => (
          <motion.span
            key={status}
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            className={cn(
              'px-3 py-1.5 rounded-full text-xs font-medium',
              STATUS_PILL[status]
            )}
          >
            {STATUS_LABELS[status]}: {totalByStatus[status]}
          </motion.span>
        ))}
      </div>

      {/* Content */}
      {isError ? (
        <div className="glass-card p-12 text-center">
          <p className="text-sm text-muted-foreground">
            Failed to load jobs. Please try again.
          </p>
        </div>
      ) : isLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          {ACTIVE_STATUSES.map((s) => (
            <div key={s} className="space-y-2">
              <div className="h-4 bg-muted rounded animate-pulse w-24" />
              <div className="glass-card p-2 min-h-[200px] border-t-2 border-border rounded-t-none space-y-2">
                {[1, 2].map((i) => (
                  <div key={i} className="bg-muted/40 rounded-xl p-3 space-y-2 animate-pulse">
                    <div className="h-3 bg-muted rounded w-3/4" />
                    <div className="h-3 bg-muted rounded w-1/2" />
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      ) : view === 'kanban' ? (
        <ApiKanbanBoard
          columns={columns}
          onMove={(jobId, fromStatus, toStatus) => moveJob(jobId, fromStatus, toStatus)}
          onCardClick={(id) => setSelectedJobId(id)}
          isPending={isPending}
        />
      ) : (
        <div className="space-y-8">
          {ALL_STATUSES.filter((s) => columns[s].length > 0).map((status) => (
            <div key={status}>
              <h3 className="text-sm font-semibold text-muted-foreground mb-3 flex items-center gap-2 font-heading">
                <span className={cn('w-2 h-2 rounded-full', STATUS_DOT[status])} />
                {STATUS_LABELS[status]} ({columns[status].length})
              </h3>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {columns[status].map((job, i) => (
                  <ApiJobCard
                    key={job.id}
                    job={job}
                    index={i}
                    onClick={(id) => setSelectedJobId(id)}
                  />
                ))}
              </div>
            </div>
          ))}

          {ALL_STATUSES.every((s) => columns[s].length === 0) && (
            <div className="glass-card p-16 text-center">
              <p className="text-sm text-muted-foreground">
                No jobs yet. Add jobs from the Jobs page.
              </p>
            </div>
          )}
        </div>
      )}

      <JobDetailDrawer
        jobId={selectedJobId}
        onClose={() => setSelectedJobId(null)}
      />
    </div>
  )
}
