import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Eye, EyeOff, Loader2, AlertTriangle, CheckCircle2,
  XCircle, Clock, RefreshCw, Trash2, KeyRound,
} from 'lucide-react'
import {
  useApiKey, useSaveApiKey, useDeleteApiKey, useValidateApiKey,
} from '@/hooks/useApiKey'
import { cn } from '@/lib/utils'

const STATUS_CONFIG = {
  valid: { label: 'Valid', icon: CheckCircle2, className: 'text-emerald-500' },
  invalid: { label: 'Invalid', icon: XCircle, className: 'text-red-500' },
  unvalidated: { label: 'Not validated', icon: Clock, className: 'text-amber-500' },
  revoked: { label: 'Revoked', icon: XCircle, className: 'text-red-500' },
} as const

export function ApiKeySection() {
  const { data: apiKey, isLoading } = useApiKey()

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-10">
        <Loader2 className="w-5 h-5 text-muted-foreground animate-spin" />
      </div>
    )
  }

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-base font-semibold text-foreground font-heading">API Key</h2>
        <p className="text-sm text-muted-foreground mt-0.5">
          Your OpenRouter API key is encrypted at rest and never exposed after saving.
        </p>
      </div>

      {apiKey ? (
        <KeyExistsView />
      ) : (
        <AddKeyView />
      )}
    </div>
  )
}

// ── No key state ──────────────────────────────────────────────────────────────

function AddKeyView() {
  const [value, setValue] = useState('')
  const [label, setLabel] = useState('')
  const [show, setShow] = useState(false)
  const saveKey = useSaveApiKey()
  const [fieldError, setFieldError] = useState('')

  const handleSave = async () => {
    setFieldError('')
    if (!value.trim()) {
      setFieldError('API key is required')
      return
    }
    try {
      await saveKey.mutateAsync({ apiKey: value.trim(), label: label.trim() || undefined })
      setValue('')
      setLabel('')
    } catch (err: unknown) {
      const apiErr = err as { response?: { data?: { error?: { message?: string } } } }
      setFieldError(apiErr?.response?.data?.error?.message ?? 'Failed to save key')
    }
  }

  return (
    <div className="glass-card p-5 space-y-4">
      <div className="flex items-center gap-3 p-3 rounded-xl bg-amber-500/8 border border-amber-500/20">
        <KeyRound className="w-4 h-4 text-amber-500 shrink-0" />
        <p className="text-sm text-amber-600 dark:text-amber-400">
          Add your OpenRouter API key to unlock AI-powered job analysis.
        </p>
      </div>

      <div>
        <label className="text-xs font-medium text-muted-foreground block mb-1.5">
          API Key
        </label>
        <div className="relative">
          <input
            type={show ? 'text' : 'password'}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder="sk-or-v1-…"
            className="field-input w-full text-sm pr-10"
            autoComplete="off"
            spellCheck={false}
          />
          <button
            type="button"
            onClick={() => setShow((v) => !v)}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
            tabIndex={-1}
            aria-label={show ? 'Hide key' : 'Show key'}
          >
            {show ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
          </button>
        </div>
        {fieldError && (
          <p className="text-xs text-red-500 mt-1">{fieldError}</p>
        )}
      </div>

      <div>
        <label className="text-xs font-medium text-muted-foreground block mb-1.5">
          Label <span className="text-muted-foreground/50">(optional)</span>
        </label>
        <input
          type="text"
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          placeholder="e.g. Personal"
          className="field-input w-full text-sm"
          maxLength={80}
        />
      </div>

      <button
        type="button"
        onClick={handleSave}
        disabled={saveKey.isPending || !value.trim()}
        className="btn-tf animate-btn-shine w-full text-sm font-semibold py-2.5 disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {saveKey.isPending ? (
          <><Loader2 className="w-4 h-4 animate-spin mr-2" /> Saving…</>
        ) : (
          'Save & Validate'
        )}
      </button>
    </div>
  )
}

// ── Key exists state ──────────────────────────────────────────────────────────

