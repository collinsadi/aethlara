import { useState } from 'react'
import { Puzzle, ExternalLink, CheckCircle2, Loader2 } from 'lucide-react'
import { apiClient } from '@/api/client'

export function ExtensionSection() {
  const [connecting, setConnecting] = useState(false)
  const [done, setDone] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleConnect = async () => {
    setConnecting(true)
    setError(null)

    try {
      const res = await apiClient.post<{ data: { token: string; expires_in: number } }>(
        '/auth/extension-token'
      )
      const { token } = res.data.data
      const dashboardURL = import.meta.env.VITE_APP_URL ?? window.location.origin
      const handshakeURL = `${dashboardURL}/extension-handshake?ext_token=${encodeURIComponent(token)}`

      window.open(handshakeURL, '_blank', 'noopener')
      setDone(true)

      // Reset after 10 seconds so user can re-connect if needed
      setTimeout(() => setDone(false), 10_000)
    } catch {
      setError('Failed to generate connection token. Please try again.')
    } finally {
      setConnecting(false)
    }
  }

  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-base font-semibold text-foreground font-heading">Chrome Extension</h3>
        <p className="text-sm text-muted-foreground mt-1">
          Autofill job applications and extract job details directly from any page.
        </p>
      </div>

      <div className="glass-card p-4 space-y-4">
        <div className="flex items-start gap-3">
          <div className="p-2 rounded-xl bg-brand/10 shrink-0">
            <Puzzle className="w-5 h-5 text-brand" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-foreground">Aethlara Extension</p>
            <p className="text-xs text-muted-foreground mt-0.5">
              Connect once — the extension uses a secure, session-only token tied to your account.
            </p>
          </div>
        </div>

        {error && (
          <p className="text-xs text-red-500 px-1">{error}</p>
        )}

        <div className="flex flex-col sm:flex-row gap-2">
          <button
            type="button"
            onClick={handleConnect}
            disabled={connecting || done}
            className="btn-tf animate-btn-shine flex-1 text-sm font-semibold py-2.5 disabled:opacity-60 disabled:cursor-not-allowed flex items-center justify-center gap-2"
          >
            {connecting ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                Generating token…
              </>
            ) : done ? (
              <>
                <CheckCircle2 className="w-4 h-4" />
                Token sent — check the new tab
              </>
            ) : (
              'Connect Chrome Extension'
            )}
          </button>

          <a
            href="/extension"
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center justify-center gap-1.5 px-4 py-2.5 text-sm text-muted-foreground hover:text-foreground border border-border rounded-xl transition-colors"
          >
            <ExternalLink className="w-3.5 h-3.5" />
            Get Extension
          </a>
        </div>

        <p className="text-[11px] text-muted-foreground/60 px-1">
          After clicking &ldquo;Connect Chrome Extension&rdquo;, a new tab will open. The extension will automatically connect when you close it.
        </p>
      </div>
    </div>
  )
}
