import { motion } from 'framer-motion'
import { Building2, MapPin, Globe, Clock, Zap, MessageSquare } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { ApiJob, JobStatus } from '@/lib/types'

interface Props {
  job: ApiJob
  index?: number
  onClick: (id: string) => void
  onChat?: (id: string) => void
}

const STATUS_LABELS: Record<JobStatus, string> = {
  not_applied: 'Not Applied',
  applied: 'Applied',
  interview: 'Interview',
  offer: 'Offer',
  rejected: 'Rejected',
  withdrawn: 'Withdrawn',
}

const STATUS_COLORS: Record<JobStatus, string> = {
  not_applied: 'bg-muted text-muted-foreground',
  applied: 'bg-brand/15 text-brand',
  interview: 'bg-neutral-200 text-neutral-800 dark:bg-neutral-800 dark:text-neutral-200',
  offer: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-400',
  rejected: 'bg-red-500/15 text-red-600 dark:text-red-400',
  withdrawn: 'bg-neutral-100 text-neutral-500 dark:bg-neutral-900 dark:text-neutral-400',
}

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime()
  const days = Math.floor(diff / 86400000)
  if (days === 0) return 'Today'
  if (days === 1) return 'Yesterday'
  if (days < 7) return `${days}d ago`
  if (days < 30) return `${Math.floor(days / 7)}w ago`
  return `${Math.floor(days / 30)}mo ago`
}

function MatchPill({ score }: { score: number | null }) {
  if (score === null) return null
  const color =
    score >= 70 ? 'text-emerald-600 dark:text-emerald-400 bg-emerald-500/10'
    : score >= 40 ? 'text-amber-600 dark:text-amber-400 bg-amber-500/10'
    : 'text-red-600 dark:text-red-400 bg-red-500/10'
  return (
    <span className={cn('px-2 py-0.5 rounded-full text-[11px] font-semibold tabular-nums', color)}>
      {score}%
    </span>
  )
}

export function ApiJobCard({ job, index = 0, onClick, onChat }: Props) {
  const isPending =
    job.extraction_status === 'pending' || job.extraction_status === 'processing' ||
    job.alignment_status === 'processing'

  const canChat = onChat && job.alignment_status === 'completed'

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, delay: index * 0.06, ease: [0.22, 1, 0.36, 1] }}
    >
      <motion.button
        type="button"
        whileHover={{ y: -3, scale: 1.01 }}
        transition={{ duration: 0.2 }}
        onClick={() => onClick(job.id)}
        className="glass-card p-5 glass-hover group cursor-pointer w-full text-left"
      >
        <div className="flex items-start justify-between mb-3">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-9 h-9 shrink-0 rounded-xl bg-muted border border-border flex items-center justify-center">
              <Building2 className="w-4 h-4 text-muted-foreground" />
            </div>
            <div className="min-w-0">
              <h3 className="text-sm font-semibold text-foreground group-hover:text-brand transition-colors font-heading truncate">
                {job.job_title}
              </h3>
              <p className="text-xs text-muted-foreground truncate">{job.company}</p>
            </div>
          </div>
          {isPending ? (
            <span className="flex items-center gap-1 text-[10px] text-muted-foreground animate-pulse shrink-0 ml-2">
              <Zap className="w-3 h-3" />
              Analysing…
            </span>
          ) : (
            <div className="shrink-0 ml-2">
              <MatchPill score={job.match_score} />
            </div>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
          {job.location && (
            <span className="flex items-center gap-1">
              <MapPin className="w-3 h-3" />
              {job.location}
            </span>
          )}
          {job.is_remote && (
            <span className="flex items-center gap-1 text-emerald-600 dark:text-emerald-400">
              <Globe className="w-3 h-3" />
              Remote
            </span>
          )}
          <span className="flex items-center gap-1">
            <Clock className="w-3 h-3" />
            {timeAgo(job.created_at)}
          </span>
        </div>

        <div className="mt-3 pt-3 border-t border-border flex items-center justify-between gap-2">
          <span className={cn(
            'px-2.5 py-1 rounded-full text-[10px] font-medium uppercase tracking-wider',
            STATUS_COLORS[job.status]
          )}>
            {STATUS_LABELS[job.status]}
          </span>
          <div className="flex items-center gap-2">
            {canChat && (
              <span
                role="button"
                tabIndex={0}
                onClick={(e) => {
                  e.stopPropagation()
                  onChat!(job.id)
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault()
                    e.stopPropagation()
                    onChat!(job.id)
                  }
                }}
                className="inline-flex items-center gap-1 text-[10px] font-medium text-brand bg-brand/10 hover:bg-brand/20 border border-brand/30 rounded-full px-2 py-0.5 transition-colors cursor-pointer"
                aria-label="Open chat for this job"
              >
                <MessageSquare className="w-3 h-3" />
                Chat
              </span>
            )}
            <span className="text-[10px] text-muted-foreground group-hover:text-brand transition-colors">
              View details →
            </span>
          </div>
        </div>
      </motion.button>
    </motion.div>
  )
}
