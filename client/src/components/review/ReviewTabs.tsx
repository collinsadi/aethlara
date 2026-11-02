import { useRef } from 'react'
import { cn } from '@/lib/utils'

export interface ReviewTab {
  id: string
  label: string
  count?: number
}

interface Props {
  tabs: ReviewTab[]
  value: string
  onChange: (id: string) => void
  /** id of the panel the tabs control */
  panelId: string
}

/** Accessible tab bar (arrow keys move between tabs). */
export function ReviewTabs({ tabs, value, onChange, panelId }: Props) {
  const refs = useRef<(HTMLButtonElement | null)[]>([])

  const onKeyDown = (e: React.KeyboardEvent, index: number) => {
    let next = -1
    if (e.key === 'ArrowRight') next = (index + 1) % tabs.length
    else if (e.key === 'ArrowLeft') next = (index - 1 + tabs.length) % tabs.length
    else if (e.key === 'Home') next = 0
    else if (e.key === 'End') next = tabs.length - 1
    if (next < 0) return
    e.preventDefault()
    refs.current[next]?.focus()
    onChange(tabs[next].id)
  }

  return (
    <div role="tablist" aria-label="Review queues" className="flex gap-1 overflow-x-auto border-b border-border">
      {tabs.map((tab, i) => {
        const selected = tab.id === value
        return (
          <button
            key={tab.id}
            ref={(el) => {
              refs.current[i] = el
            }}
            id={`review-tab-${tab.id}`}
            type="button"
            role="tab"
            aria-selected={selected}
            aria-controls={panelId}
            tabIndex={selected ? 0 : -1}
            onClick={() => onChange(tab.id)}
            onKeyDown={(e) => onKeyDown(e, i)}
            className={cn(
              '-mb-px inline-flex shrink-0 items-center gap-2 border-b-2 px-3 py-2.5 text-sm font-medium outline-none transition-colors',
              'focus-visible:ring-2 focus-visible:ring-brand/40 rounded-t-lg',
              selected ? 'border-brand text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground'
            )}
          >
            {tab.label}
            {tab.count !== undefined && (
              <span
                className={cn(
                  'inline-flex h-5 min-w-5 items-center justify-center rounded-full px-1.5 text-[10px] font-semibold tabular-nums',
                  selected ? 'bg-brand text-primary-foreground' : 'bg-muted text-muted-foreground'
                )}
              >
                {tab.count}
              </span>
            )}
          </button>
        )
      })}
    </div>
  )
}
