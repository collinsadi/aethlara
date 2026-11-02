import type { Adapter } from './adapters/types'
import {
  type Baseline,
  detectConfirmation,
  findBlockingCaptcha,
  findVerificationInputs,
  isBusy,
  newErrors,
} from './detect'
import { isOwnUi, isVisible, waitFor } from './dom'
import { collapse } from './text'

/** Finding the real submit / next buttons and reading what happens after a click. */

const SUBMIT_TEXT =
  /^(submit|submit (my |your |this )?application|submit and (finish|apply)|apply|apply now|send|send (my |your )?application|finish|finish application|complete( (my |your )?application)?|submit form|done)[.!]?$/i
const SUBMIT_LOOSE = /\b(submit|send application|complete application|finish application)\b/i
const NEXT_TEXT = /^(next|next step|next page|continue|save (and|&) continue|save (and|&) next|proceed|continue to (the )?next (step|page)|review( (my |your )?application)?)\b/i
const NEVER =
  /save (as )?(a )?draft|save for later|cancel|^back$|go back|previous|sign ?in|log ?in|with linkedin|with indeed|with google|with apple|autofill|auto-fill|upload|attach|dropbox|google drive|enter manually|add (another|more)|remove|delete|clear|reset|search|subscribe|share|refer a friend|locate me|withdraw/i

export function buttonText(el: HTMLElement): string {
  const value = el instanceof HTMLInputElement ? el.value : ''
  return collapse(el.innerText || value || el.getAttribute('aria-label') || el.title || '')
}

export function isDisabled(el: HTMLElement): boolean {
  return (el as HTMLButtonElement).disabled === true || el.getAttribute('aria-disabled') === 'true'
}

function buttons(root: Element): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>('button, input[type="submit"], [role="button"], a.btn, a.button')).filter(
    (el) => !isOwnUi(el) && isVisible(el),
  )
}

function isSubmitType(el: HTMLElement): boolean {
  if (el instanceof HTMLInputElement) return el.type === 'submit'
  return el instanceof HTMLButtonElement && el.type === 'submit' && !!el.form
}

/** The final submit button (never "save draft", "back", social sign-ins…). */
export function findSubmitButton(root: Element, adapter?: Adapter): HTMLElement | null {
  const preferred = adapter?.findSubmit?.(root)
  if (preferred && isVisible(preferred)) return preferred
  let best: HTMLElement | null = null
  let bestScore = 0
  for (const el of buttons(root)) {
    const text = buttonText(el)
    if (!text || NEVER.test(text) || text.length > 60) continue
    let score = 0
    if (isSubmitType(el)) score += 3
    if (SUBMIT_TEXT.test(text)) score += 5
    else if (SUBMIT_LOOSE.test(text)) score += 3
    if (NEXT_TEXT.test(text)) score -= 6
    // later buttons win ties: the submit button sits at the bottom
    if (score >= 4 && score >= bestScore) {
      best = el
      bestScore = score
    }
  }
  return best
}

export function findNextButton(root: Element): HTMLElement | null {
  let found: HTMLElement | null = null
  for (const el of buttons(root)) {
    const text = buttonText(el)
    if (!text || NEVER.test(text) || text.length > 40) continue
    if (NEXT_TEXT.test(text) && !SUBMIT_LOOSE.test(text)) found = el
  }
  return found
}

export function isSubmitLike(el: Element): boolean {
  const btn = el.closest<HTMLElement>('button, input[type="submit"], [role="button"]')
  if (!btn) return false
  const text = buttonText(btn)
  return !NEVER.test(text) && (SUBMIT_TEXT.test(text) || SUBMIT_LOOSE.test(text) || isSubmitType(btn))
}

const CONTROL = 'input:not([type="hidden"]), select, textarea, [role="combobox"]'

export function snapshotControls(root: Element): { url: string; controls: Set<Element> } {
  return {
    url: location.href,
    controls: new Set(Array.from(root.querySelectorAll(CONTROL)).filter((el) => isVisible(el))),
  }
}

/** After clicking Next: did the visible set of fields change (a new step)? */
export async function waitForStepChange(
  root: Element,
  before: { url: string; controls: Set<Element> },
  timeoutMs: number,
): Promise<'changed' | 'unchanged'> {
  const changed = await waitFor(() => {
    if (location.href !== before.url) return true
    if (!root.isConnected) return true
    const now = Array.from(root.querySelectorAll(CONTROL)).filter((el) => isVisible(el))
    if (!now.length) return false
    const kept = now.filter((el) => before.controls.has(el)).length
    return kept / Math.max(now.length, before.controls.size) < 0.5
  }, timeoutMs)
  return changed ? 'changed' : 'unchanged'
}

export type SubmitOutcome =
  | { kind: 'confirmed'; message: string }
  | { kind: 'verification' }
  | { kind: 'captcha' }
  | { kind: 'errors'; errors: string[] }
  | { kind: 'unknown' }

/**
 * Watches the page after a submit click: a confirmation, an emailed-code
 * step, a CAPTCHA challenge or validation errors. Navigation ends this
 * document; the next one picks up from the persisted "submitting" phase.
 */
export async function watchOutcome(
  root: Element,
  baseline: Baseline,
  adapter: Adapter,
  timeoutMs: number,
  opts: { ignoreVerification?: boolean } = {},
): Promise<SubmitOutcome> {
  const started = Date.now()
  const result = await waitFor<SubmitOutcome>(
    () => {
      const message = detectConfirmation(adapter.confirmation?.() ?? null, baseline, root)
      if (message) return { kind: 'confirmed', message }
      if (!opts.ignoreVerification && !baseline.hadVerification && findVerificationInputs()) return { kind: 'verification' }
      if (findBlockingCaptcha()) return { kind: 'captcha' }
      if (Date.now() - started > 2500 && !isBusy(root)) {
        const errors = newErrors(root.isConnected ? root : document.body, baseline)
        if (errors.length) return { kind: 'errors', errors }
      }
      return null
    },
    timeoutMs,
    { intervalMs: 700 },
  )
  return result ?? { kind: 'unknown' }
}
