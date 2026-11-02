import { useState } from 'react'
import { Building2, Plus, Sparkles, Trash2 } from 'lucide-react'
import { SettingsSection } from '@/components/agent/settings/SettingsSection'
import { EmptyState } from '@/components/EmptyState'
import { useAgentSources, useUpdateAgentProfile } from '@/hooks/useAgent'
import { useDraft } from '@/hooks/useDraft'
import type { AgentProfile, WatchlistAts, WatchlistCompany } from '@/lib/agentTypes'
import { WATCHLIST_ATS } from '@/lib/agentFormat'
import { LIMITS, validateWatchlistRow, watchlistKey } from '@/lib/agentSettings'
import { friendlyErrorMessage } from '@/lib/apiError'
import { ui } from '@/lib/styles'
import { toast } from '@/lib/toast'
import { cn } from '@/lib/utils'

export function WatchlistSection({ profile }: { profile: AgentProfile }) {
  const sources = useAgentSources()
  const { draft, setDraft, dirty, reset } = useDraft(profile.search_prefs.watchlist)
  const update = useUpdateAgentProfile()
  const [saved, setSaved] = useState(false)

  const rowErrors = draft.map(validateWatchlistRow)
  const keys = draft.map(watchlistKey)
  const duplicates = keys.map((k, i) => !!draft[i].slug.trim() && keys.indexOf(k) !== i)
  const invalid = rowErrors.some(Boolean) || duplicates.some(Boolean)
  const starter = sources.data?.starter_watchlist ?? []
  const missingStarters = starter.filter((c) => !keys.includes(watchlistKey(c)))
  const full = draft.length >= LIMITS.watchlist

  const setRow = (index: number, patch: Partial<WatchlistCompany>) =>
    setDraft(draft.map((row, i) => (i === index ? { ...row, ...patch } : row)))

  const addRow = () => setDraft([...draft, { ats: 'greenhouse', slug: '', name: '' }])

  const addStarters = () => {
    const room = LIMITS.watchlist - draft.length
    setDraft([...draft, ...missingStarters.slice(0, room)])
  }

  const save = () =>
    update.mutate(
      {
        search_prefs: {
          ...profile.search_prefs,
          watchlist: draft.map((c) => ({ ats: c.ats, slug: c.slug.trim(), name: c.name?.trim() || undefined })),
        },
      },
      {
        onSuccess: (p) => {
          setDraft(p.search_prefs.watchlist)
          setSaved(true)
          toast.success('Watchlist saved', { description: `${p.search_prefs.watchlist.length} companies.` })
        },
      }
    )

  return (
    <SettingsSection
      id="watchlist"
      title="Company watchlist"
      description={
        <>
          Companies whose Greenhouse, Lever or Ashby boards the agent checks every run. Find the slug in the board URL —
          e.g. <span className="font-mono text-xs text-foreground">boards.greenhouse.io/<b>stripe</b></span>,{' '}
          <span className="font-mono text-xs text-foreground">jobs.lever.co/<b>spotify</b></span>,{' '}
          <span className="font-mono text-xs text-foreground">jobs.ashbyhq.com/<b>openai</b></span>.
        </>
      }
      footer={{
        dirty,
        saving: update.isPending,
        invalid,
        error: update.isError ? friendlyErrorMessage(update.error) : invalid ? 'Fix the highlighted rows to save.' : null,
        saved: saved && !dirty,
        onSave: save,
        onReset: () => {
          reset()
          update.reset()
        },
      }}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-muted-foreground">
          {draft.length} of {LIMITS.watchlist} companies
        </p>
        <div className="flex flex-wrap gap-2">
          {missingStarters.length > 0 && (
            <button type="button" onClick={addStarters} disabled={full} className={ui.outline}>
              <Sparkles className="size-3.5" aria-hidden />
              Add {missingStarters.length} starter {missingStarters.length === 1 ? 'company' : 'companies'}
            </button>
          )}
          <button type="button" onClick={addRow} disabled={full} className={ui.outline}>
            <Plus className="size-3.5" aria-hidden />
            Add company
          </button>
        </div>
      </div>

      {draft.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border">
          <EmptyState
            compact
            icon={Building2}
            title="No companies yet"
            description="Add the companies you'd love to work at, or start with the starter list of companies that hire often."
          />
        </div>
      ) : (
        <div className="max-h-[26rem] overflow-auto rounded-xl border border-border">
          <table className="w-full min-w-[34rem] text-sm">
            <caption className="sr-only">Watchlist companies</caption>
            <thead className="sticky top-0 z-10 bg-card">
              <tr className="text-left text-xs text-muted-foreground">
                <th scope="col" className="w-44 px-3 py-2 font-medium">ATS</th>
                <th scope="col" className="py-2 pr-2 font-medium">Board slug</th>
                <th scope="col" className="py-2 pr-2 font-medium">Display name</th>
                <th scope="col" className="w-12 py-2"><span className="sr-only">Remove</span></th>
              </tr>
            </thead>
            <tbody>
              {draft.map((row, i) => {
                const error = rowErrors[i] ?? (duplicates[i] ? 'Already in the list.' : null)
                const errorId = `watch-${i}-error`
                return (
                  <tr key={i} className="border-t border-border align-top">
                    <td className="py-1.5 pl-3 pr-2">
                      <select
                        value={row.ats}
                        onChange={(e) => setRow(i, { ats: e.target.value as WatchlistAts })}
                        aria-label={`ATS for row ${i + 1}`}
                        className={cn(ui.select, 'h-9')}
                      >
                        {WATCHLIST_ATS.map((a) => (
                          <option key={a.id} value={a.id}>
                            {a.label}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="py-1.5 pr-2">
                      <input
                        type="text"
                        value={row.slug}
                        onChange={(e) => setRow(i, { slug: e.target.value })}
                        placeholder="stripe"
                        spellCheck={false}
                        autoCapitalize="off"
                        aria-label={`Board slug for row ${i + 1}`}
                        aria-invalid={!!error || undefined}
                        aria-describedby={error ? errorId : undefined}
                        className={cn(ui.input, 'h-9 font-mono text-[13px]', error && 'border-destructive')}
                      />
                      {error && (
                        <p id={errorId} className={ui.fieldError}>
                          {error}
                        </p>
                      )}
                    </td>
                    <td className="py-1.5 pr-2">
                      <input
                        type="text"
                        value={row.name ?? ''}
                        maxLength={100}
                        onChange={(e) => setRow(i, { name: e.target.value })}
                        placeholder="Stripe"
                        aria-label={`Display name for row ${i + 1}`}
                        className={cn(ui.input, 'h-9')}
                      />
                    </td>
                    <td className="py-1.5 pr-2">
                      <button
                        type="button"
                        onClick={() => setDraft(draft.filter((_, j) => j !== i))}
                        aria-label={`Remove ${row.name || row.slug || `row ${i + 1}`}`}
                        className={cn(ui.iconButton, 'hover:text-destructive')}
                      >
                        <Trash2 className="size-4" aria-hidden />
                      </button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </SettingsSection>
  )
}
