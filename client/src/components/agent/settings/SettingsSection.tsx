import { CheckCircle2, Loader2 } from 'lucide-react'
import { ui } from '@/lib/styles'
import { cn } from '@/lib/utils'

interface Props {
  id: string
  title: string
  description?: React.ReactNode
  children: React.ReactNode
  /** Omit for sections that save per item (e.g. saved answers). */
  footer?: {
    dirty: boolean
    saving: boolean
    /** Client-side validation problem that blocks saving. */
    invalid?: boolean
    /** Server error message from the last save. */
    error?: string | null
    saved?: boolean
    onSave: () => void
    onReset: () => void
    saveLabel?: string
  }
  className?: string
}

/** Card for one settings section with its own Save / Discard footer. */
export function SettingsSection({ id, title, description, children, footer, className }: Props) {
  return (
    <section id={id} aria-labelledby={`${id}-title`} className={cn('glass-card scroll-mt-24 outline-none', className)}>
      <header className="border-b border-border px-5 py-4 md:px-6">
        <h2 id={`${id}-title`} className="font-heading text-base font-semibold text-foreground">
          {title}
        </h2>
        {description && <div className="mt-1 text-sm text-muted-foreground">{description}</div>}
      </header>
      <div className="space-y-5 px-5 py-5 md:px-6">{children}</div>
      {footer && (
        <footer className="flex flex-col gap-3 rounded-b-2xl border-t border-border bg-muted/30 px-5 py-3.5 sm:flex-row sm:items-center sm:justify-between md:px-6">
          <div className="min-h-5 text-xs" aria-live="polite">
            {footer.error ? (
              <span role="alert" className="text-destructive">
                {footer.error}
              </span>
            ) : footer.dirty ? (
              <span className="text-warning">Unsaved changes</span>
            ) : footer.saved ? (
              <span className="inline-flex items-center gap-1 text-success">
                <CheckCircle2 className="size-3.5" aria-hidden />
                Saved
              </span>
            ) : null}
          </div>
          <div className="flex items-center gap-2">
            {footer.dirty && (
              <button type="button" onClick={footer.onReset} disabled={footer.saving} className={ui.ghost}>
                Discard
              </button>
            )}
            <button
              type="button"
              onClick={footer.onSave}
              disabled={!footer.dirty || footer.saving || footer.invalid}
              className={ui.primarySm}
            >
              {footer.saving && <Loader2 className="size-3.5 animate-spin" aria-hidden />}
              {footer.saving ? 'Saving…' : footer.saveLabel ?? 'Save'}
            </button>
          </div>
        </footer>
      )}
    </section>
  )
}
