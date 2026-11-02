/**
 * DOM helpers for scanning and driving third-party forms.
 *
 * The autopilot works in an *inactive* tab, where Chrome throttles timers to
 * about once per second and never runs requestAnimationFrame. Waits are
 * therefore driven by MutationObserver (not throttled) with a timer only as a
 * fallback, and short "let the page react" pauses use a MessageChannel task.
 */

export const OWN_UI_ATTR = 'data-aethlara-ui'

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/** Yield one macrotask without timer throttling (lets React flush updates). */
export function yieldTask(): Promise<void> {
  return new Promise((resolve) => {
    const channel = new MessageChannel()
    channel.port1.onmessage = () => {
      channel.port1.close()
      resolve()
    }
    channel.port2.postMessage(null)
  })
}

export async function settleFrames(count = 3): Promise<void> {
  for (let i = 0; i < count; i++) await yieldTask()
}

export function isOwnUi(el: Element): boolean {
  return !!el.closest(`[${OWN_UI_ATTR}]`)
}

/** Visible to a user: rendered, not transparent, non-empty box. */
export function isVisible(el: Element | null | undefined): boolean {
  if (!el || !(el instanceof HTMLElement) || !el.isConnected) return false
  const withCheck = el as HTMLElement & { checkVisibility?: (opts?: Record<string, boolean>) => boolean }
  if (typeof withCheck.checkVisibility === 'function') {
    if (!withCheck.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })) return false
  } else {
    const style = getComputedStyle(el)
    if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0) return false
  }
  const rect = el.getBoundingClientRect()
  return rect.width > 0 && rect.height > 0
}

/**
 * Text-like inputs a person could actually type into. Rejects the classic
 * honeypot tricks: 1px boxes, off-screen positioning, aria-hidden wrappers
 * and tell-tale names.
 */
export function isRealTextControl(el: HTMLElement): boolean {
  if (!isVisible(el)) return false
  const rect = el.getBoundingClientRect()
  if (rect.width < 4 || rect.height < 4) return false
  if (rect.right + window.scrollX < 0 || rect.bottom + window.scrollY < 0) return false
  if (el.closest('[aria-hidden="true"]')) return false
  return !looksLikeHoneypot(el)
}

export function looksLikeHoneypot(el: Element): boolean {
  const hay = `${el.getAttribute('name') ?? ''} ${el.id} ${typeof el.className === 'string' ? el.className : ''}`.toLowerCase()
  if (/honey|\bhp[-_]|bot[-_]?(field|trap|check)|leave[-_ ]?(this[-_ ]?)?(field[-_ ]?)?(blank|empty)|do[-_]?not[-_]?fill|fax[-_]?only/.test(hay)) {
    return true
  }
  const label = el.getAttribute('aria-label') ?? ''
  return /leave (this )?(field )?(blank|empty)|do not fill/i.test(label)
}

/** All elements under root in document order, descending into open shadow roots. */
export function deepElements(root: Node): Element[] {
  const out: Element[] = []
  const visit = (node: Node) => {
    const walker = document.createTreeWalker(node, NodeFilter.SHOW_ELEMENT)
    let current = walker.nextNode() as Element | null
    while (current) {
      out.push(current)
      if (current.shadowRoot) visit(current.shadowRoot)
      current = walker.nextNode() as Element | null
    }
  }
  visit(root)
  return out
}

export function deepQueryAll<T extends Element = HTMLElement>(root: Node, selector: string): T[] {
  return deepElements(root).filter((el) => el.matches(selector)) as T[]
}

/** getElementById within the element's own tree (document or shadow root). */
export function byIdNear(el: Element, id: string): HTMLElement | null {
  const root = el.getRootNode() as Document | ShadowRoot
  const found = typeof root.getElementById === 'function' ? root.getElementById(id) : null
  return (found as HTMLElement | null) ?? document.getElementById(id)
}

/** Visible text of an element without form controls, scripts or styles. */
export function textOf(el: Element | null | undefined, opts: { keepHidden?: boolean } = {}): string {
  if (!el) return ''
  const clone = el.cloneNode(true) as HTMLElement
  clone
    .querySelectorAll('script,style,noscript,template,svg,input,select,textarea,option,button,[role="listbox"],[role="option"]')
    .forEach((n) => n.remove())
  if (!opts.keepHidden) clone.querySelectorAll('[hidden]').forEach((n) => n.remove())
  return (clone.textContent ?? '').replace(/\s+/g, ' ').trim()
}

/** Text including what textOf strips (used for headings and messages). */
export function rawText(el: Element | null | undefined): string {
  if (!el) return ''
  const anyEl = el as HTMLElement
  const t = typeof anyEl.innerText === 'string' && anyEl.isConnected ? anyEl.innerText : el.textContent ?? ''
  return t.replace(/\s+/g, ' ').trim()
}

// ── Value setting (React / Vue / Angular friendly) ────────────────────────────

const inputValueSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
const textareaValueSetter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set
const selectValueSetter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')?.set

export function setNativeValue(el: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement, value: string): void {
  const setter =
    el instanceof HTMLInputElement ? inputValueSetter : el instanceof HTMLTextAreaElement ? textareaValueSetter : selectValueSetter
  if (setter) setter.call(el, value)
  else el.value = value
}

