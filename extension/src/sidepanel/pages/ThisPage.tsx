import { useEffect, useMemo, useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { ApiError, agentApi } from '@/background/api'
import { ensureContentScript } from '@/background/tabs'
import { sendToBackground, sendToTab } from '@/lib/messaging'
import { errorMessage, hostOf } from '@/lib/util'
import type { Application, LeadWithApplication, RunnerState } from '@/types'
import { LiveRun } from '../components/LiveRun'
import { Notice, ScoreBadge, SectionHead, Spinner } from '../components/ui'
import { NoContentScriptError, isRestrictedUrl, useActiveTab, usePageInfo } from '../hooks/useActiveTab'
import { useFillableApplications, useInvalidateAgent } from '../hooks/useAgent'

export type LegacyRoute = 'job_picker' | 'extract'

function addLeadError(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.code === 'API_KEY_REQUIRED') return 'Add an AI provider key in the dashboard first.'
    if (err.code === 'RATE_LIMITED') return 'You added a lot of jobs this hour. Try again later.'
    if (err.code === 'AI_TIMEOUT' || err.code === 'TIMEOUT') return 'The AI took too long. Try again in a moment.'
  }
  return errorMessage(err, 'Could not add this job.')
}

function SendToAgent({ tab }: { tab: chrome.tabs.Tab }) {
  const [approve, setApprove] = useState(false)
  const invalidate = useInvalidateAgent()
  const send = useMutation({
    mutationFn: async (): Promise<LeadWithApplication> => {
      let pageText = ''
      try {
        pageText = (await sendToTab(tab.id!, { type: 'EXTRACT_TEXT' })).text
      } catch {
        pageText = '' // the server scrapes the URL itself when the text is short
      }
      return agentApi.addLead({ url: tab.url!, page_text: pageText, approve, source: 'extension' })
    },
    onSuccess: () => invalidate(),
  })

  // A new page deserves a fresh form.
  const reset = send.reset
  useEffect(() => reset(), [tab.url, reset])

  const result = send.data
  const score = result?.lead.match?.score ?? null

  return (
    <div className="card stack" style={{ gap: 10 }}>
      <div>
        <p className="bold">Send this job to your agent</p>
        <p className="small muted">The agent reads the posting, scores it against your resume and adds it to your leads.</p>
      </div>
      {!result && (
        <>
          <label className="checkbox-row">
            <input type="checkbox" checked={approve} onChange={(e) => setApprove(e.target.checked)} />
            Approve right away (queue an application)
          </label>
          <button className="btn btn-primary btn-full" disabled={send.isPending} onClick={() => send.mutate()}>
            {send.isPending ? (
              <>
                <Spinner /> Reading and scoring…
              </>
            ) : (
              'Send to agent'
            )}
          </button>
        </>
      )}
      {send.isError && <Notice tone="error">{addLeadError(send.error)}</Notice>}
      {result && (
        <div className="stack" style={{ gap: 8 }}>
          <div className="row" style={{ alignItems: 'flex-start' }}>
            <ScoreBadge score={score} />
            <div className="grow">
              <p className="item-title">{result.lead.title}</p>
              <p className="small muted">{result.lead.company}</p>
            </div>
          </div>
          {result.lead.match?.summary && <p className="small">{result.lead.match.summary}</p>}
          <Notice tone="success">
            {result.application
              ? `Approved. The agent prepares the application on its next run${result.lead.apply_channel === 'email' ? ' and emails it' : ''}.`
              : result.lead.status === 'new'
                ? 'Added to Review.'
                : `Already in your leads (${result.lead.status}).`}
          </Notice>
          <button className="link-btn" style={{ alignSelf: 'flex-start' }} onClick={() => send.reset()}>
            Send again
          </button>
        </div>
      )}
    </div>
  )
}

function urlScore(a: string | null, b: string | undefined): number {
  if (!a || !b) return 0
  try {
    const x = new URL(a)
    const y = new URL(b)
    if (x.hostname !== y.hostname) return 0
    let score = 1
    if (x.pathname.replace(/\/+$/, '') === y.pathname.replace(/\/+$/, '')) score += 2
    if (x.search && x.search === y.search) score += 1
    return score
  } catch {
    return 0
  }
}

