import { useEffect, useState } from 'react'
import { API_ORIGIN, DASHBOARD_LINKS } from '@/lib/config'
import { hostOf } from '@/lib/util'
import type { ConnectStatus } from '@/lib/storage'
import { LogoIcon, Notice, Spinner, openTab } from '../components/ui'

const WAIT_MS = 3 * 60_000

export function SignInPage({ connect }: { connect: ConnectStatus | null }) {
  const [waitingSince, setWaitingSince] = useState<number | null>(null)
  const [timedOut, setTimedOut] = useState(false)

  useEffect(() => {
    if (!waitingSince) return
    const t = setTimeout(() => setTimedOut(true), Math.max(0, waitingSince + WAIT_MS - Date.now()))
    return () => clearTimeout(t)
  }, [waitingSince])

  const start = () => {
    setTimedOut(false)
    setWaitingSince(Date.now())
    openTab(DASHBOARD_LINKS.connectExtension)
  }

  const connecting = connect?.state === 'connecting' && Date.now() - connect.at < 60_000
  const failed = connect?.state === 'error' && (!waitingSince || connect.at >= waitingSince - 5_000) ? connect : null
  const waiting = !!waitingSince && !timedOut && !failed

  return (
    <div className="page" style={{ justifyContent: 'center', paddingTop: 40 }}>
      <div className="stack center" style={{ alignItems: 'center', gap: 10 }}>
        <span className="brand-mark" style={{ width: 44, height: 44, borderRadius: 12 }}>
          <LogoIcon />
        </span>
        <p style={{ fontSize: 16, fontWeight: 700 }}>Connect Aethlara</p>
        <p className="muted small" style={{ maxWidth: 280 }}>
          The extension is the autopilot's hands: it fills and submits the applications you approve, right here in your
          browser.
        </p>
      </div>

      <div className="card stack" style={{ gap: 10 }}>
        <ol className="small muted" style={{ margin: 0, paddingLeft: 18, display: 'flex', flexDirection: 'column', gap: 4 }}>
          <li>Open the dashboard and sign in.</li>
          <li>
            In <span style={{ color: 'var(--fg)' }}>Settings → Extension</span>, click <span style={{ color: 'var(--fg)' }}>Connect Chrome extension</span>.
          </li>
          <li>This panel connects on its own. You stay connected until you sign out.</li>
        </ol>
        <button className="btn btn-primary btn-full" onClick={start} disabled={connecting}>
          {waiting || connecting ? 'Open the dashboard again' : 'Open dashboard to connect'}
        </button>
        {(waiting || connecting) && (
          <div className="row small muted" style={{ justifyContent: 'center' }}>
            <Spinner />
            {connecting ? 'Connecting…' : 'Waiting for the dashboard…'}
          </div>
        )}
        {timedOut && !failed && <Notice tone="warn">Still not connected. Open the dashboard and click Connect extension again.</Notice>}
        {failed && <Notice tone="error">{failed.message ?? 'Connecting failed. Try again.'}</Notice>}
      </div>

      <p className="tiny faint center">
        The extension only talks to {hostOf(API_ORIGIN) || 'the Aethlara API'} and never sees your password.
      </p>
    </div>
  )
}
