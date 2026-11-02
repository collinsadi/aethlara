import {
  byIdNear,
  dispatchInput,
  fireClick,
  fireMouseDown,
  focusQuietly,
  isVisible,
  keyboard,
  rawText,
  setNativeValue,
  sleep,
  waitFor,
  yieldTask,
} from './dom'
import type { FieldHandle } from './fields'
import { bestOptionIndex, collapse, norm } from './text'

/**
 * Custom dropdowns: react-select (Greenhouse), ARIA comboboxes/listboxes and
 * search-as-you-type location pickers. They have no native <select>, so we
 * open the menu, read the [role=option] elements and click one.
 */

const NOISE_OPTION = /^(no options?|no results?( found)?|no matches( found)?|loading\.*|searching\.*|type to search.*|start typing.*|begin typing.*|enter \d+ or more characters.*)$/i

const VALUE_MARKERS =
  '[class*="singleValue"], [class*="single-value"], [class*="multiValue"], [class*="multi-value"], [class*="selected-value" i], [class*="selectedValue"]'

export function comboInput(h: FieldHandle): HTMLInputElement | null {
  if (h.el instanceof HTMLInputElement) return h.el
  return h.el.querySelector<HTMLInputElement>('input:not([type="hidden"])')
}

/** The clickable box of the widget (react-select's __control, or the element itself). */
export function comboControl(h: FieldHandle): HTMLElement {
  const control = h.el.closest<HTMLElement>('[class*="__control"], [class*="-control"], [class*="Control"]')
  if (control && (!h.container || h.container.contains(control))) return control
  return h.el
}

function visibleListboxes(): HTMLElement[] {
  return Array.from(document.querySelectorAll<HTMLElement>('[role="listbox"]')).filter((el) => isVisible(el))
}

export function findListbox(h: FieldHandle, before: Set<Element>): HTMLElement | null {
  const ref = (comboInput(h) ?? h.el)
  for (const attr of ['aria-controls', 'aria-owns']) {
    const id = ref.getAttribute(attr) || h.el.getAttribute(attr)
    if (!id) continue
    for (const part of id.split(/\s+/)) {
      const el = byIdNear(h.el, part)
      if (el && isVisible(el)) return el
    }
  }
  const scope = h.container ?? h.el.parentElement
  const inWidget = scope?.querySelector<HTMLElement>('[role="listbox"], [class*="menu-list"], [class*="MenuList"], [class*="__menu"]')
  if (inWidget && isVisible(inWidget)) return inWidget
  for (const lb of visibleListboxes()) if (!before.has(lb)) return lb
  return null
}

function optionElements(listbox: HTMLElement): HTMLElement[] {
  let opts = Array.from(listbox.querySelectorAll<HTMLElement>('[role="option"]'))
  if (!opts.length) {
    const loose = Array.from(listbox.querySelectorAll<HTMLElement>('[class*="option" i]'))
    // keep leaves only (the class also matches wrappers such as "options-list")
    opts = loose.filter((el) => !loose.some((other) => other !== el && el.contains(other)))
  }
  return opts.filter((el) => isVisible(el) && el.getAttribute('aria-disabled') !== 'true')
}

export interface ComboOption {
  el: HTMLElement
  text: string
}

export function readOptions(listbox: HTMLElement): ComboOption[] {
  const seen = new Set<string>()
  const out: ComboOption[] = []
  for (const el of optionElements(listbox)) {
    const text = collapse(rawText(el))
    if (!text || NOISE_OPTION.test(text) || seen.has(text)) continue
    seen.add(text)
    out.push({ el, text })
  }
  return out
}

export async function openCombobox(h: FieldHandle): Promise<HTMLElement | null> {
  const input = comboInput(h)
  const before = new Set<Element>(visibleListboxes())
  if (input) focusQuietly(input)
  const control = comboControl(h)
  fireMouseDown(control)
  await yieldTask()
  let listbox = await waitFor(() => findListbox(h, before), 700)
  if (!listbox && input) {
    keyboard(input, 'ArrowDown')
    listbox = await waitFor(() => findListbox(h, before), 900)
  }
  if (!listbox) {
    fireClick(control)
    listbox = await waitFor(() => findListbox(h, before), 900)
  }
  return listbox
}

