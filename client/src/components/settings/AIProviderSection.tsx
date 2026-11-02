import { ShieldCheck } from 'lucide-react'
import { ErrorState } from '@/components/ErrorState'
import { ModelSettings } from '@/components/settings/ModelSettings'
import { ProviderCard } from '@/components/settings/ProviderCard'
import { Skeleton } from '@/components/ui/skeleton'
import { useAISettings } from '@/hooks/useAISettings'

/** Settings → AI provider (#ai). Anthropic or OpenRouter, bring your own key. */
export function AIProviderSection() {
  const { data, isLoading, isError, error, refetch, isRefetching } = useAISettings()

  // Recommended provider first.
  const providers = [...(data?.providers ?? [])].sort((a, b) =>
    a.id === 'anthropic' ? -1 : b.id === 'anthropic' ? 1 : 0
  )
  const activeKey = data?.keys.find((k) => k.provider === data.provider)
  const noUsableKey = !!data && activeKey?.validation_status !== 'valid'

  return (
    <div className="space-y-5">
      <div>
        <h2 className="font-heading text-base font-semibold text-foreground">AI provider</h2>
        <p className="mt-0.5 text-sm text-muted-foreground">
          Aethlara has no AI key of its own: every AI call — scoring, tailoring, cover letters, form filling, inbox
          triage — runs on your key for the <span className="font-medium text-foreground">active</span> provider.
        </p>
        <p className="mt-2 flex items-center gap-1.5 text-xs text-muted-foreground">
          <ShieldCheck className="size-3.5 text-success" aria-hidden />
          Keys are encrypted at rest and never shown again after saving.
        </p>
      </div>

      {isLoading ? (
        <div className="grid gap-4 md:grid-cols-2" aria-busy="true">
          <Skeleton className="h-60 rounded-2xl" />
          <Skeleton className="h-60 rounded-2xl" />
        </div>
      ) : isError || !data ? (
        <div className="glass-card">
          <ErrorState error={error} title="Couldn't load your AI settings" onRetry={() => refetch()} retrying={isRefetching} compact />
        </div>
      ) : (
        <>
          {noUsableKey && (
            <p role="status" className="rounded-xl border border-warning/30 bg-warning/[0.08] px-4 py-3 text-sm text-foreground">
              {activeKey
                ? `Your ${data.providers.find((p) => p.id === data.provider)?.label ?? 'active'} key isn't working. Re-validate or replace it — AI features are paused until then.`
                : 'Add a key to turn on AI features and the autopilot. Anthropic is recommended: it also lets the agent search the web.'}
            </p>
          )}
          <div className="grid gap-4 md:grid-cols-2">
            {providers.map((p) => {
              const other = data.providers.find((o) => o.id !== p.id)
              const otherValid = other && data.keys.some((k) => k.provider === other.id && k.validation_status === 'valid')
              return (
                <ProviderCard
                  key={p.id}
                  provider={p}
                  apiKey={data.keys.find((k) => k.provider === p.id) ?? null}
                  active={data.provider === p.id}
                  fallbackLabel={otherValid ? other!.label : null}
                />
              )
            })}
          </div>
          <ModelSettings settings={data} />
        </>
      )}
    </div>
  )
}
