import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react'
import { motion } from 'framer-motion'
import { Send, Loader2 } from 'lucide-react'
import { cn } from '@/lib/utils'

const MAX_CHARS = 4000
const WARN_WITHIN = 500
const MIN_ROWS = 1
const MAX_ROWS = 6

interface Props {
  onSend: (content: string) => void | Promise<void>
  isSending: boolean
  disabled?: boolean
  /** When > 0, render a countdown "Please wait Ns" state. */
  rateLimitedSeconds?: number
  placeholder?: string
}

export interface ChatInputHandle {
  focus: () => void
  setValue: (v: string) => void
}

export const ChatInput = forwardRef<ChatInputHandle, Props>(function ChatInput(
  { onSend, isSending, disabled, rateLimitedSeconds = 0, placeholder = 'Ask anything about this role…' },
  ref,
) {
  const [value, setValue] = useState('')
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  useImperativeHandle(ref, () => ({
    focus: () => textareaRef.current?.focus(),
    setValue: (v: string) => setValue(v),
  }))

  // Auto-resize: reset → scrollHeight-driven height within min/max rows.
  useEffect(() => {
    const el = textareaRef.current
    if (!el) return
    el.style.height = 'auto'
    // line-height approx 20px + 20px padding
    const rowPx = 20
    const minH = MIN_ROWS * rowPx + 20
    const maxH = MAX_ROWS * rowPx + 20
    const next = Math.min(Math.max(el.scrollHeight, minH), maxH)
    el.style.height = `${next}px`
  }, [value])

  const charsLeft = MAX_CHARS - value.length
  const showCounter = charsLeft <= WARN_WITHIN
  const overLimit = charsLeft < 0
  const blocked = !!disabled || isSending || rateLimitedSeconds > 0

  const canSend = !blocked && value.trim().length > 0 && !overLimit

  const handleSubmit = async () => {
    if (!canSend) return
    const toSend = value.trim()
    setValue('')
    // Reset height immediately — next frame will settle auto-resize on empty.
    if (textareaRef.current) textareaRef.current.style.height = 'auto'
    await onSend(toSend)
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault()
      handleSubmit()
    }
  }

  return (
    <div className="border-t border-border bg-card/30 px-4 py-3">
      <div
        className={cn(
          'relative flex items-end gap-2 rounded-2xl border border-border bg-background/60 pl-3 pr-2 py-1.5 transition-colors',
          overLimit && 'border-red-500/60',
          !blocked && 'focus-within:border-brand/60',
        )}
      >
        <textarea
          ref={textareaRef}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={handleKeyDown}
          rows={MIN_ROWS}
          placeholder={rateLimitedSeconds > 0 ? `Please wait ${rateLimitedSeconds}s…` : placeholder}
          disabled={blocked}
          maxLength={MAX_CHARS + 100}
          className="flex-1 resize-none bg-transparent text-sm text-foreground placeholder:text-muted-foreground/70 outline-none py-1.5 disabled:opacity-60 disabled:cursor-not-allowed"
        />
        <motion.button
          type="button"
          whileTap={{ scale: 0.92 }}
          onClick={handleSubmit}
          disabled={!canSend}
          aria-label="Send message"
          className="shrink-0 size-9 rounded-xl bg-brand text-brand-foreground flex items-center justify-center disabled:opacity-40 disabled:pointer-events-none hover:opacity-90 transition-opacity"
        >
          {isSending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
        </motion.button>
      </div>

      <div className="flex items-center justify-between mt-1.5 px-1 min-h-[14px]">
        <span className="text-[10px] text-muted-foreground">
          Press <kbd className="px-1 py-0.5 rounded bg-muted/60 text-[10px]">Enter</kbd> to send ·{' '}
          <kbd className="px-1 py-0.5 rounded bg-muted/60 text-[10px]">Shift+Enter</kbd> for newline
        </span>
        {showCounter && (
          <span
            className={cn(
              'text-[10px] tabular-nums',
              overLimit ? 'text-red-500 font-medium' : 'text-muted-foreground',
            )}
          >
            {overLimit ? `${Math.abs(charsLeft)} over limit` : `${charsLeft} left`}
          </span>
        )}
      </div>
    </div>
  )
})
