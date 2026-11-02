import { useEffect, useRef } from 'react'
import { Loader2 } from 'lucide-react'
import { LeadListItem } from '@/components/review/LeadListItem'
import { Skeleton } from '@/components/ui/skeleton'
import { useNow } from '@/hooks/useNow'
import type { Lead } from '@/lib/agentTypes'
import { ui } from '@/lib/styles'

interface Props {
  leads: Lead[]
  activeId: string | null
  checkedIds: Set<string>
  showStatus: boolean
  hasMore: boolean
  loadingMore: boolean
  onLoadMore: () => void
  onSelect: (lead: Lead) => void
  onCheck: (lead: Lead, checked: boolean, shiftKey: boolean) => void
  onCheckAll: (checked: boolean) => void
}

export function LeadList({
  leads,
  activeId,
  checkedIds,
  showStatus,
  hasMore,
  loadingMore,
  onLoadMore,
  onSelect,
  onCheck,
  onCheckAll,
}: Props) {
  const now = useNow()
  const itemRefs = useRef(new Map<string, HTMLLIElement>())
  const allChecked = leads.length > 0 && leads.every((l) => checkedIds.has(l.id))
  const someChecked = !allChecked && leads.some((l) => checkedIds.has(l.id))
  const selectAllRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (selectAllRef.current) selectAllRef.current.indeterminate = someChecked
  }, [someChecked])

  // Keep the keyboard cursor visible while triaging with J/K.
  useEffect(() => {
    if (!activeId) return
    itemRefs.current.get(activeId)?.scrollIntoView({ block: 'nearest' })
  }, [activeId])

  if (leads.length === 0) {
    return (
      <div className="glass-card flex flex-col items-center gap-3 px-6 py-10 text-center">
        <p className="text-sm text-muted-foreground">You've been through everything loaded so far.</p>
        {hasMore && (
          <button type="button" onClick={onLoadMore} disabled={loadingMore} className={ui.secondarySm}>
            {loadingMore && <Loader2 className="size-3.5 animate-spin" aria-hidden />}
            {loadingMore ? 'Loading…' : 'Load more jobs'}
          </button>
        )}
      </div>
    )
  }

  return (
    <div>
      <div className="flex items-center gap-3 px-3 pb-2">
        <input
          ref={selectAllRef}
          type="checkbox"
          checked={allChecked}
          onChange={(e) => onCheckAll(e.target.checked)}
          aria-label="Select all jobs in the list"
          className="size-4 cursor-pointer rounded accent-brand"
        />
        <span className="text-xs text-muted-foreground">
          {checkedIds.size > 0 ? `${checkedIds.size} selected` : 'Select all'}
        </span>
      </div>
      <ul className="space-y-1" aria-label="Jobs">
        {leads.map((lead) => (
          <LeadListItem
            key={lead.id}
            ref={(el) => {
              if (el) itemRefs.current.set(lead.id, el)
              else itemRefs.current.delete(lead.id)
            }}
            lead={lead}
            now={now}
            active={lead.id === activeId}
            checked={checkedIds.has(lead.id)}
            showStatus={showStatus}
            onSelect={() => onSelect(lead)}
            onCheckedChange={(checked, shiftKey) => onCheck(lead, checked, shiftKey)}
          />
        ))}
      </ul>
      {hasMore && (
        <div className="flex justify-center pt-3">
          <button type="button" onClick={onLoadMore} disabled={loadingMore} className={ui.outline}>
            {loadingMore && <Loader2 className="size-3.5 animate-spin" aria-hidden />}
            {loadingMore ? 'Loading…' : 'Load more jobs'}
          </button>
        </div>
      )}
    </div>
  )
}

export function LeadListSkeleton() {
  return (
    <ul className="space-y-1" aria-busy="true" aria-label="Loading jobs">
      {Array.from({ length: 7 }).map((_, i) => (
        <li key={i} className="flex items-start gap-3 px-3 py-3">
          <Skeleton className="mt-3 size-4 rounded" />
          <Skeleton className="size-10 rounded-full" />
          <div className="flex-1 space-y-2">
            <Skeleton className="h-3.5 w-4/5" />
            <Skeleton className="h-3 w-1/2" />
            <Skeleton className="h-3 w-2/3" />
          </div>
        </li>
      ))}
    </ul>
  )
}
