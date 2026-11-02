import { useEffect, useRef } from 'react'
import { Link } from 'react-router-dom'
import {
  AlertTriangle,
  Briefcase,
  CheckCircle2,
  ExternalLink,
  FileText,
  Loader2,
  Mail,
  MessageSquareText,
  Puzzle,
  RotateCcw,
  XCircle,
} from 'lucide-react'
import { ToneBadge } from '@/components/ToneBadge'
import type { AgentApplication } from '@/lib/agentTypes'
import {
  APPLICATION_STATUS_META,
  atsLabel,
  formatDateTime,
  formatRelative,
  hostOf,
  needsReasonMeta,
  pluralize,
  safeHref,
} from '@/lib/agentFormat'
import { scoreTone, toneBadge } from '@/lib/tones'
import { ui } from '@/lib/styles'
import { cn } from '@/lib/utils'

/** "the email could not be sent" → "The email could not be sent." */
function sentence(text: string | null): string {
  const t = (text ?? '').trim()
  if (!t) return ''
  const capped = t.charAt(0).toUpperCase() + t.slice(1)
  return /[.!?]$/.test(capped) ? capped : `${capped}.`
}

interface Props {
  app: AgentApplication
  now: number
  highlighted: boolean
  retrying: boolean
  onAnswer: (app: AgentApplication) => void
  onRetry: (app: AgentApplication) => void
  onCancel: (app: AgentApplication) => void
  onCoverLetter: (app: AgentApplication) => void
  onMarkSubmitted: (app: AgentApplication) => void
  marking: boolean
}

