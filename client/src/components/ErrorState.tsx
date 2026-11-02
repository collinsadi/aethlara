import { Link } from 'react-router-dom'
import { AlertTriangle, RefreshCw } from 'lucide-react'
import { errorAction, friendlyErrorMessage } from '@/lib/apiError'
import { ui } from '@/lib/styles'
import { cn } from '@/lib/utils'

interface ErrorStateProps {
  error: unknown
  title?: string
  onRetry?: () => void
  retrying?: boolean
  compact?: boolean
  className?: string
}

/** Load failure with the server's message, a retry and (if known) a fix-it link. */
export function ErrorState({
  error,
  title = "Couldn't load this",
  onRetry,
  retrying,
  compact,
  className,
}: ErrorStateProps) {
  const action = errorAction(error)
  return (
    <div
      role="alert"
      className={cn(
        'flex flex-col items-center justify-center text-center',
        compact ? 'px-6 py-8' : 'px-6 py-14',
        className
      )}
    >
      <div className="mb-4 flex size-12 items-center justify-center rounded-2xl border border-destructive/20 bg-destructive/10">
        <AlertTriangle className="size-5 text-destructive" aria-hidden />
      </div>
      <h3 className="font-heading text-base font-semibold text-foreground">{title}</h3>
      <p className="mt-1.5 max-w-md text-sm text-muted-foreground">{friendlyErrorMessage(error)}</p>
      {(onRetry || action) && (
        <div className="mt-5 flex flex-wrap items-center justify-center gap-3">
          {onRetry && (
            <button type="button" onClick={onRetry} disabled={retrying} className={ui.secondarySm}>
              <RefreshCw className={cn('size-3.5', retrying && 'animate-spin')} aria-hidden />
              Try again
            </button>
          )}
          {action && (
            <Link to={action.path} className={ui.primarySm}>
              {action.label}
            </Link>
          )}
        </div>
      )}
    </div>
  )
}
