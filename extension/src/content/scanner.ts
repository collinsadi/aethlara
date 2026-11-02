import { comboHasValue, loadComboOptions } from './combobox'
import {
  byIdNear,
  deepElements,
  isOwnUi,
  isRealTextControl,
  isVisible,
  looksLikeHoneypot,
  textOf,
} from './dom'
import type { FieldHandle, FieldKind, FileRole, ScannedField } from './fields'
import { cleanLabel, collapse, hasRequiredMarker, humanize, isPlaceholderOption, norm } from './text'

/**
 * Field scanner
 * -------------
 * Finds every answerable control under a form root and describes it the way
 * a person reads the form: one entry per question (a radio group is one
 * field whose options are the radio labels), with the question text, whether
 * it is required, its section heading and help text. Hidden, disabled and
 * honeypot inputs are skipped; hidden file inputs behind upload widgets and
 * visually-hidden radios behind styled labels are kept.
 */

const CANDIDATES =
  'input, select, textarea, [contenteditable="true"], [contenteditable=""], [role="combobox"], [role="radio"], [role="checkbox"], [role="switch"], button'

const SKIP_INPUT_TYPES = new Set(['hidden', 'submit', 'button', 'reset', 'image', 'password', 'range', 'color'])

/** Controls that belong to other questions: used to stop label searches. */
const FIELD_CONTROL = 'input:not([type="hidden"]), select, textarea, [role="combobox"], [contenteditable="true"]'

const GENERIC_LABEL =
  /^(attach|attach file|upload|upload file|browse|choose file|choose files|select file|drop files? here|or|enter manually|select\.\.\.|select…|select|choose|type here\.?\.?\.?|type your response|your answer|search|start typing\.?\.?\.?)$/i

const EXCLUDED_REGIONS =
  'header, nav, footer, [role="search"], [role="navigation"], [role="banner"], [role="contentinfo"], [id*="cookie" i], [class*="cookie" i], [id*="consent-banner" i], [class*="consent-banner" i], [id^="onetrust" i], [class*="onetrust" i], [id*="newsletter" i], [class*="newsletter" i]'

export interface ScanOptions {
  /** Open custom dropdowns to read their options (slow; once per step). */
  readComboOptions?: boolean
  /** Leave file inputs out (the legacy job autofill cannot fill files). */
  excludeFiles?: boolean
  /** Adapter hook: return true to ignore an element. */
  skip?: (el: Element) => boolean
}

interface ScanContext {
  root: Element
  all: Element[]
  usedIds: Set<string>
  seenGroups: Set<Element | string>
  headings: HTMLElement[]
  rootIsDocument: boolean
}

// ── Labels ────────────────────────────────────────────────────────────────────

interface LabelText {
  text: string
  raw: string
  el: Element | null
}

function labelFromElement(el: Element): LabelText {
  // Prefer an inner "label/title/question" element (Lever wraps the whole field in <label>).
  const inner = el.querySelector(':scope [class*="label" i]:not(input), :scope [class*="question" i], :scope [class*="title" i]')
  const source = inner && !inner.querySelector(FIELD_CONTROL) ? inner : el
  const raw = textOf(source)
  return { text: cleanLabel(raw), raw, el }
}

function labelledBy(el: Element): LabelText | null {
  const ids = (el.getAttribute('aria-labelledby') ?? '').split(/\s+/).filter(Boolean)
  if (!ids.length) return null
  const parts = ids.map((id) => byIdNear(el, id)).filter((n): n is HTMLElement => !!n)
  if (!parts.length) return null
  const raw = parts.map((p) => textOf(p)).join(' ')
  const text = cleanLabel(raw)
  return text ? { text, raw, el: parts[0] } : null
}

function containsOtherControl(node: Element, members: Element[]): boolean {
  const controls = node.matches(FIELD_CONTROL) ? [node] : Array.from(node.querySelectorAll(FIELD_CONTROL))
  return controls.some((c) => !members.some((m) => m === c || m.contains(c) || c.contains(m)) && !isHiddenHelper(c))
}

function isHiddenHelper(el: Element): boolean {
  // react-select's "required" shim and similar invisible helpers
  return el.getAttribute('aria-hidden') === 'true' || (el instanceof HTMLInputElement && el.tabIndex === -1 && !isVisible(el))
}

