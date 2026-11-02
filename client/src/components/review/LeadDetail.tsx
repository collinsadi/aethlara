import { Link } from 'react-router-dom'
import {
  ArrowLeft,
  Ban,
  Building2,
  Check,
  CheckCircle2,
  ExternalLink,
  Globe,
  MapPin,
  MinusCircle,
  RotateCcw,
  Send,
  X,
} from 'lucide-react'
import { ErrorState } from '@/components/ErrorState'
import { ApplyChannelInfo } from '@/components/review/ApplyChannelInfo'
import { MatchScore } from '@/components/review/MatchScore'
import { ToneBadge } from '@/components/ToneBadge'
import { Kbd } from '@/components/ui/kbd'
import { Skeleton } from '@/components/ui/skeleton'
import { useLead } from '@/hooks/useLeads'
import { useNow } from '@/hooks/useNow'
import type { Lead } from '@/lib/agentTypes'
import {
  APPLICATION_STATUS_META,
  DISMISS_REASON_META,
  FIT_META,
  LEAD_STATUS_META,
  employmentTypeLabel,
  formatDateTime,
  formatRelative,
  formatSalary,
  safeHref,
} from '@/lib/agentFormat'
import { friendlyErrorMessage } from '@/lib/apiError'
import { ui } from '@/lib/styles'
import { cn } from '@/lib/utils'

interface Props {
  leadId: string
  /** List row shown until the full detail (description, application) arrives. */
  fallback: Lead | null
  coverLetters: boolean
  onApprove: (lead: Lead) => void
  onDismiss: (lead: Lead) => void
  onRestore: (lead: Lead) => void
  onBack: () => void
}

export function LeadDetail({ leadId, fallback, ...rest }: Props) {
  const query = useLead(leadId)
  const lead = query.data?.lead ?? fallback
  if (!lead) {
    if (query.isError) {
      return (
        <div className="p-5">
          <ErrorState compact error={query.error} title="Couldn't load this job" onRetry={() => query.refetch()} />
        </div>
      )
    }
    return <LeadDetailSkeleton />
  }
  return <LeadDetailBody lead={lead} query={query} {...rest} />
}

