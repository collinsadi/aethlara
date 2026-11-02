import { useState } from 'react'
import { Link } from 'react-router-dom'
import { CheckCircle2, ChevronDown, Circle, MinusCircle, AlertCircle } from 'lucide-react'
import type { AgentProfile, AgentSetup } from '@/lib/agentTypes'
import { ui } from '@/lib/styles'
import { cn } from '@/lib/utils'

type StepState = 'done' | 'todo' | 'partial' | 'optional'

interface Step {
  id: string
  title: string
  state: StepState
  /** Required for the agent to work at all. */
  required: boolean
  detail: React.ReactNode
  actions?: { label: string; to: string; primary?: boolean }[]
}

function buildSteps(setup: AgentSetup, profile: AgentProfile): Step[] {
  const provider = setup.ai_provider === 'anthropic' ? 'Anthropic' : setup.ai_provider === 'openrouter' ? 'OpenRouter' : null
  const titles = profile.search_prefs.titles.length ? profile.search_prefs.titles : profile.search_prefs.keywords

  return [
    {
      id: 'ai',
      title: 'Connect an AI provider',
      required: true,
      state: setup.has_ai_key ? 'done' : 'todo',
      detail: setup.has_ai_key
        ? `Using your ${provider ?? 'AI'} key${setup.web_search_available ? ' — Claude web search is available.' : '. Switch to Anthropic to let the agent search the web too.'}`
        : 'The agent runs on your own Anthropic or OpenRouter key. Anthropic also unlocks Claude web search.',
      actions: setup.has_ai_key ? undefined : [{ label: 'Add API key', to: '/settings#ai', primary: true }],
    },
    {
      id: 'resume',
      title: 'Upload your resume',
      required: true,
      state: setup.has_resume ? 'done' : 'todo',
      detail: setup.has_resume
        ? 'Every posting is scored against it and it is tailored for each application.'
        : 'The agent scores postings against your resume and tailors it for each application.',
      actions: setup.has_resume
        ? [{ label: 'Change resume', to: '/agent/settings#resume' }]
        : [{ label: 'Upload resume', to: '/resumes', primary: true }],
    },
    {
      id: 'preferences',
      title: "Tell it what you're looking for",
      required: true,
      state: setup.has_preferences ? 'done' : 'todo',
      detail: setup.has_preferences
        ? `Searching for ${titles.slice(0, 3).join(', ')}${titles.length > 3 ? '…' : ''}.`
        : 'Add at least one job title or keyword so the agent knows what to search for.',
      actions: [
        {
          label: setup.has_preferences ? 'Edit preferences' : 'Set preferences',
          to: '/agent/settings#search',
          primary: !setup.has_preferences,
        },
      ],
    },
    {
      id: 'mailbox',
      title: 'Agent mailbox',
      required: false,
      state: setup.mailbox_enabled ? (setup.inbound_enabled ? 'done' : 'partial') : 'optional',
      detail: setup.mailbox_enabled ? (
        setup.inbound_enabled ? (
          <>
            Applications go out from <span className="font-medium text-foreground">{profile.mailbox_address}</span>
            , and replies land in your Inbox.
          </>
        ) : (
          <>
            Applications go out from <span className="font-medium text-foreground">{profile.mailbox_address}</span>
            , but this server doesn't receive replies yet (inbound mail isn't configured).
          </>
        )
      ) : (
        "Not configured on this server, so applications use your account email and replies go to your personal inbox."
      ),
      actions: setup.mailbox_enabled ? [{ label: 'Edit address', to: '/agent/settings#mailbox' }] : undefined,
    },
    {
      id: 'extension',
      title: 'Connect the Chrome extension',
      required: false,
      state: setup.extension_connected ? 'done' : 'todo',
      detail: setup.extension_connected
        ? 'Form applications (Greenhouse, Lever, Ashby…) are filled and submitted from your browser.'
        : 'Needed for form applications on Greenhouse, Lever, Ashby and other job sites. Email applications work without it.',
      actions: setup.extension_connected
        ? undefined
        : [
            { label: 'Connect', to: '/settings#extension', primary: true },
            { label: 'Install', to: '/extension/install' },
          ],
    },
  ]
}

const STATE_ICON: Record<StepState, { icon: typeof CheckCircle2; className: string; label: string }> = {
  done: { icon: CheckCircle2, className: 'text-success', label: 'Done' },
  todo: { icon: Circle, className: 'text-muted-foreground', label: 'To do' },
  partial: { icon: AlertCircle, className: 'text-warning', label: 'Partly set up' },
  optional: { icon: MinusCircle, className: 'text-muted-foreground/70', label: 'Optional' },
}

interface Props {
  setup: AgentSetup
  profile: AgentProfile
}

/**
 * Onboarding checklist. Expanded while a required step is missing; once the
 * essentials are done it collapses to a single summary row.
 */
export function SetupChecklist({ setup, profile }: Props) {
  const steps = buildSteps(setup, profile)
  const requiredMissing = steps.some((s) => s.required && s.state !== 'done')
  const doneCount = steps.filter((s) => s.state === 'done').length
  const [expanded, setExpanded] = useState(false)
  const open = requiredMissing || expanded

  return (
    <section aria-labelledby="setup-heading" className="glass-card overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-4">
        <div className="min-w-0">
          <h2 id="setup-heading" className="font-heading text-sm font-semibold text-foreground">
            {requiredMissing ? 'Finish setting up your autopilot' : 'Setup'}
          </h2>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {requiredMissing
              ? 'A few things are needed before the agent can search and apply for you.'
              : `${doneCount} of ${steps.length} done — the essentials are in place.`}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <div className="hidden h-1.5 w-28 overflow-hidden rounded-full bg-muted sm:block" aria-hidden>
            <div
              className="h-full rounded-full bg-success transition-[width] duration-500"
              style={{ width: `${(doneCount / steps.length) * 100}%` }}
            />
          </div>
          {!requiredMissing && (
            <button
              type="button"
              onClick={() => setExpanded((v) => !v)}
              aria-expanded={open}
              aria-controls="setup-steps"
              className={ui.ghost}
            >
              {open ? 'Hide' : 'Details'}
              <ChevronDown className={cn('size-3.5 transition-transform', open && 'rotate-180')} aria-hidden />
            </button>
          )}
        </div>
      </div>

      {open && (
        <ol id="setup-steps" className="divide-y divide-border border-t border-border">
          {steps.map((step) => {
            const { icon: Icon, className, label } = STATE_ICON[step.state]
            return (
              <li key={step.id} className="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex min-w-0 items-start gap-3">
                  <Icon className={cn('mt-0.5 size-5 shrink-0', className)} role="img" aria-label={label} />
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-foreground">
                      {step.title}
                      {!step.required && step.state !== 'done' && (
                        <span className="ml-2 text-xs font-normal text-muted-foreground">Optional</span>
                      )}
                    </p>
                    <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">{step.detail}</p>
                  </div>
                </div>
                {step.actions && (
                  <div className="flex shrink-0 flex-wrap gap-2 pl-8 sm:pl-0">
                    {step.actions.map((a) => (
                      <Link key={a.label} to={a.to} className={a.primary ? ui.primarySm : ui.outline}>
                        {a.label}
                      </Link>
                    ))}
                  </div>
                )}
              </li>
            )
          })}
        </ol>
      )}
    </section>
  )
}