/**
 * The question text printed near a control: walks up from the control and
 * takes the closest preceding sibling with text, stopping before it would
 * reach text that belongs to another question.
 */
function questionNear(anchor: Element, members: Element[], root: Element): LabelText | null {
  let child: Element = anchor
  let parent = anchor.parentElement
  for (let depth = 0; parent && depth < 6; depth++) {
    for (let sib = child.previousElementSibling; sib; sib = sib.previousElementSibling) {
      if (isOwnUi(sib)) continue
      if (containsOtherControl(sib, members)) return null
      const raw = textOf(sib)
      if (raw && raw.length <= 400) {
        const text = cleanLabel(raw)
        if (text && !GENERIC_LABEL.test(text)) return { text, raw, el: sib }
      }
    }
    if (parent === root || containsOtherControl(parent, members)) return null
    if (parent.matches('fieldset')) {
      const legend = parent.querySelector(':scope > legend')
      if (legend) return labelFromElement(legend)
    }
    child = parent
    parent = parent.parentElement
  }
  return null
}

function controlLabel(el: HTMLElement, root: Element): LabelText {
  const by = labelledBy(el)
  if (by && !GENERIC_LABEL.test(by.text)) return by
  const labels = (el as HTMLInputElement).labels ? Array.from((el as HTMLInputElement).labels ?? []) : []
  for (const label of labels) {
    const l = labelFromElement(label)
    if (l.text && !GENERIC_LABEL.test(l.text)) return l
  }
  const aria = el.getAttribute('aria-label')
  if (aria && !GENERIC_LABEL.test(cleanLabel(aria))) return { text: cleanLabel(aria), raw: aria, el: null }
  const near = questionNear(el, [el], root)
  if (near) return near
  const placeholder = el.getAttribute('placeholder')
  if (placeholder && !GENERIC_LABEL.test(cleanLabel(placeholder))) return { text: cleanLabel(placeholder), raw: placeholder, el: null }
  const title = el.getAttribute('title')
  if (title) return { text: cleanLabel(title), raw: title, el: null }
  return { text: humanize(el.getAttribute('name') || el.id), raw: '', el: null }
}

/** The question title of a fieldset / field entry: <legend>, or a leading <label> that is not an option's label. */
function entryHeading(container: Element, members: HTMLElement[]): Element | null {
  const entry = container.closest('fieldset, [data-field-path], [class*="field-entry" i], [class*="fieldEntry"]')
  if (!entry || !members.every((m) => entry.contains(m))) return null
  const memberIds = new Set(members.map((m) => m.id).filter(Boolean))
  for (const candidate of Array.from(entry.querySelectorAll(':scope > legend, :scope > label, :scope > [class*="question-title" i]'))) {
    const target = candidate.getAttribute('for')
    if (target && memberIds.has(target)) continue
    if (candidate.querySelector('input, select, textarea')) continue
    return candidate
  }
  return null
}

function groupLabel(groupRoot: Element | null, members: HTMLElement[], root: Element): LabelText {
  const container = groupRoot ?? commonAncestor(members)
  if (container) {
    const by = labelledBy(container)
    if (by) return by
    const aria = container.getAttribute('aria-label')
    if (aria) return { text: cleanLabel(aria), raw: aria, el: null }
    const heading = entryHeading(container, members)
    if (heading) {
      const l = labelFromElement(heading)
      if (l.text) return l
    }
    const near = questionNear(container, members, root)
    if (near) return near
  }
  return { text: humanize(members[0]?.getAttribute('name') ?? ''), raw: '', el: null }
}

function optionLabel(member: HTMLElement): string {
  const labels = (member as HTMLInputElement).labels ? Array.from((member as HTMLInputElement).labels ?? []) : []
  for (const label of labels) {
    const t = collapse(textOf(label))
    if (t) return t
  }
  const by = labelledBy(member)
  if (by?.text) return by.text
  const aria = member.getAttribute('aria-label')
  if (aria) return collapse(aria)
  if (!(member instanceof HTMLInputElement)) {
    const own = collapse(member.textContent)
    if (own) return own
  }
  const next = member.nextElementSibling
  if (next && !next.matches(FIELD_CONTROL)) {
    const t = collapse(textOf(next))
    if (t) return t
  }
  const value = (member as HTMLInputElement).value
  return collapse(value === 'on' ? '' : value)
}

