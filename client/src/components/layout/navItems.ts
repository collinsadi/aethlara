import {
  BarChart3,
  Bot,
  Briefcase,
  FileText,
  KanbanSquare,
  ListChecks,
  Mail,
  Send,
  Settings,
  type LucideIcon,
} from 'lucide-react'
import type { NavBadgeKey } from '@/hooks/useNavBadges'

export interface NavItem {
  icon: LucideIcon
  label: string
  href: string
  badge?: NavBadgeKey
}

export interface NavSection {
  title?: string
  items: NavItem[]
}

/** Shared by the desktop sidebar and the mobile menu. */
export const NAV_SECTIONS: NavSection[] = [
  {
    items: [
      { icon: Bot, label: 'Autopilot', href: '/agent' },
      { icon: ListChecks, label: 'Review', href: '/review', badge: 'review' },
      { icon: Send, label: 'Applications', href: '/applications', badge: 'applications' },
      { icon: Mail, label: 'Inbox', href: '/inbox', badge: 'inbox' },
    ],
  },
  {
    title: 'Workspace',
    items: [
      { icon: Briefcase, label: 'Jobs', href: '/jobs' },
      { icon: KanbanSquare, label: 'Tracker', href: '/tracker' },
      { icon: FileText, label: 'Resumes', href: '/resumes' },
      { icon: BarChart3, label: 'Insights', href: '/dashboard' },
    ],
  },
  {
    items: [{ icon: Settings, label: 'Settings', href: '/settings' }],
  },
]

export function isNavActive(href: string, pathname: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`)
}
