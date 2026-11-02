import { CategoryBadge, SpoofBadge } from '@/components/inbox/MessageBadges'
import type { InboxMessage } from '@/lib/agentTypes'
import { formatDateTime, formatRelative } from '@/lib/agentFormat'
import { cn } from '@/lib/utils'

interface Props {
  message: InboxMessage
  active: boolean
  now: number
  onOpen: () => void
}

export function MessageListItem({ message, active, now, onOpen }: Props) {
  const unread = message.direction === 'inbound' && !message.read_at
  const who =
    message.direction === 'outbound'
      ? `To ${message.to.join(', ')}`
      : message.from_name?.trim() || message.from_address
  return (
    <li>
      <button
        type="button"
        onClick={onOpen}
        aria-current={active ? 'true' : undefined}
        className={cn(
          'relative flex w-full items-start gap-3 overflow-hidden rounded-xl border px-3.5 py-3 text-left outline-none transition-colors',
          'focus-visible:ring-2 focus-visible:ring-brand/40',
          active ? 'border-border bg-card shadow-sm' : 'border-transparent hover:border-border hover:bg-card/60'
        )}
      >
        {active && <span className="absolute inset-y-0 left-0 w-1 bg-brand" aria-hidden />}
        <span className={cn('mt-1.5 size-2 shrink-0 rounded-full', unread ? 'bg-brand' : 'bg-transparent')} aria-hidden />
        {unread && <span className="sr-only">Unread. </span>}
        <span className="min-w-0 flex-1">
          <span className="flex items-baseline justify-between gap-2">
            <span className={cn('truncate text-sm', unread ? 'font-semibold text-foreground' : 'font-medium text-foreground/90')}>
              {who}
            </span>
            <time
              dateTime={message.received_at}
              title={formatDateTime(message.received_at)}
              className="shrink-0 text-[11px] text-muted-foreground"
            >
              {formatRelative(message.received_at, now)}
            </time>
          </span>
          <span className={cn('mt-0.5 block truncate text-sm', unread ? 'font-medium text-foreground' : 'text-foreground/80')}>
            {message.subject || '(no subject)'}
          </span>
          <span className="mt-0.5 line-clamp-2 block text-xs text-muted-foreground">
            {message.summary || message.snippet}
          </span>
          <span className="mt-2 flex flex-wrap items-center gap-1.5">
            <CategoryBadge message={message} />
            {message.important && message.direction === 'inbound' && message.sender_auth !== 'fail' && (
              <span className="text-[11px] font-medium text-brand">Important</span>
            )}
            {message.sender_auth === 'fail' && <SpoofBadge />}
          </span>
        </span>
      </button>
    </li>
  )
}