function commonAncestor(nodes: Element[]): HTMLElement | null {
  if (!nodes.length) return null
  let anc: HTMLElement | null = nodes[0].parentElement
  while (anc && !nodes.every((n) => anc!.contains(n))) anc = anc.parentElement
  return anc
}

// ── Required / help / section ────────────────────────────────────────────────

function isRequired(el: Element, label: LabelText, extra: Element[] = []): boolean {
  for (const node of [el, ...extra]) {
    if ((node as HTMLInputElement).required) return true
    if (node.getAttribute('aria-required') === 'true') return true
  }
  if (hasRequiredMarker(label.raw)) return true
  const labelEl = label.el as HTMLElement | null
  if (labelEl) {
    const cls = typeof labelEl.className === 'string' ? labelEl.className : ''
    if (/required/i.test(cls) && !/not-required|optional/i.test(cls)) return true
    if (labelEl.querySelector('.required, [class*="required" i], abbr[title*="required" i]')) return true
  }
  if (el.closest('[aria-required="true"], .required-field')) return true
  // The question title of the field entry (Ashby: <label class="…_required_…"> on the fieldset).
  const entry = el.closest('fieldset, [data-field-path], [class*="field-entry" i], [class*="fieldEntry"]')
  const heading = entry?.querySelector(':scope > label, :scope > legend, :scope > [class*="question-title" i]')
  if (heading && heading !== labelEl) {
    const cls = typeof heading.className === 'string' ? heading.className : ''
    if (/required/i.test(cls) && !/not-required|optional/i.test(cls)) return true
    if (hasRequiredMarker(textOf(heading))) return true
  }
  return false
}

function helpText(el: Element, container: Element | null): string {
  const parts: string[] = []
  const ids = (el.getAttribute('aria-describedby') ?? '').split(/\s+/).filter((id) => id && !/error|placeholder|live-region|counter/i.test(id))
  for (const id of ids) {
    const node = byIdNear(el, id)
    if (node && !/error/i.test(typeof node.className === 'string' ? node.className : '')) {
      const t = textOf(node)
      if (t) parts.push(t)
    }
  }
  if (!parts.length && container) {
    const desc = container.querySelector('[class*="description" i], [class*="help" i]:not(button), [class*="hint" i], [class*="instruction" i]')
    if (desc && !desc.querySelector(FIELD_CONTROL)) {
      const t = textOf(desc)
      if (t) parts.push(t)
    }
  }
  const text = collapse(parts.join(' '))
  return text.length > 300 ? `${text.slice(0, 299)}…` : text
}

function collectHeadings(root: Element, skip?: (el: Element) => boolean): HTMLElement[] {
  return Array.from(
    root.querySelectorAll<HTMLElement>('h1, h2, h3, h4, h5, h6, [role="heading"], [class*="section-header" i], [class*="section-title" i], [class*="sectionTitle"]'),
  ).filter((h) => {
    if (skip?.(h)) return false
    const t = textOf(h)
    return t.length > 0 && t.length <= 120 && isVisible(h)
  })
}

function sectionFor(el: Element, headings: HTMLElement[], label: string): string {
  let found = ''
  for (const h of headings) {
    if (h.contains(el)) continue
    if (h.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING) {
      const t = cleanLabel(textOf(h), 200)
      if (t && t !== label) found = t
    } else {
      break
    }
  }
  return found
}

// ── Widgets ───────────────────────────────────────────────────────────────────

/** The highest ancestor (≤ 6 levels) that still holds only this field's controls. */
function widgetRoot(el: Element, members: Element[] = [el]): HTMLElement | null {
  let best: HTMLElement | null = el.parentElement
  let node = el.parentElement
  for (let depth = 0; node && depth < 6; depth++) {
    if (containsOtherControl(node, members)) break
    if (node.matches('form, body')) break
    best = node
    node = node.parentElement
  }
  return best
}

