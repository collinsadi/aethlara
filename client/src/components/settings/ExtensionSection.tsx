import { useEffect, useState } from 'react'
import { CheckCircle2, ExternalLink, Laptop, Loader2, Puzzle, Unplug } from 'lucide-react'
import type { ExtensionDevice } from '@/api/extension'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import { ErrorState } from '@/components/ErrorState'
import { Skeleton } from '@/components/ui/skeleton'
import { useConnectExtension, useExtensionDevices, useRevokeExtensionDevice } from '@/hooks/useExtensionDevices'
import { useNow } from '@/hooks/useNow'
import { formatDate, formatDateTime, formatRelative } from '@/lib/agentFormat'
import { friendlyErrorMessage } from '@/lib/apiError'
import { ui } from '@/lib/styles'
import { toast } from '@/lib/toast'
import { cn } from '@/lib/utils'

export function ExtensionSection() {
  const now = useNow()
  const devices = useExtensionDevices()
  const connect = useConnectExtension()
  const revoke = useRevokeExtensionDevice()
  const [sent, setSent] = useState(false)
  const [revoking, setRevoking] = useState<ExtensionDevice | null>(null)

  // "Check the new tab" hint fades so the user can connect again.
  useEffect(() => {
    if (!sent) return
    const t = setTimeout(() => setSent(false), 10_000)
    return () => clearTimeout(t)
  }, [sent])

  const onConnect = () =>
    connect.mutate(undefined, {
      onSuccess: () => {
        setSent(true)
        // The extension finishes the handshake in the background; refresh the list shortly after.
        setTimeout(() => void devices.refetch(), 4000)
      },
    })

  const onRevoke = () => {
    if (!revoking) return
    const device = revoking
    revoke.mutate(device.id, {
      onSuccess: () => toast.success('Extension disconnected', { description: `${device.name} has been signed out.` }),
      onError: (err) => toast.error("Couldn't disconnect", { description: friendlyErrorMessage(err) }),
      onSettled: () => setRevoking(null),
    })
  }

  const list = devices.data ?? []

  return (
    <div className="space-y-4">
      <div>
        <h2 className="font-heading text-base font-semibold text-foreground">Chrome extension</h2>
        <p className="mt-0.5 text-sm text-muted-foreground">
          The extension fills and submits form applications the autopilot prepares, and lets you send any job you're
          looking at to the agent. Connect once — it stays signed in with a device token you can revoke here.
        </p>
      </div>

      <div className="glass-card space-y-4 p-5">
        <div className="flex items-start gap-3">
          <div className="shrink-0 rounded-xl bg-brand/10 p-2">
            <Puzzle className="size-5 text-brand" aria-hidden />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium text-foreground">Connect a browser</p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Opens a short-lived handshake tab; the extension picks up the token and closes it.
            </p>
          </div>
        </div>

        {connect.isError && (
          <p role="alert" className="text-xs text-destructive">
            Couldn't start the connection: {friendlyErrorMessage(connect.error)}
          </p>
        )}

        <div className="flex flex-col gap-2 sm:flex-row">
          <button type="button" onClick={onConnect} disabled={connect.isPending || sent} className={cn(ui.primary, 'flex-1')}>
            {connect.isPending ? (
              <Loader2 className="size-4 animate-spin" aria-hidden />
            ) : sent ? (
              <CheckCircle2 className="size-4" aria-hidden />
            ) : (
              <Puzzle className="size-4" aria-hidden />
            )}
            {connect.isPending ? 'Generating token…' : sent ? 'Token sent — check the new tab' : 'Connect Chrome extension'}
          </button>
          <a href="/extension/install" target="_blank" rel="noopener noreferrer" className={ui.secondary}>
            <ExternalLink className="size-4" aria-hidden />
            Get the extension
          </a>
        </div>

        <div className="border-t border-border pt-4">
          <p className="text-xs font-medium text-muted-foreground">Connected browsers</p>
          {devices.isLoading ? (
            <div className="mt-3 space-y-2" aria-busy="true">
              <Skeleton className="h-12 w-full rounded-xl" />
            </div>
          ) : devices.isError ? (
            <ErrorState compact error={devices.error} title="Couldn't load connected browsers" onRetry={() => devices.refetch()} />
          ) : list.length === 0 ? (
            <p className="mt-2 text-sm text-muted-foreground">
              None yet. Form applications wait in Applications until a browser is connected.
            </p>
          ) : (
            <ul className="mt-2 divide-y divide-border">
              {list.map((d) => (
                <li key={d.id} className="flex items-center justify-between gap-3 py-2.5">
                  <div className="flex min-w-0 items-center gap-3">
                    <Laptop className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-foreground">{d.name}</p>
                      <p className="text-xs text-muted-foreground">
                        {d.last_used_at ? (
                          <span title={formatDateTime(d.last_used_at)}>Active {formatRelative(d.last_used_at, now)}</span>
                        ) : (
                          'Not used yet'
                        )}
                        {' · '}connected {formatDate(d.created_at)}
                      </p>
                    </div>
                  </div>
                  <button type="button" onClick={() => setRevoking(d)} className={ui.danger}>
                    <Unplug className="size-3.5" aria-hidden />
                    Disconnect
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      <ConfirmDialog
        open={!!revoking}
        onOpenChange={(open) => !open && setRevoking(null)}
        title="Disconnect this browser?"
        description={
          revoking
            ? `${revoking.name} will be signed out and stop submitting applications. You can connect it again any time.`
            : undefined
        }
        confirmLabel="Disconnect"
        pendingLabel="Disconnecting…"
        destructive
        pending={revoke.isPending}
        onConfirm={onRevoke}
      />
    </div>
  )
}