function LeadDetailBody({
  lead,
  query,
  coverLetters,
  onApprove,
  onDismiss,
  onRestore,
  onBack,
}: Omit<Props, 'leadId' | 'fallback'> & { lead: Lead; query: ReturnType<typeof useLead> }) {
  const now = useNow()
  const { data, isLoading, isError, error, refetch } = query
  const application = data?.application ?? null
  const salary = formatSalary(lead.salary)
  const employment = employmentTypeLabel(lead.employment_type)
  const postingHref = safeHref(lead.url)
  const status = LEAD_STATUS_META[lead.status]
  const reason =
    lead.status === 'expired' ? DISMISS_REASON_META.expired : lead.dismiss_reason ? DISMISS_REASON_META[lead.dismiss_reason] : null
  const canApprove = lead.status === 'new' || lead.status === 'dismissed' || lead.status === 'expired'
  const canDismiss = lead.status === 'new' || lead.status === 'approved' || lead.status === 'applying' || lead.status === 'failed'
  const canRestore = lead.status === 'dismissed' || lead.status === 'expired'

  return (
    <article aria-labelledby="lead-title" className="flex flex-col">
      {/* Sticky header with the decision bar */}
      <header className="sticky top-16 z-10 rounded-t-2xl border-b border-border bg-card/95 px-5 pb-4 pt-4 backdrop-blur-md lg:top-0">
        <button type="button" onClick={onBack} className={cn(ui.ghost, '-ml-2 mb-2 lg:hidden')} aria-label="Back to the job list">
          <ArrowLeft className="size-3.5" aria-hidden />
          Back to list
        </button>
        <div className="flex items-start gap-4">
          <MatchScore score={lead.match?.score} size="lg" />
          <div className="min-w-0 flex-1">
            <h2 id="lead-title" className="font-heading text-lg font-semibold leading-snug text-foreground">
              {lead.title}
            </h2>
            <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
              <span className="inline-flex items-center gap-1">
                <Building2 className="size-3.5" aria-hidden />
                {lead.company}
              </span>
              {lead.location && (
                <span className="inline-flex min-w-0 items-start gap-1" title={lead.location}>
                  <MapPin className="mt-0.5 size-3.5 shrink-0" aria-hidden />
                  <span className="line-clamp-2">{lead.location}</span>
                </span>
              )}
              {lead.is_remote && (
                <span className="inline-flex items-center gap-1 font-medium text-success">
                  <Globe className="size-3.5" aria-hidden />
                  Remote
                </span>
              )}
            </p>
            <p className="mt-1 flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
              {salary && <span className="font-medium text-foreground">{salary}</span>}
              {salary && (employment || lead.posted_at) && <span aria-hidden>·</span>}
              {employment && <span>{employment}</span>}
              {employment && lead.posted_at && <span aria-hidden>·</span>}
              {lead.posted_at && (
                <span title={formatDateTime(lead.posted_at)}>Posted {formatRelative(lead.posted_at, now)}</span>
              )}
            </p>
          </div>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-2">
          {canApprove && (
            <button type="button" onClick={() => onApprove(lead)} className={ui.primary}>
              <Check className="size-4" aria-hidden />
              Approve
              <Kbd className="ml-1 hidden md:inline-flex border-primary-foreground/20 bg-primary-foreground/10 text-primary-foreground/80 shadow-none">A</Kbd>
            </button>
          )}
          {canRestore && (
            <button type="button" onClick={() => onRestore(lead)} className={ui.secondary}>
              <RotateCcw className="size-4" aria-hidden />
              Back to review
              <Kbd className="ml-1 hidden md:inline-flex">R</Kbd>
            </button>
          )}
          {canDismiss && (
            <button type="button" onClick={() => onDismiss(lead)} className={ui.secondary}>
              <X className="size-4" aria-hidden />
              {lead.status === 'new' ? 'Dismiss' : 'Cancel & dismiss'}
              <Kbd className="ml-1 hidden md:inline-flex">X</Kbd>
            </button>
          )}
          {postingHref && (
            <a href={postingHref} target="_blank" rel="noopener noreferrer" className={ui.outline}>
              <ExternalLink className="size-3.5" aria-hidden />
              Open posting
              <Kbd className="ml-1 hidden md:inline-flex">O</Kbd>
            </a>
          )}
        </div>
        {canApprove && lead.apply_channel === 'email' && lead.apply_email && (
          <p className="mt-2 text-xs text-muted-foreground">
            Approving emails your resume to <span className="break-all font-medium text-foreground">{lead.apply_email}</span>{' '}
            on the next run.
          </p>
        )}
      </header>

      <div className="space-y-6 px-5 py-5">
        {lead.status !== 'new' && (
          <div className="flex flex-wrap items-center gap-2 rounded-xl border border-border bg-muted/30 px-3.5 py-3 text-xs">
            <ToneBadge tone={status.tone}>{status.label}</ToneBadge>
            {reason && <ToneBadge tone="muted" title={reason.help}>{reason.label}</ToneBadge>}
            {lead.decided_at && (
              <span className="text-muted-foreground">decided {formatRelative(lead.decided_at, now)}</span>
            )}
            {application && (
              <>
                <span className="text-muted-foreground">· application</span>
                <ToneBadge tone={APPLICATION_STATUS_META[application.status].tone}>
                  {APPLICATION_STATUS_META[application.status].label}
                </ToneBadge>
                <Link to={`/applications?highlight=${application.id}`} className={cn(ui.link, 'text-xs')}>
                  View application
                </Link>
              </>
            )}
            {lead.job_id && (
              <Link to={`/jobs/${lead.job_id}`} className={cn(ui.link, 'text-xs')}>
                Tracker job
              </Link>
            )}
          </div>
        )}

        <ApplyChannelInfo lead={lead} coverLetters={coverLetters} />

        <MatchSection lead={lead} />

        <section aria-labelledby="lead-description-heading">
          <h3 id="lead-description-heading" className="font-heading text-sm font-semibold text-foreground">
            Job description
          </h3>
          {isLoading ? (
            <div className="mt-3 space-y-2" aria-busy="true">
              {[92, 100, 84, 96, 70, 88, 60].map((w, i) => (
                <Skeleton key={i} className="h-3" style={{ width: `${w}%` }} />
              ))}
            </div>
          ) : isError ? (
            <div role="alert" className="mt-3 rounded-xl border border-destructive/25 bg-destructive/[0.07] px-3.5 py-3 text-xs text-destructive">
              Couldn't load the description: {friendlyErrorMessage(error)}{' '}
              <button type="button" onClick={() => refetch()} className="font-semibold underline underline-offset-2">
                Try again
              </button>
            </div>
          ) : lead.description?.trim() ? (
            <div className="mt-3 whitespace-pre-wrap break-words text-sm leading-relaxed text-foreground/90">
              {lead.description}
            </div>
          ) : (
            <p className="mt-3 text-sm text-muted-foreground">
              The source didn't include a description. Open the posting to read it.
            </p>
          )}
        </section>

        <footer className="border-t border-border pt-4 text-xs text-muted-foreground">
          {postingHref ? (
            <>
              via{' '}
              <a href={postingHref} target="_blank" rel="noopener noreferrer" className={ui.link}>
                {lead.source_label}
              </a>
            </>
          ) : (
            <>via {lead.source_label}</>
          )}
          {' · '}found {formatRelative(lead.created_at, now)}
        </footer>
      </div>
    </article>
  )
}

