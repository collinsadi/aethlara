import { forwardRef } from 'react'
import { Globe, MapPin } from 'lucide-react'
import { MatchScore } from '@/components/review/MatchScore'
import { ApplyChannelTag } from '@/components/review/ApplyChannelInfo'
import { ToneBadge } from '@/components/ToneBadge'
import type { Lead } from '@/lib/agentTypes'
import { DISMISS_REASON_META, LEAD_STATUS_META, formatRelative, formatSalary } from '@/lib/agentFormat'
import { cn } from '@/lib/utils'

interface Props {
  lead: Lead
  active: boolean
  checked: boolean
  now: number
  showStatus: boolean
  onSelect: () => void
  onCheckedChange: (checked: boolean, shiftKey: boolean) => void
}

export const LeadListItem = forwardRef<HTMLLIElement, Props>(function LeadListItem(
  { lead, active, checked, now, showStatus, onSelect, onCheckedChange },
  ref
) {
  const salary = formatSalary(lead.salary)
  const status = LEAD_STATUS_META[lead.status]
  const reason =
    lead.status === 'expired' ? DISMISS_REASON_META.expired : lead.dismiss_reason ? DISMISS_REASON_META[lead.dismiss_reason] : null

  return (
    <li
      ref={ref}
      data-lead-id={lead.id}
      className={cn(
        'group relative flex items-start gap-3 overflow-hidden rounded-xl border px-3 py-3 transition-colors',
        active ? 'border-border bg-card shadow-sm' : 'border-transparent hover:border-border hover:bg-card/60',
        checked && !active && 'bg-brand/[0.04]'
      )}
    >
      {active && <span className="absolute left-0 top-0 bottom-0 w-1 bg-brand" aria-hidden />}
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onCheckedChange(e.target.checked, (e.nativeEvent as MouseEvent).shiftKey === true)}
        aria-label={`Select ${lead.title} at ${lead.company}`}
        className="mt-3 size-4 shrink-0 cursor-pointer rounded accent-brand"
      />
      <button
        type="button"
        onClick={onSelect}
        aria-current={active ? 'true' : undefined}
        className="flex min-w-0 flex-1 items-start gap-3 rounded-lg text-left outline-none focus-visible:ring-2 focus-visible:ring-brand/40"
      >
        <MatchScore score={lead.match?.score} />
        <div className="min-w-0 flex-1">
          <p className="line-clamp-2 text-sm font-semibold leading-snug text-foreground">{lead.title}</p>
          <p className="mt-0.5 truncate text-xs text-muted-foreground">
            {lead.company}
            {lead.location && (
              <>
                {' · '}
                <MapPin className="inline size-3 -translate-y-px" aria-hidden /> {lead.location}
              </>
            )}
          </p>
          <div className="mt-1.5 flex flex-wrap items-center gap-x-2.5 gap-y-1">
            {showStatus && <ToneBadge tone={status.tone}>{status.label}</ToneBadge>}
            {showStatus && reason && <ToneBadge tone="muted">{reason.label}</ToneBadge>}
            {lead.is_remote && (
              <span className="inline-flex items-center gap-1 text-[11px] font-medium text-success">
                <Globe className="size-3" aria-hidden />
                Remote
              </span>
            )}
            {salary && <span className="text-[11px] font-medium text-foreground">{salary}</span>}
            <ApplyChannelTag lead={lead} />
            <span className="text-[11px] text-muted-foreground">
              via {lead.source_label}
              {lead.posted_at && ` · ${formatRelative(lead.posted_at, now)}`}
            </span>
          </div>
        </div>
      </button>
    </li>
  )
})
