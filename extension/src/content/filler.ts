import { pickComboValue } from './combobox'
import {
  dispatchBlur,
  dispatchChange,
  dispatchInput,
  fireClick,
  focusQuietly,
  isVisible,
  setNativeValue,
  waitFor,
  yieldTask,
} from './dom'
import type { FieldHandle, ScannedField } from './fields'
import { bestOptionIndex, collapse, isAffirmative, isNegative, norm, splitMulti } from './text'

/**
 * Puts values into scanned fields the way a person would, so framework state
 * (React, Vue, Angular) sees the change: native value setters plus
 * input/change/blur events, real clicks for choices, typing then choosing
 * for custom dropdowns, and DataTransfer for file uploads.
 */

function pad(n: number): string {
  return String(n).padStart(2, '0')
}

function toIsoDate(value: string): string | null {
  const t = value.trim()
  if (/^\d{4}-\d{2}-\d{2}$/.test(t)) return t
  const parsed = new Date(t)
  if (Number.isNaN(parsed.getTime())) return null
  return `${parsed.getFullYear()}-${pad(parsed.getMonth() + 1)}-${pad(parsed.getDate())}`
}

function coerceForInput(value: string, inputType: string, el: HTMLInputElement | HTMLTextAreaElement): string {
  let v = value
  switch (inputType) {
    case 'number': {
      const m = value.replace(/,/g, '').match(/-?\d+(\.\d+)?/)
      v = m ? m[0] : ''
      break
    }
    case 'date':
      v = toIsoDate(value) ?? ''
      break
    case 'date-text': {
      // Date pickers parse what is typed; follow the placeholder's order (default MM/DD/YYYY).
      const iso = toIsoDate(value)
      if (!iso) {
        v = ''
        break
      }
      const [y, m, d] = iso.split('-')
      const ph = (el.getAttribute('placeholder') ?? '').toLowerCase()
      v = /dd\s*[/.-]\s*mm/.test(ph) ? `${d}/${m}/${y}` : /yyyy\s*[/.-]\s*mm/.test(ph) ? iso : `${m}/${d}/${y}`
      break
    }
    case 'month': {
      const d = toIsoDate(value)
      v = d ? d.slice(0, 7) : /^\d{4}-\d{2}$/.test(value.trim()) ? value.trim() : ''
      break
    }
    case 'email':
    case 'tel':
    case 'url':
      v = value.trim()
      break
  }
  const max = el.maxLength
  if (max > 0 && v.length > max) v = v.slice(0, max)
  return v
}

function touch(el: HTMLElement): void {
  focusQuietly(el)
  el.dispatchEvent(new FocusEvent('focusin', { bubbles: true, composed: true }))
}

export async function fillText(el: HTMLInputElement | HTMLTextAreaElement, value: string, inputType: string): Promise<boolean> {
  const v = coerceForInput(value, inputType, el)
  if (!v) return false
  if (el.value === v) return true
  touch(el)
  setNativeValue(el, v)
  dispatchInput(el, v)
  dispatchChange(el)
  dispatchBlur(el)
  await yieldTask()
  // Masked inputs may reformat ("+1 (555)…"); anything non-empty counts.
  return el.value.trim().length > 0
}

async function fillRichText(el: HTMLElement, value: string): Promise<boolean> {
  touch(el)
  try {
    const sel = window.getSelection()
    const range = document.createRange()
    range.selectNodeContents(el)
    sel?.removeAllRanges()
    sel?.addRange(range)
    document.execCommand('insertText', false, value)
  } catch {
    // fall through to the direct write below
  }
  if (collapse(el.textContent) !== collapse(value)) {
    el.textContent = value
    dispatchInput(el, value)
  }
  dispatchBlur(el)
  await yieldTask()
  return collapse(el.textContent).length > 0
}

function fillSelect(h: FieldHandle, value: string): boolean {
  const sel = h.el as HTMLSelectElement
  const wanted = h.multiple ? splitMulti(value) : [value]
  const indices = wanted
    .map((w) => {
      const byText = bestOptionIndex(w, h.options)
      if (byText >= 0) return byText
      return h.optionValues.findIndex((v) => norm(v) === norm(w))
    })
    .filter((i) => i >= 0)
  if (!indices.length) return false
  touch(sel)
  if (sel.multiple) {
    const values = new Set(indices.map((i) => h.optionValues[i]))
    for (const opt of Array.from(sel.options)) opt.selected = values.has(opt.value)
  } else {
    setNativeValue(sel, h.optionValues[indices[0]])
  }
  dispatchInput(sel)
  dispatchChange(sel)
  dispatchBlur(sel)
  return sel.multiple ? sel.selectedOptions.length > 0 : sel.value === h.optionValues[indices[0]]
}

function isChecked(el: HTMLElement): boolean {
  if (el instanceof HTMLInputElement) return el.checked
  return el.getAttribute('aria-checked') === 'true' || el.getAttribute('aria-pressed') === 'true'
}

async function toggleTo(el: HTMLElement, want: boolean): Promise<boolean> {
  if (isChecked(el) === want) return true
  if (el instanceof HTMLInputElement) el.click()
  else fireClick(el)
  await yieldTask()
  if (isChecked(el) !== want && el instanceof HTMLInputElement) {
    const label = el.labels?.[0]
    if (label) {
      fireClick(label)
      await yieldTask()
    }
  }
  return isChecked(el) === want
}

async function fillRadio(h: FieldHandle, value: string): Promise<boolean> {
  const idx = bestOptionIndex(value, h.options)
  if (idx < 0) return false
  return toggleTo(h.members[idx], true)
}

