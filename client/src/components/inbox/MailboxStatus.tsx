import { Link } from 'react-router-dom'
import { AtSign, Info, MailX } from 'lucide-react'
import { CopyButton } from '@/components/CopyButton'
import { EmptyState } from '@/components/EmptyState'
import type { AgentOverview } from '@/lib/agentTypes'
import { ui } from '@/lib/styles'

/** The agent's address, with a copy button. */
export function MailboxAddress({ overview }: { overview: AgentOverview }) {
  const address = overview.profile.mailbox_address
  if (!overview.setup.mailbox_enabled || !address) return null
  return (
    <div className="inline-flex max-w-full items-center gap-2 rounded-full border border-border bg-card/70 py-1 pl-3 pr-1 text-xs">
      <AtSign className="size-3.5 shrink-0 text-brand" aria-hidden />
      <span className="truncate font-medium text-foreground" title="Your agent's email address">
        {address}
      </span>
      <CopyButton value={address} label="Copy agent email address" className="p-1.5" />
    </div>
  )
}

/** Explains a mailbox that can send but not receive. */
export function InboundDisabledNotice() {
  return (
    <div role="note" className="flex items-start gap-3 rounded-2xl border border-warning/30 bg-warning/[0.08] p-4">
      <Info className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden />
      <div className="text-sm">
        <p className="font-medium text-foreground">Replies aren't being received yet</p>
        <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
          Applications go out from your agent address, but this server isn't set up for inbound mail. The server admin
          needs to add the mail domain to Resend Inbound and point its <code className="font-mono">email.received</code>{' '}
          webhook at <code className="font-mono">/api/v1/webhooks/resend</code> (with{' '}
          <code className="font-mono">RESEND_WEBHOOK_SECRET</code> set).
        </p>
      </div>
    </div>
  )
}

/** Full empty state when the server has no agent mail domain at all. */
export function MailboxDisabledState() {
  return (
    <EmptyState
      icon={MailX}
      title="The agent mailbox isn't set up on this server"
      description={
        <>
          With a mailbox, the agent applies from its own address (like <span className="font-medium text-foreground">first.last@agent.example.com</span>),
          sorts every reply with AI and moves your tracker automatically. The server admin enables it by setting{' '}
          <code className="font-mono text-xs">AGENT_MAIL_DOMAIN</code> and connecting Resend Inbound. Until then, the agent
          uses your account email and replies go to your personal inbox.
        </>
      }
      action={
        <Link to="/agent" className={ui.secondarySm}>
          Back to Autopilot
        </Link>
      }
    />
  )
}
