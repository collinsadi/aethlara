import { useEffect, useState } from 'react'
import { Check, Copy } from 'lucide-react'
import { toast } from '@/lib/toast'
import { ui } from '@/lib/styles'
import { cn } from '@/lib/utils'

interface CopyButtonProps {
  value: string
  /** Accessible label, e.g. "Copy verification code". */
  label: string
  /** Visible text; omit for an icon-only button. */
  children?: React.ReactNode
  className?: string
}

export function CopyButton({ value, label, children, className }: CopyButtonProps) {
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    if (!copied) return
    const t = setTimeout(() => setCopied(false), 1800)
    return () => clearTimeout(t)
  }, [copied])

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value)
      setCopied(true)
    } catch {
      toast.error('Could not copy to the clipboard', { description: value })
    }
  }

  const Icon = copied ? Check : Copy
  return (
    <button
      type="button"
      onClick={copy}
      aria-label={children ? undefined : label}
      title={label}
      className={cn(children ? ui.outline : ui.iconButton, className)}
    >
      <Icon className={cn('size-3.5', copied && 'text-success')} aria-hidden />
      {children}
      <span className="sr-only" aria-live="polite">
        {copied ? 'Copied' : ''}
      </span>
    </button>
  )
}
