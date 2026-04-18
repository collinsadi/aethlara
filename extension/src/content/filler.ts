import type { ScannedField } from '@/types'

const FILL_DELAY_MS = 50

const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
  window.HTMLInputElement.prototype,
  'value'
)?.set

const nativeTextAreaValueSetter = Object.getOwnPropertyDescriptor(
  window.HTMLTextAreaElement.prototype,
  'value'
)?.set

function fillTextInput(el: HTMLInputElement | HTMLTextAreaElement, value: string): void {
  el.focus()
  const setter = el instanceof HTMLInputElement ? nativeInputValueSetter : nativeTextAreaValueSetter
  if (setter) {
    setter.call(el, value)
  } else {
    el.value = value
  }
  el.dispatchEvent(new Event('input', { bubbles: true }))
  el.dispatchEvent(new Event('change', { bubbles: true }))
  el.blur()
}

function fillSelect(el: HTMLSelectElement, value: string): void {
  const lower = value.toLowerCase()
  for (const option of el.options) {
    if (
      option.text.toLowerCase().includes(lower) ||
      option.value.toLowerCase() === lower
    ) {
      el.value = option.value
      el.dispatchEvent(new Event('change', { bubbles: true }))
      return
    }
  }
}

function fillContentEditable(el: HTMLElement, value: string): void {
  el.focus()
  document.execCommand('selectAll', false)
  document.execCommand('insertText', false, value)
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}

function resolveElement(field: ScannedField): HTMLElement | null {
  return document.querySelector<HTMLElement>(field.selector)
}

export interface FillSummary {
  filled: number
  skipped: number
  failed: string[]
}

export async function fillFields(
  fields: ScannedField[],
  fillMap: Record<string, string | null>
): Promise<FillSummary> {
  let filled = 0
  let skipped = 0
  const failed: string[] = []

  const toFill = fields.filter((f) => fillMap[f.field_id] != null)
  if (toFill.length === 0) return { filled: 0, skipped: fields.length, failed: [] }

  // Scroll first field into view
  const firstEl = resolveElement(toFill[0])
  firstEl?.scrollIntoView({ behavior: 'smooth', block: 'center' })

  for (const field of toFill) {
    const value = fillMap[field.field_id]
    if (value == null) { skipped++; continue }

    const el = resolveElement(field)
    if (!el) {
      failed.push(field.field_id)
      continue
    }

    try {
      if (el instanceof HTMLInputElement && el.type !== 'radio' && el.type !== 'checkbox') {
        fillTextInput(el, value)
      } else if (el instanceof HTMLTextAreaElement) {
        fillTextInput(el, value)
      } else if (el instanceof HTMLSelectElement) {
        fillSelect(el, value)
      } else if (el.contentEditable === 'true' || el.getAttribute('role') === 'textbox') {
        fillContentEditable(el, value)
      } else {
        skipped++
        continue
      }
      filled++
      await sleep(FILL_DELAY_MS)
    } catch {
      failed.push(field.field_id)
    }
  }

  return { filled, skipped, failed }
}