function FillForm({ tab, runner }: { tab: chrome.tabs.Tab; runner: RunnerState }) {
  const apps = useFillableApplications(true)
  const [selected, setSelected] = useState('')
  const [startedAt, setStartedAt] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)

  const options = useMemo(() => (apps.data ?? []).filter((a) => a.channel === 'browser'), [apps.data])
  useEffect(() => {
    if (selected || !options.length) return
    const ranked = [...options].sort((a, b) => urlScore(b.apply_url, tab.url) - urlScore(a.apply_url, tab.url))
    if (urlScore(ranked[0].apply_url, tab.url) >= 3) setSelected(ranked[0].id)
  }, [options, selected, tab.url])

  const session = runner.manual.find((r) => r.tabId === tab.id)
  const result = startedAt ? runner.recent.find((r) => r.appId === selected && r.at >= startedAt) : undefined

  const start = async () => {
    if (!selected || tab.id === undefined) return
    setPending(true)
    setError(null)
    setStartedAt(Date.now())
    try {
      await sendToBackground({ type: 'MANUAL_FILL', tabId: tab.id, appId: selected })
    } catch (err) {
      setError(errorMessage(err))
      setStartedAt(null)
    } finally {
      setPending(false)
    }
  }

  const label = (a: Application) => `${a.lead.title} · ${a.lead.company}${a.status !== 'ready' ? ` (${a.status.replace('_', ' ')})` : ''}`

  return (
    <div className="card stack" style={{ gap: 10 }}>
      <div>
        <p className="bold">Fill this form</p>
        <p className="small muted">Uses an approved application's tailored resume and answers. Stops before submitting.</p>
      </div>
      {apps.isLoading && (
        <div className="row small muted">
          <Spinner /> Loading applications…
        </div>
      )}
      {apps.isError && <Notice tone="error">{errorMessage(apps.error)}</Notice>}
      {apps.data && !options.length && (
        <p className="small muted">No approved applications to use. Approve a job (or send this one to the agent) and let the agent prepare it.</p>
      )}
      {options.length > 0 && (
        <select className="select" value={selected} onChange={(e) => setSelected(e.target.value)} disabled={!!session}>
          <option value="">Choose an application…</option>
          {options.map((a) => (
            <option key={a.id} value={a.id}>
              {label(a)}
            </option>
          ))}
        </select>
      )}
      {session ? (
        <LiveRun run={session} />
      ) : (
        options.length > 0 && (
          <button className="btn btn-primary btn-full" disabled={!selected || pending} onClick={() => void start()}>
            {pending ? 'Starting…' : 'Fill this form'}
          </button>
        )
      )}
      {result && !session && (
        <Notice tone={result.status === 'needs_input' ? 'warn' : result.status === 'submitted' ? 'success' : 'error'}>{result.message}</Notice>
      )}
      {error && <Notice tone="error">{error}</Notice>}
    </div>
  )
}

export function ThisPage({ runner, onNavigate }: { runner: RunnerState; onNavigate: (route: LegacyRoute) => void }) {
  const { tab } = useActiveTab()
  const info = usePageInfo(tab)
  const [reloading, setReloading] = useState(false)

  if (!tab) {
    return (
      <div className="page">
        <Spinner />
      </div>
    )
  }

  const restricted = isRestrictedUrl(tab.url)
  const noScript = info.error instanceof NoContentScriptError

  const reload = async () => {
    if (tab.id === undefined) return
    setReloading(true)
    await chrome.tabs.reload(tab.id)
    setTimeout(() => setReloading(false), 1500)
  }

  const tryInject = async () => {
    if (tab.id !== undefined && (await ensureContentScript(tab.id))) void info.refetch()
  }

  const page = info.data
  const managedByAutopilot = page?.managed?.mode === 'auto' || runner.current?.tabId === tab.id

  return (
    <div className="page">
      <div className="card">
        <p className="item-title truncate" title={tab.title}>
          {tab.title || 'Untitled page'}
        </p>
        <p className="small muted truncate">{hostOf(tab.url) || tab.url}</p>
        {page && (
          <div className="row wrap" style={{ gap: 6, marginTop: 8 }}>
            {page.isJobPosting && <span className="badge badge-blue">Job posting</span>}
            {page.isApplicationForm && <span className="badge badge-brand">Application form</span>}
            {page.ats && <span className="badge badge-gray">{page.ats}</span>}
            {page.loginWall && <span className="badge badge-amber">Sign-in wall</span>}
            {!page.isJobPosting && !page.isApplicationForm && <span className="badge badge-gray">No job detected</span>}
          </div>
        )}
      </div>

      {restricted && <Notice>Open a job posting or an application form to use Aethlara on it.</Notice>}
      {!restricted && tab.status !== 'complete' && (
        <div className="row small muted">
          <Spinner /> Waiting for the page to load…
        </div>
      )}
      {!restricted && info.isLoading && tab.status === 'complete' && (
        <div className="row small muted">
          <Spinner /> Reading the page…
        </div>
      )}
      {noScript && (
        <Notice tone="warn">
          <div className="stack">
            <span>Aethlara can't read this tab yet (it was open before the extension started).</span>
            <div className="row">
              <button className="btn btn-soft btn-sm" onClick={() => void reload()} disabled={reloading}>
                {reloading ? 'Reloading…' : 'Reload page'}
              </button>
              <button className="link-btn" onClick={() => void tryInject()}>
                Try without reloading
              </button>
            </div>
          </div>
        </Notice>
      )}
      {info.isError && !noScript && <Notice tone="error">{errorMessage(info.error)}</Notice>}

      {runner.current && runner.current.tabId === tab.id && (
        <div className="section">
          <SectionHead title="The autopilot is applying here" />
          <LiveRun run={runner.current} />
        </div>
      )}

      {page && !managedByAutopilot && (
        <>
          {(page.isJobPosting || !page.isApplicationForm) && (
            <div className="section">
              <SectionHead title="Job posting" />
              <SendToAgent tab={tab} />
            </div>
          )}
          {page.isApplicationForm && (
            <div className="section">
              <SectionHead title="Application form" />
              {page.loginWall && <Notice tone="warn">This site wants you to sign in first. Sign in, then fill the form.</Notice>}
              <FillForm tab={tab} runner={runner} />
            </div>
          )}
        </>
      )}

      {!restricted && (
        <div className="section">
          <SectionHead title="Saved jobs" />
          <div className="list">
            <button className="btn btn-ghost btn-full" onClick={() => onNavigate('job_picker')}>
              <span>Autofill with a saved job</span>
              <span className="badge badge-beta">Beta</span>
            </button>
            <button className="btn btn-ghost btn-full" onClick={() => onNavigate('extract')}>
              Extract this job to your tracker
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
