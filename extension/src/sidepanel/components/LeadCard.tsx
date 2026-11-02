import { useState } from 'react'
import type { Lead, LeadDecision } from '@/types'
import { ExternalLink, ScoreBadge } from './ui'

function meta(lead: Lead): string {
  const parts: string[] = []
  if (lead.is_remote) parts.push('Remote')
  if (lead.location) parts.push(lead.location)
  if (lead.salary?.text) parts.push(lead.salary.text)
  return parts.join(' · ')
}

export function LeadCard({
  lead,
  onDecide,
  pending,
}: {
  lead: Lead
  onDecide: (decision: LeadDecision) => void
  pending: boolean
}) {
  const [open, setOpen] = useState(false)
  const match = lead.match
  return (
    <div className="item">
      <div className="row" style={{ alignItems: 'flex-start' }}>
        <ScoreBadge score={match?.score} />
        <div className="grow">
          <p className="item-title clamp-2" title={lead.title}>
            {lead.title}
          </p>
          <p className="small muted truncate">{lead.company}</p>
          {meta(lead) && <p className="tiny faint truncate">{meta(lead)}</p>}
        </div>
      </div>

      {match?.summary && <p className={open ? 'small' : 'small clamp-2'}>{match.summary}</p>}
      {open && match && (
        <div className="stack small">
          {match.pros.length > 0 && <p style={{ color: '#86efac' }}>+ {match.pros.join(' · ')}</p>}
          {match.gaps.length > 0 && <p style={{ color: '#fcd34d' }}>− {match.gaps.join(' · ')}</p>}
          {match.dealbreaker && <p style={{ color: '#fca5a5' }}>Deal-breaker: {match.dealbreaker}</p>}
        </div>
      )}

      <div className="row wrap" style={{ gap: 6 }}>
        <button className="btn btn-primary btn-sm" disabled={pending} onClick={() => onDecide('approve')}>
          Approve
        </button>
        <button className="btn btn-ghost btn-sm" disabled={pending} onClick={() => onDecide('dismiss')}>
          Dismiss
        </button>
        <span className="grow" />
        {match && (match.pros.length > 0 || match.gaps.length > 0) && (
          <button className="link-btn" onClick={() => setOpen((v) => !v)}>
            {open ? 'Less' : 'Why?'}
          </button>
        )}
      </div>
      <p className="tiny faint">
        via{' '}
        <ExternalLink href={lead.url} className="tiny">
          {lead.source_label || lead.source}
        </ExternalLink>
        {!lead.auto_apply_supported && ' · form on another site (best effort)'}
      </p>
    </div>
  )
}