export function dispatchInput(el: HTMLElement, data?: string): void {
  let event: Event
  try {
    event = new InputEvent('input', { bubbles: true, composed: true, inputType: 'insertText', data: data ?? null })
  } catch {
    event = new Event('input', { bubbles: true, composed: true })
  }
  el.dispatchEvent(event)
}

export function dispatchChange(el: HTMLElement): void {
  el.dispatchEvent(new Event('change', { bubbles: true }))
}

export function dispatchBlur(el: HTMLElement): void {
  el.dispatchEvent(new FocusEvent('focusout', { bubbles: true, composed: true }))
  el.dispatchEvent(new FocusEvent('blur'))
}

export function focusQuietly(el: HTMLElement): void {
  try {
    el.focus({ preventScroll: true })
  } catch {
    // ignore
  }
}

export function keyboard(el: HTMLElement, key: string, type: 'keydown' | 'keyup' = 'keydown'): void {
  const codes: Record<string, number> = { Enter: 13, Escape: 27, ArrowDown: 40, ArrowUp: 38, Tab: 9, Backspace: 8 }
  el.dispatchEvent(
    new KeyboardEvent(type, { key, code: key, keyCode: codes[key] ?? 0, which: codes[key] ?? 0, bubbles: true, cancelable: true, composed: true }),
  )
}

/** A full pointer/mouse sequence, then click(); what most widget libraries expect. */
export function fireClick(el: HTMLElement): void {
  const rect = el.getBoundingClientRect()
  const base = {
    bubbles: true,
    cancelable: true,
    composed: true,
    clientX: rect.left + rect.width / 2,
    clientY: rect.top + rect.height / 2,
    button: 0,
  }
  try {
    el.dispatchEvent(new PointerEvent('pointerover', { ...base, pointerType: 'mouse', isPrimary: true }))
    el.dispatchEvent(new PointerEvent('pointerdown', { ...base, pointerType: 'mouse', isPrimary: true, buttons: 1 }))
  } catch {
    // PointerEvent unsupported: mouse events below still run
  }
  el.dispatchEvent(new MouseEvent('mouseover', base))
  el.dispatchEvent(new MouseEvent('mousedown', { ...base, buttons: 1 }))
  try {
    el.dispatchEvent(new PointerEvent('pointerup', { ...base, pointerType: 'mouse', isPrimary: true }))
  } catch {
    // ignore
  }
  el.dispatchEvent(new MouseEvent('mouseup', base))
  el.click()
}

export function fireMouseDown(el: HTMLElement): void {
  const rect = el.getBoundingClientRect()
  const base = { bubbles: true, cancelable: true, composed: true, clientX: rect.left + 4, clientY: rect.top + 4, button: 0, buttons: 1 }
  try {
    el.dispatchEvent(new PointerEvent('pointerdown', { ...base, pointerType: 'mouse', isPrimary: true }))
  } catch {
    // ignore
  }
  el.dispatchEvent(new MouseEvent('mousedown', base))
}

// ── Waiting ───────────────────────────────────────────────────────────────────

/**
 * Resolves with the first truthy value of `check`, re-evaluated on DOM
 * mutations (and on a slow timer), or null after `timeoutMs`.
 */
export function waitFor<T>(
  check: () => T | null | undefined | false,
  timeoutMs: number,
  opts: { root?: Node; intervalMs?: number; signal?: { aborted: boolean } } = {},
): Promise<T | null> {
  return new Promise((resolve) => {
    let done = false
    let lastRun = 0
    let scheduled = false
    const finish = (value: T | null) => {
      if (done) return
      done = true
      observer.disconnect()
      clearInterval(interval)
      clearTimeout(timeout)
      resolve(value)
    }
    const run = () => {
      scheduled = false
      if (done) return
      if (opts.signal?.aborted) return finish(null)
      lastRun = Date.now()
      try {
        const value = check()
        if (value) finish(value as T)
      } catch {
        // keep waiting
      }
    }
    const onMutation = () => {
      if (scheduled) return
      scheduled = true
      // Coalesce bursts of mutations; heavy checks run at most every ~60ms.
      const wait = Math.max(0, 60 - (Date.now() - lastRun))
      if (wait === 0) queueMicrotask(run)
      else setTimeout(run, wait)
    }
    const observer = new MutationObserver(onMutation)
    observer.observe(opts.root ?? document.documentElement, {
      subtree: true,
      childList: true,
      attributes: true,
      characterData: true,
    })
    const interval = setInterval(run, opts.intervalMs ?? 400)
    const timeout = setTimeout(() => finish(null), timeoutMs)
    run()
  })
}

/** Resolves once the DOM under root has been quiet for quietMs (or after maxMs). */
export function waitForQuiet(root: Node, quietMs: number, maxMs: number): Promise<void> {
  return new Promise((resolve) => {
    let quietTimer = setTimeout(done, quietMs)
    const maxTimer = setTimeout(done, maxMs)
    const observer = new MutationObserver(() => {
      clearTimeout(quietTimer)
      quietTimer = setTimeout(done, quietMs)
    })
    observer.observe(root, { subtree: true, childList: true, attributes: true, characterData: true })
    function done() {
      observer.disconnect()
      clearTimeout(quietTimer)
      clearTimeout(maxTimer)
      resolve()
    }
  })
}

export function scrollIntoViewQuietly(el: HTMLElement): void {
  try {
    el.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'instant' as ScrollBehavior })
  } catch {
    // ignore
  }
}