function fileRoleOf(label: string, el: HTMLInputElement): FileRole {
  const hay = norm(`${label} ${el.name} ${el.id}`)
  if (/cover letter|coverletter|cover_letter|motivation letter|letter of motivation/.test(hay)) return 'cover_letter'
  if (/resume|cv\b|curriculum|resumé/.test(hay)) return 'resume'
  return 'other'
}

export function containerShowsFile(container: Element | null): boolean {
  if (!container) return false
  const text = collapse(container.textContent)
  if (/\.(pdf|docx?|txt|rtf|odt)\b/i.test(text)) return true
  return Array.from(container.querySelectorAll('button, a, [role="button"]')).some((b) =>
    /^(remove|delete|replace|change)( file)?$/i.test(collapse(b.textContent) || b.getAttribute('aria-label') || ''),
  )
}

// ── Classification ────────────────────────────────────────────────────────────

function makeHandle(kind: FieldKind, el: HTMLElement, partial: Partial<FieldHandle> = {}): FieldHandle {
  return {
    kind,
    el,
    members: [],
    container: null,
    multiple: false,
    fileRole: null,
    options: [],
    optionValues: [],
    optionsLoaded: true,
    ...partial,
  }
}

interface Classified {
  handle: FieldHandle
  label: LabelText
  required: boolean
}

function classifyText(el: HTMLInputElement | HTMLTextAreaElement | HTMLElement, kind: FieldKind, ctx: ScanContext): Classified | null {
  if (!isRealTextControl(el)) return null
  const label = controlLabel(el, ctx.root)
  const handle = makeHandle(kind, el, { container: widgetRoot(el) })
  return { handle, label, required: isRequired(el, label) }
}

function classifySelect(el: HTMLSelectElement, ctx: ScanContext): Classified | null {
  if (el.disabled) return null
  const replacement = el.nextElementSibling
  const visible =
    isVisible(el) ||
    (!!replacement && /select2|chosen|selectize|nice-select|choices/i.test(String(replacement.className)) && isVisible(replacement))
  if (!visible || looksLikeHoneypot(el)) return null
  const options: string[] = []
  const values: string[] = []
  for (const opt of Array.from(el.options)) {
    if (opt.disabled || isPlaceholderOption(opt.text, opt.value)) continue
    options.push(collapse(opt.text))
    values.push(opt.value)
  }
  if (!options.length) return null
  const label = controlLabel(el, ctx.root)
  const handle = makeHandle('select', el, { container: widgetRoot(el), multiple: el.multiple, options, optionValues: values })
  return { handle, label, required: isRequired(el, label) }
}

function classifyFile(el: HTMLInputElement, ctx: ScanContext): Classified | null {
  if (el.disabled) return null
  // parentElement: the input's own class often contains "file"/"upload" too.
  const container =
    el.parentElement?.closest<HTMLElement>('[role="group"], fieldset, [class*="upload" i], [class*="dropzone" i], [class*="file" i]') ??
    widgetRoot(el)
  const widget = container && !containsOtherControl(container, [el]) ? container : widgetRoot(el)
  const visible = isVisible(el) || (!!widget && isVisible(widget))
  if (!visible) return null
  if (widget && /\bauto-?fill\b/i.test(collapse(widget.textContent))) return null // Ashby's "Autofill from resume" pane
  const groupBy = el.closest('[role="group"][aria-labelledby]')
  let label = groupBy ? labelledBy(groupBy) : null
  if (!label || GENERIC_LABEL.test(label.text)) label = controlLabel(el, ctx.root)
  if (!label.text || GENERIC_LABEL.test(label.text)) label = questionNear(widget ?? el, [el], ctx.root) ?? label
  const handle = makeHandle('file', el, { container: widget, fileRole: fileRoleOf(label.text, el) })
  const extra = groupBy ? [groupBy] : []
  return { handle, label, required: isRequired(el, label, extra) }
}

