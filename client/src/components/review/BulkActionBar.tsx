import { Check, Loader2, RotateCcw, X } from 'lucide-react'
import { ui } from '@/lib/styles'

interface Props {
  count: number
  busy: boolean
  canApprove: boolean
  canDismiss: boolean
  canRestore: boolean
  onApprove: () => void
  onDismiss: () => void
  onRestore: () => void
  onClear: () => void
}

/** Floating actions for multi-selected jobs. */
export function BulkActionBar({ count, busy, canApprove, canDismiss, canRestore, onApprove, onDismiss, onRestore, onClear }: Props) {
  if (count === 0) return null
  return (
    <div
      role="region"
      aria-label="Bulk actions"
      className="sticky bottom-4 z-20 mx-auto flex w-fit max-w-full flex-wrap items-center gap-2 rounded-full border border-border bg-popover/95 px-3 py-2 shadow-lg backdrop-blur-md"
    >
      <span className="px-2 text-sm font-medium text-foreground" aria-live="polite">
        {count} selected
      </span>
      {busy && <Loader2 className="size-4 animate-spin text-muted-foreground" aria-label="Working" />}
      {canApprove && (
        <button type="button" onClick={onApprove} disabled={busy} className={ui.primarySm}>
          <Check className="size-3.5" aria-hidden />
          Approve {count}
        </button>
      )}
      {canRestore && (
        <button type="button" onClick={onRestore} disabled={busy} className={ui.secondarySm}>
          <RotateCcw className="size-3.5" aria-hidden />
          Back to review
        </button>
      )}
      {canDismiss && (
        <button type="button" onClick={onDismiss} disabled={busy} className={ui.secondarySm}>
          <X className="size-3.5" aria-hidden />
          Dismiss {count}
        </button>
      )}
      <button type="button" onClick={onClear} disabled={busy} className={ui.ghost}>
        Clear
      </button>
    </div>
  )
}
