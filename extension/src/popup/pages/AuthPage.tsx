import { useExtensionAuth } from '../hooks/useExtensionAuth'

const DASHBOARD_URL = import.meta.env.VITE_DASHBOARD_URL ?? 'https://app.aethlara.com'

interface Props {
  onAuthed: () => void
}

export function AuthPage({ onAuthed }: Props) {
  const { timedOut } = useExtensionAuth(onAuthed)

  const openDashboard = () => {
    chrome.tabs.create({ url: `${DASHBOARD_URL}/settings#extension` })
  }

  return (
    <div style={{ padding: 20, textAlign: 'center', paddingTop: 32 }}>
      <div style={{ width: 40, height: 40, borderRadius: 10, background: 'rgba(124,58,237,0.1)', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 16px' }}>
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#7c3aed" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="M12 2L2 7l10 5 10-5-10-5z"/><path d="M2 17l10 5 10-5"/><path d="M2 12l10 5 10-5"/>
        </svg>
      </div>

      <p style={{ fontSize: 14, fontWeight: 600, marginBottom: 6, color: 'var(--fg)' }}>
        Connect to your account
      </p>
      <p style={{ fontSize: 12, color: 'var(--muted)', lineHeight: 1.5, marginBottom: 20 }}>
        {timedOut
          ? 'Timed out. Try connecting again.'
          : 'Open your dashboard and click "Connect Extension" in settings.'}
      </p>

      <button className="btn btn-primary btn-full" onClick={openDashboard}>
        Open Dashboard →
      </button>

      {!timedOut && (
        <p style={{ fontSize: 11, color: 'var(--muted)', marginTop: 14, lineHeight: 1.5 }}>
          After clicking Connect Extension in your dashboard settings, this will connect automatically.
        </p>
      )}
    </div>
  )
}
