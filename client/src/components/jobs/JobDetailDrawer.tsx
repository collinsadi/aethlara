import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  X, MapPin, Globe, Briefcase, TrendingUp, FileText,
  ExternalLink, ChevronDown, AlertTriangle, MessageSquare,
} from 'lucide-react'
import { useJobDetail, useJobPreviewUrl, useUpdateJobStatus, useDeleteJob } from '@/hooks/useJobs'
import { ALLOWED_TRANSITIONS } from '@/lib/types'
import type { JobStatus } from '@/lib/types'
import { cn } from '@/lib/utils'

interface Props {
  jobId: string | null
  onClose: () => void
  onOpenChat?: (jobId: string) => void
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

export function JobDetailDrawer({ jobId, onClose, onOpenChat }: Props) {
  const { data: job, isLoading } = useJobDetail(jobId)
  const updateStatus = useUpdateJobStatus()
  const deleteJob = useDeleteJob()
  const [fetchPDF, setFetchPDF] = useState(false)
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  const [statusOpen, setStatusOpen] = useState(false)

  const { data: pdfUrl, isLoading: pdfLoading } = useJobPreviewUrl(
    job?.alignment_status === 'completed' ? jobId : null,
    fetchPDF
  )

  const handleStatusChange = (status: JobStatus) => {
    if (!job) return
    setStatusOpen(false)
    updateStatus.mutate({ id: job.id, status })
  }

  const handleDelete = async () => {
    if (!job) return
    await deleteJob.mutateAsync(job.id)
    onClose()
  }

  return (
    <AnimatePresence>
      {jobId && (
        <>
          <div
            className="fixed inset-0 z-40 bg-black/40 backdrop-blur-sm"
            onClick={onClose}
          />
          <motion.aside
            key="drawer"
            initial={{ x: '100%' }}
            animate={{ x: 0 }}
            exit={{ x: '100%' }}
            transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
            className="fixed right-0 top-0 bottom-0 z-50 w-full max-w-md glass-strong border-l border-border overflow-y-auto"
          >
            {/* Header */}
            <div className="sticky top-0 z-10 bg-[var(--tf-surface-dark)]/90 dark:bg-[var(--tf-surface-dark)]/90 backdrop-blur-md flex items-center justify-between px-5 py-4 border-b border-border">
              <h2 className="text-base font-semibold text-foreground font-heading truncate pr-4">
                Job Details
              </h2>
              <button
                type="button"
                onClick={onClose}
                className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground transition-colors"
                aria-label="Close drawer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {isLoading && (
              <div className="p-6 space-y-4">
                {[80, 60, 100, 70].map((w) => (
                  <div key={w} className={`h-4 rounded bg-muted animate-pulse`} style={{ width: `${w}%` }} />
                ))}
              </div>
            )}

            {job && (
              <div className="p-5 space-y-6">
                {/* Title + company */}
                <div>
                  <h3 className="text-lg font-semibold text-foreground font-heading">
                    {job.job_title}
                  </h3>
                  <p className="text-sm text-muted-foreground mt-0.5">{job.company}</p>

                  <div className="flex flex-wrap gap-2 mt-3">
                    {job.location && (
                      <span className="flex items-center gap-1 text-xs text-muted-foreground">
                        <MapPin className="w-3 h-3" />
                        {job.location}
                      </span>
                    )}
                    {job.is_remote && (
                      <span className="flex items-center gap-1 text-xs text-emerald-600 dark:text-emerald-400">
                        <Globe className="w-3 h-3" />
                        Remote
                      </span>
                    )}
                    {job.employment_type && (
                      <span className="flex items-center gap-1 text-xs text-muted-foreground">
                        <Briefcase className="w-3 h-3" />
                        {job.employment_type.replace('_', ' ')}
                      </span>
                    )}
                    {job.experience_level && (
                      <span className="flex items-center gap-1 text-xs text-muted-foreground">
                        <TrendingUp className="w-3 h-3" />
                        {job.experience_level}
                      </span>
                    )}
                  </div>

                  {job.job_url && (
                    <a
                      href={job.job_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 text-xs text-brand hover:opacity-80 mt-2 transition-opacity"
                    >
                      <ExternalLink className="w-3 h-3" />
                      View original posting
                    </a>
                  )}

                  {job.alignment_status === 'completed' && onOpenChat && (
                    <button
                      type="button"
                      onClick={() => onOpenChat(job.id)}
                      className="mt-4 inline-flex items-center gap-2 text-sm font-medium text-brand bg-brand/10 hover:bg-brand/20 border border-brand/30 rounded-xl px-3 py-2 transition-colors"
                    >
                      <MessageSquare className="w-4 h-4" />
                      Chat about this job
                    </button>
                  )}
                </div>

                {/* Match Analysis */}
                {job.match_score !== null && (
                  <Section title="Match Analysis">
                    <div className="text-center mb-4">
                      <span className={cn(
                        'text-4xl font-bold font-heading',
                        job.match_score >= 70 ? 'text-emerald-500' :
                        job.match_score >= 40 ? 'text-amber-500' : 'text-red-500'
                      )}>
                        {job.match_score}%
                      </span>
                      <p className="text-xs text-muted-foreground mt-0.5">Overall match</p>
                    </div>

                    {job.match_breakdown && (
                      <div className="space-y-2.5">
                        {[
                          ['Skills', job.match_breakdown.skills_match],
                          ['Experience', job.match_breakdown.experience_match],
                          ['Education', job.match_breakdown.education_match],
                        ].map(([label, val]) => (
                          <div key={String(label)}>
                            <div className="flex justify-between text-xs mb-1">
                              <span className="text-muted-foreground">{label}</span>
                              <span className="text-foreground font-medium">{val}%</span>
                            </div>
                            <div className="h-1.5 bg-muted rounded-full overflow-hidden">
                              <motion.div
                                initial={{ width: 0 }}
                                animate={{ width: `${val}%` }}
                                transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
                                className={cn(
                                  'h-full rounded-full',
                                  (val as number) >= 70 ? 'bg-emerald-500' :
                                  (val as number) >= 40 ? 'bg-amber-500' : 'bg-red-500'
                                )}
                              />
                            </div>
                          </div>
                        ))}
                        {job.match_breakdown.overall_notes && (
                          <p className="text-xs text-muted-foreground mt-2 italic">
                            {job.match_breakdown.overall_notes}
                          </p>
                        )}
                      </div>
                    )}
                  </Section>
                )}

                {/* Gaps */}
                {job.gaps && job.gaps.length > 0 && (
                  <Section title="Gaps Identified">
                    <ul className="space-y-1.5">
                      {job.gaps.map((g, i) => (
                        <li key={i} className="flex items-start gap-2 text-xs text-muted-foreground">
                          <AlertTriangle className="w-3 h-3 text-amber-500 shrink-0 mt-0.5" />
                          {g}
                        </li>
                      ))}
                    </ul>
                  </Section>
                )}

                {/* Status */}
                <Section title="Application Status">
                  <div className="relative">
                    <button
                      type="button"
                      onClick={() => setStatusOpen((o) => !o)}
                      className="flex items-center justify-between w-full p-3 rounded-xl border border-border hover:bg-muted/30 transition-colors"
                    >
                      <span className={cn('px-2.5 py-1 rounded-full text-[11px] font-medium uppercase tracking-wider', STATUS_COLORS[job.status])}>
                        {STATUS_LABELS[job.status]}
                      </span>
                      <ChevronDown className={cn('w-4 h-4 text-muted-foreground transition-transform', statusOpen && 'rotate-180')} />
                    </button>

                    <AnimatePresence>
                      {statusOpen && (
                        <motion.div
                          initial={{ opacity: 0, y: -4 }}
                          animate={{ opacity: 1, y: 0 }}
                          exit={{ opacity: 0, y: -4 }}
                          className="absolute top-full left-0 right-0 mt-1 glass-card border border-border rounded-xl overflow-hidden z-10 shadow-lg"
                        >
                          {ALLOWED_TRANSITIONS[job.status].length === 0 ? (
                            <p className="text-xs text-muted-foreground text-center py-3">
                              No further transitions available
                            </p>
                          ) : (
                            ALLOWED_TRANSITIONS[job.status].map((s) => (
                              <button
                                key={s}
                                type="button"
                                onClick={() => handleStatusChange(s)}
                                className="w-full text-left px-4 py-2.5 text-sm hover:bg-muted/40 transition-colors"
                                disabled={updateStatus.isPending}
                              >
                                Move to{' '}
                                <span className={cn('font-medium', STATUS_COLORS[s].split(' ').slice(-1))}>
                                  {STATUS_LABELS[s]}
                                </span>
                              </button>
                            ))
                          )}
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </div>
                  {job.applied_at && (
                    <p className="text-xs text-muted-foreground mt-2">
                      Applied {new Date(job.applied_at).toLocaleDateString()}
                    </p>
                  )}
                </Section>

                {/* PDF Preview */}
                {job.alignment_status === 'completed' && (
                  <Section title="Tailored Resume">
                    {!fetchPDF ? (
                      <button
                        type="button"
                        onClick={() => setFetchPDF(true)}
                        className="flex items-center gap-2 text-sm text-brand hover:opacity-80 transition-opacity"
                      >
                        <FileText className="w-4 h-4" />
                        Preview tailored resume
                      </button>
                    ) : pdfLoading ? (
                      <p className="text-xs text-muted-foreground">Generating link…</p>
                    ) : pdfUrl ? (
                      <a
                        href={pdfUrl.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center gap-2 text-sm text-brand hover:opacity-80 transition-opacity"
                      >
                        <ExternalLink className="w-4 h-4" />
                        Open PDF
                        <span className="text-[10px] text-muted-foreground">
                          (expires {new Date(pdfUrl.expires_at).toLocaleTimeString()})
                        </span>
                      </a>
                    ) : (
                      <p className="text-xs text-muted-foreground">PDF not available</p>
                    )}
                  </Section>
                )}

                {/* Delete */}
                <div className="pt-2 border-t border-border">
                  {!showDeleteConfirm ? (
                    <button
                      type="button"
                      onClick={() => setShowDeleteConfirm(true)}
                      className="text-xs text-red-500 hover:text-red-400 transition-colors"
                    >
                      Remove job
                    </button>
                  ) : (
                    <div className="flex items-center gap-3">
                      <p className="text-xs text-muted-foreground">Are you sure?</p>
                      <button
                        type="button"
                        onClick={handleDelete}
                        disabled={deleteJob.isPending}
                        className="text-xs text-red-500 hover:text-red-400 font-medium transition-colors"
                      >
                        {deleteJob.isPending ? 'Removing…' : 'Yes, remove'}
                      </button>
                      <button
                        type="button"
                        onClick={() => setShowDeleteConfirm(false)}
                        className="text-xs text-muted-foreground hover:text-foreground transition-colors"
                      >
                        Cancel
                      </button>
                    </div>
                  )}
                </div>
              </div>
            )}
          </motion.aside>
        </>
      )}
    </AnimatePresence>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">
        {title}
      </h4>
      {children}
    </div>
  )
}
