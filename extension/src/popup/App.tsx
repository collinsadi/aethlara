import { useState, useEffect } from 'react'
import { getSession } from '@/lib/storage'
import { AuthPage } from './pages/AuthPage'
import { HomePage } from './pages/HomePage'
import { JobDetailPage } from './pages/JobDetailPage'
import { ExtractionPage } from './pages/ExtractionPage'
import { JobSearchModal } from './components/JobSearchModal'
import type { ExtJob } from '@/types'

export type Route =
  | { name: 'auth' }
  | { name: 'home' }
  | { name: 'job'; job: ExtJob }
  | { name: 'extract' }
  | { name: 'job_search' }

export function App() {
  const [route, setRoute] = useState<Route>({ name: 'auth' })
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    getSession().then((session) => {
      setRoute(session ? { name: 'home' } : { name: 'auth' })
      setLoading(false)
    })
  }, [])

  if (loading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: 200 }}>
        <div style={{ width: 24, height: 24, border: '2px solid #7c3aed', borderTopColor: 'transparent', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />
        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      </div>
    )
  }

  if (route.name === 'auth') {
    return <AuthPage onAuthed={() => setRoute({ name: 'home' })} />
  }
  if (route.name === 'home') {
    return (
      <HomePage
        onSelectJob={(job) => setRoute({ name: 'job', job })}
        onExtract={() => setRoute({ name: 'extract' })}
        onAutofill={() => setRoute({ name: 'job_search' })}
        onSignOut={() => setRoute({ name: 'auth' })}
      />
    )
  }
  if (route.name === 'job') {
    return (
      <JobDetailPage
        job={route.job}
        onBack={() => setRoute({ name: 'home' })}
      />
    )
  }
  if (route.name === 'extract') {
    return (
      <ExtractionPage
        onBack={() => setRoute({ name: 'home' })}
      />
    )
  }
  if (route.name === 'job_search') {
    return (
      <JobSearchModal
        onSelect={(job) => setRoute({ name: 'job', job })}
        onCancel={() => setRoute({ name: 'home' })}
      />
    )
  }
  return null
}
