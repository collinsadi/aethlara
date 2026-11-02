/**
 * Minimal logger. Never pass tokens, form values, labels, page text, e-mail
 * addresses or URLs with query strings: only event names, ids, counts,
 * statuses and error codes. Debug output is compiled out of production builds.
 */

type Fields = Record<string, string | number | boolean | null | undefined>

const DEBUG = import.meta.env.DEV

function fmt(scope: string, event: string, fields?: Fields): string {
  if (!fields) return `[aethlara:${scope}] ${event}`
  const parts = Object.entries(fields)
    .filter(([, v]) => v !== undefined)
    .map(([k, v]) => `${k}=${String(v)}`)
  return `[aethlara:${scope}] ${event}${parts.length ? ` ${parts.join(' ')}` : ''}`
}

export function createLogger(scope: string) {
  return {
    debug(event: string, fields?: Fields) {
      if (DEBUG) console.debug(fmt(scope, event, fields))
    },
    info(event: string, fields?: Fields) {
      if (DEBUG) console.info(fmt(scope, event, fields))
    },
    warn(event: string, fields?: Fields) {
      console.warn(fmt(scope, event, fields))
    },
  }
}

/** A short, PII-free description of an error for logs (class + code only). */
export function errorKind(err: unknown): string {
  if (err && typeof err === 'object') {
    const e = err as { name?: string; code?: string; status?: number }
    return [e.name, e.code, e.status].filter((x) => x !== undefined && x !== '').join(':') || 'error'
  }
  return typeof err
}
