import { fillText } from '../filler'
import { fireClick, isVisible, rawText, waitFor, waitForQuiet, yieldTask } from '../dom'
import { bestOptionIndex, collapse } from '../text'
import { clip } from '@/lib/util'
import type { Adapter } from './types'

/**
 * Lever (jobs.lever.co/<company>/<id>/apply): a server-rendered form. The
 * resume upload is parsed in the page and pre-fills name/e-mail/phone, so
 * text fields are filled after it. The visible "Submit application" button
 * is type="button" and runs invisible hCaptcha before submitting; success
 * navigates to …/thanks.
 */

async function fillLocation(input: HTMLInputElement, value: string): Promise<boolean> {
  const typed = await fillText(input, value, 'text')
  if (!typed) return false
  const results = await waitFor(() => {
    const items = Array.from(document.querySelectorAll<HTMLElement>('.dropdown-results > *')).filter((el) => isVisible(el))
    return items.length ? items : null
  }, 5000)
  if (!results) return true // free text is still a valid answer when nothing matches
  const idx = bestOptionIndex(
    value,
    results.map((r) => collapse(r.textContent)),
  )
  fireClick(results[idx >= 0 ? idx : 0])
  await yieldTask()
  return true
}

export const leverAdapter: Adapter = {
  id: 'lever',

  findForm() {
    return document.querySelector('#application-form, form[action*="/apply"]')
  },

  async prepare() {
    if (this.findForm()) return
    if (/\/apply\/?$/.test(location.pathname)) return
    const link = document.querySelector<HTMLAnchorElement>('a.postings-btn[href*="/apply"], a[href$="/apply"]')
    if (link?.href) return { navigateTo: link.href }
  },

  findSubmit(root) {
    return root.querySelector<HTMLElement>('#btn-submit, button[data-qa="btn-submit"]')
  },

  confirmation() {
    if (/\/thanks\/?$/.test(location.pathname)) {
      return clip(rawText(document.querySelector('h3, h2, h1')) || 'Lever confirmation page', 200)
    }
    const marker = document.querySelector<HTMLElement>('[data-qa="msg-submit-success"], .application-confirmation')
    return marker && isVisible(marker) ? clip(rawText(marker), 200) : null
  },

  async afterFiles(root) {
    // "Analyzing resume..." while Lever parses the upload.
    await waitFor(() => {
      const working = root.querySelector<HTMLElement>('.resume-upload-working')
      return !working || !isVisible(working)
    }, 15_000)
    await waitForQuiet(root, 700, 4000)
  },

  async fill(field, value) {
    if (field.handle.el.id === 'location-input' && field.handle.el instanceof HTMLInputElement) {
      return fillLocation(field.handle.el, value)
    }
    return null
  },
}
