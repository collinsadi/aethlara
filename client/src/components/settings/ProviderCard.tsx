import { useState } from 'react'
import {
  CheckCircle2,
  Clock,
  ExternalLink,
  KeyRound,
  Loader2,
  RefreshCw,
  Sparkles,
  Trash2,
  XCircle,
} from 'lucide-react'
import type { AIProviderOption, ApiKeyMetadata } from '@/api/settings'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import { ProviderKeyForm } from '@/components/settings/ProviderKeyForm'
import { ToneBadge } from '@/components/ToneBadge'
import { useDeleteApiKey, useValidateApiKey } from '@/hooks/useApiKey'
import { useUpdateAISettings } from '@/hooks/useAISettings'
import { useNow } from '@/hooks/useNow'
import { formatDateTime, formatRelative } from '@/lib/agentFormat'
import { friendlyErrorMessage, hasErrorCode } from '@/lib/apiError'
import { ui } from '@/lib/styles'
import { toast } from '@/lib/toast'
import type { Tone } from '@/lib/tones'
import { cn } from '@/lib/utils'

const KEY_STATUS: Record<ApiKeyMetadata['validation_status'], { label: string; tone: Tone; icon: typeof CheckCircle2 }> = {
  valid: { label: 'Valid', tone: 'success', icon: CheckCircle2 },
  invalid: { label: 'Invalid', tone: 'danger', icon: XCircle },
  unvalidated: { label: 'Not validated', tone: 'warning', icon: Clock },
  revoked: { label: 'Revoked', tone: 'danger', icon: XCircle },
}

const PROVIDER_COPY: Record<string, { blurb: string; keysUrl: string }> = {
  anthropic: {
    blurb: 'Claude models through the official Anthropic API. Unlocks Claude web search, so the autopilot can find postings beyond the job boards.',
    keysUrl: 'https://console.anthropic.com/settings/keys',
  },
  openrouter: {
    blurb: 'One key for many models (including Claude) via OpenRouter. No web search for the autopilot.',
    keysUrl: 'https://openrouter.ai/keys',
  },
}

interface Props {
  provider: AIProviderOption
  apiKey: ApiKeyMetadata | null
  active: boolean
  /** The other provider, if it has a valid key (for delete copy). */
  fallbackLabel: string | null
}

