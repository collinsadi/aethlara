import { Keyboard } from 'lucide-react'
import { Kbd } from '@/components/ui/kbd'

export interface Shortcut {
  keys: string[]
  label: string
}

/** Always-visible keyboard legend for the triage view (hidden on touch-size screens). */
export function ShortcutLegend({ shortcuts }: { shortcuts: Shortcut[] }) {
  return (
    <div
      className="hidden flex-wrap items-center gap-x-4 gap-y-1.5 rounded-xl border border-border bg-muted/30 px-3 py-2 text-[11px] text-muted-foreground md:flex"
      aria-label="Keyboard shortcuts"
    >
      <Keyboard className="size-3.5" aria-hidden />
      {shortcuts.map((s) => (
        <span key={s.label} className="inline-flex items-center gap-1">
          {s.keys.map((k) => (
            <Kbd key={k}>{k}</Kbd>
          ))}
          <span className="ml-0.5">{s.label}</span>
        </span>
      ))}
    </div>
  )
}