export function ApplicationRow({
  app,
  now,
  highlighted,
  retrying,
  marking,
  onAnswer,
  onRetry,
  onCancel,
  onCoverLetter,
  onMarkSubmitted,
}: Props) {
  const status = APPLICATION_STATUS_META[app.status]
  const needs = app.status === 'needs_input' ? app.needs : null
  const needsMeta = needs ? needsReasonMeta(needs.reason) : null
  const hasQuestions = !!needs && (needs.questions?.length ?? 0) > 0
  const formHref = safeHref(needs?.page_url) ?? safeHref(app.apply_url)
  const postingHref = safeHref(app.lead.url)
  const finalHref = safeHref(app.result?.final_url)
  const canRetry = app.status === 'failed' || app.status === 'needs_input' || app.status === 'cancelled'
  const canCancel = app.status !== 'submitted' && app.status !== 'cancelled'
  // For CAPTCHAs, sign-ins and odd forms the user finishes the job by hand.
  const canMarkSubmitted = app.status === 'needs_input' || app.status === 'failed'
  const ats = atsLabel(app.ats)
  const email = app.channel === 'email'
  const score = app.lead.score
  const ref = useRef<HTMLLIElement>(null)

  useEffect(() => {
    if (highlighted) ref.current?.scrollIntoView({ block: 'center', behavior: 'smooth' })
  }, [highlighted])

  return (
    <li
      ref={ref}
      id={`application-${app.id}`}
      className={cn(
        'glass-card scroll-mt-24 p-4 transition-shadow md:p-5',
        highlighted && 'ring-2 ring-brand/50 ring-offset-2 ring-offset-background'
      )}
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex min-w-0 items-start gap-3">
          <span
            className={cn(
              'flex size-10 shrink-0 items-center justify-center rounded-xl border font-heading text-sm font-semibold tabular-nums',
              toneBadge[scoreTone(score)]
            )}
            title={score === null ? 'Not scored' : `Match score ${score}`}
          >
            {score ?? '—'}
          </span>
          <div className="min-w-0">
            <h3 className="text-sm font-semibold leading-snug text-foreground">{app.lead.title}</h3>
            <p className="text-xs text-muted-foreground">{app.lead.company}</p>
            <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-[11px] text-muted-foreground">
              <span className="inline-flex items-center gap-1">
                {email ? <Mail className="size-3" aria-hidden /> : <Puzzle className="size-3" aria-hidden />}
                {email ? 'Email' : 'Extension'}
                {email && app.apply_email && <span className="break-all text-foreground"> · {app.apply_email}</span>}
                {!email && ats && <span className="text-foreground"> · {ats}</span>}
              </span>
              {app.attempts > 0 && <span>{pluralize(app.attempts, 'attempt')}</span>}
              {app.status === 'submitted' && app.submitted_at ? (
                <span title={formatDateTime(app.submitted_at)}>Submitted {formatRelative(app.submitted_at, now)}</span>
              ) : (
                <span title={formatDateTime(app.updated_at)}>Updated {formatRelative(app.updated_at, now)}</span>
              )}
              {app.status === 'in_progress' && app.claim_expires_at && (
                <span>
                  {new Date(app.claim_expires_at).getTime() > now
                    ? `extension lease ends ${formatRelative(app.claim_expires_at, now)}`
                    : 'extension lease expired — it will be picked up again'}
                </span>
              )}
            </div>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2 pl-[52px] sm:pl-0">
          {(app.status === 'preparing' || app.status === 'in_progress') && (
            <Loader2 className="size-3.5 animate-spin text-muted-foreground" aria-hidden />
          )}
          <ToneBadge tone={status.tone} title={status.help}>
            {status.label}
          </ToneBadge>
        </div>
      </div>

      {needs && needsMeta && (
        <div className="mt-3 rounded-xl border border-warning/30 bg-warning/[0.08] px-3.5 py-3">
          <p className="flex items-center gap-1.5 text-sm font-medium text-foreground">
            <MessageSquareText className="size-4 text-warning" aria-hidden />
            {needsMeta.label}
          </p>
          {needs.message && <p className="mt-1 text-xs text-foreground/80">{needs.message}</p>}
          <p className="mt-1 text-xs text-muted-foreground">{needsMeta.help}</p>
          {hasQuestions && (
            <ul className="mt-2 list-disc space-y-0.5 pl-5 text-xs text-foreground/80">
              {needs.questions!.slice(0, 3).map((q) => (
                <li key={q.field_id || q.label}>{q.label}</li>
              ))}
              {needs.questions!.length > 3 && <li>and {needs.questions!.length - 3} more</li>}
            </ul>
          )}
        </div>
      )}

      {app.status === 'failed' && (
        <p role="note" className="mt-3 flex items-start gap-2 rounded-xl border border-destructive/25 bg-destructive/[0.07] px-3.5 py-3 text-xs text-destructive">
          <AlertTriangle className="mt-px size-3.5 shrink-0" aria-hidden />
          <span>{sentence(app.last_error) || 'Something went wrong while applying.'} Retry to try again.</span>
        </p>
      )}

      {app.status === 'submitted' && (app.result?.message || app.result?.filled || finalHref) && (
        <p className="mt-3 text-xs text-muted-foreground">
          {app.result?.filled ? `${pluralize(app.result.filled, 'field')} filled. ` : ''}
          {app.result?.message && <span className="text-foreground/80">“{app.result.message}”</span>}
          {finalHref && (
            <>
              {' '}
              <a href={finalHref} target="_blank" rel="noopener noreferrer" className={ui.link}>
                Confirmation page
              </a>
            </>
          )}
        </p>
      )}

      <div className="mt-4 flex flex-wrap items-center gap-2">
        {hasQuestions && (
          <button type="button" onClick={() => onAnswer(app)} className={ui.primarySm}>
            <MessageSquareText className="size-3.5" aria-hidden />
            Answer {pluralize(needs!.questions!.length, 'question')}
          </button>
        )}
        {needs && formHref && (
          <a href={formHref} target="_blank" rel="noopener noreferrer" className={hasQuestions ? ui.outline : ui.primarySm}>
            <ExternalLink className="size-3.5" aria-hidden />
            Open the form
            <span className="sr-only"> on {hostOf(formHref)}</span>
          </a>
        )}
        {canMarkSubmitted && (
          <button
            type="button"
            onClick={() => onMarkSubmitted(app)}
            disabled={marking}
            className={ui.outline}
            title="You submitted this application yourself - record it as applied"
          >
            {marking ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : <CheckCircle2 className="size-3.5" aria-hidden />}
            I applied myself
          </button>
        )}
        {canRetry && (
          <button type="button" onClick={() => onRetry(app)} disabled={retrying} className={ui.outline}>
            {retrying ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : <RotateCcw className="size-3.5" aria-hidden />}
            Retry
          </button>
        )}
        {app.has_cover_letter && (
          <button type="button" onClick={() => onCoverLetter(app)} className={ui.outline}>
            <FileText className="size-3.5" aria-hidden />
            Cover letter
          </button>
        )}
        {!needs && !email && formHref && app.status !== 'submitted' && (
          <a href={formHref} target="_blank" rel="noopener noreferrer" className={ui.outline}>
            <ExternalLink className="size-3.5" aria-hidden />
            Application page
          </a>
        )}
        {app.job_id && (
          <Link to={`/jobs/${app.job_id}`} className={ui.outline}>
            <Briefcase className="size-3.5" aria-hidden />
            Tracker job
          </Link>
        )}
        {postingHref && (
          <a href={postingHref} target="_blank" rel="noopener noreferrer" className={ui.ghost}>
            Posting
            <ExternalLink className="size-3" aria-hidden />
          </a>
        )}
        {canCancel && (
          <button type="button" onClick={() => onCancel(app)} className={cn(ui.ghost, 'ml-auto hover:text-destructive')}>
            <XCircle className="size-3.5" aria-hidden />
            Cancel
          </button>
        )}
      </div>
    </li>
  )
}
