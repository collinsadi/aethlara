import { Loader2, OctagonPause, Play, Send, ShieldAlert } from 'lucide-react'
import { useSendingPause } from '@/hooks/useAgent'
import { useNow } from '@/hooks/useNow'
import type { AgentOverview } from '@/lib/agentTypes'
import { formatDateTime, formatRelative, pluralize } from '@/lib/agentFormat'
import { friendlyErrorMessage } from '@/lib/apiError'
import { ui } from '@/lib/styles'
import { toast } from '@/lib/toast'
import { cn } from '@/lib/utils'

/**
 * The send queue at a glance: applications are emailed one at a time,
 * spaced out inside the sending window. Shows a pause (yours or the
 * automatic one after bounces or a spam complaint) and lets you pause or
 * resume.
 */
export function SendingPanel({ overview }: { overview: AgentOverview }) {
  const { sending, setup } = overview
  const now = useNow()
  const pause = useSendingPause()
  const blocked = setup.mail_health && !setup.mail_health.can_send

  const toggle = (paused: boolean) =>
    pause.mutate(paused, {
      onSuccess: () =>
        toast.success(paused ? 'Sending paused' : 'Sending resumed', {
          description: paused
            ? 'Scheduled emails wait until you resume. Nothing else changes.'
            : 'Scheduled emails go out again, spaced through your sending window.',
        }),
      onError: (err) => toast.error("Couldn't update sending", { description: friendlyErrorMessage(err) }),
    })

  if (!sending) return null

  if (sending.paused) {
    return (
      <div
        role="status"
        className="flex flex-col gap-3 rounded-2xl border border-warning/30 bg-warning/[0.08] p-4 sm:flex-row sm:items-center sm:justify-between"
      >
        <div className="flex items-start gap-3">
          <OctagonPause className="mt-0.5 size-5 shrink-0 text-warning" aria-hidden />
          <div>
            <p className="text-sm font-semibold text-foreground">
              Sending is paused
              {sending.paused_until && !sending.paused_by_user && (
                <span className="font-normal text-muted-foreground" title={formatDateTime(sending.paused_until)}>
                  {' '}
                  · resumes {formatRelative(sending.paused_until, now)}
                </span>
              )}
            </p>
            {sending.pause_reason && <p className="mt-0.5 text-xs text-muted-foreground">{sending.pause_reason}</p>}
            {sending.scheduled > 0 && (
              <p className="mt-0.5 text-xs text-muted-foreground">
                {pluralize(sending.scheduled, 'email is', 'emails are')} waiting.
              </p>
            )}
          </div>
        </div>
        <button type="button" onClick={() => toggle(false)} disabled={pause.isPending} className={cn(ui.primarySm, 'shrink-0')}>
          {pause.isPending ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : <Play className="size-3.5" aria-hidden />}
          Resume sending
        </button>
      </div>
    )
  }

  return (
    <div className="space-y-3">
      {blocked && (
        <p role="alert" className="flex items-start gap-2 rounded-xl border border-destructive/25 bg-destructive/[0.07] px-3.5 py-3 text-xs text-destructive">
          <ShieldAlert className="mt-px size-3.5 shrink-0" aria-hidden />
          <span>
            Emails are on hold: the sending domain {setup.mail_health?.domain} can't send right now (
            {setup.mail_health?.checks.find((c) => c.status === 'fail')?.detail ?? 'see the deliverability check'}). They go
            out as soon as it's fixed.
          </span>
        </p>
      )}
      <div className="flex flex-col gap-3 rounded-2xl border border-border bg-muted/20 p-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-3">
          <Send className="mt-0.5 size-5 shrink-0 text-brand" aria-hidden />
          <div className="text-xs text-muted-foreground">
            <p className="text-sm font-semibold text-foreground">
              {sending.scheduled > 0
                ? `${pluralize(sending.scheduled, 'email')} scheduled`
                : 'Nothing waiting to send'}
              {sending.next_send_at && (
                <span className="font-normal text-muted-foreground" title={formatDateTime(sending.next_send_at)}>
                  {' '}
                  · next {formatRelative(sending.next_send_at, now)}
                </span>
              )}
            </p>
            <p className="mt-0.5">
              One at a time, minutes apart, inside your sending window ({sending.timezone}). {sending.sent_last_24h} sent in
              the last 24 hours; up to {sending.daily_cap} a day
              {sending.warming_up ? ' while your new mailbox warms up' : ''}.
            </p>
          </div>
        </div>
        <button type="button" onClick={() => toggle(true)} disabled={pause.isPending} className={cn(ui.outline, 'shrink-0')}>
          {pause.isPending ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : <OctagonPause className="size-3.5" aria-hidden />}
          Pause sending
        </button>
      </div>
    </div>
  )
}
