import { useState } from 'react'
import { Link } from 'react-router-dom'
import { KeyRound, X, ArrowRight } from 'lucide-react'
import { useAIGate } from '@/hooks/useAIGate'
import { AI_SETTINGS_PATH } from '@/lib/apiError'
import { cn } from '@/lib/utils'

interface Props {
  variant?: 'inline' | 'page'
  className?: string
}

/**
 * Shown when the ACTIVE AI provider (Anthropic or OpenRouter) has no valid
 * key — the same rule the server's AI gate applies.
 */
export function ApiKeyStatusBanner({ variant = 'inline', className }: Props) {
  const { hasKey, isLoading, keyNeedsAttention, providerLabel } = useAIGate()
  const [dismissed, setDismissed] = useState(false)

  if (isLoading || hasKey || dismissed) return null

  const title = keyNeedsAttention ? `Your ${providerLabel} key isn't working` : 'AI features need an API key'
  const body = keyNeedsAttention
    ? `Re-validate or replace your ${providerLabel} key — or switch to another provider — to keep using AI features.`
    : 'Add an Anthropic or OpenRouter key in Settings to analyse jobs and run the autopilot.'

  if (variant === 'page') {
    return (
      <div
        role="status"
        className={cn('flex items-start gap-3 p-4 rounded-xl', 'bg-warning/[0.08] border border-warning/30', className)}
      >
        <KeyRound className="w-4 h-4 text-warning shrink-0 mt-0.5" aria-hidden />
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-foreground">{title}</p>
          <p className="text-xs text-muted-foreground mt-0.5">{body}</p>
          <Link
            to={AI_SETTINGS_PATH}
            className="inline-flex items-center gap-1 text-xs font-semibold text-foreground hover:text-brand hover:underline mt-2"
          >
            {keyNeedsAttention ? 'Fix API key' : 'Add API key'} <ArrowRight className="w-3 h-3" aria-hidden />
          </Link>
        </div>
        <button
          type="button"
          onClick={() => setDismissed(true)}
          className="text-muted-foreground hover:text-foreground transition-colors shrink-0 rounded focus-visible:outline-2 focus-visible:outline-brand"
          aria-label="Dismiss"
        >
          <X className="w-4 h-4" aria-hidden />
        </button>
      </div>
    )
  }

  // inline variant — compact, for use inside modals/panels
  return (
    <div
      role="status"
      className={cn('flex items-center gap-3 p-3 rounded-xl', 'bg-warning/[0.08] border border-warning/30', className)}
    >
      <KeyRound className="w-4 h-4 text-warning shrink-0" aria-hidden />
      <p className="text-sm text-foreground flex-1">
        {keyNeedsAttention ? `Your ${providerLabel} key isn't working. ` : 'You need an '}
        <Link to={AI_SETTINGS_PATH} className="font-semibold underline underline-offset-2 hover:text-brand">
          {keyNeedsAttention ? 'Fix it in Settings' : 'Anthropic or OpenRouter API key'}
        </Link>
        {keyNeedsAttention ? '.' : ' to use this feature.'}
      </p>
    </div>
  )
}