async function fillCheckboxGroup(h: FieldHandle, value: string): Promise<boolean> {
  const wanted = new Set(
    splitMulti(value)
      .map((v) => bestOptionIndex(v, h.options))
      .filter((i) => i >= 0),
  )
  if (!wanted.size) return false
  let ok = true
  for (let i = 0; i < h.members.length; i++) {
    // Unticks options the answer leaves out, e.g. pre-ticked marketing boxes.
    const done = await toggleTo(h.members[i], wanted.has(i))
    if (wanted.has(i)) ok = ok && done
  }
  return ok
}

async function fillSingleCheckbox(f: ScannedField, value: string): Promise<boolean> {
  const el = f.handle.members[0] ?? f.handle.el
  let want: boolean | null = null
  if (isAffirmative(value)) want = true
  else if (isNegative(value)) want = false
  else if (norm(value) && norm(f.label).includes(norm(value))) want = true
  if (want === null) return false
  return toggleTo(el, want)
}

async function fillButtons(h: FieldHandle, value: string): Promise<boolean> {
  const idx = bestOptionIndex(value, h.options)
  if (idx < 0) return false
  const btn = h.members[idx]
  fireClick(btn)
  await yieldTask()
  return true
}

async function fillCombobox(h: FieldHandle, value: string): Promise<boolean> {
  if (!h.multiple) return pickComboValue(h, value)
  let ok = true
  for (const part of splitMulti(value)) ok = (await pickComboValue(h, part)) && ok
  return ok
}

/** Applies one non-file value. Returns false when the value could not be set. */
export async function fillField(f: ScannedField, value: string): Promise<boolean> {
  const h = f.handle
  if (!h.el.isConnected) return false
  switch (h.kind) {
    case 'text':
      return fillText(h.el as HTMLInputElement, value, f.inputType)
    case 'textarea':
      return fillText(h.el as HTMLTextAreaElement, value, 'textarea')
    case 'richtext':
      return fillRichText(h.el, value)
    case 'select':
      return fillSelect(h, value)
    case 'radio':
      return fillRadio(h, value)
    case 'checkboxes':
      return fillCheckboxGroup(h, value)
    case 'checkbox':
      return fillSingleCheckbox(f, value)
    case 'buttons':
      return fillButtons(h, value)
    case 'combobox':
      return fillCombobox(h, value)
    case 'file':
      return false
  }
}

// ── Files ─────────────────────────────────────────────────────────────────────

export function base64ToFile(base64: string, filename: string, mime: string): File {
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return new File([bytes], filename, { type: mime || 'application/octet-stream', lastModified: Date.now() })
}

/** Does the input's `accept` attribute allow this file? */
export function acceptAllows(accept: string, file: File): boolean {
  const tokens = accept
    .split(',')
    .map((t) => t.trim().toLowerCase())
    .filter(Boolean)
  if (!tokens.length) return true
  const name = file.name.toLowerCase()
  const type = file.type.toLowerCase()
  return tokens.some((t) => {
    if (t.startsWith('.')) return name.endsWith(t)
    if (t.endsWith('/*')) return type.startsWith(t.slice(0, -1))
    return type === t
  })
}

const UPLOAD_ERROR = /(upload failed|could ?n[o']t upload|unable to upload|file (is )?too (large|big)|exceeds the maximum|not (a )?supported|unsupported file|invalid file|file type (is )?not allowed|wrong file type)/i

function visibleUploadError(container: Element): string | null {
  for (const el of Array.from(container.querySelectorAll<HTMLElement>('p, span, div, [role="alert"]'))) {
    if (el.children.length > 3) continue
    const t = collapse(el.textContent)
    if (t && t.length < 200 && UPLOAD_ERROR.test(t) && isVisible(el)) return t
  }
  return null
}

export interface AttachResult {
  ok: boolean
  error?: 'type' | 'rejected' | 'no_input'
  message?: string
}

/** Sets a File on a (possibly hidden) file input, as a drop would. */
export async function attachFile(f: ScannedField, file: File): Promise<AttachResult> {
  const input = f.handle.el as HTMLInputElement
  if (!acceptAllows(input.accept, file)) return { ok: false, error: 'type' }
  const transfer = new DataTransfer()
  transfer.items.add(file)
  let assigned = false
  try {
    input.files = transfer.files
    assigned = (input.files?.length ?? 0) > 0
  } catch {
    assigned = false
  }
  if (assigned) {
    input.dispatchEvent(new Event('input', { bubbles: true }))
    input.dispatchEvent(new Event('change', { bubbles: true }))
  } else {
    // Drop-zone widgets that ignore the input: simulate a drop on the widget.
    const zone = f.handle.container
    if (!zone) return { ok: false, error: 'no_input' }
    for (const type of ['dragenter', 'dragover', 'drop'] as const) {
      zone.dispatchEvent(new DragEvent(type, { bubbles: true, cancelable: true, dataTransfer: transfer }))
    }
  }
  const container = f.handle.container ?? input.parentElement
  if (!container) return { ok: true }
  const stem = file.name.toLowerCase().slice(0, 18)
  const outcome = await waitFor(
    () => {
      const err = visibleUploadError(container)
      if (err) return { error: err }
      if (collapse(container.textContent).toLowerCase().includes(stem)) return { shown: true }
      return null
    },
    7000,
    { root: container },
  )
  if (outcome && 'error' in outcome) return { ok: false, error: 'rejected', message: outcome.error }
  return { ok: true }
}
