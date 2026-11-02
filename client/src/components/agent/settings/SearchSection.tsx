import { useState } from 'react'
import { AlertTriangle } from 'lucide-react'
import { ChoiceChips, Field, ToggleRow } from '@/components/agent/settings/Field'
import { SettingsSection } from '@/components/agent/settings/SettingsSection'
import { Switch } from '@/components/ui/switch'
import { TagInput } from '@/components/ui/tag-input'
import { useUpdateAgentProfile } from '@/hooks/useAgent'
import { useDraft } from '@/hooks/useDraft'
import type { AgentProfile } from '@/lib/agentTypes'
import { EMPLOYMENT_TYPE_OPTIONS, SENIORITY_OPTIONS } from '@/lib/agentFormat'
import { CURRENCIES, LIMITS, pickSearch, validateSearch } from '@/lib/agentSettings'
import { friendlyErrorMessage } from '@/lib/apiError'
import { ui } from '@/lib/styles'
import { toast } from '@/lib/toast'
import { cn } from '@/lib/utils'

function toNumber(value: string): number {
  return value.trim() === '' ? Number.NaN : Number(value)
}

export function SearchSection({ profile }: { profile: AgentProfile }) {
  const { draft, setDraft, patch, dirty, reset } = useDraft(pickSearch(profile.search_prefs))
  const update = useUpdateAgentProfile()
  const [saved, setSaved] = useState(false)
  const errors = validateSearch(draft)
  const invalid = Object.keys(errors).length > 0
  const nothingToSearch = draft.titles.length === 0 && draft.keywords.length === 0
  const currencies = draft.salary_currency && !CURRENCIES.includes(draft.salary_currency.toUpperCase())
    ? [draft.salary_currency.toUpperCase(), ...CURRENCIES]
    : CURRENCIES

  const save = () =>
    update.mutate(
      {
        search_prefs: {
          ...profile.search_prefs,
          ...draft,
          salary_currency: draft.salary_currency.toUpperCase(),
        },
      },
      {
        onSuccess: (p) => {
          setDraft(pickSearch(p.search_prefs))
          setSaved(true)
          toast.success('Search preferences saved', { description: 'The next run uses them.' })
        },
      }
    )

  return (
    <SettingsSection
      id="search"
      title="What to look for"
      description="The agent searches with your titles and keywords, then drops postings that don't fit before scoring the rest against your resume."
      footer={{
        dirty,
        saving: update.isPending,
        invalid,
        error: update.isError ? friendlyErrorMessage(update.error) : null,
        saved: saved && !dirty,
        onSave: save,
        onReset: () => {
          reset()
          update.reset()
        },
      }}
    >
      {nothingToSearch && (
        <p role="note" className="flex items-start gap-2 rounded-xl border border-warning/30 bg-warning/[0.08] px-3.5 py-3 text-xs text-foreground">
          <AlertTriangle className="mt-px size-3.5 shrink-0 text-warning" aria-hidden />
          Add at least one job title or keyword — the agent can't search (or be switched on) without one.
        </p>
      )}

      <div className="grid gap-5 md:grid-cols-2">
        <Field id="search-titles" label="Job titles" hint={`Up to ${LIMITS.titles.items}. Press Enter or comma to add.`}>
          <TagInput
            id="search-titles"
            value={draft.titles}
            onChange={(titles) => patch({ titles })}
            maxItems={LIMITS.titles.items}
            maxLength={LIMITS.titles.length}
            placeholder="e.g. Backend Engineer"
            aria-describedby="search-titles-hint"
          />
        </Field>
        <Field id="search-keywords" label="Keywords" hint="Skills or tech the role should mention.">
          <TagInput
            id="search-keywords"
            value={draft.keywords}
            onChange={(keywords) => patch({ keywords })}
            maxItems={LIMITS.keywords.items}
            maxLength={LIMITS.keywords.length}
            placeholder="e.g. Go, PostgreSQL"
            aria-describedby="search-keywords-hint"
          />
        </Field>
        <Field id="search-exclude" label="Exclude keywords" hint="Postings mentioning any of these are skipped.">
          <TagInput
            id="search-exclude"
            value={draft.exclude_keywords}
            onChange={(exclude_keywords) => patch({ exclude_keywords })}
            maxItems={LIMITS.excludeKeywords.items}
            maxLength={LIMITS.excludeKeywords.length}
            placeholder="e.g. clearance"
            aria-describedby="search-exclude-hint"
          />
        </Field>
        <Field id="search-exclude-companies" label="Exclude companies" hint="Never apply to these.">
          <TagInput
            id="search-exclude-companies"
            value={draft.exclude_companies}
            onChange={(exclude_companies) => patch({ exclude_companies })}
            maxItems={LIMITS.excludeCompanies.items}
            maxLength={LIMITS.excludeCompanies.length}
            placeholder="e.g. Current employer"
            aria-describedby="search-exclude-companies-hint"
          />
        </Field>
      </div>

      <div className="rounded-xl border border-border p-4">
        <ToggleRow
          title="Remote only"
          description="Skip on-site and hybrid roles."
          control={
            <Switch
              checked={draft.remote_only}
              onCheckedChange={(remote_only) => patch({ remote_only })}
              aria-label="Remote only"
            />
          }
        />
        <div className={cn('mt-4', draft.remote_only && 'opacity-60')}>
          <Field
            id="search-locations"
            label="Locations"
            hint={
              draft.remote_only
                ? 'Ignored while Remote only is on.'
                : 'On-site and hybrid roles must be in one of these. Remote roles always pass.'
            }
          >
            <TagInput
              id="search-locations"
              value={draft.locations}
              onChange={(locations) => patch({ locations })}
              maxItems={LIMITS.locations.items}
              maxLength={LIMITS.locations.length}
              placeholder="e.g. Berlin, Germany"
              aria-describedby="search-locations-hint"
            />
          </Field>
        </div>
      </div>

      <div className="grid gap-5 md:grid-cols-2">
        <ChoiceChips
          legend="Seniority"
          options={SENIORITY_OPTIONS}
          value={draft.seniority}
          onChange={(seniority) => patch({ seniority })}
          hint="Leave empty for any level."
        />
        <ChoiceChips
          legend="Employment type"
          options={EMPLOYMENT_TYPE_OPTIONS}
          value={draft.employment_types}
          onChange={(employment_types) => patch({ employment_types })}
          hint="Leave empty for any type."
        />
      </div>

      <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
        <Field id="search-min-salary" label="Minimum salary" error={errors.min_salary} hint="Optional, yearly.">
          <input
            id="search-min-salary"
            type="number"
            inputMode="numeric"
            min={LIMITS.minSalary.min}
            max={LIMITS.minSalary.max}
            step={1000}
            value={draft.min_salary === null || Number.isNaN(draft.min_salary) ? '' : draft.min_salary}
            onChange={(e) => patch({ min_salary: e.target.value === '' ? null : toNumber(e.target.value) })}
            placeholder="e.g. 90000"
            aria-invalid={!!errors.min_salary || undefined}
            aria-describedby={errors.min_salary ? 'search-min-salary-error' : 'search-min-salary-hint'}
            className={ui.input}
          />
        </Field>
        <Field id="search-currency" label="Currency" error={errors.salary_currency}>
          <select
            id="search-currency"
            value={draft.salary_currency.toUpperCase()}
            onChange={(e) => patch({ salary_currency: e.target.value })}
            className={ui.select}
          >
            <option value="">Any</option>
            {currencies.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </Field>
        <Field
          id="search-max-age"
          label="Max posting age (days)"
          error={errors.max_age_days}
          hint="0 means no limit."
        >
          <input
            id="search-max-age"
            type="number"
            inputMode="numeric"
            min={LIMITS.maxAgeDays.min}
            max={LIMITS.maxAgeDays.max}
            value={Number.isNaN(draft.max_age_days) ? '' : draft.max_age_days}
            onChange={(e) => patch({ max_age_days: toNumber(e.target.value) })}
            aria-invalid={!!errors.max_age_days || undefined}
            aria-describedby={errors.max_age_days ? 'search-max-age-error' : 'search-max-age-hint'}
            className={ui.input}
          />
        </Field>
        <Field id="search-min-score" label={`Minimum match score: ${Number.isNaN(draft.min_score) ? '—' : draft.min_score}`} error={errors.min_score} hint="Lower scores are auto-dismissed.">
          <input
            id="search-min-score"
            type="range"
            min={LIMITS.minScore.min}
            max={LIMITS.minScore.max}
            step={5}
            value={Number.isNaN(draft.min_score) ? 0 : draft.min_score}
            onChange={(e) => patch({ min_score: Number(e.target.value) })}
            aria-describedby="search-min-score-hint"
            className="mt-3 w-full accent-brand"
          />
        </Field>
      </div>
    </SettingsSection>
  )
}
