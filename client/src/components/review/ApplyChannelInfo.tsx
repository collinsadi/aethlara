import { AlertTriangle, Mail, Puzzle } from 'lucide-react'
import type { Lead } from '@/lib/agentTypes'
import { atsLabel } from '@/lib/agentFormat'
import { cn } from '@/lib/utils'

/** Compact channel label for list rows: "Email" or "Extension". */
export function ApplyChannelTag({ lead, className }: { lead: Lead; className?: string }) {
  const email = lead.apply_channel === 'email'
  const Icon = email ? Mail : Puzzle
  return (
    <span
      className={cn('inline-flex items-center gap-1 text-[11px] text-muted-foreground', className)}
      title={
        email
          ? `Applies by email${lead.apply_email ? ` to ${lead.apply_email}` : ''}`
          : lead.auto_apply_supported
            ? `The extension fills the ${atsLabel(lead.ats) ?? ''} form`
            : 'The extension will try, but a manual step is likely'
      }
    >
      <Icon className="size-3" aria-hidden />
      {email ? 'Email' : 'Extension'}
      {!email && !lead.auto_apply_supported && (
        <AlertTriangle className="size-3 text-warning" role="img" aria-label="Manual step likely" />
      )}
    </span>
  )
}

/** Detail-pane explanation of exactly what approving will do. */
export function ApplyChannelInfo({ lead, coverLetters }: { lead: Lead; coverLetters?: boolean }) {
  if (lead.apply_channel === 'email') {
    return (
      <div className="flex items-start gap-3 rounded-xl border border-border bg-muted/30 p-3.5">
        <Mail className="mt-0.5 size-4 shrink-0 text-brand" aria-hidden />
        <div className="min-w-0 text-sm">
          <p className="font-medium text-foreground">Applies by email</p>
          <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
            On the next run the agent emails your tailored resume
            {coverLetters !== false && ' and a cover letter'} from your agent mailbox to{' '}
            {lead.apply_email ? (
              <span className="break-all font-medium text-foreground">{lead.apply_email}</span>
            ) : (
              'the address in the posting'
            )}
            .
          </p>
        </div>
      </div>
    )
  }
  const ats = atsLabel(lead.ats)
  return (
    <div
      className={cn(
        'flex items-start gap-3 rounded-xl border p-3.5',
        lead.auto_apply_supported ? 'border-border bg-muted/30' : 'border-warning/30 bg-warning/[0.08]'
      )}
    >
      {lead.auto_apply_supported ? (
        <Puzzle className="mt-0.5 size-4 shrink-0 text-brand" aria-hidden />
      ) : (
        <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden />
      )}
      <div className="min-w-0 text-sm">
        <p className="font-medium text-foreground">
          {lead.auto_apply_supported ? `Applies through the Chrome extension${ats ? ` · ${ats}` : ''}` : 'Manual step likely'}
        </p>
        <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
          {lead.auto_apply_supported
            ? `After the next run prepares it, the extension opens the ${ats ?? 'application'} form in your browser, fills it in and submits it.`
            : `This isn't a form the extension knows${ats ? ` (${ats})` : ''}. It will still try to fill it in your browser, but you'll probably need to finish the application yourself.`}
        </p>
      </div>
    </div>
  )
}
