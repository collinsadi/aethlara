/**
 * Page text extraction for job listings.
 *
 * Design notes
 * ------------
 * Many job boards (LinkedIn, Lever, Greenhouse, Workable, etc.) place the
 * actual job description in elements with role="complementary" or inside
 * <aside>. Previously we stripped those, which caused "Not enough text…"
 * errors on pages that obviously DID have a job. We now only remove
 * definitely-noise elements (scripts, styles, nav menus, iframes, hidden
 * nodes) and keep everything else.
 *
 * Also exposes `extractPageTextFromDocument(doc)` so the popup can inject
 * this function directly via chrome.scripting.executeScript and not depend
 * on the content script being present.
 */

const REMOVE_SELECTORS = [
  'script', 'style', 'noscript', 'iframe',
  'nav', 'header', 'footer',
  '[aria-hidden="true"]',
  '[role="navigation"]', '[role="banner"]',
].join(', ')

const MAX_CHARS = 50_000

export function extractPageTextFromDocument(doc: Document): string {
  const body = doc.body
  if (!body) return ''

  const clone = body.cloneNode(true) as HTMLElement
  clone.querySelectorAll(REMOVE_SELECTORS).forEach((el) => el.remove())

  const text = (clone.innerText || clone.textContent || '').replace(/\s+/g, ' ').trim()
  return text.slice(0, MAX_CHARS)
}

export function extractPageText(): string {
  return extractPageTextFromDocument(document)
}
