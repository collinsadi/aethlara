import { embeddedFormFrame, findBestFormRoot } from '../detect'
import { fireClick, isVisible, waitFor } from '../dom'
import { collapse } from '../text'
import type { Adapter } from './types'

const APPLY_CTA = /^(apply|apply now|apply for (this|the) (job|position|role)|apply online|start (your )?application|begin application|i'?m interested)$/i

function findApplyCta(): HTMLElement | null {
  const els = Array.from(document.querySelectorAll<HTMLElement>('a[href], button, [role="button"]'))
  return els.find((el) => APPLY_CTA.test(collapse(el.innerText || el.getAttribute('aria-label') || '')) && isVisible(el)) ?? null
}

function isNavigableHref(a: HTMLAnchorElement): boolean {
  const href = a.getAttribute('href') ?? ''
  if (!href || href.startsWith('#') || /^javascript:/i.test(href)) return false
  try {
    const url = new URL(a.href)
    return url.protocol === 'https:' || url.protocol === 'http:'
  } catch {
    return false
  }
}

/** Fallback for unknown sites: largest form on the page, one hop to an apply link or embedded ATS form. */
export const genericAdapter: Adapter = {
  id: 'generic',
  findForm: findBestFormRoot,
  async prepare() {
    if (findBestFormRoot()) return
    const frame = embeddedFormFrame()
    if (frame) return { navigateTo: frame.src }
    const cta = findApplyCta()
    if (!cta) return
    if (cta instanceof HTMLAnchorElement && isNavigableHref(cta)) return { navigateTo: cta.href }
    fireClick(cta)
    await waitFor(() => findBestFormRoot() ?? embeddedFormFrame(), 10_000)
    const frameAfter = embeddedFormFrame()
    if (!findBestFormRoot() && frameAfter) return { navigateTo: frameAfter.src }
  },
}
