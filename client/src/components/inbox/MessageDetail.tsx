import { Link } from 'react-router-dom'
import {
  AlarmClock,
  ArrowLeft,
  Briefcase,
  ExternalLink,
  KeyRound,
  MailOpen,
  Paperclip,
  Send,
  ShieldAlert,
  Sparkles,
} from 'lucide-react'
import { CopyButton } from '@/components/CopyButton'
import { ErrorState } from '@/components/ErrorState'
import { CategoryBadge, SpoofBadge } from '@/components/inbox/MessageBadges'
import { Skeleton } from '@/components/ui/skeleton'
import { useInboxMessage, useMarkMessageRead } from '@/hooks/useInbox'
import { useNow } from '@/hooks/useNow'
import type { InboxMessage, InboxMessageDetail } from '@/lib/agentTypes'
import { formatBytes, formatDateTime, formatRelative, hostOf, safeHref } from '@/lib/agentFormat'
import { ui } from '@/lib/styles'
import { cn } from '@/lib/utils'

interface Props {
  messageId: string
  fallback: InboxMessage | null
  onBack: () => void
}

export function MessageDetail({ messageId, fallback, onBack }: Props) {
  const query = useInboxMessage(messageId)
  const message: InboxMessage | null = query.data ?? fallback

  if (!message) {
    if (query.isError) {
      return (
        <div className="p-5">
          <ErrorState compact error={query.error} title="Couldn't open this email" onRetry={() => query.refetch()} />
        </div>
      )
    }
    return <MessageSkeleton />
  }

  return (
    <MessageBody
      message={message}
      detail={query.data ?? null}
      loading={query.isLoading}
      error={query.isError ? query.error : null}
      onRetry={() => query.refetch()}
      onBack={onBack}
    />
  )
}

