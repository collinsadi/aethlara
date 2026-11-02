import { useEffect, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { CheckCheck, Inbox as InboxIcon, Link2, Loader2, Play, SearchX, ThumbsUp, Trash2 } from 'lucide-react'
import { EmptyState } from '@/components/EmptyState'
import { ErrorState } from '@/components/ErrorState'
import { PageHeader } from '@/components/PageHeader'
import { AddJobDialog } from '@/components/review/AddJobDialog'
import { BulkActionBar } from '@/components/review/BulkActionBar'
import { LeadDetail, LeadDetailEmpty } from '@/components/review/LeadDetail'
import { LeadList, LeadListSkeleton } from '@/components/review/LeadList'
import { ReviewFilters, type ReviewFilterValues } from '@/components/review/ReviewFilters'
import { ReviewTabs } from '@/components/review/ReviewTabs'
import { ShortcutLegend, type Shortcut } from '@/components/review/ShortcutLegend'
import { useAgentOverview, useAgentSources, useStartRun } from '@/hooks/useAgent'
import { useHotkeys } from '@/hooks/useHotkeys'
import { prefetchLead, useLead, useLeadDecision, useLeadList } from '@/hooks/useLeads'
import type { Lead, LeadDecision } from '@/lib/agentTypes'
import { pluralize, safeHref } from '@/lib/agentFormat'
import { errorAction, friendlyErrorMessage } from '@/lib/apiError'
import { queryKeys, type LeadFilters } from '@/lib/queryKeys'
import { ui } from '@/lib/styles'
import { toast } from '@/lib/toast'
import { cn } from '@/lib/utils'

type TabKey = 'new' | 'approved' | 'dismissed'

const TAB_STATUS: Record<TabKey, string> = {
  new: 'new',
  approved: 'approved,applying,applied,failed',
  dismissed: 'dismissed,expired',
}

function parseTab(raw: string | null): TabKey {
  return raw === 'approved' || raw === 'dismissed' ? raw : 'new'
}

interface UndoEntry {
  id: number
  leads: Lead[]
  decision: LeadDecision
  toastId?: string
}

const canApprove = (l: Lead) => l.status === 'new' || l.status === 'dismissed' || l.status === 'expired'
const canDismiss = (l: Lead) => ['new', 'approved', 'applying', 'failed'].includes(l.status)
const canRestore = (l: Lead) => l.status === 'dismissed' || l.status === 'expired'

let undoSeq = 0

/** /review — fast triage of the leads the agent found. */
export function Review() {
  const qc = useQueryClient()
  const [params, setParams] = useSearchParams()
  const tab = parseTab(params.get('tab'))
  const selectedParam = params.get('lead')
  const filters: ReviewFilterValues = {
    minScore: params.get('min') ? Number(params.get('min')) : null,
    remote: params.get('remote') === '1',
    source: params.get('source') ?? '',
    sort: params.get('sort') === 'recent' ? 'recent' : 'score',
  }
  const search = params.get('q') ?? ''
  const [searchInput, setSearchInput] = useState(search)
  // Follow back/forward navigation that changes ?q= underneath the input.
  const [syncedSearch, setSyncedSearch] = useState(search)
  if (search !== syncedSearch) {
    setSyncedSearch(search)
    setSearchInput(search)
  }

  const leadFilters: LeadFilters = {
    status: TAB_STATUS[tab],
    sort: filters.sort,
    ...(filters.minScore !== null ? { min_score: filters.minScore } : {}),
    ...(filters.source ? { source: filters.source } : {}),
    ...(filters.remote ? { remote: true } : {}),
    ...(search ? { search } : {}),
  }

  const overview = useAgentOverview()
  const sources = useAgentSources()
  const list = useLeadList(leadFilters)
  const decision = useLeadDecision()
  const startRun = useStartRun()

  /** Leads decided in this session, keyed by the tab they were hidden from. */
  const [hiddenIn, setHiddenIn] = useState<Record<string, TabKey>>({})
  const [checked, setChecked] = useState<Set<string>>(() => new Set())
  const [anchorId, setAnchorId] = useState<string | null>(null)
  const [mobileOpen, setMobileOpen] = useState(false)
  const [addOpen, setAddOpen] = useState(false)
  const [bulkBusy, setBulkBusy] = useState(false)
  const [undoStack, setUndoStack] = useState<UndoEntry[]>([])
  const [lastDecisionAt, setLastDecisionAt] = useState(0)

  // Debounce the search box into the URL.
  useEffect(() => {
    if (searchInput === search) return
    const t = setTimeout(() => {
      setParams(
        (prev) => {
          const next = new URLSearchParams(prev)
          if (searchInput.trim()) next.set('q', searchInput.trim())
          else next.delete('q')
          next.delete('lead')
          return next
        },
        { replace: true }
      )
    }, 300)
    return () => clearTimeout(t)
  }, [searchInput, search, setParams])

  // ── Derived list state ─────────────────────────────────────────────────────
  const seen = new Set<string>()
  const loaded: Lead[] = []
  for (const page of list.data?.pages ?? []) {
    for (const lead of page.items) {
      if (seen.has(lead.id)) continue
      seen.add(lead.id)
      loaded.push(lead)
    }
  }
  const visible = loaded.filter((l) => hiddenIn[l.id] !== tab)
  const total = list.data?.pages[0]?.pagination.total_items ?? 0
  const hiddenHere = loaded.length - visible.length
  const remaining = Math.max(0, total - hiddenHere)
  // Decisions since the last full fetch shift server-side offsets, so the
  // next page must be fetched against a refreshed list (see loadMore).
  const dirty = lastDecisionAt > list.dataUpdatedAt
  const hasMore = !!list.hasNextPage

  const activeId = selectedParam ?? visible[0]?.id ?? null
  const activeFromList = visible.find((l) => l.id === activeId) ?? null
  const activeDetail = useLead(activeId)
  const activeLead = activeFromList ?? activeDetail.data?.lead ?? null
  const activeIndex = activeFromList ? visible.indexOf(activeFromList) : -1

  // Warm the next lead so J feels instant.
  const nextId = activeIndex >= 0 ? visible[activeIndex + 1]?.id : undefined
  useEffect(() => {
    if (nextId) void prefetchLead(qc, nextId)
  }, [nextId, qc])

  // Each lead opens at the top of the detail pane.
  const detailRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    detailRef.current?.scrollTo({ top: 0 })
  }, [activeId])

  const counts = overview.data?.counts.leads
  const tabs = [
    { id: 'new', label: 'To review', count: counts?.new },
    {
      id: 'approved',
      label: 'Approved',
      count: counts ? (counts.approved ?? 0) + (counts.applying ?? 0) + (counts.applied ?? 0) + (counts.failed ?? 0) : undefined,
    },
    { id: 'dismissed', label: 'Dismissed', count: counts ? (counts.dismissed ?? 0) + (counts.expired ?? 0) : undefined },
  ]

  // ── URL helpers ────────────────────────────────────────────────────────────
  // Read the live URL rather than a captured `prev`: undo callbacks run from
  // toasts long after the render that created them.
  const setLead = (id: string | null) => {
    const next = new URLSearchParams(window.location.search)
    if (id) next.set('lead', id)
    else next.delete('lead')
    setParams(next, { replace: true })
  }

  const updateParams = (mutate: (next: URLSearchParams) => void) => {
    const next = new URLSearchParams(window.location.search)
    mutate(next)
    next.delete('lead')
    setParams(next)
    setChecked(new Set())
  }

  const setTab = (id: string) => updateParams((n) => (id === 'new' ? n.delete('tab') : n.set('tab', id)))

  const setFilters = (patch: Partial<ReviewFilterValues>) =>
    updateParams((n) => {
      const merged = { ...filters, ...patch }
      if (merged.minScore !== null) n.set('min', String(merged.minScore))
      else n.delete('min')
      if (merged.remote) n.set('remote', '1')
      else n.delete('remote')
      if (merged.source) n.set('source', merged.source)
      else n.delete('source')
      if (merged.sort === 'recent') n.set('sort', 'recent')
      else n.delete('sort')
    })

  const clearFilters = () => {
    setSearchInput('')
    updateParams((n) => {
      for (const key of ['min', 'remote', 'source', 'sort', 'q']) n.delete(key)
    })
  }

  // ── Decisions (optimistic) ─────────────────────────────────────────────────
  const hide = (ids: string[], where: TabKey) =>
    setHiddenIn((prev) => {
      const next = { ...prev }
      for (const id of ids) next[id] = where
      return next
    })
  const unhide = (ids: string[]) =>
    setHiddenIn((prev) => {
      const next = { ...prev }
      for (const id of ids) delete next[id]
      return next
    })

  const neighbourOf = (removed: Set<string>): string | null => {
    if (activeIndex < 0) return activeId && !removed.has(activeId) ? activeId : null
    for (let i = activeIndex + 1; i < visible.length; i++) if (!removed.has(visible[i].id)) return visible[i].id
    for (let i = activeIndex - 1; i >= 0; i--) if (!removed.has(visible[i].id)) return visible[i].id
    return null
  }

  const runUndo = async (entry: UndoEntry) => {
    setUndoStack((prev) => prev.filter((e) => e.id !== entry.id))
    if (entry.toastId) toast.dismiss(entry.toastId)
    const ids = entry.leads.map((l) => l.id)
    unhide(ids)
    setLead(ids[0])
    const steps: LeadDecision[] =
      entry.decision === 'approve' ? ['dismiss', 'reset'] : entry.decision === 'dismiss' ? ['reset'] : ['dismiss']
    try {
      for (const step of steps) {
        const outcome = await decision.mutateAsync({ ids, decision: step })
        if (outcome.failed.length) throw new Error(outcome.failed[0].error)
      }
      toast.info(ids.length === 1 ? 'Undone' : `Undid ${ids.length} decisions`)
    } catch (err) {
      toast.error("Couldn't undo that", { description: friendlyErrorMessage(err) })
    } finally {
      // Bring the list back in line with the server (the lead may need to reappear).
      qc.invalidateQueries({ queryKey: queryKeys.agent.leadLists() })
    }
  }

  const announce = (leads: Lead[], kind: LeadDecision) => {
    const entry: UndoEntry = { id: ++undoSeq, leads, decision: kind }
    const one = leads.length === 1 ? leads[0] : null
    const what = one ? one.title : pluralize(leads.length, 'job')
    let title = `Dismissed ${what}`
    let description: string | undefined
    if (kind === 'approve') {
      title = `Approved ${what}`
      description =
        one?.apply_channel === 'email' && one.apply_email
          ? `The next run emails your resume to ${one.apply_email}.`
          : 'Queued — the agent applies on its next run.'
    } else if (kind === 'reset') {
      title = one ? `${one.title} is back in review` : `${what} back in review`
    }
    entry.toastId = toast.success(title, {
      description,
      action: { label: 'Undo', onClick: () => void runUndo(entry) },
    })
    setUndoStack((prev) => [...prev.slice(-9), entry])
  }

  const decide = async (leads: Lead[], kind: LeadDecision, opts: { bulk?: boolean } = {}) => {
    if (leads.length === 0) return
    const ids = leads.map((l) => l.id)
    const idSet = new Set(ids)
    if (activeId && idSet.has(activeId)) setLead(neighbourOf(idSet))
    hide(ids, tab)
    setChecked((prev) => {
      const next = new Set(prev)
      for (const id of ids) next.delete(id)
      return next
    })
    setLastDecisionAt(Date.now())
    if (opts.bulk) setBulkBusy(true)
    try {
      const outcome = await decision.mutateAsync({ ids, decision: kind })
      if (outcome.failed.length) {
        unhide(outcome.failed.map((f) => f.id))
        const first = leads.find((l) => l.id === outcome.failed[0].id)
        toast.error(
          outcome.failed.length === 1
            ? `Couldn't update ${first?.title ?? 'that job'}`
            : `${outcome.failed.length} jobs couldn't be updated`,
          { description: outcome.failed[0].error }
        )
      }
      const done = leads.filter((l) => outcome.ok.includes(l.id))
      if (done.length) announce(done, kind)
    } catch (err) {
      unhide(ids)
      const action = errorAction(err)
      toast.error("Couldn't save your decision", {
        description: friendlyErrorMessage(err),
        link: action ? { label: action.label, to: action.path } : undefined,
      })
    } finally {
      if (opts.bulk) setBulkBusy(false)
    }
  }

  // ── Navigation ─────────────────────────────────────────────────────────────
  const loadMore = async () => {
    if (dirty) {
      const res = await list.refetch()
      const pages = res.data?.pages ?? []
      if (pages[pages.length - 1]?.pagination.has_next) await list.fetchNextPage()
      return
    }
    await list.fetchNextPage()
  }

  const move = (delta: 1 | -1) => {
    if (visible.length === 0) return
    if (activeIndex < 0) {
      setLead(visible[0].id)
      return
    }
    const target = activeIndex + delta
    if (target >= visible.length) {
      if (hasMore && !list.isFetchingNextPage) void loadMore()
      return
    }
    if (target < 0) return
    setLead(visible[target].id)
  }

  const openPosting = () => {
    const href = safeHref(activeLead?.url)
    if (href) window.open(href, '_blank', 'noopener,noreferrer')
  }

  useHotkeys(
    {
      j: () => move(1),
      k: () => move(-1),
      a: () => activeLead && canApprove(activeLead) && void decide([activeLead], 'approve'),
      x: () => activeLead && canDismiss(activeLead) && void decide([activeLead], 'dismiss'),
      r: () => activeLead && canRestore(activeLead) && void decide([activeLead], 'reset'),
      o: openPosting,
      u: () => {
        const last = undoStack[undoStack.length - 1]
        if (last) void runUndo(last)
      },
      Escape: () => {
        if (checked.size) setChecked(new Set())
        else setMobileOpen(false)
      },
    },
    !addOpen
  )

  // ── Selection ──────────────────────────────────────────────────────────────
  const onCheck = (lead: Lead, isChecked: boolean, shiftKey: boolean) => {
    setChecked((prev) => {
      const next = new Set(prev)
      const a = anchorId ? visible.findIndex((l) => l.id === anchorId) : -1
      const b = visible.findIndex((l) => l.id === lead.id)
      if (shiftKey && a !== -1 && b !== -1) {
        const [start, end] = a < b ? [a, b] : [b, a]
        for (let i = start; i <= end; i++) {
          if (isChecked) next.add(visible[i].id)
          else next.delete(visible[i].id)
        }
      } else if (isChecked) {
        next.add(lead.id)
      } else {
        next.delete(lead.id)
      }
      return next
    })
    setAnchorId(lead.id)
  }

  const onCheckAll = (isChecked: boolean) => setChecked(isChecked ? new Set(visible.map((l) => l.id)) : new Set())

  const checkedLeads = visible.filter((l) => checked.has(l.id))

  const shortcuts: Shortcut[] = [
    { keys: ['J', 'K'], label: 'next / previous' },
    ...(tab === 'dismissed'
      ? [
          { keys: ['A'], label: 'approve' },
          { keys: ['R'], label: 'back to review' },
        ]
      : tab === 'new'
        ? [
            { keys: ['A'], label: 'approve' },
            { keys: ['X'], label: 'dismiss' },
          ]
        : [{ keys: ['X'], label: 'cancel & dismiss' }]),
    { keys: ['O'], label: 'open posting' },
    { keys: ['U'], label: 'undo' },
  ]

  const filtersActive = filters.minScore !== null || filters.remote || !!filters.source || !!search
  const running = !!overview.data?.running_run
  const coverLetters = overview.data?.profile.apply_settings.cover_letters ?? true

  // ── Render ─────────────────────────────────────────────────────────────────
  const renderEmpty = () => {
    if (filtersActive) {
      return (
        <EmptyState
          compact
          icon={SearchX}
          title="No jobs match these filters"
          description="Try a lower minimum score, another source, or clear the filters."
          action={
            <button type="button" onClick={clearFilters} className={ui.secondarySm}>
              Clear filters
            </button>
          }
        />
      )
    }
    if (tab === 'approved') {
      return (
        <EmptyState
          compact
          icon={ThumbsUp}
          title="Nothing approved yet"
          description="Approve jobs in To review and the agent applies to them on its next run."
          action={
            <button type="button" onClick={() => setTab('new')} className={ui.secondarySm}>
              Go to To review
            </button>
          }
        />
      )
    }
    if (tab === 'dismissed') {
      return (
        <EmptyState
          compact
          icon={Trash2}
          title="Nothing dismissed"
          description="Jobs you pass on — and ones the agent drops for a low score or a deal-breaker — land here, so nothing is lost."
        />
      )
    }
    const setup = overview.data?.setup
    const needsSetup = setup && (!setup.has_ai_key || !setup.has_resume || !setup.has_preferences)
    if (needsSetup) {
      return (
        <EmptyState
          compact
          icon={InboxIcon}
          title="Nothing to review yet"
          description="Finish setting up your autopilot so it can start searching job boards for you."
          action={
            <Link to="/agent" className={ui.primarySm}>
              Finish setup
            </Link>
          }
        />
      )
    }
    return (
      <EmptyState
        compact
        icon={CheckCheck}
        title={running ? 'Searching for new jobs…' : "You're all caught up"}
        description={
          running
            ? 'The agent is running right now — new matches appear here as soon as it finishes.'
            : 'New matches show up here after each run. Run it now, or add a job you found yourself.'
        }
        action={
          <>
            {!running && (
              <button
                type="button"
                onClick={() =>
                  startRun.mutate(undefined, {
                    onError: (err) => toast.error("Couldn't start a run", { description: friendlyErrorMessage(err) }),
                  })
                }
                disabled={startRun.isPending}
                className={ui.primarySm}
              >
                {startRun.isPending ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : <Play className="size-3.5" aria-hidden />}
                Run now
              </button>
            )}
            <button type="button" onClick={() => setAddOpen(true)} className={ui.secondarySm}>
              <Link2 className="size-3.5" aria-hidden />
              Add a job by URL
            </button>
          </>
        }
      />
    )
  }

  // Nothing to triage (or the list failed): show the state full width, no panes.
  const standalone = !list.isLoading && (list.isError || (visible.length === 0 && !hasMore))

  const listBody = list.isLoading ? (
    <LeadListSkeleton />
  ) : (
    <LeadList
      leads={visible}
      activeId={activeFromList ? activeId : null}
      checkedIds={checked}
      showStatus={tab !== 'new'}
      hasMore={hasMore}
      loadingMore={list.isFetchingNextPage || (dirty && list.isRefetching)}
      onLoadMore={() => void loadMore()}
      onSelect={(lead) => {
        setLead(lead.id)
        setMobileOpen(true)
        if (window.matchMedia('(max-width: 1023px)').matches) {
          requestAnimationFrame(() => detailRef.current?.scrollIntoView({ block: 'start' }))
        }
      }}
      onCheck={onCheck}
      onCheckAll={onCheckAll}
    />
  )

  return (
    <div className="space-y-5">
      <PageHeader
        title="Review"
        description={
          list.isLoading || list.isError
            ? ' '
            : tab === 'new'
              ? `${pluralize(remaining, 'job')} waiting for your decision. Approve the ones worth applying to — the agent applies on its next run.`
              : tab === 'approved'
                ? 'Jobs you approved, and where each application stands.'
                : 'Dismissed and expired jobs. Bring any of them back to review.'
        }
        actions={
          <button type="button" onClick={() => setAddOpen(true)} className={ui.secondary}>
            <Link2 className="size-4" aria-hidden />
            Add a job by URL
          </button>
        }
      />

      <ReviewTabs tabs={tabs} value={tab} onChange={setTab} panelId="review-panel" />

      <ReviewFilters
        values={filters}
        search={searchInput}
        onSearchChange={setSearchInput}
        onChange={setFilters}
        onClear={clearFilters}
        sources={sources.data?.sources ?? []}
      />

      {standalone ? (
        <div id="review-panel" role="tabpanel" aria-labelledby={`review-tab-${tab}`} className="glass-card">
          {list.isError ? (
            <ErrorState error={list.error} title="Couldn't load jobs" onRetry={() => list.refetch()} retrying={list.isRefetching} />
          ) : (
            renderEmpty()
          )}
        </div>
      ) : (
        <div
          id="review-panel"
          role="tabpanel"
          aria-labelledby={`review-tab-${tab}`}
          className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,26rem)_minmax(0,1fr)]"
        >
          <div
            className={cn(
              'min-w-0 space-y-3 transition-opacity',
              list.isPlaceholderData && 'pointer-events-none opacity-60',
              mobileOpen && activeId && 'hidden lg:block'
            )}
            aria-busy={list.isPlaceholderData || undefined}
          >
            <ShortcutLegend shortcuts={shortcuts} />
            {listBody}
            <BulkActionBar
              count={checkedLeads.length}
              busy={bulkBusy}
              canApprove={tab !== 'approved' && checkedLeads.some(canApprove)}
              canDismiss={tab !== 'dismissed' && checkedLeads.some(canDismiss)}
              canRestore={tab === 'dismissed' && checkedLeads.some(canRestore)}
              onApprove={() => void decide(checkedLeads.filter(canApprove), 'approve', { bulk: true })}
              onDismiss={() => void decide(checkedLeads.filter(canDismiss), 'dismiss', { bulk: true })}
              onRestore={() => void decide(checkedLeads.filter(canRestore), 'reset', { bulk: true })}
              onClear={() => setChecked(new Set())}
            />
          </div>

          <div
            ref={detailRef}
            className={cn(
              'glass-card min-w-0 scroll-mt-20 lg:sticky lg:top-20 lg:max-h-[calc(100dvh-6.5rem)] lg:overflow-y-auto',
              !(mobileOpen && activeId) && 'hidden lg:block'
            )}
          >
            {activeId ? (
              <LeadDetail
                key={activeId}
                leadId={activeId}
                fallback={activeFromList}
                coverLetters={coverLetters}
                onApprove={(lead) => void decide([lead], 'approve')}
                onDismiss={(lead) => void decide([lead], 'dismiss')}
                onRestore={(lead) => void decide([lead], 'reset')}
                onBack={() => setMobileOpen(false)}
              />
            ) : (
              <LeadDetailEmpty tab={tab} />
            )}
          </div>
        </div>
      )}

      <AddJobDialog
        open={addOpen}
        onOpenChange={setAddOpen}
        onAdded={(lead, approved) => {
          const targetTab: TabKey = lead.status === 'new' ? 'new' : lead.status === 'dismissed' || lead.status === 'expired' ? 'dismissed' : 'approved'
          toast.success(approved ? `Added and approved ${lead.title}` : `Added ${lead.title}`, {
            description: approved
              ? `${lead.company} · the agent applies on its next run.`
              : `${lead.company} · scored ${lead.match?.score ?? '—'}/100.`,
          })
          const next = new URLSearchParams(window.location.search)
          if (targetTab === 'new') next.delete('tab')
          else next.set('tab', targetTab)
          next.set('lead', lead.id)
          setParams(next)
          setMobileOpen(true)
        }}
      />
    </div>
  )
}
