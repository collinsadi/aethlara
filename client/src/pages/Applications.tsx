import { useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { Send } from 'lucide-react'
import { ExtensionWarning } from '@/components/agent/ExtensionWarning'
import { AnswerQuestionsDialog } from '@/components/applications/AnswerQuestionsDialog'
import { ApplicationGroup, type ApplicationActions } from '@/components/applications/ApplicationGroup'
import { CoverLetterDialog } from '@/components/applications/CoverLetterDialog'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import { EmptyState } from '@/components/EmptyState'
import { PageHeader } from '@/components/PageHeader'
import { useAgentOverview } from '@/hooks/useAgent'
import {
  useApplication,
  useCancelApplication,
  useMarkApplicationSubmitted,
  useRetryApplication,
} from '@/hooks/useAgentApplications'
import type { AgentApplication } from '@/lib/agentTypes'
import { friendlyErrorMessage } from '@/lib/apiError'
import { ui } from '@/lib/styles'
import { toast } from '@/lib/toast'

const GROUPS = {
  needs: 'needs_input,failed',
  active: 'queued,preparing,ready,in_progress',
  submitted: 'submitted',
  cancelled: 'cancelled',
} as const

/** /applications — everything the agent is applying to, grouped by what it needs. */
export function Applications() {
  const [params, setParams] = useSearchParams()
  const highlightId = params.get('highlight')
  const overview = useAgentOverview()
  const highlighted = useApplication(highlightId)
  const retry = useRetryApplication()
  const cancel = useCancelApplication()
  const markSubmitted = useMarkApplicationSubmitted()
  const [markingId, setMarkingId] = useState<string | null>(null)

  const [answering, setAnswering] = useState<AgentApplication | null>(null)
  const [coverFor, setCoverFor] = useState<AgentApplication | null>(null)
  const [cancelling, setCancelling] = useState<AgentApplication | null>(null)
  const [retryingId, setRetryingId] = useState<string | null>(null)

  // Let the highlight ring fade after the row has been scrolled into view.
  useEffect(() => {
    if (!highlightId) return
    const t = setTimeout(() => {
      const next = new URLSearchParams(window.location.search)
      next.delete('highlight')
      setParams(next, { replace: true })
    }, 6000)
    return () => clearTimeout(t)
  }, [highlightId, setParams])

  const counts = overview.data?.counts.applications
  const sum = (statuses: string) =>
    counts ? statuses.split(',').reduce((n, s) => n + (counts[s as keyof typeof counts] ?? 0), 0) : undefined
  const total = counts ? Object.values(counts).reduce((n, v) => n + (v ?? 0), 0) : undefined
  const activeCount = sum(GROUPS.active) ?? 0

  const actions: ApplicationActions = {
    highlightId,
    retryingId,
    markingId,
    onMarkSubmitted: (app) => {
      setMarkingId(app.id)
      markSubmitted.mutate(app.id, {
        onSuccess: () =>
          toast.success('Marked as applied', {
            description: `${app.lead.title} at ${app.lead.company} moved to Submitted and the tracker shows it as applied.`,
          }),
        onError: (err) => toast.error("Couldn't update it", { description: friendlyErrorMessage(err) }),
        onSettled: () => setMarkingId(null),
      })
    },
    onAnswer: setAnswering,
    onCoverLetter: setCoverFor,
    onCancel: setCancelling,
    onRetry: (app) => {
      setRetryingId(app.id)
      retry.mutate(app.id, {
        onSuccess: (updated) =>
          toast.success('Back in the queue', {
            description:
              updated.status === 'ready'
                ? `${app.lead.title} is ready for the extension again.`
                : `${app.lead.title} will be retried on the next run.`,
          }),
        onError: (err) => toast.error("Couldn't retry", { description: friendlyErrorMessage(err) }),
        onSettled: () => setRetryingId(null),
      })
    },
  }

  const confirmCancel = () => {
    if (!cancelling) return
    const app = cancelling
    cancel.mutate(app.id, {
      onSuccess: () => {
        toast.success('Application cancelled', {
          description: `${app.lead.title} moved to Cancelled. You can retry it from there.`,
        })
        setCancelling(null)
      },
      onError: (err) => {
        toast.error("Couldn't cancel", { description: friendlyErrorMessage(err) })
        setCancelling(null)
      },
    })
  }

  const nothingYet = total === 0

  return (
    <div className="space-y-8">
      <PageHeader
        title="Applications"
        description="Everything the agent is applying to — and anything it needs from you."
        actions={
          <Link to="/review" className={ui.secondary}>
            Review new jobs
          </Link>
        }
      />

      {overview.data && <ExtensionWarning overview={overview.data} />}

      {nothingYet ? (
        <div className="glass-card">
          <EmptyState
            icon={Send}
            title="No applications yet"
            description="Approve jobs in Review and the agent applies on its next run — by email, or through the Chrome extension for form applications."
            action={
              <Link to="/review" className={ui.primarySm}>
                Go to Review
              </Link>
            }
          />
        </div>
      ) : (
        <>
          <ApplicationGroup
            id="needs-you"
            title="Needs you"
            description="Questions only you can answer, sites that need you, and failures to retry."
            status={GROUPS.needs}
            count={sum(GROUPS.needs)}
            tone="warning"
            emptyText="Nothing needs you right now."
            actions={actions}
          />
          <ApplicationGroup
            id="in-progress"
            title="In progress"
            description="Queued for the next run, being prepared, or waiting for the Chrome extension."
            status={GROUPS.active}
            count={activeCount}
            tone="brand"
            poll={activeCount > 0}
            emptyText="Nothing in flight. Approved jobs show up here until they're submitted."
            actions={actions}
          />
          <ApplicationGroup
            id="submitted"
            title="Submitted"
            description="Sent. Replies to your agent mailbox move these along your tracker automatically."
            status={GROUPS.submitted}
            count={sum(GROUPS.submitted)}
            tone="success"
            emptyText="Nothing submitted yet."
            actions={actions}
          />
          <ApplicationGroup
            id="cancelled"
            title="Cancelled"
            description="Applications you stopped. Retry any of them to put it back in the queue."
            status={GROUPS.cancelled}
            count={sum(GROUPS.cancelled)}
            tone="muted"
            collapsible
            forceOpen={highlighted.data?.status === 'cancelled'}
            emptyText="Nothing cancelled."
            actions={actions}
          />
        </>
      )}

      <AnswerQuestionsDialog application={answering} onOpenChange={(open) => !open && setAnswering(null)} />
      <CoverLetterDialog application={coverFor} onOpenChange={(open) => !open && setCoverFor(null)} />
      <ConfirmDialog
        open={!!cancelling}
        onOpenChange={(open) => !open && setCancelling(null)}
        title="Cancel this application?"
        description={
          cancelling
            ? `${cancelling.lead.title} at ${cancelling.lead.company} won't be submitted and the job moves to Dismissed. You can retry it later from Cancelled.`
            : undefined
        }
        confirmLabel="Cancel application"
        pendingLabel="Cancelling…"
        destructive
        pending={cancel.isPending}
        onConfirm={confirmCancel}
      />
    </div>
  )
}
