import {
  Award,
  CalendarCheck,
  CheckCircle2,
  ClipboardList,
  KeyRound,
  Loader2,
  Mail,
  Send,
  ShieldAlert,
  UserRound,
  XCircle,
  type LucideIcon,
} from 'lucide-react'
import { ToneBadge } from '@/components/ToneBadge'
import type { InboxMessage, MessageCategory } from '@/lib/agentTypes'
import { CATEGORY_META } from '@/lib/agentFormat'

const CATEGORY_ICON: Record<MessageCategory, LucideIcon> = {
  interview: CalendarCheck,
  assessment: ClipboardList,
  offer: Award,
  rejection: XCircle,
  confirmation: CheckCircle2,
  verification: KeyRound,
  recruiter: UserRound,
  other: Mail,
  application: Send,
}

export function CategoryBadge({ message }: { message: InboxMessage }) {
  if (message.direction === 'outbound') {
    return <ToneBadge tone="muted" icon={Send}>Sent application</ToneBadge>
  }
  if (message.triage_status === 'pending') {
    return <ToneBadge tone="muted" icon={Loader2}>Sorting…</ToneBadge>
  }
  if (!message.category) return null
  const meta = CATEGORY_META[message.category] ?? CATEGORY_META.other
  return (
    <ToneBadge tone={meta.tone} icon={CATEGORY_ICON[message.category] ?? Mail}>
      {meta.label}
    </ToneBadge>
  )
}

/** Shown when SPF/DKIM/DMARC failed: the agent ignored the message. */
export function SpoofBadge() {
  return (
    <ToneBadge
      tone="danger"
      icon={ShieldAlert}
      title="Sender not verified — possible spoof; the agent took no action"
    >
      Sender not verified
    </ToneBadge>
  )
}
