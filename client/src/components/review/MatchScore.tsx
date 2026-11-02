import { scoreTone, toneText } from '@/lib/tones'
import { cn } from '@/lib/utils'

interface MatchScoreProps {
  score: number | null | undefined
  size?: 'sm' | 'lg'
  className?: string
}

const SIZES = {
  sm: { box: 40, stroke: 3.5, text: 'text-xs' },
  lg: { box: 64, stroke: 5, text: 'text-lg' },
}

/** Circular 0-100 match score. Unscored leads show a dash. */
export function MatchScore({ score, size = 'sm', className }: MatchScoreProps) {
  const { box, stroke, text } = SIZES[size]
  const r = (box - stroke) / 2
  const c = 2 * Math.PI * r
  const value = typeof score === 'number' ? Math.max(0, Math.min(100, score)) : null
  const tone = scoreTone(value)

  return (
    <div
      className={cn('relative shrink-0', className)}
      style={{ width: box, height: box }}
      role="img"
      aria-label={value === null ? 'Not scored yet' : `Match score ${value} out of 100`}
    >
      <svg width={box} height={box} className="-rotate-90" aria-hidden>
        <circle cx={box / 2} cy={box / 2} r={r} fill="none" strokeWidth={stroke} className="stroke-border" />
        {value !== null && (
          <circle
            cx={box / 2}
            cy={box / 2}
            r={r}
            fill="none"
            strokeWidth={stroke}
            strokeLinecap="round"
            strokeDasharray={c}
            strokeDashoffset={c - (value / 100) * c}
            className={cn('stroke-current transition-[stroke-dashoffset] duration-500', toneText[tone])}
          />
        )}
      </svg>
      <span
        className={cn(
          'absolute inset-0 flex items-center justify-center font-heading font-semibold tabular-nums',
          text,
          value === null ? 'text-muted-foreground' : 'text-foreground'
        )}
        aria-hidden
      >
        {value ?? '—'}
      </span>
    </div>
  )
}
