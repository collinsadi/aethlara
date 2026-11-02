import { useAgentOverview } from '@/hooks/useAgent'
import type { Tone } from '@/lib/tones'

export type NavBadgeKey = 'review' | 'applications' | 'inbox'

export interface NavBadge {
  count: number
  tone: Tone
  /** Screen-reader text, e.g. "29 jobs to review". */
  label: string
}

/** Counts shown next to the autopilot nav items (from GET /agent/overview). */
export function useNavBadges(): Partial<Record<NavBadgeKey, NavBadge>> {
  const { data } = useAgentOverview()
  if (!data) return {}
  const { leads, applications, unread_important } = data.counts
  const review = leads.new ?? 0
  const waiting = (applications.needs_input ?? 0) + (applications.failed ?? 0)
  return {
    review: { count: review, tone: 'brand', label: `${review} jobs to review` },
    applications: { count: waiting, tone: 'warning', label: `${waiting} applications waiting on you` },
    inbox: { count: unread_important, tone: 'brand', label: `${unread_important} unread important emails` },
  }
}