function classifyChoice(el: HTMLInputElement, ctx: ScanContext): Classified | null {
  const type = el.type
  let members: HTMLInputElement[] = []
  let groupRoot: Element | null = null
  const sameName = (x: Element) =>
    x instanceof HTMLInputElement && x.type === type && x.name === el.name && x.form === el.form
  if (el.name) members = ctx.all.filter(sameName) as HTMLInputElement[]
  if (members.length <= 1) {
    // Unnamed (or uniquely named) inputs: group them only under an explicit,
    // labelled group so independent consent checkboxes are not merged.
    const candidate = el.closest('[role="radiogroup"], [role="group"], fieldset')
    const labelled =
      !!candidate &&
      (candidate.hasAttribute('aria-labelledby') ||
        candidate.hasAttribute('aria-label') ||
        !!candidate.querySelector(':scope > legend'))
    const inGroup = candidate && labelled ? Array.from(candidate.querySelectorAll<HTMLInputElement>(`input[type="${type}"]`)) : []
    if (inGroup.length > 1 && inGroup.length <= 40) {
      groupRoot = candidate
      members = inGroup
    } else {
      members = [el]
    }
  }
  const key: Element | string = groupRoot ?? (members.length > 1 && el.name ? `${type}:${el.name}` : el)
  if (ctx.seenGroups.has(key)) return null
  ctx.seenGroups.add(key)
  members = members.filter((m) => !m.disabled && !isOwnUi(m))
  if (!members.length) return null
  const anyVisible = members.some((m) => isVisible(m) || Array.from(m.labels ?? []).some((l) => isVisible(l)))
  if (!anyVisible) return null

  if (type === 'checkbox' && members.length === 1) {
    const own = controlLabel(el, ctx.root)
    const question = questionNear(widgetRoot(el) ?? el, [el], ctx.root)
    // "I agree" under a printed question reads better with both.
    const label: LabelText =
      question && own.text.length < 30 && question.text !== own.text
        ? { text: cleanLabel(`${question.text} (${own.text})`), raw: `${question.raw} ${own.raw}`, el: question.el }
        : own
    const handle = makeHandle('checkbox', el, { members: [el], container: widgetRoot(el), options: ['Yes', 'No'] })
    return { handle, label, required: isRequired(el, label) }
  }

  const root = (groupRoot as HTMLElement | null) ?? commonAncestor(members)
  const label = groupLabel(groupRoot ?? root, members, ctx.root)
  const options = members.map((m) => optionLabel(m))
  const handle = makeHandle(type === 'radio' ? 'radio' : 'checkboxes', root ?? el, {
    members,
    container: root ? widgetRoot(root, members) ?? root : null,
    multiple: type === 'checkbox',
    options,
  })
  return { handle, label, required: members.some((m) => m.required) || isRequired(root ?? el, label, members.slice(0, 1)) }
}

function classifyAriaChoice(el: HTMLElement, role: 'radio' | 'checkbox', ctx: ScanContext): Classified | null {
  const groupRoot = el.closest<HTMLElement>(role === 'radio' ? '[role="radiogroup"]' : '[role="group"], [role="listbox"]')
  const key: Element = groupRoot ?? el
  if (ctx.seenGroups.has(key)) return null
  ctx.seenGroups.add(key)
  const selector = role === 'radio' ? '[role="radio"]' : '[role="checkbox"], [role="switch"]'
  const members = groupRoot ? Array.from(groupRoot.querySelectorAll<HTMLElement>(selector)) : [el]
  if (!members.some((m) => isVisible(m)) || members.some((m) => m.getAttribute('aria-disabled') === 'true')) return null
  if (role === 'checkbox' && members.length === 1) {
    const label = controlLabel(el, ctx.root)
    const handle = makeHandle('checkbox', el, { members: [el], container: widgetRoot(el), options: ['Yes', 'No'] })
    return { handle, label, required: isRequired(el, label) }
  }
  const label = groupLabel(groupRoot, members, ctx.root)
  const handle = makeHandle(role === 'radio' ? 'radio' : 'checkboxes', groupRoot ?? el, {
    members,
    container: groupRoot ? widgetRoot(groupRoot, members) : null,
    multiple: role === 'checkbox',
    options: members.map((m) => optionLabel(m)),
  })
  return { handle, label, required: isRequired(groupRoot ?? el, label) }
}

const YES_NO = /^(yes|no)$/i