function MessageBody({
  message,
  detail,
  loading,
  error,
  onRetry,
  onBack,
}: {
  message: InboxMessage
  detail: InboxMessageDetail | null
  loading: boolean
  error: unknown
  onRetry: () => void
  onBack: () => void
}) {
  const now = useNow()
  const markRead = useMarkMessageRead()
  const extracted = detail?.extracted ?? null
  const spoofed = message.sender_auth === 'fail'
  const outbound = message.direction === 'outbound'
  const verificationHref = safeHref(extracted?.verification_link)
  const links = detail?.links ?? []
  const attachments = detail?.attachments ?? []
  const fromLabel = message.from_name ? `${message.from_name} <${message.from_address}>` : message.from_address

  return (
    <article aria-labelledby="message-subject" className="flex flex-col">
      <header className="sticky top-16 z-10 rounded-t-2xl border-b border-border bg-card/95 px-5 pb-4 pt-4 backdrop-blur-md lg:top-0">
        <button type="button" onClick={onBack} className={cn(ui.ghost, '-ml-2 mb-2 lg:hidden')}>
          <ArrowLeft className="size-3.5" aria-hidden />
          Back to inbox
        </button>
        <div className="flex flex-wrap items-center gap-1.5">
          <CategoryBadge message={message} />
          {spoofed && <SpoofBadge />}
        </div>
        <h2 id="message-subject" className="mt-2 font-heading text-lg font-semibold leading-snug text-foreground">
          {message.subject || '(no subject)'}
        </h2>
        <dl className="mt-2 grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-0.5 text-xs">
          <dt className="text-muted-foreground">From</dt>
          <dd className="break-all text-foreground">{fromLabel}</dd>
          <dt className="text-muted-foreground">To</dt>
          <dd className="break-all text-foreground">{message.to.join(', ') || '—'}</dd>
          <dt className="text-muted-foreground">{outbound ? 'Sent' : 'Received'}</dt>
          <dd className="text-foreground">
            {formatDateTime(message.received_at)}{' '}
            <span className="text-muted-foreground">({formatRelative(message.received_at, now)})</span>
          </dd>
        </dl>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          {message.application_id && (
            <Link to={`/applications?highlight=${message.application_id}`} className={ui.outline}>
              <Send className="size-3.5" aria-hidden />
              View application
            </Link>
          )}
          {message.job_id && (
            <Link to={`/jobs/${message.job_id}`} className={ui.outline}>
              <Briefcase className="size-3.5" aria-hidden />
              Tracker job
            </Link>
          )}
          {!outbound && message.read_at && (
            <button
              type="button"
              onClick={() => markRead.mutate({ id: message.id, read: false })}
              className={ui.ghost}
            >
              <MailOpen className="size-3.5" aria-hidden />
              Mark as unread
            </button>
          )}
        </div>
      </header>

      <div className="space-y-5 px-5 py-5">
        {spoofed && (
          <div role="alert" className="flex items-start gap-3 rounded-xl border border-destructive/25 bg-destructive/[0.07] px-3.5 py-3">
            <ShieldAlert className="mt-0.5 size-4 shrink-0 text-destructive" aria-hidden />
            <div className="text-sm">
              <p className="font-medium text-foreground">Sender not verified — possible spoof</p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                This email failed sender checks (SPF/DKIM/DMARC), so the agent took no action: no tracker updates and no
                alerts. Don't use its links or codes unless you're sure it's genuine.
              </p>
            </div>
          </div>
        )}

        {(extracted || message.summary) && !outbound && (
          <section aria-label="AI summary" className="rounded-xl border border-border bg-muted/30 px-3.5 py-3">
            <p className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
              <Sparkles className="size-3.5 text-brand" aria-hidden />
              Summary
            </p>
            <p className="mt-1 text-sm text-foreground">{extracted?.summary || message.summary}</p>
            {extracted?.action_required && extracted.action && (
              <p className="mt-2 text-sm">
                <span className="font-medium text-foreground">Next step: </span>
                <span className="text-foreground/90">{extracted.action}</span>
              </p>
            )}
            {extracted?.deadline && (
              <p className="mt-1 flex items-center gap-1.5 text-xs font-medium text-warning">
                <AlarmClock className="size-3.5" aria-hidden />
                Deadline: {extracted.deadline}
              </p>
            )}
          </section>
        )}

        {extracted?.verification_code && (
          <section aria-label="Verification code" className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border px-3.5 py-3">
            <div>
              <p className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                <KeyRound className="size-3.5" aria-hidden />
                Verification code
              </p>
              <p className="mt-1 select-all font-mono text-xl font-semibold tracking-[0.2em] text-foreground">
                {extracted.verification_code}
              </p>
            </div>
            <CopyButton value={extracted.verification_code} label="Copy verification code">
              Copy code
            </CopyButton>
          </section>
        )}

        {verificationHref && (
          <a href={verificationHref} target="_blank" rel="noopener noreferrer" className={ui.primarySm}>
            <ExternalLink className="size-3.5" aria-hidden />
            Open verification link
          </a>
        )}

        <section aria-labelledby="message-body-heading">
          <h3 id="message-body-heading" className="sr-only">
            Message
          </h3>
          {loading ? (
            <div className="space-y-2" aria-busy="true">
              {[100, 92, 96, 70].map((w, i) => (
                <Skeleton key={i} className="h-3.5" style={{ width: `${w}%` }} />
              ))}
            </div>
          ) : error ? (
            <ErrorState compact error={error} title="Couldn't load the message body" onRetry={onRetry} />
          ) : (
            // Plain text only — mail HTML is never stored or rendered.
            <pre className="whitespace-pre-wrap break-words font-sans text-sm leading-relaxed text-foreground/90">
              {detail?.text_body?.trim() || message.snippet || '(empty message)'}
            </pre>
          )}
        </section>

        {links.length > 0 && (
          <section aria-labelledby="message-links-heading">
            <h3 id="message-links-heading" className="text-xs font-medium text-muted-foreground">
              Links in this email
            </h3>
            <ul className="mt-2 space-y-1.5">
              {links.map((link) => {
                const href = safeHref(link)
                if (!href) return null
                return (
                  <li key={link}>
                    <a
                      href={href}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="group flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-xs transition-colors hover:bg-muted/40 focus-visible:outline-2 focus-visible:outline-brand"
                    >
                      <ExternalLink className="size-3.5 shrink-0 text-muted-foreground group-hover:text-brand" aria-hidden />
                      <span className="shrink-0 font-medium text-foreground">{hostOf(href)}</span>
                      <span className="truncate text-muted-foreground">{href}</span>
                    </a>
                  </li>
                )
              })}
            </ul>
          </section>
        )}

        {attachments && attachments.length > 0 && (
          <section aria-labelledby="message-attachments-heading">
            <h3 id="message-attachments-heading" className="text-xs font-medium text-muted-foreground">
              Attachments
            </h3>
            <ul className="mt-2 flex flex-wrap gap-2">
              {attachments.map((a, i) => (
                <li
                  key={`${a.filename}-${i}`}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-border px-2.5 py-1.5 text-xs text-foreground"
                >
                  <Paperclip className="size-3.5 text-muted-foreground" aria-hidden />
                  {a.filename}
                  {a.size > 0 && <span className="text-muted-foreground">· {formatBytes(a.size)}</span>}
                </li>
              ))}
            </ul>
            <p className="mt-1.5 text-[11px] text-muted-foreground">Only attachment names are stored.</p>
          </section>
        )}
      </div>
    </article>
  )
}

function MessageSkeleton() {
  return (
    <div className="space-y-4 p-5" aria-busy="true" aria-label="Loading email">
      <Skeleton className="h-5 w-24 rounded-full" />
      <Skeleton className="h-6 w-3/4" />
      <Skeleton className="h-3 w-1/2" />
      <Skeleton className="h-3 w-2/5" />
      <Skeleton className="h-20 w-full rounded-xl" />
      {[100, 90, 96, 80].map((w, i) => (
        <Skeleton key={i} className="h-3.5" style={{ width: `${w}%` }} />
      ))}
    </div>
  )
}
