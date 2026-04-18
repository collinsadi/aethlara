import type { ScannedField } from '@/types'

const FILLABLE_SELECTORS = [
  'input[type="text"]',
  'input[type="email"]',
  'input[type="tel"]',
  'input[type="url"]',
  'input[type="number"]',
  'input:not([type])',
  'textarea',
  'select',
  'input[type="radio"]',
  'input[type="checkbox"]',
  '[contenteditable="true"]',
  '[role="textbox"]',
  '[role="combobox"]',
].join(', ')

const SKIP_TYPES = new Set(['hidden', 'password', 'file', 'submit', 'reset', 'button', 'image'])

function isVisible(el: Element): boolean {
  const style = window.getComputedStyle(el)
  if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') return false
  const rect = el.getBoundingClientRect()
  return rect.width > 0 && rect.height > 0
}

function resolveLabel(el: HTMLElement): string {
  const id = el.id
  if (id) {
    const label = document.querySelector<HTMLLabelElement>(`label[for="${CSS.escape(id)}"]`)
    if (label) return label.innerText.trim()
  }
  const aria = el.getAttribute('aria-label')
  if (aria) return aria.trim()

  const labelledBy = el.getAttribute('aria-labelledby')
  if (labelledBy) {
    const ref = document.getElementById(labelledBy)
    if (ref) return ref.innerText.trim()
  }
  if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
    if (el.placeholder) return el.placeholder
  }
  // Walk up to find nearest text label
  let parent = el.parentElement
  for (let i = 0; i < 3 && parent; i++, parent = parent.parentElement) {
    const text = (parent as HTMLElement).innerText?.split('\n')[0]?.trim()
    if (text && text.length < 80 && text.length > 1) return text
  }
  return (el as HTMLInputElement).name ?? ''
}

function getOptions(el: HTMLSelectElement): string[] {
  return Array.from(el.options).map((o) => o.text.trim()).filter(Boolean)
}

function generateFieldId(el: HTMLElement, index: number): string {
  const name = (el as HTMLInputElement).name ?? ''
  const label = resolveLabel(el)
  const tag = el.tagName.toLowerCase()
  const raw = `${tag}:${name}:${label}:${index}`
  // Simple djb2 hash for determinism
  let hash = 5381
  for (let i = 0; i < raw.length; i++) {
    hash = ((hash << 5) + hash) ^ raw.charCodeAt(i)
  }
  return `field_${(hash >>> 0).toString(16)}`
}

function getSelector(el: HTMLElement, index: number): string {
  if (el.id) return `#${CSS.escape(el.id)}`
  if ((el as HTMLInputElement).name) return `[name="${CSS.escape((el as HTMLInputElement).name)}"]`
  return `${el.tagName.toLowerCase()}:nth-of-type(${index + 1})`
}

export function scanFields(): ScannedField[] {
  const all = document.querySelectorAll<HTMLElement>(FILLABLE_SELECTORS)
  const results: ScannedField[] = []
  let index = 0

  for (const el of all) {
    if (el.closest('iframe')) continue // skip cross-origin iframes

    if (el instanceof HTMLInputElement) {
      if (SKIP_TYPES.has(el.type)) continue
      if (el.disabled) continue
    }
    if (!isVisible(el)) continue

    const type = el instanceof HTMLInputElement
      ? el.type || 'text'
      : el instanceof HTMLTextAreaElement
        ? 'textarea'
        : el instanceof HTMLSelectElement
          ? 'select'
          : el.getAttribute('role') ?? el.tagName.toLowerCase()

    const currentValue = el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement
      ? el.value
      : (el as HTMLElement).innerText ?? ''

    // Skip already-filled fields
    if (currentValue.trim().length > 0 && type !== 'select') {
      index++
      continue
    }

    const label = resolveLabel(el)
    const field: ScannedField = {
      field_id: generateFieldId(el, index),
      label,
      type,
      name: (el as HTMLInputElement).name || null,
      placeholder: (el as HTMLInputElement).placeholder || null,
      required: (el as HTMLInputElement).required ?? false,
      options: el instanceof HTMLSelectElement ? getOptions(el) : null,
      selector: getSelector(el, index),
      value: currentValue,
      visible: true,
    }
    results.push(field)
    index++
  }

  return results
}
