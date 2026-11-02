import { dispatchChange, dispatchInput, fireClick, isVisible, rawText, setNativeValue, waitFor, yieldTask } from '../dom'
import { clip } from '@/lib/util'
import type { Adapter } from './types'

/**
 * Greenhouse job boards (job-boards.greenhouse.io and the embed form
 * /embed/job_app). Fields are React; dropdowns are react-select comboboxes;
 * uploads have "Attach / Dropbox / Enter manually" widgets with a hidden
 * file input; submitting may ask for an 8-character security code that is
 * emailed to the applicant.
 */
export const greenhouseAdapter: Adapter = {
  id: 'greenhouse',

  findForm() {
    return document.querySelector('#application-form, form.application--form, #application_form, form[action*="job_app"]')
  },

  async prepare() {
    if (this.findForm()) return
    // Posting pages render the form further down behind an "Apply" button.
    const apply = Array.from(document.querySelectorAll<HTMLElement>('button, a')).find(
      (el) => /^apply( now| for this job)?$/i.test((el.innerText || '').trim()) && isVisible(el),
    )
    if (apply) {
      fireClick(apply)
      await waitFor(() => this.findForm(), 8000)
    }
  },

  findSubmit(root) {
    return root.querySelector<HTMLElement>('.application--submit button[type="submit"], #submit_app, button[type="submit"].btn')
  },

  confirmation() {
    if (/\/confirmation\b/.test(location.pathname)) {
      const heading = document.querySelector('h1, h2')
      return clip(rawText(heading) || 'Greenhouse confirmation page', 200)
    }
    const marker = document.querySelector<HTMLElement>('#application_confirmation, .application-confirmation, [data-testid*="confirmation" i]')
    if (marker && isVisible(marker)) {
      const text = rawText(marker)
      if (/thank|received|submitted/i.test(text)) return clip(text, 200)
    }
    return null
  },

  async coverLetterAsText(root, text) {
    if (!text.trim()) return false
    const manual =
      root.querySelector<HTMLElement>('[data-testid="cover_letter-text"]') ??
      Array.from(root.querySelectorAll<HTMLElement>('[aria-labelledby="upload-label-cover_letter"] button')).find((b) =>
        /enter manually/i.test(b.innerText || ''),
      ) ??
      null
    let area = root.querySelector<HTMLTextAreaElement>('#cover_letter_text, textarea[name*="cover_letter" i]')
    if (!area && manual) {
      fireClick(manual)
      area = await waitFor(() => root.querySelector<HTMLTextAreaElement>('#cover_letter_text, textarea[name*="cover_letter" i]'), 4000)
    }
    if (!area) return false
    setNativeValue(area, text)
    dispatchInput(area, text)
    dispatchChange(area)
    await yieldTask()
    return area.value.trim().length > 0
  },
}
