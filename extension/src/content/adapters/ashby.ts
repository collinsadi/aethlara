import { fireClick, isVisible, rawText, waitFor } from '../dom'
import { collapse } from '../text'
import { clip } from '@/lib/util'
import type { Adapter } from './types'

/**
 * Ashby (jobs.ashbyhq.com/<company>/<id>/application): a React SPA. The
 * posting page has Overview / Application tabs; the form renders client
 * side. Yes/No questions are button pairs, uploads are drop zones with a
 * hidden input, and an optional "Autofill from resume" pane must be left
 * alone (it would overwrite our answers with parsed values).
 */
export const ashbyAdapter: Adapter = {
  id: 'ashby',

  findForm() {
    // No <form>: the questions, the EEO survey (.ashby-survey-form-container) and the
    // submit button are siblings, so the root is their common parent.
    const container = document.querySelector('.ashby-application-form-container, [class*="ashby-application-form-container"]')
    if (container) {
      const submit = document.querySelector('.ashby-application-form-submit-button')
      let root: Element | null = container.parentElement
      while (root && submit && !root.contains(submit) && root !== document.body) root = root.parentElement
      return container.closest('form') ?? (root && root !== document.body ? root : container)
    }
    const entry = document.querySelector('[class*="application-form-field-entry"], [id^="_systemfield_"]')
    return entry?.closest('form') ?? entry?.parentElement?.parentElement ?? null
  },

  async prepare() {
    if (this.findForm()) return
    const tab = Array.from(document.querySelectorAll<HTMLElement>('a, button, [role="tab"]')).find(
      (el) => /^application$/i.test(collapse(el.textContent)) && isVisible(el),
    )
    if (tab) {
      fireClick(tab)
      await waitFor(() => this.findForm(), 10_000)
    }
  },

  findSubmit() {
    return document.querySelector<HTMLElement>('.ashby-application-form-submit-button, button[class*="submit-button" i]')
  },

  confirmation() {
    const success = document.querySelector<HTMLElement>('.ashby-application-form-success-container, [class*="success-container" i]')
    if (success && isVisible(success)) return clip(rawText(success) || 'Application submitted', 200)
    return null
  },

  skip(el) {
    return !!el.closest('[class*="autofill" i]')
  },
}
