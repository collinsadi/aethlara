import { Link } from 'react-router-dom'
import { Puzzle } from 'lucide-react'
import type { AgentOverview } from '@/lib/agentTypes'
import { pluralize } from '@/lib/agentFormat'
import { ui } from '@/lib/styles'

/** Shown when browser applications are ready but no extension is connected. */
export function ExtensionWarning({ overview }: { overview: AgentOverview }) {
  const ready = overview.counts.applications.ready ?? 0
  if (ready === 0 || overview.setup.extension_connected) return null
  return (
    <div
      role="status"
      className="flex flex-col gap-3 rounded-2xl border border-warning/30 bg-warning/[0.08] p-4 sm:flex-row sm:items-center sm:justify-between"
    >
      <div className="flex items-start gap-3">
        <Puzzle className="mt-0.5 size-5 shrink-0 text-warning" aria-hidden />
        <div>
          <p className="text-sm font-semibold text-foreground">
            {pluralize(ready, 'application is', 'applications are')} waiting for the Chrome extension
          </p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            They're tailored and ready, but no extension is connected to fill and submit the forms.
          </p>
        </div>
      </div>
      <div className="flex shrink-0 gap-2 pl-8 sm:pl-0">
        <Link to="/settings#extension" className={ui.primarySm}>
          Connect extension
        </Link>
        <Link to="/extension/install" className={ui.outline}>
          Install
        </Link>
      </div>
    </div>
  )
}
