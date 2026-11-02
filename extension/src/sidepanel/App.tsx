import { useState } from 'react'
import type { ExtJob } from '@/types'
import { BackIcon, GearIcon, LogoIcon, Spinner } from './components/ui'
import { useOverview } from './hooks/useAgent'
import { useAuth, useRunnerState } from './hooks/useStorage'
import { AutopilotPage } from './pages/AutopilotPage'
import { ReviewPage } from './pages/ReviewPage'
import { SettingsPage } from './pages/SettingsPage'
import { SignInPage } from './pages/SignInPage'
import { ThisPage, type LegacyRoute } from './pages/ThisPage'
import { ExtractionPage } from './pages/legacy/ExtractionPage'
import { JobDetailPage } from './pages/legacy/JobDetailPage'
import { JobPickerPage } from './pages/legacy/JobPickerPage'

type Tab = 'autopilot' | 'review' | 'page'

type Overlay = { name: 'settings' } | { name: LegacyRoute } | { name: 'job'; job: ExtJob } | null

const OVERLAY_TITLES: Record<string, string> = {
  settings: 'Settings',
  job_picker: 'Saved jobs',
  job: 'Autofill',
  extract: 'Extract job',
}

export function App() {
  const { device, loaded, connect } = useAuth()
  const runner = useRunnerState()
  const [tab, setTab] = useState<Tab>('autopilot')
  const [overlay, setOverlay] = useState<Overlay>(null)
  const overview = useOverview(!!device)

  if (!loaded) {
    return (
      <div className="app" style={{ alignItems: 'center', justifyContent: 'center' }}>
        <Spinner large />
      </div>
    )
  }
  if (!device) {
    return (
      <div className="app">
        <SignInPage connect={connect} />
      </div>
    )
  }

  const newLeads = overview.data?.counts.leads.new ?? 0
  const working = !!runner.current

  const back = () => {
    if (overlay?.name === 'job') setOverlay({ name: 'job_picker' })
    else setOverlay(null)
  }

  return (
    <div className="app">
      <header className="app-header">
        <div className="app-title-row app-header-row">
          {overlay ? (
            <button className="icon-btn" onClick={back} aria-label="Back">
              <BackIcon />
            </button>
          ) : (
            <span className="brand-mark">
              <LogoIcon />
            </span>
          )}
          <div className="app-title">
            <strong>{overlay ? OVERLAY_TITLES[overlay.name] : 'Aethlara'}</strong>
            <span>{overlay ? device.user.full_name : working ? 'Applying…' : device.user.full_name || device.user.email}</span>
          </div>
          {!overlay && (
            <button className="icon-btn" onClick={() => setOverlay({ name: 'settings' })} aria-label="Settings">
              <GearIcon />
            </button>
          )}
        </div>
        {!overlay && (
          <nav className="tabs" role="tablist">
            <button role="tab" aria-selected={tab === 'autopilot'} className={`tab${tab === 'autopilot' ? ' active' : ''}`} onClick={() => setTab('autopilot')}>
              Autopilot
            </button>
            <button role="tab" aria-selected={tab === 'review'} className={`tab${tab === 'review' ? ' active' : ''}`} onClick={() => setTab('review')}>
              Review
              {newLeads > 0 && <span className="count">{newLeads > 99 ? '99+' : newLeads}</span>}
            </button>
            <button role="tab" aria-selected={tab === 'page'} className={`tab${tab === 'page' ? ' active' : ''}`} onClick={() => setTab('page')}>
              This page
            </button>
          </nav>
        )}
      </header>

      {overlay?.name === 'settings' && <SettingsPage device={device} />}
      {overlay?.name === 'job_picker' && <JobPickerPage onSelect={(job) => setOverlay({ name: 'job', job })} />}
      {overlay?.name === 'job' && <JobDetailPage job={overlay.job} />}
      {overlay?.name === 'extract' && <ExtractionPage onDone={() => setOverlay(null)} />}

      {!overlay && tab === 'autopilot' && <AutopilotPage runner={runner} onReview={() => setTab('review')} />}
      {!overlay && tab === 'review' && <ReviewPage />}
      {!overlay && tab === 'page' && <ThisPage runner={runner} onNavigate={(name) => setOverlay({ name })} />}
    </div>
  )
}