function classifyButtons(el: HTMLButtonElement, ctx: ScanContext): Classified | null {
  if (!YES_NO.test(collapse(el.textContent))) return null
  const parent = el.parentElement
  if (!parent || ctx.seenGroups.has(parent)) return null
  const buttons = Array.from(parent.querySelectorAll<HTMLButtonElement>(':scope > button, :scope > * > button')).filter((b) =>
    /^(yes|no|not sure|prefer not to say|n\/a)$/i.test(collapse(b.textContent)),
  )
  // A typeless <button> inside a <form> submits it when clicked: never treat those as answers.
  if (buttons.length < 2 || buttons.length > 4 || buttons.some((b) => b.type === 'submit' && !!b.form)) return null
  ctx.seenGroups.add(parent)
  if (!buttons.some((b) => isVisible(b))) return null
  const label = groupLabel(parent, buttons, ctx.root)
  const handle = makeHandle('buttons', parent, {
    members: buttons,
    container: widgetRoot(parent, buttons) ?? parent,
    options: buttons.map((b) => collapse(b.textContent)),
  })
  // A hidden checkbox/radio next to the buttons often carries `required`.
  const hiddenInput = handle.container?.querySelector('input[type="checkbox"], input[type="radio"]')
  return { handle, label, required: isRequired(parent, label, hiddenInput ? [hiddenInput] : []) }
}

function isComboInput(el: HTMLInputElement): boolean {
  const role = el.getAttribute('role')
  return role === 'combobox' || (el.getAttribute('aria-autocomplete') === 'list' && el.hasAttribute('aria-controls'))
}

function classifyCombo(el: HTMLElement, ctx: ScanContext): Classified | null {
  if (el.getAttribute('aria-disabled') === 'true' || (el as HTMLInputElement).disabled) return null
  const container = widgetRoot(el)
  const visible = isVisible(el) || (!!container && isVisible(container))
  if (!visible) return null
  const label = controlLabel(el, ctx.root)
  const multiple =
    !!container?.querySelector('[class*="--is-multi"], [class*="isMulti"], [aria-multiselectable="true"]') ||
    el.getAttribute('aria-multiselectable') === 'true'
  const handle = makeHandle('combobox', el, { container, multiple, optionsLoaded: false })
  return { handle, label, required: isRequired(el, label) }
}

function inExcludedRegion(el: Element, ctx: ScanContext): boolean {
  if (!ctx.rootIsDocument) return false
  return !!el.closest(EXCLUDED_REGIONS)
}

function classify(el: Element, ctx: ScanContext, opts: ScanOptions): Classified | null {
  if (el instanceof HTMLInputElement) {
    const type = (el.getAttribute('type') || 'text').toLowerCase()
    if (SKIP_INPUT_TYPES.has(type) || el.disabled) return null
    if (type === 'file') return opts.excludeFiles ? null : classifyFile(el, ctx)
    if (type === 'radio' || type === 'checkbox') return classifyChoice(el, ctx)
    if (isComboInput(el)) return classifyCombo(el, ctx)
    if (type === 'search' || el.readOnly) return null
    return classifyText(el, 'text', ctx)
  }
  if (el instanceof HTMLTextAreaElement) {
    if (el.disabled || el.readOnly) return null
    return classifyText(el, 'textarea', ctx)
  }
  if (el instanceof HTMLSelectElement) return classifySelect(el, ctx)
  if (el instanceof HTMLButtonElement) return classifyButtons(el, ctx)
  if (!(el instanceof HTMLElement)) return null
  const role = el.getAttribute('role')
  if (role === 'combobox') return classifyCombo(el, ctx)
  if (role === 'radio') return classifyAriaChoice(el, 'radio', ctx)
  if (role === 'checkbox' || role === 'switch') return classifyAriaChoice(el, 'checkbox', ctx)
  if (el.isContentEditable && !el.parentElement?.closest('[contenteditable="true"], [role="combobox"]')) {
    return classifyText(el, 'richtext', ctx)
  }
  return null
}

const DATE_PLACEHOLDER = /pick (a )?date|select (a )?date|mm\s*\/\s*dd|dd\s*\/\s*mm|yyyy|date of/i

/** The input type, with text inputs that are really date pickers reported as "date-text". */
function textInputType(input: HTMLInputElement): string {
  const type = (input.getAttribute('type') || 'text').toLowerCase()
  if (type !== 'text') return type
  const picker = input.closest('.react-datepicker-wrapper, .react-datepicker__input-container, [class*="datepicker" i], [class*="date-picker" i]')
  return picker || DATE_PLACEHOLDER.test(input.placeholder) ? 'date-text' : 'text'
}

