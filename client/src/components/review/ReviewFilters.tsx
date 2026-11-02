import { Globe, Search, X } from 'lucide-react'
import type { AgentSource } from '@/lib/agentTypes'
import { EXTRA_SOURCE_LABELS } from '@/lib/agentFormat'
import { ui } from '@/lib/styles'
import { cn } from '@/lib/utils'

export interface ReviewFilterValues {
  minScore: number | null
  remote: boolean
  source: string
  sort: 'score' | 'recent'
}

interface Props {
  values: ReviewFilterValues
  search: string
  onSearchChange: (value: string) => void
  onChange: (patch: Partial<ReviewFilterValues>) => void
  onClear: () => void
  sources: AgentSource[]
}

const MIN_SCORES = [50, 60, 70, 80, 90]

export function ReviewFilters({ values, search, onSearchChange, onChange, onClear, sources }: Props) {
  const active = values.minScore !== null || values.remote || values.source !== '' || search !== ''
  return (
    <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center" role="search" aria-label="Filter jobs">
      <div className="relative min-w-0 flex-1 sm:min-w-[14rem]">
        <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
        <input
          type="search"
          value={search}
          onChange={(e) => onSearchChange(e.target.value)}
          placeholder="Search title or company…"
          aria-label="Search jobs by title or company"
          className={cn(ui.input, 'pl-9 pr-3')}
        />
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <select
          value={values.minScore ?? ''}
          onChange={(e) => onChange({ minScore: e.target.value ? Number(e.target.value) : null })}
          aria-label="Minimum match score"
          className={cn(ui.select, 'w-auto')}
        >
          <option value="">Any score</option>
          {MIN_SCORES.map((s) => (
            <option key={s} value={s}>
              {s}+ match
            </option>
          ))}
        </select>
        <select
          value={values.source}
          onChange={(e) => onChange({ source: e.target.value })}
          aria-label="Source"
          className={cn(ui.select, 'w-auto max-w-[12rem]')}
        >
          <option value="">All sources</option>
          {sources.map((s) => (
            <option key={s.id} value={s.id}>
              {s.label}
            </option>
          ))}
          {Object.entries(EXTRA_SOURCE_LABELS).map(([id, label]) => (
            <option key={id} value={id}>
              {label}
            </option>
          ))}
        </select>
        <button
          type="button"
          aria-pressed={values.remote}
          onClick={() => onChange({ remote: !values.remote })}
          className={cn(ui.pill, 'h-10 px-3.5', values.remote ? ui.pillActive : ui.pillIdle)}
        >
          <Globe className="size-3.5" aria-hidden />
          Remote only
        </button>
        <div className="inline-flex h-10 items-center rounded-full border border-border bg-muted/40 p-1" role="group" aria-label="Sort">
          {(['score', 'recent'] as const).map((sort) => (
            <button
              key={sort}
              type="button"
              aria-pressed={values.sort === sort}
              onClick={() => onChange({ sort })}
              className={cn(
                'h-full rounded-full px-3 text-xs font-medium transition-colors focus-visible:outline-2 focus-visible:outline-brand',
                values.sort === sort ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'
              )}
            >
              {sort === 'score' ? 'Best match' : 'Newest'}
            </button>
          ))}
        </div>
        {active && (
          <button type="button" onClick={onClear} className={ui.ghost}>
            <X className="size-3.5" aria-hidden />
            Clear
          </button>
        )}
      </div>
    </div>
  )
}