function KeyExistsView() {
  const { data: apiKey } = useApiKey()
  const validateKey = useValidateApiKey()
  const deleteKey = useDeleteApiKey()
  const [deleteOpen, setDeleteOpen] = useState(false)

  if (!apiKey) return null

  const statusConfig = STATUS_CONFIG[apiKey.validation_status]
  const StatusIcon = statusConfig.icon

  const handleValidate = async () => {
    try {
      await validateKey.mutateAsync()
    } catch {
      // error shown via status badge on refetch
    }
  }

  return (
    <>
      <div className="glass-card p-5 space-y-4">
        {/* Provider + prefix row */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-muted border border-border flex items-center justify-center">
              <KeyRound className="w-4 h-4 text-muted-foreground" />
            </div>
            <div>
              <p className="text-sm font-medium text-foreground">
                {apiKey.label || 'OpenRouter'}
              </p>
              <p className="text-xs text-muted-foreground font-mono">
                {apiKey.key_prefix}••••••••••••
              </p>
            </div>
          </div>

          {/* Status badge */}
          <div className={cn('flex items-center gap-1.5', statusConfig.className)}>
            <StatusIcon className="w-4 h-4" />
            <span className="text-xs font-medium">{statusConfig.label}</span>
          </div>
        </div>

        {/* Meta */}
        {(apiKey.last_validated_at || apiKey.last_used_at) && (
          <div className="text-xs text-muted-foreground space-y-0.5">
            {apiKey.last_validated_at && (
              <p>Last validated: {new Date(apiKey.last_validated_at).toLocaleString()}</p>
            )}
            {apiKey.last_used_at && (
              <p>Last used: {new Date(apiKey.last_used_at).toLocaleString()}</p>
            )}
          </div>
        )}

        {/* Actions */}
        <div className="flex items-center gap-2 pt-1">
          <button
            type="button"
            onClick={handleValidate}
            disabled={validateKey.isPending}
            className={cn(
              'flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium',
              'border border-border text-muted-foreground hover:text-foreground',
              'hover:bg-muted/40 transition-colors disabled:opacity-50 disabled:cursor-not-allowed'
            )}
          >
            {validateKey.isPending
              ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
              : <RefreshCw className="w-3.5 h-3.5" />
            }
            {validateKey.isPending ? 'Validating…' : 'Re-validate'}
          </button>

          <button
            type="button"
            onClick={() => setDeleteOpen(true)}
            className={cn(
              'flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium ml-auto',
              'border border-red-500/30 text-red-500 hover:bg-red-500/8 transition-colors'
            )}
          >
            <Trash2 className="w-3.5 h-3.5" />
            Remove key
          </button>
        </div>
      </div>

      <AnimatePresence>
        {deleteOpen && (
          <DeleteKeyDialog
            onConfirm={async () => {
              await deleteKey.mutateAsync()
              setDeleteOpen(false)
            }}
            onCancel={() => setDeleteOpen(false)}
            isDeleting={deleteKey.isPending}
          />
        )}
      </AnimatePresence>
    </>
  )
}

// ── Delete confirmation dialog ────────────────────────────────────────────────

function DeleteKeyDialog({
  onConfirm,
  onCancel,
  isDeleting,
}: {
  onConfirm: () => Promise<void>
  onCancel: () => void
  isDeleting: boolean
}) {
  const [typed, setTyped] = useState('')
  const confirmed = typed === 'DELETE'

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="absolute inset-0 bg-black/50 backdrop-blur-sm"
        onClick={onCancel}
      />
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.95 }}
        className="glass-card w-full max-w-sm p-6 relative z-10"
      >
        <div className="size-12 rounded-full bg-red-500/15 flex items-center justify-center mx-auto mb-4">
          <AlertTriangle className="w-6 h-6 text-red-500" />
        </div>
        <h3 className="text-base font-semibold text-foreground font-heading text-center mb-1">
          Remove API Key
        </h3>
        <p className="text-sm text-muted-foreground text-center mb-5">
          This will permanently delete your saved key. AI features will stop working until you add a new one.
        </p>

        <div className="mb-4">
          <label className="text-xs font-medium text-muted-foreground block mb-1.5">
            Type <span className="font-mono font-semibold text-foreground">DELETE</span> to confirm
          </label>
          <input
            type="text"
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            placeholder="DELETE"
            className="field-input w-full text-sm"
            autoFocus
          />
        </div>

        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={onCancel}
            disabled={isDeleting}
            className="flex-1 py-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={!confirmed || isDeleting}
            className={cn(
              'flex-1 py-2 rounded-xl bg-red-500 text-white text-sm font-semibold',
              'hover:bg-red-600 transition-colors disabled:opacity-40 disabled:cursor-not-allowed',
              'flex items-center justify-center gap-2'
            )}
          >
            {isDeleting ? (
              <><Loader2 className="w-4 h-4 animate-spin" /> Removing…</>
            ) : (
              'Remove'
            )}
          </button>
        </div>
      </motion.div>
    </div>
  )
}
