/**
 * Shared class strings for the dashboard's button and field styles, built on
 * the design-system classes in index.css (`btn-tf`, `btn-tf-secondary`,
 * `field-input`). Use these instead of re-typing long class lists so every
 * page gets identical focus, disabled and size treatment.
 *
 * Note: use `text-primary-foreground` (always white) for text on brand or
 * destructive fills; `text-white` is remapped to the foreground colour in
 * light mode by the legacy safety net in index.css.
 */
const focusRing =
  'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand'
const disabled = 'disabled:cursor-not-allowed disabled:opacity-50'

export const ui = {
  /** Primary CTA (dark pill). */
  primary: `btn-tf animate-btn-shine inline-flex items-center justify-center gap-2 px-5 py-2.5 min-h-0 text-sm font-semibold ${disabled}`,
  primarySm: `btn-tf animate-btn-shine inline-flex items-center justify-center gap-1.5 px-3.5 py-1.5 min-h-0 text-xs font-semibold ${disabled}`,
  /** Secondary pill. */
  secondary: `btn-tf-secondary animate-btn-shine inline-flex items-center justify-center gap-2 px-4 py-2.5 min-h-0 text-sm font-semibold ${disabled}`,
  secondarySm: `btn-tf-secondary animate-btn-shine inline-flex items-center justify-center gap-1.5 px-3.5 py-1.5 min-h-0 text-xs font-semibold ${disabled}`,
  /** Compact bordered action used in rows and toolbars. */
  outline: `inline-flex items-center justify-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground ${focusRing} ${disabled}`,
  /** Destructive outline action. */
  danger: `inline-flex items-center justify-center gap-1.5 rounded-lg border border-destructive/30 px-3 py-1.5 text-xs font-medium text-destructive transition-colors hover:bg-destructive/10 ${focusRing} ${disabled}`,
  /** Solid destructive confirm button. */
  dangerSolid: `inline-flex items-center justify-center gap-2 rounded-xl bg-destructive px-4 py-2 text-sm font-semibold text-primary-foreground transition-opacity hover:opacity-90 ${focusRing} ${disabled}`,
  /** Borderless icon / text button. */
  ghost: `inline-flex items-center justify-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground ${focusRing} ${disabled}`,
  iconButton: `inline-flex items-center justify-center rounded-lg p-2 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground ${focusRing} ${disabled}`,
  /** Inline text link. */
  link: `rounded font-medium text-foreground underline underline-offset-2 transition-colors hover:text-brand ${focusRing}`,
  /** Text inputs / selects / textareas. */
  input: 'field-input h-10 text-sm disabled:cursor-not-allowed disabled:opacity-60',
  textarea: 'field-input py-2.5 text-sm leading-relaxed disabled:cursor-not-allowed disabled:opacity-60',
  select: 'field-input h-10 text-sm pr-8 disabled:cursor-not-allowed disabled:opacity-60',
  label: 'mb-1.5 block text-xs font-medium text-muted-foreground',
  hint: 'mt-1.5 text-xs text-muted-foreground',
  fieldError: 'mt-1.5 text-xs text-destructive',
  /** Filter pill (pair with `pillActive` / `pillIdle`). */
  pill: `inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors ${focusRing}`,
  pillActive: 'border-brand bg-brand text-primary-foreground',
  pillIdle: 'border-border bg-muted/40 text-muted-foreground hover:text-foreground',
} as const
