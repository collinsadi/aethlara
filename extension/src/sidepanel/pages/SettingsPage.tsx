import { useState } from 'react'
import { deviceName } from '@/background/auth'
import { API_ORIGIN, DASHBOARD_LINKS, EXTENSION_VERSION } from '@/lib/config'
import { sendToBackground } from '@/lib/messaging'
import { errorMessage, hostOf } from '@/lib/util'
import type { DeviceAuth } from '@/lib/storage'
import { ExternalLink, Notice, SectionHead, Toggle } from '../components/ui'
import { useSettings } from '../hooks/useStorage'

const INTERVALS = [5, 10, 15, 20, 30, 45, 60]

export function SettingsPage({ device }: { device: DeviceAuth }) {
  const { settings, update } = useSettings()
  const [confirming, setConfirming] = useState(false)
  const [signingOut, setSigningOut] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const signOut = async () => {
    setSigningOut(true)
    setError(null)
    try {
      await sendToBackground({ type: 'SIGN_OUT' })
    } catch (err) {
      setError(errorMessage(err))
      setSigningOut(false)
    }
  }

  return (
    <div className="page">
      <div className="section">
        <SectionHead title="Account" />
        <div className="card stack">
          <dl className="kv">
            <dt>Name</dt>
            <dd>{device.user.full_name || '—'}</dd>
            <dt>Email</dt>
            <dd title={device.user.email}>{device.user.email || '—'}</dd>
            <dt>This browser</dt>
            <dd>{deviceName()}</dd>
            <dt>Connected</dt>
            <dd>{new Date(device.connectedAt).toLocaleDateString()}</dd>
          </dl>
          {confirming ? (
            <div className="row">
              <span className="small grow">Sign out and disconnect this browser?</span>
              <button className="btn btn-danger btn-sm" disabled={signingOut} onClick={() => void signOut()}>
                {signingOut ? 'Signing out…' : 'Sign out'}
              </button>
              <button className="btn btn-ghost btn-sm" onClick={() => setConfirming(false)}>
                Cancel
              </button>
            </div>
          ) : (
            <button className="btn btn-ghost btn-sm" style={{ alignSelf: 'flex-start' }} onClick={() => setConfirming(true)}>
              Sign out
            </button>
          )}
          {error && <Notice tone="error">{error}</Notice>}
        </div>
      </div>

      <div className="section">
        <SectionHead title="Extension autopilot" />
        <div className="card stack" style={{ gap: 12 }}>
          <div className="row between">
            <div className="grow">
              <p className="bold">Apply automatically</p>
              <p className="small muted">Work the application queue in the background.</p>
            </div>
            <Toggle label="Apply automatically" on={settings.autopilot} onChange={(v) => void update({ autopilot: v })} />
          </div>
          <div className="row between">
            <label className="grow" htmlFor="interval">
              <p className="bold">Check every</p>
              <p className="small muted">Up to 3 applications per check, one at a time.</p>
            </label>
            <select
              id="interval"
              className="select"
              style={{ width: 'auto' }}
              value={settings.intervalMinutes}
              onChange={(e) => void update({ intervalMinutes: Number(e.target.value) })}
            >
              {INTERVALS.map((m) => (
                <option key={m} value={m}>
                  {m} min
                </option>
              ))}
            </select>
          </div>
          <div className="row between">
            <div className="grow">
              <p className="bold">Notifications</p>
              <p className="small muted">Tell me when an application needs me.</p>
            </div>
            <Toggle label="Notifications" on={settings.notifications} onChange={(v) => void update({ notifications: v })} />
          </div>
        </div>
      </div>

      <div className="section">
        <SectionHead title="Dashboard" />
        <div className="card stack">
          <ExternalLink href={DASHBOARD_LINKS.agent}>Autopilot</ExternalLink>
          <ExternalLink href={DASHBOARD_LINKS.agentSettings}>Agent settings and preferences</ExternalLink>
          <ExternalLink href={DASHBOARD_LINKS.applications}>Applications</ExternalLink>
          <ExternalLink href={DASHBOARD_LINKS.inbox}>Agent inbox</ExternalLink>
        </div>
      </div>

      <p className="tiny faint center">
        Aethlara {EXTENSION_VERSION} · API {hostOf(API_ORIGIN)}
      </p>
    </div>
  )
}
