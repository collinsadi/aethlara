import { useState } from 'react'
import { DASHBOARD_LINKS } from '@/lib/config'
import { errorMessage } from '@/lib/util'
import type { LeadDecision } from '@/types'
import { LeadCard } from '../components/LeadCard'
import { EmptyState, ExternalLink, Notice, SectionHead, Spinner } from '../components/ui'
import { useDecideLead, useNewLeads } from '../hooks/useAgent'

const PAGE = 20

/** Quick triage of new leads: approve (queue an application) or dismiss. */
export function ReviewPage() {
  const [sort, setSort] = useState<'score' | 'recent'>('score')
  const [limit, setLimit] = useState(PAGE)
  const leads = useNewLeads(sort, limit)
  const decide = useDecideLead()
  const [hidden, setHidden] = useState<Set<string>>(new Set())
  const [pendingId, setPendingId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const onDecide = (id: string, decision: LeadDecision) => {
    setPendingId(id)
    setError(null)
    decide.mutate(
      { id, decision },
      {
        onSuccess: () => setHidden((prev) => new Set(prev).add(id)),
        onError: (err) => setError(errorMessage(err, 'Could not save that decision.')),
        onSettled: () => setPendingId(null),
      },
    )
  }

  const all = leads.data?.items ?? []
  const items = all.filter((l) => !hidden.has(l.id))
  const total = leads.data?.pagination.total_items ?? 0
  // Decided leads stay hidden until the refetch drops them from the list.
  const remaining = Math.max(0, total - (all.length - items.length))

  return (
    <div className="page">
      <div className="section">
        <SectionHead
          title={`New leads${leads.data ? ` (${remaining})` : ''}`}
          action={
            <div className="row" style={{ gap: 4 }}>
              <button className={`btn btn-sm ${sort === 'score' ? 'btn-soft' : 'btn-ghost'}`} onClick={() => setSort('score')}>
                Best match
              </button>
              <button className={`btn btn-sm ${sort === 'recent' ? 'btn-soft' : 'btn-ghost'}`} onClick={() => setSort('recent')}>
                Newest
              </button>
            </div>
          }
        />
        <p className="tiny faint">
          Approved jobs are tailored and queued on the agent's next run; the extension then applies to the ones with web forms.
        </p>
      </div>

      {error && <Notice tone="error">{error}</Notice>}
      {leads.isLoading && (
        <div className="row muted small">
          <Spinner /> Loading leads…
        </div>
      )}
      {leads.isError && <Notice tone="error">Couldn't load leads: {errorMessage(leads.error)}</Notice>}
      {leads.data && items.length === 0 && (
        <EmptyState title="You're all caught up">
          <p className="small">New matches appear here after the agent runs.</p>
        </EmptyState>
      )}

      <div className="list">
        {items.map((lead) => (
          <LeadCard key={lead.id} lead={lead} pending={pendingId === lead.id} onDecide={(d) => onDecide(lead.id, d)} />
        ))}
      </div>

      {leads.data?.pagination.has_next && (
        <button className="btn btn-ghost btn-full" disabled={leads.isFetching} onClick={() => setLimit((n) => Math.min(100, n + PAGE))}>
          {leads.isFetching ? 'Loading…' : 'Load more'}
        </button>
      )}
      <p className="center small">
        <ExternalLink href={DASHBOARD_LINKS.review}>Review in the dashboard</ExternalLink>
      </p>
    </div>
  )
}