function sanitizeId(raw: string): string {
  return raw.replace(/[^A-Za-z0-9_\-.:[\]]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 100)
}

function fieldId(handle: FieldHandle, ctx: ScanContext): string {
  const anchor = handle.members[0] ?? handle.el
  const base =
    handle.kind === 'radio' || handle.kind === 'checkboxes'
      ? anchor.getAttribute('name') || handle.el.id || anchor.id
      : handle.el.id || handle.el.getAttribute('name') || ''
  const id = sanitizeId(base) || `${handle.kind}_${ctx.usedIds.size + 1}`
  let candidate = id
  for (let n = 2; ctx.usedIds.has(candidate); n++) candidate = `${id}~${n}`
  ctx.usedIds.add(candidate)
  return candidate
}

// ── Public API ────────────────────────────────────────────────────────────────

export function readFilled(f: ScannedField): boolean {
  const h = f.handle
  switch (h.kind) {
    case 'text':
    case 'textarea':
      return (h.el as HTMLInputElement).value.trim().length > 0
    case 'richtext':
      return collapse(h.el.textContent).length > 0
    case 'select': {
      const sel = h.el as HTMLSelectElement
      return Array.from(sel.selectedOptions).some((o) => !isPlaceholderOption(o.text, o.value))
    }
    case 'radio':
    case 'checkboxes':
      return h.members.some((m) => (m instanceof HTMLInputElement ? m.checked : m.getAttribute('aria-checked') === 'true'))
    case 'checkbox': {
      const m = h.members[0] ?? h.el
      return m instanceof HTMLInputElement ? m.checked : m.getAttribute('aria-checked') === 'true'
    }
    case 'buttons':
      return h.members.some(
        (b) =>
          b.getAttribute('aria-pressed') === 'true' ||
          b.getAttribute('aria-checked') === 'true' ||
          b.getAttribute('aria-selected') === 'true' ||
          /(^|[\s_-])(active|selected|checked|isSelected|is-selected)/i.test(String(b.className)),
      )
    case 'combobox':
      return comboHasValue(h)
    case 'file': {
      const input = h.el as HTMLInputElement
      return (input.files?.length ?? 0) > 0 || containerShowsFile(h.container)
    }
  }
}

/** Scans the answerable fields under `root` in document order. */
export async function scanForm(root: Element, opts: ScanOptions = {}): Promise<ScannedField[]> {
  const all = deepElements(root).filter((el) => el.matches(CANDIDATES) && !isOwnUi(el))
  const ctx: ScanContext = {
    root,
    all,
    usedIds: new Set(),
    seenGroups: new Set(),
    headings: collectHeadings(root, opts.skip),
    rootIsDocument: root === document.body || root === document.documentElement,
  }
  const fields: ScannedField[] = []
  for (const el of all) {
    if (inExcludedRegion(el, ctx) || opts.skip?.(el)) continue
    const c = classify(el, ctx, opts)
    if (!c) continue
    const { handle, label, required } = c
    const input = handle.el as HTMLInputElement
    fields.push({
      id: fieldId(handle, ctx),
      label: label.text,
      required,
      inputType: handle.kind === 'text' ? textInputType(input) : '',
      name: (handle.members[0] ?? handle.el).getAttribute('name') ?? '',
      placeholder: cleanLabel(handle.el.getAttribute('placeholder') ?? '', 200),
      section: sectionFor(handle.el, ctx.headings, label.text),
      help: helpText(handle.el, handle.container),
      handle,
    })
    if (fields.length >= 400) break
  }
  if (opts.readComboOptions) {
    for (const f of fields) {
      if (f.handle.kind !== 'combobox' || f.handle.optionsLoaded) continue
      f.handle.options = await loadComboOptions(f.handle)
      f.handle.optionsLoaded = true
    }
  }
  return fields
}

/** Number of visible answerable controls under root (cheap; no combobox opening). */
export async function countFields(root: Element): Promise<number> {
  return (await scanForm(root, {})).length
}
