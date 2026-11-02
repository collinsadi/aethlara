import { useState } from 'react'
import { MailX } from 'lucide-react'
import { SettingsSection } from '@/components/agent/settings/SettingsSection'
import { CopyButton } from '@/components/CopyButton'
import { useUpdateAgentProfile } from '@/hooks/useAgent'
import type { AgentProfile } from '@/lib/agentTypes'
import { mailboxLocalPart, validateMailbox } from '@/lib/agentSettings'
import { friendlyErrorMessage, hasErrorCode } from '@/lib/apiError'
import { ui } from '@/lib/styles'
import { toast } from '@/lib/toast'
import { cn } from '@/lib/utils'

interface Props {
  profile: AgentProfile
  inboundEnabled: boolean
}

export function MailboxSection({ profile, inboundEnabled }: Props) {
  const domain = profile.mailbox_domain
  const current = mailboxLocalPart(profile.mailbox_address)
  const [value, setValue] = useState(current)
  const [syncedCurrent, setSyncedCurrent] = useState(current)
  if (current !== syncedCurrent) {
    setSyncedCurrent(current)
    if (value === syncedCurrent) setValue(current)
  }
  const update = useUpdateAgentProfile()
  const [saved, setSaved] = useState(false)
  const normalized = value.trim().toLowerCase()
  const dirty = normalized !== current
  const validation = dirty ? validateMailbox(value) : null
  const taken = hasErrorCode(update.error, 'MAILBOX_TAKEN')

  if (!domain) {
    return (
      <SettingsSection id="mailbox" title="Agent mailbox">
        <div className="flex items-start gap-3">
          <MailX className="mt-0.5 size-5 shrink-0 text-muted-foreground" aria-hidden />
          <div className="text-sm">
            <p className="font-medium text-foreground">Not available on this server</p>
            <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
              Agent mailboxes need <code className="font-mono">AGENT_MAIL_DOMAIN</code> to be configured by the server
              admin. Until then, applications use your account email and replies go to your personal inbox, so the
              tracker isn't updated from replies automatically.
            </p>
          </div>
        </div>
      </SettingsSection>
    )
  }

  const save = () =>
    update.mutate(
      { mailbox_local_part: normalized },
      {
        onSuccess: (p) => {
          setValue(mailboxLocalPart(p.mailbox_address))
          setSaved(true)
          toast.success('Agent address updated', { description: p.mailbox_address ?? undefined })
        },
      }
    )

  const serverError = update.isError
    ? taken
      ? 'That address is taken. Try another.'
      : friendlyErrorMessage(update.error)
    : null

  return (
    <SettingsSection
      id="mailbox"
      title="Agent mailbox"
      description={
        inboundEnabled
          ? 'The address the agent applies from. Replies land in your Inbox and update the tracker.'
          : "The address the agent applies from. This server doesn't receive replies yet, so they won't show in your Inbox."
      }
      footer={{
        dirty,
        saving: update.isPending,
        invalid: !!validation,
        error: serverError,
        saved: saved && !dirty,
        onSave: save,
        onReset: () => {
          setValue(current)
          update.reset()
        },
        saveLabel: 'Save address',
      }}
    >
      <div>
        <label htmlFor="mailbox-local" className={ui.label}>
          Address
        </label>
        <div
          className={cn(
            'flex h-10 items-center overflow-hidden rounded-xl border border-border bg-card focus-within:border-brand focus-within:ring-2 focus-within:ring-brand/20',
            (validation || taken) && 'border-destructive'
          )}
        >
          <input
            id="mailbox-local"
            type="text"
            value={value}
            onChange={(e) => {
              setValue(e.target.value)
              if (update.isError) update.reset()
            }}
            maxLength={40}
            spellCheck={false}
            autoCapitalize="off"
            autoComplete="off"
            aria-invalid={!!(validation || taken) || undefined}
            aria-describedby="mailbox-local-help"
            className="h-full min-w-0 flex-1 bg-transparent px-3 text-sm text-foreground outline-none"
          />
          <span className="flex h-full items-center border-l border-border bg-muted/50 px-3 text-sm text-muted-foreground">
            @{domain}
          </span>
        </div>
        <p id="mailbox-local-help" className={validation ? ui.fieldError : ui.hint}>
          {validation ?? 'Lowercase letters, numbers, dots, dashes and underscores.'}
        </p>
      </div>
      {profile.mailbox_address && (
        <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          Current address:
          <span className="font-medium text-foreground">{profile.mailbox_address}</span>
          <CopyButton value={profile.mailbox_address} label="Copy agent address" className="p-1" />
        </div>
      )}
      {dirty && (
        <p className="text-xs text-muted-foreground">
          Replies to applications already sent from the old address won't reach the agent after you change it.
        </p>
      )}
    </SettingsSection>
  )
}
