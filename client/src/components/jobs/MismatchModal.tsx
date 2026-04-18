import { useEffect, useRef, useState } from 'react'
import { motion } from 'framer-motion'
import { AlertTriangle } from 'lucide-react'
import { useQueryClient } from '@tanstack/react-query'
import { queryKeys } from '@/lib/queryKeys'
import type { MatchBreakdown } from '@/lib/types'
import { cn } from '@/lib/utils'
import { sanitiseResumeText, sanitiseResumeArray } from '@/lib/sanitise'

export interface MismatchData {
  job_id: string
  job_title: string
  company: string
  match_score: number
  match_breakdown: MatchBreakdown | null
  reason: string
  gaps: string[]
  suggestion: string
  learn_more_url?: string
}

interface Props {
  data: MismatchData
  onClose: () => void
}

export function MismatchModal({ data, onClose }: Props) {
  const qc = useQueryClient()
  const [displayScore, setDisplayScore] = useState(0)
  const animRef = useRef<number | null>(null)

  // Animate score from 0 to actual value over 300ms
  useEffect(() => {
    const target = data.match_score
    const duration = 300
    const start = performance.now()

    const tick = (now: number) => {
      const elapsed = now - start
      const progress = Math.min(elapsed / duration, 1)
      setDisplayScore(Math.round(progress * target))
      if (progress < 1) {
        animRef.current = requestAnimationFrame(tick)
      }
    }

    animRef.current = requestAnimationFrame(tick)
    return () => {
      if (animRef.current !== null) cancelAnimationFrame(animRef.current)
    }
  }, [data.match_score])

  // Block Escape key
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') e.preventDefault()
    }
    document.addEventListener('keydown', onKey, { capture: true })
    return () => document.removeEventListener('keydown', onKey, { capture: true })
  }, [])

  const handleClose = () => {
    // Invalidate caches — job was soft-deleted server-side
    qc.invalidateQueries({ queryKey: queryKeys.jobs.lists() })
    qc.invalidateQueries({ queryKey: queryKeys.analytics.dashboard() })
    onClose()
  }

  const gaps = sanitiseResumeArray(data.gaps ?? [])
  const reason = sanitiseResumeText(data.reason ?? '')
  const suggestion = sanitiseResumeText(data.suggestion ?? '').trim()
  const breakdown = data.match_breakdown

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
      {/* Non-dismissible backdrop */}
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" />

      <motion.div
        initial={{ opacity: 0, scale: 0.95, y: 12 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
        className="relative glass-card w-full max-w-md max-h-[90vh] overflow-y-auto shadow-2xl"
      >
        <div className="p-6 space-y-5">
          {/* Header */}
          <div className="flex items-start gap-3">
            <div className="p-2 rounded-xl bg-amber-500/10 shrink-0">
              <AlertTriangle className="w-5 h-5 text-amber-500" />
            </div>
            <div className="flex-1 min-w-0">
              <h2 className="text-base font-semibold text-foreground font-heading">
                Low Match Detected
              </h2>
              <p className="text-sm text-muted-foreground mt-0.5 truncate">
                {data.job_title} {data.company ? `at ${data.company}` : ''}
              </p>
            </div>
          </div>

          {/* Score */}
          <div className="glass-card p-4 text-center">
            <p className="text-4xl font-bold text-amber-500 font-heading tabular-nums">
              {displayScore}%
            </p>
            <p className="text-xs text-muted-foreground mt-1">Overall Match</p>

            {breakdown ? (
              <div className="mt-3 space-y-1.5 text-left">
                <ScoreBar label="Skills" value={breakdown.skills_match} />
                <ScoreBar label="Experience" value={breakdown.experience_match} />
                <ScoreBar label="Education" value={breakdown.education_match} />
              </div>
            ) : (
              <p className="mt-3 text-[11px] text-muted-foreground/70">
                Detailed breakdown unavailable for this analysis.
              </p>
            )}
          </div>

          {/* Reason */}
          <div>
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1.5">
              Why this didn&apos;t match
            </p>
            <p className="text-sm text-foreground leading-relaxed">{reason}</p>
          </div>

          {/* Gaps */}
          {gaps.length > 0 ? (
            <div>
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">
                What&apos;s missing
              </p>
              <ul className="space-y-1">
                {gaps.map((gap) => (
                  <li key={gap} className="flex items-center gap-2 text-sm text-foreground">
                    <span className="w-1.5 h-1.5 rounded-full bg-amber-500 shrink-0" />
                    {gap}
                  </li>
                ))}
              </ul>
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">
              No specific gaps identified — your overall profile may not meet this role&apos;s level.
              {data.learn_more_url ? (
                <>
                  {' '}
                  <a
                    href={data.learn_more_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="underline hover:text-foreground"
                  >
                    Learn more.
                  </a>
                </>
              ) : null}
            </p>
          )}

          {/* Suggestion */}
          {suggestion.length > 0 && (
            <div className="flex items-start gap-2 p-3 rounded-xl bg-muted/50 border border-border">
              <span className="text-base leading-none mt-0.5">💡</span>
              <p className="text-xs text-muted-foreground leading-relaxed">{suggestion}</p>
            </div>
          )}

          {/* Actions */}
          <div className="flex flex-col gap-2">
            {data.learn_more_url && (
              <a
                href={data.learn_more_url}
                target="_blank"
                rel="noopener noreferrer"
                className="w-full py-2.5 text-sm font-medium text-center rounded-xl border border-border text-muted-foreground hover:bg-muted/50 transition-colors"
              >
                Learn More ↗
              </a>
            )}
            <button
              type="button"
              onClick={handleClose}
              className="w-full py-2.5 text-sm font-medium border border-border rounded-xl text-foreground hover:bg-muted/50 transition-colors"
            >
              Close
            </button>
          </div>
        </div>
      </motion.div>
    </div>
  )
}

function ScoreBar({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-xs text-muted-foreground w-20 shrink-0">{label}</span>
      <div className="flex-1 h-1.5 rounded-full bg-muted overflow-hidden">
        <div
          className={cn(
            'h-full rounded-full transition-all',
            value >= 70 ? 'bg-emerald-500' : value >= 40 ? 'bg-amber-500' : 'bg-red-500'
          )}
          style={{ width: `${value}%` }}
        />
      </div>
      <span className="text-xs text-muted-foreground w-8 text-right">{value}%</span>
    </div>
  )
}
