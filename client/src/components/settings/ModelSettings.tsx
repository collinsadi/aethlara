import { useState } from 'react'
import { Loader2 } from 'lucide-react'
import type { AISettings } from '@/api/settings'
import { useUpdateAISettings } from '@/hooks/useAISettings'
import { useDraft } from '@/hooks/useDraft'
import { friendlyErrorMessage } from '@/lib/apiError'
import { ui } from '@/lib/styles'
import { toast } from '@/lib/toast'
import { cn } from '@/lib/utils'

const MODEL_RE = /^[A-Za-z0-9._:/-]{1,100}$/
const CUSTOM = '__custom__'

interface SlotProps {
  id: string
  label: string
  description: string
  /** '' = server default */
  value: string
  suggested: string[]
  effective: string
  onChange: (value: string) => void
}

function ModelSlot({ id, label, description, value, suggested, effective, onChange }: SlotProps) {
  const isCustom = value !== '' && !suggested.includes(value)
  const [customMode, setCustomMode] = useState(isCustom)
  const showCustom = customMode || isCustom
  const invalid = showCustom && value !== '' && !MODEL_RE.test(value)

  return (
    <div className="space-y-2">
      <div>
        <label htmlFor={id} className="text-sm font-medium text-foreground">
          {label}
        </label>
        <p className="text-xs text-muted-foreground">{description}</p>
      </div>
      <select
        id={id}
        value={showCustom ? CUSTOM : value}
        onChange={(e) => {
          if (e.target.value === CUSTOM) {
            setCustomMode(true)
            return
          }
          setCustomMode(false)
          onChange(e.target.value)
        }}
        className={ui.select}
      >
        <option value="">Server default</option>
        {suggested.map((m) => (
          <option key={m} value={m}>
            {m}
          </option>
        ))}
        <option value={CUSTOM}>Custom model id…</option>
      </select>
      {showCustom && (
        <div>
          <input
            type="text"
            value={value}
            onChange={(e) => onChange(e.target.value.trim())}
            placeholder="provider/model-name"
            spellCheck={false}
            autoCapitalize="off"
            aria-label={`${label}: custom model id`}
            aria-invalid={invalid || undefined}
            className={cn(ui.input, 'font-mono text-[13px]', invalid && 'border-destructive')}
          />
          {invalid && (
            <p className={ui.fieldError}>Use letters, numbers and . _ : / - only (max 100 characters).</p>
          )}
        </div>
      )}
      <p className="text-xs text-muted-foreground">
        In use: <span className="font-mono text-foreground">{effective}</span>
        {value === '' && ' (default)'}
      </p>
    </div>
  )
}

/** Smart + fast model overrides for the ACTIVE provider. */
export function ModelSettings({ settings }: { settings: AISettings }) {
  const provider = settings.providers.find((p) => p.id === settings.provider)
  const { draft, setDraft, patch, dirty, reset } = useDraft({
    smart: settings.smart_model ?? '',
    fast: settings.fast_model ?? '',
  })
  const update = useUpdateAISettings()
  const invalid = [draft.smart, draft.fast].some((v) => v !== '' && !MODEL_RE.test(v))
  // Remount the pickers after save/discard so "custom" mode follows the value again.
  const [generation, setGeneration] = useState(0)
  const slotKey = `${settings.provider}-${generation}`

  const save = () =>
    update.mutate(
      { provider: settings.provider, smart_model: draft.smart, fast_model: draft.fast },
      {
        onSuccess: (s) => {
          setDraft({ smart: s.smart_model ?? '', fast: s.fast_model ?? '' })
          setGeneration((g) => g + 1)
          toast.success('Models saved', { description: `Smart: ${s.effective_smart_model} · Fast: ${s.effective_fast_model}` })
        },
      }
    )

  return (
    <div className="glass-card p-5">
      <h3 className="font-heading text-sm font-semibold text-foreground">Models for {provider?.label ?? settings.provider}</h3>
      <p className="mt-0.5 text-xs text-muted-foreground">
        Overrides reset when you switch provider (model ids are provider-specific).
      </p>
      <div className="mt-4 grid gap-5 md:grid-cols-2">
        <ModelSlot
          key={`smart-${slotKey}`}
          id="model-smart"
          label="Smart model"
          description="Tailoring, cover letters, form filling and chat."
          value={draft.smart}
          suggested={provider?.suggested_models ?? []}
          effective={settings.effective_smart_model}
          onChange={(smart) => patch({ smart })}
        />
        <ModelSlot
          key={`fast-${slotKey}`}
          id="model-fast"
          label="Fast model"
          description="Bulk lead scoring and inbox triage."
          value={draft.fast}
          suggested={provider?.suggested_models ?? []}
          effective={settings.effective_fast_model}
          onChange={(fast) => patch({ fast })}
        />
      </div>
      {update.isError && (
        <p role="alert" className="mt-4 text-xs text-destructive">
          {friendlyErrorMessage(update.error)}
        </p>
      )}
      {dirty && (
        <div className="mt-4 flex justify-end gap-2 border-t border-border pt-4">
          <button
            type="button"
            onClick={() => {
              reset()
              update.reset()
              setGeneration((g) => g + 1)
            }}
            disabled={update.isPending}
            className={ui.ghost}
          >
            Discard
          </button>
          <button type="button" onClick={save} disabled={update.isPending || invalid} className={ui.primarySm}>
            {update.isPending && <Loader2 className="size-3.5 animate-spin" aria-hidden />}
            Save models
          </button>
        </div>
      )}
    </div>
  )
}
