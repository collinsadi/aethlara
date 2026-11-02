import type { ScannedField } from '../fields'

export type AdapterId = 'greenhouse' | 'lever' | 'ashby' | 'generic'

/**
 * Per-ATS knowledge layered on top of the generic scanner/filler. Every hook
 * is optional except findForm; the generic adapter is the fallback.
 */
export interface Adapter {
  id: AdapterId
  /**
   * Bring the application form on screen (e.g. Ashby's "Application" tab).
   * Returns a URL when the form lives on another page (apply link, iframe).
   */
  prepare?(): Promise<{ navigateTo?: string } | void>
  /** The element that contains the application form, once rendered. */
  findForm(): Element | null
  /** The ATS's own submit button, when generic detection would be unsure. */
  findSubmit?(root: Element): HTMLElement | null
  /** An ATS-specific success marker (message), or null. */
  confirmation?(): string | null
  /** Elements the scanner must ignore (e.g. "Autofill from resume" panes). */
  skip?(el: Element): boolean
  /** Runs after files are attached (resume parsing can rewrite fields). */
  afterFiles?(root: Element): Promise<void>
  /** Field-specific filling. Return null to fall back to the generic filler. */
  fill?(field: ScannedField, value: string): Promise<boolean | null>
  /** Paste the cover letter as text when its file cannot be attached. */
  coverLetterAsText?(root: Element, text: string): Promise<boolean>
}
