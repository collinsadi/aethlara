import { useState } from 'react'
import { Eye, EyeOff, Loader2 } from 'lucide-react'
import type { AIProviderOption } from '@/api/settings'
import { useSaveApiKey } from '@/hooks/useApiKey'
import { friendlyErrorMessage, hasErrorCode } from '@/lib/apiError'
import { ui } from '@/lib/styles'
import { toast } from '@/lib/toast'
import { cn } from '@/lib/utils'

interface Props {
  provider: AIProviderOption
  /** Replacing an existing key (changes copy only). */
  replacing: boolean
  /** Whether this provider is already the active one. */
  isActive: boolean
  onDone: () => void
}

/** Add or replace a provider key. The server validates it live before storing. */
export function ProviderKeyForm({ provider, replacing, isActive, onDone }: Props) {
  const save = useSaveApiKey()
  const [value, setValue] = useState('')
  const [label, setLabel] = useState('')
  const [show, setShow] = useState(false)
  const [makeActive, setMakeActive] = useState(true)
  const [fieldError, setFieldError] = useState<string | null>(null)
  const id = `key-${provider.id}`

  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    const key = value.trim()
    if (!key) return setFieldError('Paste your API key.')
    if (/\s/.test(key)) return setFieldError("Keys don't contain spaces — check you copied the whole key.")
    if (!key.startsWith(provider.key_prefix)) {
      return setFieldError(`${provider.label} keys start with ${provider.key_prefix}`)
    }
    if (key.length < 20 || key.length > 256) return setFieldError('That key looks too short or too long.')
    setFieldError(null)
    save.mutate(
      { apiKey: key, provider: provider.id, label: label.trim() || undefined, makeActive: isActive || makeActive },
      {
        onSuccess: () => {
          setValue('')
          toast.success(`${provider.label} key saved`, {
            description: isActive || makeActive ? `${provider.label} is now your active provider.` : 'Verified and stored encrypted.',
          })
          onDone()
        },
      }
    )
  }

  const serverError = save.isError
    ? hasErrorCode(save.error, 'INVALID_API_KEY')
      ? `${provider.label} rejected that key. Check it's active and copied in full.`
      : friendlyErrorMessage(save.error)
    : null
  const error = fieldError ?? serverError

  return (
    <form onSubmit={submit} className="space-y-3 rounded-xl border border-border bg-muted/20 p-4" noValidate>
      <div>
        <label htmlFor={id} className={ui.label}>
          {replacing ? `New ${provider.label} key` : `${provider.label} API key`}
        </label>
        <div className="relative">
          <input
            id={id}
            type={show ? 'text' : 'password'}
            value={value}
            onChange={(e) => {
              setValue(e.target.value)
              if (fieldError) setFieldError(null)
            }}
            placeholder={`${provider.key_prefix}…`}
            autoComplete="off"
            spellCheck={false}
            autoFocus
            aria-invalid={!!error || undefined}
            aria-describedby={error ? `${id}-error` : `${id}-hint`}
            disabled={save.isPending}
            className={cn(ui.input, 'pr-10 font-mono', error && 'border-destructive')}
          />
          <button
            type="button"
            onClick={() => setShow((v) => !v)}
            className="absolute right-2 top-1/2 -translate-y-1/2 rounded-md p-1.5 text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-2 focus-visible:outline-brand"
            aria-label={show ? 'Hide key' : 'Show key'}
            aria-pressed={show}
          >
            {show ? <EyeOff className="size-4" aria-hidden /> : <Eye className="size-4" aria-hidden />}
          </button>
        </div>
        {error ? (
          <p id={`${id}-error`} role="alert" className={ui.fieldError}>
            {error}
          </p>
        ) : (
          <p id={`${id}-hint`} className={ui.hint}>
            Checked with a live call to {provider.label}, then stored encrypted. You won't see it again.
          </p>
        )}
      </div>
      <div>
        <label htmlFor={`${id}-label`} className={ui.label}>
          Label <span className="text-muted-foreground/70">(optional)</span>
        </label>
        <input
          id={`${id}-label`}
          type="text"
          value={label}
          maxLength={50}
          onChange={(e) => setLabel(e.target.value)}
          placeholder="e.g. Personal"
          disabled={save.isPending}
          className={ui.input}
        />
      </div>
      {!isActive && (
        <label className="flex cursor-pointer items-center gap-2.5 text-sm text-foreground">
          <input
            type="checkbox"
            checked={makeActive}
            onChange={(e) => setMakeActive(e.target.checked)}
            disabled={save.isPending}
            className="size-4 accent-brand"
          />
          Make {provider.label} my active provider
        </label>
      )}
      <div className="flex justify-end gap-2">
        <button type="button" onClick={onDone} disabled={save.isPending} className={ui.ghost}>
          Cancel
        </button>
        <button type="submit" disabled={save.isPending || !value.trim()} className={ui.primarySm}>
          {save.isPending && <Loader2 className="size-3.5 animate-spin" aria-hidden />}
          {save.isPending ? 'Verifying…' : replacing ? 'Replace key' : 'Save & verify'}
        </button>
      </div>
    </form>
  )
}
