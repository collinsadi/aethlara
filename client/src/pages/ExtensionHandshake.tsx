/**
 * Extension handshake relay page.
 *
 * URL: /extension-handshake?ext_token=<token>
 *
 * The extension background script watches for tabs navigating to this URL,
 * reads the ext_token query param, and calls POST /auth/extension-token/exchange.
 * This page itself does nothing — it just needs to exist and be reachable
 * so the browser tab URL is fully loaded when the background script intercepts it.
 */
import { useEffect } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Loader2, CheckCircle2 } from 'lucide-react'

export function ExtensionHandshake() {
  const [params] = useSearchParams()
  const token = params.get('ext_token')

  useEffect(() => {
    // Auto-close after 3 seconds — the extension will close it programmatically,
    // but this is a fallback in case the extension is not installed.
    const t = setTimeout(() => window.close(), 3000)
    return () => clearTimeout(t)
  }, [])

  return (
    <div className="min-h-screen flex items-center justify-center bg-background">
      <div className="text-center space-y-4 p-8">
        {token ? (
          <>
            <CheckCircle2 className="w-10 h-10 text-emerald-500 mx-auto" />
            <p className="text-sm font-medium text-foreground">Connecting to Aethlara Extension…</p>
            <p className="text-xs text-muted-foreground">This tab will close automatically.</p>
          </>
        ) : (
          <>
            <Loader2 className="w-8 h-8 text-muted-foreground mx-auto animate-spin" />
            <p className="text-xs text-muted-foreground">No token found.</p>
          </>
        )}
      </div>
    </div>
  )
}