export async function closeCombobox(h: FieldHandle): Promise<void> {
  const input = comboInput(h)
  const target = input ?? h.el
  keyboard(target, 'Escape')
  await yieldTask()
  try {
    target.blur()
  } catch {
    // ignore
  }
  await yieldTask()
}

/** Opens the menu, reads its options and closes it again. */
export async function loadComboOptions(h: FieldHandle): Promise<string[]> {
  try {
    const listbox = await openCombobox(h)
    if (!listbox) return []
    // async menus render "Loading..." first
    const options = await waitFor(() => {
      const opts = readOptions(listbox)
      return opts.length ? opts : null
    }, 900)
    return (options ?? []).map((o) => o.text).slice(0, 400)
  } finally {
    await closeCombobox(h)
  }
}

export function comboHasValue(h: FieldHandle): boolean {
  const scope = h.container ?? h.el.parentElement
  const marker = scope?.querySelector<HTMLElement>(VALUE_MARKERS)
  if (marker && collapse(marker.textContent).length > 0) return true
  if (!(h.el instanceof HTMLInputElement)) {
    const t = collapse(h.el.textContent)
    return t.length > 0 && !/^(select|choose|pick|search)\b|\.\.\.$|…$/i.test(t)
  }
  // Some widgets keep the chosen value in a hidden input next to the visible one.
  const hidden = scope?.querySelector<HTMLInputElement>('input[type="hidden"][name]')
  if (hidden && hidden.value.trim()) return true
  return h.el.getAttribute('aria-expanded') !== 'true' && h.el.value.trim().length > 0 && !scope?.querySelector('[class*="placeholder" i]')
}

function searchQueries(value: string): string[] {
  const v = collapse(value)
  const out = [v]
  const firstPart = v.split(',')[0]?.trim()
  if (firstPart && firstPart !== v) out.push(firstPart)
  const words = v.split(/\s+/)
  if (words.length > 2) out.push(words.slice(0, 2).join(' '))
  return [...new Set(out.filter(Boolean))].slice(0, 3)
}

async function chooseFromOpenMenu(listbox: HTMLElement, value: string): Promise<string | null> {
  const options = await waitFor(() => {
    const opts = readOptions(listbox)
    return opts.length ? opts : null
  }, 3500)
  if (!options) return null
  const idx = bestOptionIndex(value, options.map((o) => o.text))
  if (idx < 0) return null
  const choice = options[idx]
  fireClick(choice.el)
  await yieldTask()
  await sleep(80)
  return choice.text
}

function valueShown(h: FieldHandle, text: string): boolean {
  const scope = h.container ?? h.el.parentElement
  const wanted = norm(text)
  const markers = scope ? Array.from(scope.querySelectorAll<HTMLElement>(VALUE_MARKERS)) : []
  if (markers.some((m) => norm(m.textContent).includes(wanted) || wanted.includes(norm(m.textContent)))) return true
  if (!(h.el instanceof HTMLInputElement) && norm(h.el.textContent).includes(wanted)) return true
  if (h.el instanceof HTMLInputElement && norm(h.el.value) === wanted) return true
  return false
}

/**
 * Picks `value` in a custom dropdown: opens it, types to filter (or search),
 * clicks the best matching option and checks that the widget shows it.
 */
export async function pickComboValue(h: FieldHandle, value: string): Promise<boolean> {
  const input = comboInput(h)
  const typeable = !!input && !input.readOnly
  for (const query of typeable ? searchQueries(value) : [value]) {
    const listbox = await openCombobox(h)
    if (typeable && input) {
      setNativeValue(input, query)
      dispatchInput(input, query)
      await yieldTask()
    }
    const lb = listbox ?? (await waitFor(() => findListbox(h, new Set()), 2000))
    if (!lb) continue
    const chosen = await chooseFromOpenMenu(lb, value)
    if (chosen) {
      const shown = await waitFor(() => valueShown(h, chosen), 1500)
      await closeCombobox(h)
      if (shown || h.multiple) return true
      return comboHasValue(h)
    }
    if (typeable && input) {
      setNativeValue(input, '')
      dispatchInput(input, '')
    }
    await closeCombobox(h)
  }
  return false
}
