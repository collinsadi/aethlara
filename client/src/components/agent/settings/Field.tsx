import { ui } from '@/lib/styles'
import { cn } from '@/lib/utils'

interface FieldProps {
  id: string
  label: string
  hint?: React.ReactNode
  error?: string | null
  className?: string
  children: React.ReactNode
}

/** Label + control + hint/error, wired with ids for aria-describedby. */
export function Field({ id, label, hint, error, className, children }: FieldProps) {
  return (
    <div className={className}>
      <label htmlFor={id} className={ui.label}>
        {label}
      </label>
      {children}
      {error ? (
        <p id={`${id}-error`} className={ui.fieldError}>
          {error}
        </p>
      ) : hint ? (
        <p id={`${id}-hint`} className={ui.hint}>
          {hint}
        </p>
      ) : null}
    </div>
  )
}

interface ToggleRowProps {
  title: string
  description?: React.ReactNode
  control: React.ReactNode
  className?: string
}

/** A row with text on the left and a switch on the right. */
export function ToggleRow({ title, description, control, className }: ToggleRowProps) {
  return (
    <div className={cn('flex items-start justify-between gap-4', className)}>
      <div className="min-w-0">
        <p className="text-sm font-medium text-foreground">{title}</p>
        {description && <div className="mt-0.5 text-xs text-muted-foreground">{description}</div>}
      </div>
      <div className="shrink-0 pt-0.5">{control}</div>
    </div>
  )
}

interface ChoiceChipsProps<T extends string> {
  legend: string
  options: { value: T; label: string }[]
  value: string[]
  onChange: (next: string[]) => void
  hint?: string
}

/** Multi-select as toggle chips (accessible checkbox group). */
export function ChoiceChips<T extends string>({ legend, options, value, onChange, hint }: ChoiceChipsProps<T>) {
  return (
    <fieldset>
      <legend className={ui.label}>{legend}</legend>
      <div className="flex flex-wrap gap-2">
        {options.map((o) => {
          const checked = value.includes(o.value)
          return (
            <label
              key={o.value}
              className={cn(
                ui.pill,
                'cursor-pointer select-none focus-within:outline-2 focus-within:outline-brand',
                checked ? ui.pillActive : ui.pillIdle
              )}
            >
              <input
                type="checkbox"
                className="sr-only"
                checked={checked}
                onChange={(e) =>
                  onChange(e.target.checked ? [...value, o.value] : value.filter((v) => v !== o.value))
                }
              />
              {o.label}
            </label>
          )
        })}
      </div>
      {hint && <p className={ui.hint}>{hint}</p>}
    </fieldset>
  )
}
