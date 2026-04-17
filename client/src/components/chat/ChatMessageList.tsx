import { useCallback, useEffect, useLayoutEffect, useRef } from 'react'
import { ChevronUp, Loader2 } from 'lucide-react'
import { ChatMessage } from './ChatMessage'
import type { ApiChatMessage } from '@/lib/types'

interface Props {
  messages: ApiChatMessage[]
  isLoadingInitial: boolean
  hasMore: boolean
  isLoadingMore: boolean
  onLoadMore: () => void
  onRetry?: (content: string) => void
  /**
   * Bumped every time a new outbound send is initiated so the list auto-scrolls
   * to bottom even if the user had scrolled up slightly.
   */
  sendTick?: number
}

const NEAR_BOTTOM_PX = 120

function shouldGroupWithPrev(curr: ApiChatMessage, prev: ApiChatMessage | undefined): boolean {
  if (!prev) return false
  if (prev.role !== curr.role) return false
  // Within 2 minutes → same logical turn
  const dt = new Date(curr.created_at).getTime() - new Date(prev.created_at).getTime()
  return dt >= 0 && dt < 2 * 60 * 1000
}

function dateLabel(iso: string): string {
  const d = new Date(iso)
  const today = new Date()
  const yesterday = new Date(today)
  yesterday.setDate(today.getDate() - 1)

  const sameDay = (a: Date, b: Date) =>
    a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()

  if (sameDay(d, today)) return 'Today'
  if (sameDay(d, yesterday)) return 'Yesterday'
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
}

export function ChatMessageList({
  messages,
  isLoadingInitial,
  hasMore,
  isLoadingMore,
  onLoadMore,
  onRetry,
  sendTick,
}: Props) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const lastMessageIdRef = useRef<string | null>(null)
  const prevScrollHeightRef = useRef<number>(0)
  const autoScrollRef = useRef<boolean>(true)

  // Track near-bottom: auto-scroll policy decision
  const handleScroll = useCallback(() => {
    const el = scrollRef.current
    if (!el) return
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight
    autoScrollRef.current = distanceFromBottom <= NEAR_BOTTOM_PX
  }, [])

  // Maintain scroll position when older messages prepend.
  useLayoutEffect(() => {
    const el = scrollRef.current
    if (!el) return
    if (prevScrollHeightRef.current > 0 && el.scrollHeight !== prevScrollHeightRef.current) {
      const diff = el.scrollHeight - prevScrollHeightRef.current
      el.scrollTop = el.scrollTop + diff
    }
    prevScrollHeightRef.current = el.scrollHeight
  }, [messages.length])

  // Auto-scroll to bottom when:
  //  - list initially loads,
  //  - a new trailing message lands AND user is near bottom,
  //  - user just sent a message (sendTick bumped).
  useEffect(() => {
    const el = scrollRef.current
    if (!el) return

    const newestId = messages[messages.length - 1]?.id ?? null
    const isFirstLoad = lastMessageIdRef.current === null && newestId !== null
    const isNewTrailing = newestId !== null && newestId !== lastMessageIdRef.current

    if (isFirstLoad || (isNewTrailing && autoScrollRef.current)) {
      el.scrollTop = el.scrollHeight
    }

    lastMessageIdRef.current = newestId
  }, [messages])

  // Force scroll-to-bottom on outbound send.
  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    el.scrollTop = el.scrollHeight
    autoScrollRef.current = true
  }, [sendTick])

  const handleLoadMoreClick = () => {
    const el = scrollRef.current
    if (el) prevScrollHeightRef.current = el.scrollHeight
    onLoadMore()
  }

  if (isLoadingInitial) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <Loader2 className="w-5 h-5 text-muted-foreground animate-spin" />
      </div>
    )
  }

  // Precompute per-message flags so the render loop is side-effect-free.
  const dividerFlags: boolean[] = []
  {
    let lastDay: string | null = null
    for (const m of messages) {
      const dayKey = new Date(m.created_at).toDateString()
      dividerFlags.push(dayKey !== lastDay)
      lastDay = dayKey
    }
  }

  return (
    <div
      ref={scrollRef}
      onScroll={handleScroll}
      className="flex-1 overflow-y-auto px-4 py-3 scroll-smooth"
    >
      {hasMore && (
        <div className="flex justify-center mb-2">
          <button
            type="button"
            onClick={handleLoadMoreClick}
            disabled={isLoadingMore}
            className="inline-flex items-center gap-1.5 text-[11px] text-muted-foreground hover:text-foreground bg-muted/30 hover:bg-muted/50 border border-border rounded-full px-3 py-1 transition-colors disabled:opacity-50"
          >
            {isLoadingMore ? (
              <Loader2 className="w-3 h-3 animate-spin" />
            ) : (
              <ChevronUp className="w-3 h-3" />
            )}
            Load earlier messages
          </button>
        </div>
      )}

      {messages.map((m, i) => {
        const prev = messages[i - 1]
        const grouped = shouldGroupWithPrev(m, prev)
        const showDivider = dividerFlags[i]

        return (
          <div key={m.id}>
            {showDivider && (
              <div className="flex items-center gap-3 my-4">
                <div className="flex-1 h-px bg-border" />
                <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
                  {dateLabel(m.created_at)}
                </span>
                <div className="flex-1 h-px bg-border" />
              </div>
            )}
            <ChatMessage message={m} grouped={grouped} onRetry={onRetry} />
          </div>
        )
      })}
    </div>
  )
}
