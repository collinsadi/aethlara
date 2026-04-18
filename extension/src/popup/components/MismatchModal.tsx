import { useEffect, useRef, useState } from 'react'
import type { ExtMismatchData } from '@/types'
import { sanitiseResumeText } from '@/lib/sanitise'

interface Props {
  data: ExtMismatchData
  onClose: () => void
}

export function MismatchModal({ data, onClose }: Props) {
  const [displayScore, setDisplayScore] = useState(0)
  const animRef = useRef<number | null>(null)
  const closeRef = useRef<HTMLButtonElement>(null)
  const learnRef = useRef<HTMLButtonElement>(null)

  // Count score from 0 → actual over 350ms
  useEffect(() => {
    const target = data.match_score
    const duration = 350
    const start = performance.now()
    const tick = (now: number) => {
      const progress = Math.min((now - start) / duration, 1)
      setDisplayScore(Math.round(progress * target))
      if (progress < 1) animRef.current = requestAnimationFrame(tick)
    }
    animRef.current = requestAnimationFrame(tick)
    return () => { if (animRef.current !== null) cancelAnimationFrame(animRef.current) }
  }, [data.match_score])

  // Block Escape dismissal
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') e.preventDefault()
    }
    document.addEventListener('keydown', handler, { capture: true })
    return () => document.removeEventListener('keydown', handler, { capture: true })
  }, [])

  // Focus trap — cycle between learnRef and closeRef
  useEffect(() => {
    learnRef.current?.focus()
    const trap = (e: KeyboardEvent) => {
      if (e.key !== 'Tab') return
      e.preventDefault()
      const focusable = [learnRef.current, closeRef.current].filter(Boolean) as HTMLButtonElement[]
      const idx = focusable.indexOf(document.activeElement as HTMLButtonElement)
      const next = e.shiftKey
        ? focusable[(idx - 1 + focusable.length) % focusable.length]
        : focusable[(idx + 1) % focusable.length]
      next?.focus()
    }
    document.addEventListener('keydown', trap)
    return () => document.removeEventListener('keydown', trap)
  }, [])

  const scoreColor = (s: number) => s >= 70 ? 'var(--success)' : s >= 40 ? 'var(--warning)' : 'var(--error)'
  const color = scoreColor(data.match_score)
  const bd = data.match_breakdown

  const openLearnMore = () => {
    chrome.tabs.create({ url: data.learn_more_url })
  }

  return (
    <div
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="mm-title"
      aria-describedby="mm-reason"
      style={{
        position: 'fixed', inset: 0, zIndex: 100,
        background: 'rgba(0,0,0,0.75)',
        display: 'flex', flexDirection: 'column',
        overflowY: 'auto',
        animation: 'slideUp 0.25s ease-out',
      }}
    >
      <style>{`
        @keyframes slideUp {
          from { transform: translateY(100%); opacity: 0; }
          to   { transform: translateY(0);    opacity: 1; }
        }
        @keyframes spin { to { transform: rotate(360deg); } }
      `}</style>

      <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 14 }}>
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
          <div style={{ padding: 6, borderRadius: 'var(--radius)', background: 'rgba(245,158,11,0.12)', flexShrink: 0 }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#f59e0b" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
              <line x1="12" y1="9" x2="12" y2="13" /><line x1="12" y1="17" x2="12.01" y2="17" />
            </svg>
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <p id="mm-title" style={{ fontWeight: 700, fontSize: 14, color: 'var(--fg)', margin: 0 }}>Low Match Detected</p>
            <p style={{ fontSize: 11, color: 'var(--muted)', margin: '2px 0 0', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {data.job_title}{data.company ? ` · ${data.company}` : ''}
            </p>
          </div>
        </div>

        {/* Score card */}
        <div className="card" style={{ textAlign: 'center' }}>
          <p
            aria-live="polite"
            aria-label={`${displayScore} percent overall match`}
            style={{ fontSize: 36, fontWeight: 700, color, margin: 0, fontVariantNumeric: 'tabular-nums' }}
          >
            {displayScore}%
          </p>
          <p style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2 }}>Overall Match</p>

          {bd && (
            <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 6 }}>
              <AnimatedBar label="Skills" value={bd.skills_match} />
              <AnimatedBar label="Experience" value={bd.experience_match} />
              <AnimatedBar label="Education" value={bd.education_match} />
            </div>
          )}
        </div>

        {/* Reason */}
        <div>
          <p style={{ fontSize: 10, fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 4 }}>
            Why this happened
          </p>
          <p id="mm-reason" style={{ fontSize: 12, color: 'var(--fg)', lineHeight: 1.5, margin: 0 }}>
            {sanitiseResumeText(data.reason)}
          </p>
        </div>

        {/* Gaps */}
        {data.gaps.length > 0 && (
          <div>
            <p style={{ fontSize: 10, fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 6 }}>
              What&apos;s missing
            </p>
            <ul style={{ margin: 0, paddingLeft: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 4 }}>
              {data.gaps.map((gap) => (
                <li key={gap} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--fg)' }}>
                  <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--warning)', flexShrink: 0 }} />
                  {sanitiseResumeText(gap)}
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* Suggestion hint */}
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8, padding: 10, borderRadius: 'var(--radius)', background: 'var(--muted-bg)', border: '1px solid var(--border)' }}>
          <span style={{ fontSize: 14, lineHeight: 1, marginTop: 1 }}>💡</span>
          <p style={{ fontSize: 11, color: 'var(--muted)', lineHeight: 1.5, margin: 0 }}>
            You may have skills not listed in your resume. Updating it can improve future matches.
          </p>
        </div>

        {/* Not saved notice — always visible */}
        <p style={{ fontSize: 11, color: 'var(--error)', textAlign: 'center', fontWeight: 600, margin: 0 }}>
          This job was not saved.
        </p>

        {/* Actions */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <button
            ref={learnRef}
            type="button"
            className="btn btn-primary btn-full"
            style={{ fontSize: 12 }}
            onClick={openLearnMore}
          >
            Learn More ↗
          </button>
          <button
            ref={closeRef}
            type="button"
            className="btn btn-ghost btn-full"
            style={{ fontSize: 12 }}
            onClick={onClose}
          >
            Close
          </button>
        </div>
      </div>
    </div>
  )
}

function AnimatedBar({ label, value }: { label: string; value: number }) {
  const [width, setWidth] = useState(0)
  const animRef = useRef<number | null>(null)
  const color = value >= 70 ? 'var(--success)' : value >= 40 ? 'var(--warning)' : 'var(--error)'

  useEffect(() => {
    const duration = 400
    const start = performance.now()
    const tick = (now: number) => {
      const progress = Math.min((now - start) / duration, 1)
      setWidth(Math.round(progress * value))
      if (progress < 1) animRef.current = requestAnimationFrame(tick)
    }
    const delay = setTimeout(() => { animRef.current = requestAnimationFrame(tick) }, 100)
    return () => {
      clearTimeout(delay)
      if (animRef.current !== null) cancelAnimationFrame(animRef.current)
    }
  }, [value])

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
      <span style={{ fontSize: 10, color: 'var(--muted)', width: 64, flexShrink: 0, textAlign: 'left' }}>{label}</span>
      <div
        className="score-bar"
        style={{ flex: 1 }}
        role="progressbar"
        aria-valuenow={value}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={`${label} ${value}%`}
      >
        <div className="score-bar-fill" style={{ width: `${width}%`, background: color }} />
      </div>
      <span style={{ fontSize: 10, color: 'var(--muted)', width: 26, textAlign: 'right', flexShrink: 0 }}>{value}%</span>
    </div>
  )
}
