export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export function randomId(bytes = 12): string {
  const buf = new Uint8Array(bytes)
  crypto.getRandomValues(buf)
  return Array.from(buf, (b) => b.toString(16).padStart(2, '0')).join('')
}

export function clip(text: string, max: number): string {
  if (text.length <= max) return text
  return `${text.slice(0, Math.max(0, max - 1)).trimEnd()}…`
}

export function isHttpUrl(value: string | null | undefined): value is string {
  if (!value) return false
  try {
    const url = new URL(value)
    return url.protocol === 'https:' || url.protocol === 'http:'
  } catch {
    return false
  }
}

export function hostOf(url: string | null | undefined): string {
  if (!url) return ''
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return ''
  }
}

export function cn(...classes: (string | undefined | null | false)[]): string {
  return classes.filter(Boolean).join(' ')
}

export function errorMessage(err: unknown, fallback = 'Something went wrong'): string {
  if (err instanceof Error && err.message) return err.message
  if (typeof err === 'string' && err) return err
  return fallback
}

export function relativeTime(iso: string | number | null | undefined, now = Date.now()): string {
  if (iso == null || iso === '') return ''
  const t = typeof iso === 'number' ? iso : Date.parse(iso)
  if (!Number.isFinite(t)) return ''
  const diff = t - now
  const abs = Math.abs(diff)
  const future = diff > 0
  const fmt = (n: number, unit: string) => {
    const s = `${n} ${unit}${n === 1 ? '' : 's'}`
    return future ? `in ${s}` : `${s} ago`
  }
  if (abs < 45_000) return future ? 'in a moment' : 'just now'
  if (abs < 3_600_000) return fmt(Math.round(abs / 60_000), 'min')
  if (abs < 86_400_000) return fmt(Math.round(abs / 3_600_000), 'hour')
  return fmt(Math.round(abs / 86_400_000), 'day')
}

export function formatCountdown(seconds: number): string {
  const m = Math.floor(seconds / 60)
  const s = seconds % 60
  return `${m}:${String(s).padStart(2, '0')}`
}
