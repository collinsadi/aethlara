import { Link } from 'react-router-dom'
import { CheckCircle2, ListChecks, Mail, Puzzle, UserRoundCheck, type LucideIcon } from 'lucide-react'
import type { AgentOverview } from '@/lib/agentTypes'
import { toneText, type Tone } from '@/lib/tones'
import { cn } from '@/lib/utils'

interface Tile {
  label: string
  value: number
  hint: string
  icon: LucideIcon
  to?: string
  /** Tone used when the tile needs attention (value > 0). */
  tone: Tone
}

export function CountTiles({ overview }: { overview: AgentOverview }) {
  const { counts, setup } = overview
  const waiting = (counts.applications.needs_input ?? 0) + (counts.applications.failed ?? 0)
  const ready = counts.applications.ready ?? 0

  const tiles: Tile[] = [
    {
      label: 'To review',
      value: counts.leads.new ?? 0,
      hint: 'New jobs waiting for your decision',
      icon: ListChecks,
      to: '/review',
      tone: 'brand',
    },
    {
      label: 'Waiting on you',
      value: waiting,
      hint: 'Questions to answer or failures to retry',
      icon: UserRoundCheck,
      to: '/applications',
      tone: 'warning',
    },
    {
      label: 'Ready for extension',
      value: ready,
      hint: setup.extension_connected ? 'The extension will submit these' : 'Connect the extension to submit',
      icon: Puzzle,
      to: '/applications',
      tone: setup.extension_connected ? 'neutral' : 'warning',
    },
    {
      label: 'Submitted today',
      value: counts.submitted_today,
      hint: 'In the last 24 hours',
      icon: CheckCircle2,
      to: '/applications',
      tone: 'success',
    },
    {
      label: 'Important mail',
      value: counts.unread_important,
      hint: 'Unread interviews, offers and more',
      icon: Mail,
      to: '/inbox?filter=important',
      tone: 'brand',
    },
  ]

  return (
    <ul className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5" aria-label="Autopilot at a glance">
      {tiles.map((tile) => (
        <li key={tile.label} className={cn(tile.label === 'To review' && 'col-span-2 md:col-span-1')}>
          <TileCard tile={tile} />
        </li>
      ))}
    </ul>
  )
}

function TileCard({ tile }: { tile: Tile }) {
  const active = tile.value > 0
  const body = (
    <>
      <div className="flex items-start justify-between gap-2">
        <p className="text-xs font-medium text-muted-foreground">{tile.label}</p>
        <tile.icon className={cn('size-4 shrink-0', active ? toneText[tile.tone] : 'text-muted-foreground/60')} aria-hidden />
      </div>
      <p
        className={cn(
          'mt-2 font-heading text-3xl font-semibold tabular-nums tracking-tight',
          active ? 'text-foreground' : 'text-muted-foreground/70'
        )}
      >
        {tile.value}
      </p>
      <p className="mt-1 text-[11px] leading-snug text-muted-foreground">{tile.hint}</p>
    </>
  )
  const className = 'glass-card glass-hover block h-full p-4'
  if (!tile.to) return <div className={className}>{body}</div>
  return (
    <Link
      to={tile.to}
      className={cn(className, 'outline-none focus-visible:ring-2 focus-visible:ring-brand/40')}
      aria-label={`${tile.label}: ${tile.value}. ${tile.hint}`}
    >
      {body}
    </Link>
  )
}
