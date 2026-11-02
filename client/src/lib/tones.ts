/**
 * Semantic colour tones built only from design tokens (index.css):
 * brand, success, warning, destructive and the neutral surface tokens.
 */
export type Tone = 'neutral' | 'muted' | 'brand' | 'success' | 'warning' | 'danger'

/** Badge / pill surface + text. */
export const toneBadge: Record<Tone, string> = {
  neutral: 'border-border bg-muted text-foreground',
  muted: 'border-border bg-muted/50 text-muted-foreground',
  brand: 'border-brand/20 bg-brand/10 text-brand',
  success: 'border-success/25 bg-success/10 text-success',
  warning: 'border-warning/30 bg-warning/10 text-warning',
  danger: 'border-destructive/25 bg-destructive/10 text-destructive',
}

/** Foreground text only. */
export const toneText: Record<Tone, string> = {
  neutral: 'text-foreground',
  muted: 'text-muted-foreground',
  brand: 'text-brand',
  success: 'text-success',
  warning: 'text-warning',
  danger: 'text-destructive',
}

/** Soft panel (callouts, banners). */
export const tonePanel: Record<Tone, string> = {
  neutral: 'border-border bg-muted/40',
  muted: 'border-border bg-muted/30',
  brand: 'border-brand/20 bg-brand/[0.06]',
  success: 'border-success/25 bg-success/[0.07]',
  warning: 'border-warning/30 bg-warning/[0.08]',
  danger: 'border-destructive/25 bg-destructive/[0.07]',
}

/** Small status dot. */
export const toneDot: Record<Tone, string> = {
  neutral: 'bg-foreground/60',
  muted: 'bg-muted-foreground/50',
  brand: 'bg-brand',
  success: 'bg-success',
  warning: 'bg-warning',
  danger: 'bg-destructive',
}

/** Score → tone, matching the job cards (70+ strong, 50+ fair). */
export function scoreTone(score: number | null | undefined): Tone {
  if (score === null || score === undefined) return 'muted'
  if (score >= 70) return 'success'
  if (score >= 50) return 'warning'
  return 'danger'
}
