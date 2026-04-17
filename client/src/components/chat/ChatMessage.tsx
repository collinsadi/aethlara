import { memo, useState } from 'react'
import { motion } from 'framer-motion'
import { Copy, Check, AlertCircle, RotateCw, Sparkles } from 'lucide-react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { cn } from '@/lib/utils'
import type { ApiChatMessage } from '@/lib/types'

interface Props {
  message: ApiChatMessage
  /** When true, visually group with the previous message from same author. */
  grouped?: boolean
  onRetry?: (content: string) => void
}

/**
 * Minimal, dependency-free markdown styling (no @tailwindcss/typography).
 * Intentionally subtle — chat should not look like a doc page.
 * HTML is never rendered (skipHtml + no dangerouslySetInnerHTML).
 */
function AssistantMarkdown({ content }: { content: string }) {
  return (
    <div className="chat-md text-sm leading-relaxed [&>*:first-child]:mt-0 [&>*:last-child]:mb-0">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        skipHtml
        components={{
          p: ({ children }) => <p className="my-2 break-words">{children}</p>,
          ul: ({ children }) => <ul className="my-2 ml-4 list-disc space-y-0.5">{children}</ul>,
          ol: ({ children }) => <ol className="my-2 ml-4 list-decimal space-y-0.5">{children}</ol>,
          li: ({ children }) => <li className="marker:text-muted-foreground">{children}</li>,
          strong: ({ children }) => <strong className="font-semibold text-foreground">{children}</strong>,
          em: ({ children }) => <em className="italic">{children}</em>,
          h1: ({ children }) => <h3 className="mt-3 mb-1.5 text-sm font-semibold font-heading">{children}</h3>,
          h2: ({ children }) => <h4 className="mt-3 mb-1.5 text-sm font-semibold font-heading">{children}</h4>,
          h3: ({ children }) => <h5 className="mt-3 mb-1 text-sm font-semibold">{children}</h5>,
          code: ({ className, children }) => {
            const isBlock = /language-/.test(className ?? '')
            if (isBlock) {
              return <code className={className}>{children}</code>
            }
            return (
              <code className="bg-muted/60 px-1 py-0.5 rounded text-[0.85em] font-mono">
                {children}
              </code>
            )
          },
          pre: ({ children }) => (
            <pre className="my-2 bg-muted/80 border border-border rounded-xl p-3 text-[0.85em] overflow-x-auto">
              {children}
            </pre>
          ),
          blockquote: ({ children }) => (
            <blockquote className="my-2 border-l-2 border-brand/40 pl-3 italic text-muted-foreground">
              {children}
            </blockquote>
          ),
          a: ({ href, children }) => (
            <a
              href={href}
              target="_blank"
              rel="noopener noreferrer nofollow"
              className="text-brand underline-offset-2 hover:underline break-all"
            >
              {children}
            </a>
          ),
          hr: () => <hr className="my-3 border-border" />,
          table: ({ children }) => (
            <div className="my-2 overflow-x-auto">
              <table className="w-full text-xs border-collapse">{children}</table>
            </div>
          ),
          th: ({ children }) => (
            <th className="border border-border bg-muted/40 px-2 py-1 text-left font-semibold">
              {children}
            </th>
          ),
          td: ({ children }) => <td className="border border-border px-2 py-1">{children}</td>,
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  )
}

function formatTime(iso: string): string {
  try {
    return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  } catch {
    return ''
  }
}

function TypingDots() {
  return (
    <div className="flex items-center gap-1 py-1">
      {[0, 1, 2].map((i) => (
        <motion.span
          key={i}
          className="w-1.5 h-1.5 rounded-full bg-muted-foreground/60"
          animate={{ y: [0, -3, 0], opacity: [0.4, 1, 0.4] }}
          transition={{ duration: 1, repeat: Infinity, delay: i * 0.15 }}
        />
      ))}
    </div>
  )
}

export const ChatMessage = memo(function ChatMessage({ message, grouped, onRetry }: Props) {
  const [copied, setCopied] = useState(false)
  const isUser = message.role === 'user'
  const isTyping = message.role === 'assistant' && message.metadata?.finish_reason === '__typing__'
  const isError = !!message.is_error

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(message.content)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      /* noop */
    }
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
      className={cn(
        'group flex w-full',
        isUser ? 'justify-end' : 'justify-start',
        grouped ? 'mt-1' : 'mt-3',
      )}
    >
      {/* Avatar / spacer (only on non-grouped assistant messages) */}
      {!isUser && !grouped && (
        <div className="w-7 h-7 shrink-0 rounded-lg bg-brand/15 border border-border flex items-center justify-center mr-2 mt-0.5">
          <Sparkles className="w-3.5 h-3.5 text-brand" />
        </div>
      )}
      {!isUser && grouped && <div className="w-7 shrink-0 mr-2" />}

      <div className={cn('max-w-[82%] min-w-0 flex flex-col', isUser ? 'items-end' : 'items-start')}>
        <div
          className={cn(
            'rounded-2xl px-3.5 py-2.5 text-sm break-words',
            isUser
              ? 'bg-brand/15 text-foreground border border-brand/30 rounded-br-md'
              : 'bg-muted/40 text-foreground border border-border rounded-bl-md',
            isError && 'border-red-500/50 bg-red-500/5',
          )}
        >
          {isTyping ? (
            <TypingDots />
          ) : isUser ? (
            <p className="whitespace-pre-wrap">{message.content}</p>
          ) : (
            <AssistantMarkdown content={message.content || ''} />
          )}

          {isError && (
            <div className="flex items-center gap-1.5 mt-1.5 text-[11px] text-red-500">
              <AlertCircle className="w-3 h-3" />
              <span>Message didn't send.</span>
              {onRetry && (
                <button
                  type="button"
                  onClick={() => onRetry(message.content)}
                  className="inline-flex items-center gap-1 font-medium hover:opacity-80 transition-opacity"
                >
                  <RotateCw className="w-3 h-3" />
                  Retry
                </button>
              )}
            </div>
          )}
        </div>

        {!isTyping && (
          <div className="flex items-center gap-2 mt-1 px-1 text-[10px] text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity">
            <span className="tabular-nums">{formatTime(message.created_at)}</span>
            {!isUser && message.model_used && (
              <span className="truncate max-w-[160px]">· {message.model_used}</span>
            )}
            {!isUser && !isError && message.content && (
              <button
                type="button"
                onClick={handleCopy}
                className="inline-flex items-center gap-1 hover:text-foreground transition-colors"
                aria-label="Copy message"
              >
                {copied ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
                {copied ? 'Copied' : 'Copy'}
              </button>
            )}
          </div>
        )}
      </div>
    </motion.div>
  )
})