export function ProviderCard({ provider, apiKey, active, fallbackLabel }: Props) {
  const now = useNow()
  const [formOpen, setFormOpen] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const validate = useValidateApiKey()
  const remove = useDeleteApiKey()
  const switchTo = useUpdateAISettings()
  const copy = PROVIDER_COPY[provider.id] ?? { blurb: '', keysUrl: '' }
  const status = apiKey ? KEY_STATUS[apiKey.validation_status] ?? KEY_STATUS.unvalidated : null
  const recommended = provider.id === 'anthropic'
  const canActivate = !active && apiKey?.validation_status === 'valid'

  const onValidate = () =>
    validate.mutate(provider.id, {
      onSuccess: (meta) =>
        meta.validation_status === 'valid'
          ? toast.success(`${provider.label} key is working`)
          : toast.error(`${provider.label} rejected the key`, { description: 'Replace it with a new key.' }),
      onError: (err) => toast.error("Couldn't check the key", { description: friendlyErrorMessage(err) }),
    })

  const onActivate = () =>
    switchTo.mutate(
      { provider: provider.id },
      {
        onSuccess: () => toast.success(`${provider.label} is now your active provider`),
        onError: (err) =>
          toast.error(`Couldn't switch to ${provider.label}`, {
            description: hasErrorCode(err, 'PROVIDER_KEY_REQUIRED')
              ? `Add a valid ${provider.label} key first.`
              : friendlyErrorMessage(err),
          }),
      }
    )

  const onDelete = () =>
    remove.mutate(provider.id, {
      onSuccess: () => {
        toast.success(`${provider.label} key removed`)
        setConfirmDelete(false)
      },
      onError: (err) => {
        toast.error("Couldn't remove the key", { description: friendlyErrorMessage(err) })
        setConfirmDelete(false)
      },
    })

  return (
    <div className={cn('glass-card flex flex-col p-5', active && 'border-brand/30')}>
      <div className="flex items-start gap-3">
        <div className="flex size-9 shrink-0 items-center justify-center rounded-xl border border-border bg-muted">
          <KeyRound className="size-4 text-muted-foreground" aria-hidden />
        </div>
        <div className="min-w-0">
          <h3 className="font-heading text-base font-semibold text-foreground">{provider.label}</h3>
          <div className="mt-1 flex flex-wrap gap-1.5">
            {active && <ToneBadge tone="brand">Active</ToneBadge>}
            {recommended && <ToneBadge tone="success">Recommended</ToneBadge>}
            {provider.supports_web_search && <ToneBadge tone="neutral" icon={Sparkles}>Web search</ToneBadge>}
          </div>
        </div>
      </div>

      <p className="mt-3 text-sm text-muted-foreground">
        {copy.blurb}{' '}
        {copy.keysUrl && (
          <a href={copy.keysUrl} target="_blank" rel="noopener noreferrer" className={cn(ui.link, 'inline-flex items-center gap-0.5')}>
            Get a key
            <ExternalLink className="size-3" aria-hidden />
            <span className="sr-only"> (opens {provider.label} in a new tab)</span>
          </a>
        )}
      </p>

      <div className="mt-4 flex-1">
        {apiKey && status ? (
          <div className="rounded-xl border border-border px-3.5 py-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="font-mono text-sm text-foreground">
                {apiKey.key_prefix}
                <span aria-hidden>••••••••</span>
                <span className="sr-only"> (rest hidden)</span>
              </span>
              <ToneBadge tone={status.tone} icon={status.icon}>
                {status.label}
              </ToneBadge>
            </div>
            <p className="mt-1.5 text-xs text-muted-foreground">
              {apiKey.label && <>{apiKey.label} · </>}
              {apiKey.last_used_at ? (
                <span title={formatDateTime(apiKey.last_used_at)}>Last used {formatRelative(apiKey.last_used_at, now)}</span>
              ) : (
                'Not used yet'
              )}
              {apiKey.last_validated_at && (
                <>
                  {' · '}
                  <span title={formatDateTime(apiKey.last_validated_at)}>
                    checked {formatRelative(apiKey.last_validated_at, now)}
                  </span>
                </>
              )}
            </p>
          </div>
        ) : (
          !formOpen && <p className="rounded-xl border border-dashed border-border px-3.5 py-3 text-sm text-muted-foreground">No key added.</p>
        )}

        {formOpen && (
          <div className="mt-3">
            <ProviderKeyForm provider={provider} replacing={!!apiKey} isActive={active} onDone={() => setFormOpen(false)} />
          </div>
        )}
      </div>

      {!formOpen && (
        <div className="mt-4 flex flex-wrap items-center gap-2">
          {canActivate && (
            <button type="button" onClick={onActivate} disabled={switchTo.isPending} className={ui.primarySm}>
              {switchTo.isPending && <Loader2 className="size-3.5 animate-spin" aria-hidden />}
              Use {provider.label}
            </button>
          )}
          <button
            type="button"
            onClick={() => setFormOpen(true)}
            className={apiKey ? ui.outline : ui.primarySm}
          >
            <KeyRound className="size-3.5" aria-hidden />
            {apiKey ? 'Replace key' : 'Add key'}
          </button>
          {apiKey && (
            <button type="button" onClick={onValidate} disabled={validate.isPending} className={ui.outline}>
              {validate.isPending ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : <RefreshCw className="size-3.5" aria-hidden />}
              {validate.isPending ? 'Checking…' : 'Re-validate'}
            </button>
          )}
          {apiKey && (
            <button
              type="button"
              onClick={() => setConfirmDelete(true)}
              className={cn(ui.ghost, 'hover:bg-destructive/10 hover:text-destructive')}
            >
              <Trash2 className="size-3.5" aria-hidden />
              Remove
            </button>
          )}
        </div>
      )}

      <ConfirmDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title={`Remove your ${provider.label} key?`}
        description={
          active
            ? fallbackLabel
              ? `It's deleted permanently. Aethlara switches to your ${fallbackLabel} key.`
              : "It's deleted permanently. AI features — including the autopilot — stop until you add a key."
            : "It's deleted permanently. You can add it again any time."
        }
        confirmLabel="Remove key"
        pendingLabel="Removing…"
        destructive
        pending={remove.isPending}
        onConfirm={onDelete}
      />
    </div>
  )
}
