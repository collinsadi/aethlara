import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Building2, Globe2, Sparkles } from 'lucide-react'
import { ToggleRow } from '@/components/agent/settings/Field'
import { SettingsSection } from '@/components/agent/settings/SettingsSection'
import { ErrorState } from '@/components/ErrorState'
import { Skeleton } from '@/components/ui/skeleton'
import { Switch } from '@/components/ui/switch'
import { useAgentSources, useUpdateAgentProfile } from '@/hooks/useAgent'
import { useDraft } from '@/hooks/useDraft'
import type { AgentProfile, AgentSource, SourceKind } from '@/lib/agentTypes'
import { friendlyErrorMessage } from '@/lib/apiError'
import { ui } from '@/lib/styles'
import { toast } from '@/lib/toast'

const GROUPS: { kind: SourceKind; title: string; icon: typeof Building2; hint: string }[] = [
  { kind: 'ats', title: 'Company career pages', icon: Building2, hint: 'Searches the companies in your watchlist.' },
  { kind: 'board', title: 'Job boards', icon: Globe2, hint: 'Public remote and regional job boards.' },
  { kind: 'ai', title: 'AI search', icon: Sparkles, hint: 'Lets Claude look beyond the boards.' },
]

interface Props {
  profile: AgentProfile
  webSearchAvailable: boolean
}

export function SourcesSection({ profile, webSearchAvailable }: Props) {
  const catalog = useAgentSources()
  const { draft, setDraft, dirty, reset } = useDraft(profile.search_prefs.sources)
  const update = useUpdateAgentProfile()
  const [saved, setSaved] = useState(false)
  const watchCount = (ats: string) => profile.search_prefs.watchlist.filter((c) => c.ats === ats).length

  const save = () =>
    update.mutate(
      { search_prefs: { ...profile.search_prefs, sources: draft } },
      {
        onSuccess: (p) => {
          setDraft(p.search_prefs.sources)
          setSaved(true)
          toast.success('Sources saved')
        },
      }
    )

  const renderSource = (source: AgentSource) => {
    const isWeb = source.id === 'web_search'
    const disabled = isWeb && !webSearchAvailable
    const checked = !disabled && !!draft[source.id]
    return (
      <li key={source.id} className="py-3 first:pt-0 last:pb-0">
        <ToggleRow
          title={source.label}
          description={
            <>
              {source.description}
              {source.kind === 'ats' && (
                <span className="block">
                  {watchCount(source.id) > 0
                    ? `${watchCount(source.id)} ${watchCount(source.id) === 1 ? 'company' : 'companies'} in your watchlist.`
                    : `No ${source.label} companies in your watchlist yet.`}
                </span>
              )}
              {disabled && (
                <span className="block text-warning">
                  Needs Anthropic as your active AI provider.{' '}
                  <Link to="/settings#ai" className={ui.link}>
                    Switch provider
                  </Link>
                </span>
              )}
            </>
          }
          control={
            <Switch
              checked={checked}
              disabled={disabled}
              onCheckedChange={(on) => setDraft({ ...draft, [source.id]: on })}
              aria-label={`Search ${source.label}`}
            />
          }
        />
      </li>
    )
  }

  return (
    <SettingsSection
      id="sources"
      title="Where to search"
      description="Turn sources on or off. Every run checks the enabled ones, removes duplicates and scores what's left."
      footer={{
        dirty,
        saving: update.isPending,
        error: update.isError ? friendlyErrorMessage(update.error) : null,
        saved: saved && !dirty,
        onSave: save,
        onReset: () => {
          reset()
          update.reset()
        },
      }}
    >
      {catalog.isLoading ? (
        <div className="space-y-3" aria-busy="true">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-10 w-full" />
          ))}
        </div>
      ) : catalog.isError ? (
        <ErrorState compact error={catalog.error} title="Couldn't load sources" onRetry={() => catalog.refetch()} />
      ) : (
        <div className="grid gap-4 lg:grid-cols-3">
          {GROUPS.map((group) => {
            const sources = (catalog.data?.sources ?? []).filter((s) => s.kind === group.kind)
            if (sources.length === 0) return null
            return (
              <fieldset key={group.kind} className="rounded-xl border border-border p-4">
                <legend className="flex items-center gap-1.5 px-1 text-xs font-semibold text-foreground">
                  <group.icon className="size-3.5 text-brand" aria-hidden />
                  {group.title}
                </legend>
                <p className="mb-3 text-xs text-muted-foreground">{group.hint}</p>
                <ul className="divide-y divide-border">{sources.map(renderSource)}</ul>
              </fieldset>
            )
          })}
        </div>
      )}
    </SettingsSection>
  )
}
