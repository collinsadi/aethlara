import { adapterFor } from './adapters'
import { callBackground } from './bridge'
import { showBadge } from './badge'
import { captureBaseline, detectConfirmation, findBestFormRoot } from './detect'
import { isSubmitLike } from './submit'
import type { WatchInfo } from '@/types'

/**
 * Watch mode for applications that need the user (CAPTCHA, review, missing
 * upload…). The tab stays open; when the user submits it themselves and a
 * confirmation shows up, the background reports the application submitted.
 * Detection is strict: on the page the user is filling, a confirmation only
 * counts after they pressed a submit button; on a new page it must have no
 * form left.
 */

const WATCH_MS = 2 * 60 * 60_000

let watching: WatchInfo | null = null

function sameDocument(a: string, b: string): boolean {
  return a.split('#')[0] === b.split('#')[0]
}

export function startWatch(info: WatchInfo): boolean {
  if (watching?.appId === info.appId) return false
  watching = info
  const freshPage = !sameDocument(location.href, info.pageUrl)
  const baseline = captureBaseline(document.body)
  let armed = false
  let reported = false

  if (freshPage) {
    showBadge(`Aethlara: finish and submit when you're ready`, 'attention', 8000)
  }

  const onClick = (event: Event) => {
    const target = event.target
    if (target instanceof Element && isSubmitLike(target)) armed = true
  }
  const onSubmit = () => {
    armed = true
  }
  document.addEventListener('click', onClick, true)
  document.addEventListener('submit', onSubmit, true)

  const stop = () => {
    observer.disconnect()
    clearInterval(interval)
    clearTimeout(expiry)
    document.removeEventListener('click', onClick, true)
    document.removeEventListener('submit', onSubmit, true)
    if (watching?.appId === info.appId) watching = null
  }

  const check = () => {
    if (reported || (!armed && !freshPage)) return
    const adapter = adapterFor(location.href)
    const root = adapter.findForm() ?? findBestFormRoot()
    const message = detectConfirmation(adapter.confirmation?.() ?? null, freshPage && !armed ? null : baseline, root)
    if (!message) return
    reported = true
    stop()
    showBadge('Aethlara recorded your application as submitted', 'done', 6000)
    void callBackground({ type: 'WATCH_CONFIRMED', appId: info.appId, url: location.href, message }).catch(() => undefined)
  }

  let pending = false
  const observer = new MutationObserver(() => {
    if (pending) return
    pending = true
    setTimeout(() => {
      pending = false
      check()
    }, 400)
  })
  observer.observe(document.documentElement, { subtree: true, childList: true, characterData: true })
  const interval = setInterval(check, 2000)
  const expiry = setTimeout(stop, WATCH_MS)
  check()
  return true
}
