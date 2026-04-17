import { useState } from 'react'
import { Link } from 'react-router-dom'
import { KeyRound, X, ArrowRight } from 'lucide-react'
import { useAIGate } from '@/hooks/useAIGate'
import { cn } from '@/lib/utils'

interface Props {
  variant?: 'inline' | 'page'
  className?: string
}

export function ApiKeyStatusBanner({ variant = 'inline', className }: Props) {
  const { hasKey, isLoading } = useAIGate()
  const [dismissed, setDismissed] = useState(false)

  if (isLoading || hasKey || dismissed) return null

  if (variant === 'page') {
    return (
      <div className={cn(
        'flex items-start gap-3 p-4 rounded-xl',
        'bg-amber-500/8 border border-amber-500/25',
        className
      )}>
        <KeyRound className="w-4 h-4 text-amber-500 shrink-0 mt-0.5" />
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-amber-600 dark:text-amber-400">
            AI features require an API key
          </p>
          <p className="text-xs text-amber-600/80 dark:text-amber-400/80 mt-0.5">
            Add your OpenRouter API key in settings to start analysing jobs.
          </p>
          <Link
            to="/settings#api-key"
            className="inline-flex items-center gap-1 text-xs font-semibold text-amber-600 dark:text-amber-400 hover:underline mt-2"
          >
            Add API key <ArrowRight className="w-3 h-3" />
          </Link>
        </div>
        <button
          type="button"
          onClick={() => setDismissed(true)}
          className="text-amber-500/60 hover:text-amber-500 transition-colors shrink-0"
          aria-label="Dismiss"
        >
          <X className="w-4 h-4" />
        </button>
      </div>
    )
  }

  // inline variant — compact, for use inside modals/panels
  return (
    <div className={cn(
      'flex items-center gap-3 p-3 rounded-xl',
      'bg-amber-500/8 border border-amber-500/20',
      className
    )}>
      <KeyRound className="w-4 h-4 text-amber-500 shrink-0" />
      <p className="text-sm text-amber-600 dark:text-amber-400 flex-1">
        You need an{' '}
        <Link
          to="/settings#api-key"
          className="font-semibold underline underline-offset-2"
        >
          OpenRouter API key
        </Link>{' '}
        to use this feature.
      </p>
    </div>
  )
}
