import { X, ExternalLink, MoreVertical, Trash2 } from 'lucide-react'
import { useState, useRef, useEffect } from 'react'
import { cn } from '@/lib/utils'
import type { ChatSessionSummary } from '@/lib/types'

interface Props {
  session: ChatSessionSummary | null
  onClose: () => void
  onViewJob?: (jobId: string) => void
  onClearHistory?: () => void
}

function matchColor(score: number | null): string {
  if (score === null) return 'text-muted-foreground bg-muted'
  if (score >= 70) return 'text-emerald-600 dark:text-emerald-400 bg-emerald-500/10'
  if (score >= 40) return 'text-amber-600 dark:text-amber-400 bg-amber-500/10'
  return 'text-red-600 dark:text-red-400 bg-red-500/10'
}

export function ChatHeader({ session, onClose, onViewJob, onClearHistory }: Props) {
  const [menuOpen, setMenuOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!menuOpen) return
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false)
      }
    }
    window.addEventListener('mousedown', handler)
    return () => window.removeEventListener('mousedown', handler)
  }, [menuOpen])

  return (
    <div className="sticky top-0 z-10 bg-[var(--tf-surface-dark)]/90 dark:bg-[var(--tf-surface-dark)]/90 backdrop-blur-md border-b border-border px-5 py-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <h2 className="text-sm font-semibold text-foreground font-heading truncate">
            {session ? session.job_title : 'Chat'}
          </h2>
          <p className="text-xs text-muted-foreground truncate mt-0.5">
            {session ? session.company : '—'}
          </p>
          <div className="flex items-center gap-2 mt-2">
            {session?.match_score !== undefined && (
              <span
                className={cn(
                  'px-2 py-0.5 rounded-full text-[10px] font-semibold tabular-nums',
                  matchColor(session?.match_score ?? null),
                )}
              >
                {session?.match_score !== null ? `${session?.match_score}% match` : 'Not scored'}
              </span>
            )}
            {session && onViewJob && (
              <button
                type="button"
                onClick={() => onViewJob(session.job_id)}
                className="inline-flex items-center gap-1 text-[11px] text-brand hover:opacity-80 transition-opacity"
              >
                <ExternalLink className="w-3 h-3" />
                View job
              </button>
            )}
          </div>
        </div>

        <div className="flex items-center gap-1 shrink-0">
          {session && onClearHistory && (
            <div className="relative" ref={menuRef}>
              <button
                type="button"
                onClick={() => setMenuOpen((o) => !o)}
                className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted/40 transition-colors"
                aria-label="Chat options"
              >
                <MoreVertical className="w-4 h-4" />
              </button>
              {menuOpen && (
                <div className="absolute top-full right-0 mt-1 min-w-[180px] glass-card border border-border rounded-xl overflow-hidden shadow-lg z-20">
                  <button
                    type="button"
                    onClick={() => {
                      setMenuOpen(false)
                      onClearHistory()
                    }}
                    className="flex items-center gap-2 w-full text-left px-3 py-2 text-xs text-red-500 hover:bg-red-500/10 transition-colors"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    Clear chat history
                  </button>
                </div>
              )}
            </div>
          )}
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted/40 transition-colors"
            aria-label="Close chat"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  )
}