function MatchSection({ lead }: { lead: Lead }) {
  const match = lead.match
  if (!match) {
    return (
      <section className="rounded-xl border border-border bg-muted/30 px-3.5 py-3 text-sm text-muted-foreground">
        Not scored yet — the next run scores it against your resume.
      </section>
    )
  }
  const fit = match.fit ? FIT_META[match.fit] : null
  return (
    <section aria-labelledby="lead-match-heading" className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <h3 id="lead-match-heading" className="font-heading text-sm font-semibold text-foreground">
          Why it matches
        </h3>
        {fit && <ToneBadge tone={fit.tone}>{fit.label}</ToneBadge>}
      </div>
      {match.dealbreaker && (
        <div role="note" className="flex items-start gap-2.5 rounded-xl border border-destructive/25 bg-destructive/[0.07] px-3.5 py-3">
          <Ban className="mt-0.5 size-4 shrink-0 text-destructive" aria-hidden />
          <div className="text-sm">
            <p className="font-medium text-foreground">Deal-breaker</p>
            <p className="mt-0.5 text-xs text-muted-foreground">{match.dealbreaker}</p>
          </div>
        </div>
      )}
      {match.summary && <p className="text-sm leading-relaxed text-foreground/90">{match.summary}</p>}
      {(match.pros.length > 0 || match.gaps.length > 0) && (
        <div className="grid gap-4 sm:grid-cols-2">
          {match.pros.length > 0 && (
            <div>
              <p className="mb-1.5 text-xs font-medium text-muted-foreground">Strengths</p>
              <ul className="space-y-1.5">
                {match.pros.map((pro) => (
                  <li key={pro} className="flex items-start gap-2 text-sm text-foreground/90">
                    <CheckCircle2 className="mt-0.5 size-3.5 shrink-0 text-success" aria-hidden />
                    {pro}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {match.gaps.length > 0 && (
            <div>
              <p className="mb-1.5 text-xs font-medium text-muted-foreground">Gaps</p>
              <ul className="space-y-1.5">
                {match.gaps.map((gap) => (
                  <li key={gap} className="flex items-start gap-2 text-sm text-foreground/90">
                    <MinusCircle className="mt-0.5 size-3.5 shrink-0 text-warning" aria-hidden />
                    {gap}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </section>
  )
}

function LeadDetailSkeleton() {
  return (
    <div className="space-y-5 p-5" aria-busy="true" aria-label="Loading job">
      <div className="flex items-start gap-4">
        <Skeleton className="size-16 rounded-full" />
        <div className="flex-1 space-y-2">
          <Skeleton className="h-5 w-3/4" />
          <Skeleton className="h-4 w-1/2" />
          <Skeleton className="h-3 w-1/3" />
        </div>
      </div>
      <div className="flex gap-2">
        <Skeleton className="h-11 w-32 rounded-full" />
        <Skeleton className="h-11 w-28 rounded-full" />
      </div>
      <Skeleton className="h-16 w-full rounded-xl" />
      <div className="space-y-2">
        {[90, 100, 80, 95, 70].map((w, i) => (
          <Skeleton key={i} className="h-3" style={{ width: `${w}%` }} />
        ))}
      </div>
    </div>
  )
}

export function LeadDetailEmpty({ tab }: { tab: string }) {
  return (
    <div className="flex h-full min-h-[320px] flex-col items-center justify-center px-6 text-center">
      <Send className="mb-3 size-6 text-muted-foreground/50" aria-hidden />
      <p className="text-sm text-muted-foreground">
        {tab === 'new' ? 'Pick a job to see the details.' : 'Select a job to see its details.'}
      </p>
    </div>
  )
}
