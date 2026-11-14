import { Mail, MailSearch } from 'lucide-react'
import type { Lead } from '@/lib/agentTypes'
import { cn } from '@/lib/utils'

/** Compact channel label for list rows. Every application is an email. */
export function ApplyChannelTag({ lead, className }: { lead: Lead; className?: string }) {
  const known = !!lead.apply_email
  const Icon = known ? Mail : MailSearch
  return (
    <span
      className={cn('inline-flex items-center gap-1 text-[11px] text-muted-foreground', className)}
      title={
        known
          ? `Applies by email to ${lead.apply_email}`
          : 'Applies by email to an address the company publishes, found when the application is prepared'
      }
    >
      <Icon className="size-3" aria-hidden />
      Email
    </span>
  )
}

/** Detail-pane explanation of exactly what approving will do. */
export function ApplyChannelInfo({ lead, coverLetters }: { lead: Lead; coverLetters?: boolean }) {
  const known = !!lead.apply_email
  const Icon = known ? Mail : MailSearch
  const what = coverLetters === false ? 'your tailored resume with a short note' : 'your tailored resume with a tailored email'
  return (
    <div className="flex items-start gap-3 rounded-xl border border-border bg-muted/30 p-3.5">
      <Icon className="mt-0.5 size-4 shrink-0 text-brand" aria-hidden />
      <div className="min-w-0 text-sm">
        <p className="font-medium text-foreground">Applies by email</p>
        <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
          The next run prepares {what} and schedules it from your agent mailbox to{' '}
          {known ? (
            <span className="break-all font-medium text-foreground">{lead.apply_email}</span>
          ) : (
            <>
              an address {lead.company || 'the company'} publishes for hiring (careers@, jobs@…). If it can't find one,
              it drops the job
            </>
          )}
          . It goes out later, spaced from your other applications, inside your sending window.
        </p>
      </div>
    </div>
  )
}
