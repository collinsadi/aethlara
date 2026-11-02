import type { ReactNode } from 'react'
import { cn } from '@/lib/util'
import type { ApplicationStatus, NeedsReason } from '@/types'

export function openTab(url: string): void {
  void chrome.tabs.create({ url })
}

export function Spinner({ large }: { large?: boolean }) {
  return <span className={cn('spinner', large && 'lg')} aria-hidden="true" />
}

export function Toggle({
  on,
  onChange,
  disabled,
  label,
}: {
  on: boolean
  onChange: (next: boolean) => void
  disabled?: boolean
  label: string
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      className={cn('toggle', on && 'on')}
      disabled={disabled}
      onClick={() => onChange(!on)}
    />
  )
}

export function scoreClass(score: number | null | undefined): string {
  if (score == null) return 'none'
  return score >= 75 ? 'high' : score >= 55 ? 'mid' : 'low'
}

export function ScoreBadge({ score }: { score: number | null | undefined }) {
  return (
    <span className={cn('score', scoreClass(score))} title="Match score">
      {score == null ? '–' : score}
    </span>
  )
}

const STATUS_LABEL: Record<ApplicationStatus, [string, string]> = {
  queued: ['Queued', 'badge-gray'],
  preparing: ['Preparing', 'badge-blue'],
  ready: ['Ready', 'badge-blue'],
  in_progress: ['Applying', 'badge-brand'],
  needs_input: ['Needs you', 'badge-amber'],
  submitted: ['Submitted', 'badge-green'],
  failed: ['Failed', 'badge-red'],
  cancelled: ['Cancelled', 'badge-gray'],
}

export function StatusPill({ status }: { status: ApplicationStatus }) {
  const [label, cls] = STATUS_LABEL[status] ?? [status, 'badge-gray']
  return <span className={cn('badge', cls)}>{label}</span>
}

export const NEEDS_LABEL: Record<NeedsReason, string> = {
  missing_answers: 'Questions to answer',
  captcha: 'CAPTCHA to solve',
  login_required: 'Sign-in required',
  verification: 'Email verification',
  unsupported_form: 'Unsupported form',
  review: 'Review and submit',
}

export function Notice({ tone = 'info', children }: { tone?: 'info' | 'warn' | 'error' | 'success'; children: ReactNode }) {
  return <div className={cn('notice', tone !== 'info' && tone)}>{children}</div>
}

export function EmptyState({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="empty">
      <p className="bold" style={{ color: 'var(--fg)' }}>
        {title}
      </p>
      {children}
    </div>
  )
}

export function SectionHead({ title, action }: { title: string; action?: ReactNode }) {
  return (
    <div className="section-head">
      <span className="section-title">{title}</span>
      {action}
    </div>
  )
}

// ── Icons (inline, no icon font) ─────────────────────────────────────────────

const iconProps = { width: 15, height: 15, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2.2, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const }

export function LogoIcon() {
  return (
    <svg {...iconProps} width={14} height={14} strokeWidth={2.5}>
      <path d="M12 2L2 7l10 5 10-5-10-5z" />
      <path d="M2 17l10 5 10-5" />
      <path d="M2 12l10 5 10-5" />
    </svg>
  )
}

export function GearIcon() {
  return (
    <svg {...iconProps}>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </svg>
  )
}

export function BackIcon() {
  return (
    <svg {...iconProps}>
      <path d="M15 18l-6-6 6-6" />
    </svg>
  )
}

export function ExternalIcon() {
  return (
    <svg {...iconProps} width={12} height={12}>
      <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
      <path d="M15 3h6v6" />
      <path d="M10 14L21 3" />
    </svg>
  )
}

export function ExternalLink({ href, children, className }: { href: string; children: ReactNode; className?: string }) {
  return (
    <a
      href={href}
      className={className}
      onClick={(e) => {
        e.preventDefault()
        openTab(href)
      }}
    >
      {children}
    </a>
  )
}
