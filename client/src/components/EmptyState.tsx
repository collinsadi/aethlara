import type { LucideIcon } from 'lucide-react'
import { cn } from '@/lib/utils'

interface EmptyStateProps {
  icon: LucideIcon
  title: string
  description?: React.ReactNode
  /** Buttons / links telling the user exactly what to do next. */
  action?: React.ReactNode
  compact?: boolean
  className?: string
}

export function EmptyState({ icon: Icon, title, description, action, compact, className }: EmptyStateProps) {
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center text-center',
        compact ? 'px-6 py-10' : 'px-6 py-16',
        className
      )}
    >
      <div className="mb-4 flex size-12 items-center justify-center rounded-2xl border border-border bg-muted/60">
        <Icon className="size-5 text-muted-foreground" aria-hidden />
      </div>
      <h3 className="font-heading text-base font-semibold text-foreground">{title}</h3>
      {description && (
        <div className="mt-1.5 max-w-md text-sm leading-relaxed text-muted-foreground">{description}</div>
      )}
      {action && <div className="mt-5 flex flex-wrap items-center justify-center gap-3">{action}</div>}
    </div>
  )
}
