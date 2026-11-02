import type { FormField } from '@/types'

/**
 * How a scanned field is driven.
 *  text/textarea/richtext  type into it
 *  select                  native <select> (single or multiple)
 *  radio                   one choice from a group of radios (native or ARIA)
 *  checkboxes              several choices from a group of checkboxes
 *  checkbox                one stand-alone checkbox (answered Yes / No)
 *  buttons                 Yes / No button pairs (Ashby-style)
 *  combobox                custom dropdown / autocomplete (react-select, ARIA)
 *  file                    file input (resume, cover letter, other)
 */
export type FieldKind =
  | 'text'
  | 'textarea'
  | 'richtext'
  | 'select'
  | 'radio'
  | 'checkboxes'
  | 'checkbox'
  | 'buttons'
  | 'combobox'
  | 'file'

export type FileRole = 'resume' | 'cover_letter' | 'other'

export interface FieldHandle {
  kind: FieldKind
  /** Primary element: the input / select / textarea / combobox / group root. */
  el: HTMLElement
  /** Group members (radios, checkboxes, buttons) aligned with `options`. */
  members: HTMLElement[]
  /** The field's widget wrapper, used for value checks and error lookup. */
  container: HTMLElement | null
  multiple: boolean
  fileRole: FileRole | null
  /** Every option text (the server only gets 150 of them). */
  options: string[]
  /** <select> option values aligned with `options`. */
  optionValues: string[]
  optionsLoaded: boolean
}

export interface ScannedField {
  id: string
  label: string
  required: boolean
  /** The value input type for text fields (email, tel, url, number, date…). */
  inputType: string
  name: string
  placeholder: string
  section: string
  help: string
  handle: FieldHandle
}

const LONG_LIST_LIMIT = 150

function clip(text: string, max: number): string {
  return text.length > max ? text.slice(0, max) : text
}

function serverType(field: ScannedField): string {
  switch (field.handle.kind) {
    case 'text':
      return field.inputType === 'date-text' ? 'date' : field.inputType || 'text'
    case 'textarea':
    case 'richtext':
      return 'textarea'
    case 'select':
      return 'select'
    case 'radio':
    case 'buttons':
      return 'radio'
    case 'checkboxes':
    case 'checkbox':
      return 'checkbox'
    case 'combobox':
      return 'combobox'
    case 'file':
      return 'file'
  }
}

function fallbackChoices(options: string[]): string {
  const picks = options.filter((o) => /\bother\b|not listed|none of|prefer not|decline|n\/a/i.test(o)).slice(0, 5)
  return picks.length ? ` Fallback options: ${picks.join('; ')}.` : ''
}

/** The shape sent to POST /agent/applications/:id/fill. */
export function toFormField(field: ScannedField): FormField {
  const h = field.handle
  const out: FormField = {
    field_id: field.id,
    label: clip(field.label || field.placeholder || 'Untitled field', 500),
    type: serverType(field),
    required: field.required,
  }
  if (field.name) out.name = clip(field.name, 120)
  if (field.placeholder) out.placeholder = clip(field.placeholder, 200)
  if (field.section) out.section = clip(field.section, 200)

  const notes: string[] = []
  if (field.help) notes.push(field.help)
  if (h.kind === 'checkbox') {
    out.options = ['Yes', 'No']
    notes.push('Single checkbox: "Yes" ticks it, "No" leaves it unticked.')
  } else if (h.options.length > LONG_LIST_LIMIT) {
    notes.push(`Long list of ${h.options.length} options: answer with the exact option text.${fallbackChoices(h.options)}`)
  } else if (h.options.length) {
    out.options = h.options.map((o) => clip(o, 200))
  } else if (h.kind === 'combobox') {
    notes.push('Search-as-you-type field: answer with the text to search for (for example a city name).')
  }
  if (h.multiple && h.options.length) notes.push('Several answers allowed: join them with " | ".')
  if (field.inputType === 'date-text') notes.push('Date field: answer with a calendar date as YYYY-MM-DD.')
  if (h.kind === 'file' && h.fileRole === 'resume') notes.push('Resume upload.')
  if (h.kind === 'file' && h.fileRole === 'cover_letter') notes.push('Cover letter upload.')
  if (notes.length) out.help = clip(notes.join(' '), 500)
  return out
}

/** Required fields first (they matter most), then document order; at most `limit`. */
export function prioritise(fields: ScannedField[], limit = 150): ScannedField[] {
  if (fields.length <= limit) return fields
  const required = fields.filter((f) => f.required)
  const optional = fields.filter((f) => !f.required)
  const keep = new Set([...required, ...optional].slice(0, limit))
  return fields.filter((f) => keep.has(f))
}
