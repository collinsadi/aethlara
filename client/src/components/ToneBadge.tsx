import type { LucideIcon } from 'lucide-react'
import { toneBadge, type Tone } from '@/lib/tones'
import { cn } from '@/lib/utils'

interface ToneBadgeProps {
  tone?: Tone
  icon?: LucideIcon
  children: React.ReactNode
  title?: string
  className?: string
}

export function ToneBadge({ tone = 'neutral', icon: Icon, children, title, className }: ToneBadgeProps) {
  return (
    <span
      title={title}
      className={cn(
        'inline-flex h-5 shrink-0 items-center gap-1 whitespace-nowrap rounded-full border px-2 text-[11px] font-medium leading-none',
        toneBadge[tone],
        className
      )}
    >
      {Icon && <Icon className="size-3" aria-hidden />}
      {children}
    </span>
  )
}
