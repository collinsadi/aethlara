/** Text normalisation and option matching used by the scanner and the filler. */

export function collapse(text: string | null | undefined): string {
  return (text ?? '').replace(/\s+/g, ' ').trim()
}

/** lower-case, accents stripped, punctuation folded to spaces. */
export function norm(text: string | null | undefined): string {
  return collapse(
    (text ?? '')
      .normalize('NFKD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/&/g, ' and ')
      .replace(/[^a-z0-9+]+/g, ' '),
  )
}

const REQUIRED_MARK = /(\s*[*✱]\s*)+$|^\s*[*✱]\s*/g

/** True when a raw label carries a "required" marker. */
export function hasRequiredMarker(raw: string): boolean {
  const t = raw.trim()
  return /[*✱]$/.test(t) || /^[*✱]/.test(t) || /\(\s*required\s*\)/i.test(t)
}

/** Label text as a person would read the question. */
export function cleanLabel(raw: string | null | undefined, max = 300): string {
  let t = collapse(raw)
  t = t.replace(REQUIRED_MARK, '').replace(/\(\s*required\s*\)/gi, '').replace(/\s*\(optional\)\s*$/i, '')
  t = collapse(t).replace(/[:\s]+$/, '')
  return t.length > max ? `${t.slice(0, max - 1)}…` : t
}

/** "first_name" / "firstName" / "cards[abc][field0]" → "First name" */
export function humanize(name: string | null | undefined): string {
  if (!name) return ''
  const last = name.replace(/\]/g, '').split('[').pop() ?? name
  const words = last
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/[_\-.]+/g, ' ')
    .replace(/\b(field|input|question)\s*\d+\b/gi, '')
    .trim()
  if (!words || /^[0-9a-f-]{16,}$/i.test(words)) return ''
  return words.charAt(0).toUpperCase() + words.slice(1).toLowerCase()
}

const STRICT_PLACEHOLDER =
  /^(-+\s*)?(please\s+)?(select|choose|pick)(\s+(one|an?\s+option|an?\s+answer|from\s+the\s+list))?\s*(\.\.\.|…)?(\s*-+)?$/i

/** Options such as "Select...", "-- Choose --" or any option with an empty value. */
export function isPlaceholderOption(text: string, value?: string): boolean {
  const t = collapse(text)
  if (!t) return true
  if (value === '') return true
  return STRICT_PLACEHOLDER.test(t) || /^[-—–\s]+$/.test(t)
}

const YES = /^(yes|true|i agree|agree|i accept|accept|i consent|consent|i acknowledge|acknowledge|i confirm|confirm|checked)\b/
const NO = /^(no|false|i disagree|disagree|decline|i do not|i don t|unchecked)\b/

export function isAffirmative(value: string): boolean {
  return YES.test(norm(value))
}

export function isNegative(value: string): boolean {
  return NO.test(norm(value))
}

function tokens(text: string): Set<string> {
  return new Set(norm(text).split(' ').filter((t) => t.length > 1 || /\d/.test(t)))
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (!a.size || !b.size) return 0
  let inter = 0
  for (const t of a) if (b.has(t)) inter++
  return inter / (a.size + b.size - inter)
}

/**
 * Index of the option that best matches `value`, or -1. Ambiguous matches
 * return -1 rather than guessing.
 */
export function bestOptionIndex(value: string, options: string[]): number {
  const v = norm(value)
  if (!v || !options.length) return -1
  const normed = options.map((o) => norm(o))

  const exact = normed.indexOf(v)
  if (exact >= 0) return exact

  const unique = (indices: number[]): number => (indices.length === 1 ? indices[0] : -1)

  const prefix = normed
    .map((o, i) => (o && (o.startsWith(`${v} `) || v.startsWith(`${o} `)) ? i : -1))
    .filter((i) => i >= 0)
  const p = unique(prefix)
  if (p >= 0) return p
  if (prefix.length > 1) {
    // e.g. "Yes" vs ["Yes, I consent", "Yes - but later"]: take the shortest only if clearly shorter
    const sorted = [...prefix].sort((a, b) => normed[a].length - normed[b].length)
    if (normed[sorted[0]].length + 4 < normed[sorted[1]].length) return sorted[0]
  }

  const contains = normed
    .map((o, i) => (o && v.length >= 3 && (o.includes(v) || (o.length >= 4 && v.includes(o))) ? i : -1))
    .filter((i) => i >= 0)
  const c = unique(contains)
  if (c >= 0) return c

  // Yes/No style answers against wordier options.
  if (isAffirmative(value) || isNegative(value)) {
    const want = isAffirmative(value) ? YES : NO
    const yn = normed.map((o, i) => (want.test(o) ? i : -1)).filter((i) => i >= 0)
    const y = unique(yn)
    if (y >= 0) return y
  }

  const vt = tokens(value)
  let best = -1
  let bestScore = 0
  let second = 0
  normed.forEach((_o, i) => {
    const score = jaccard(vt, tokens(options[i]))
    if (score > bestScore) {
      second = bestScore
      bestScore = score
      best = i
    } else if (score > second) {
      second = score
    }
  })
  if (bestScore >= 0.6 && bestScore - second >= 0.15) return best
  return -1
}

/** Split a server answer for multi-choice fields ("A | B"). */
export function splitMulti(value: string): string[] {
  return value
    .split(' | ')
    .map((v) => v.trim())
    .filter(Boolean)
}
