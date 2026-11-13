import { useMemo, useState } from 'react'
import { AlertTriangle } from 'lucide-react'
import { Field, ToggleRow } from '@/components/agent/settings/Field'
import { SettingsSection } from '@/components/agent/settings/SettingsSection'
import { Switch } from '@/components/ui/switch'
import { useEnsureSendTimezone, useUpdateAgentProfile } from '@/hooks/useAgent'
import { useDraft } from '@/hooks/useDraft'
import type { AgentProfile } from '@/lib/agentTypes'
import {
  LIMITS,
  RUN_INTERVALS,
  SEND_DELAYS,
  hourLabel,
  pickRules,
  timezoneOptions,
  validateRules,
} from '@/lib/agentSettings'
import { friendlyErrorMessage } from '@/lib/apiError'
import { ui } from '@/lib/styles'
import { toast } from '@/lib/toast'

const DEFAULT_AUTO_APPROVE = 85
const START_HOURS = Array.from({ length: 23 }, (_, h) => h) // 00:00-22:00
const END_HOURS = Array.from({ length: 23 }, (_, h) => h + 2) // 02:00-24:00

export function ApplyRulesSection({ profile }: { profile: AgentProfile }) {
  useEnsureSendTimezone(profile)
  const { draft, setDraft, patch, dirty, reset } = useDraft(pickRules(profile))
  const update = useUpdateAgentProfile()
  const [saved, setSaved] = useState(false)
  const errors = validateRules(draft)
  const invalid = Object.keys(errors).length > 0
  const autoApprove = draft.auto_approve_score !== null
  const presetInterval = RUN_INTERVALS.some((r) => r.hours === draft.run_interval_hours)
  const presetDelay = SEND_DELAYS.some((d) => d.minutes === draft.send_delay_minutes)
  const zones = useMemo(() => timezoneOptions(draft.send_timezone), [draft.send_timezone])

  const save = () => {
    const { run_interval_hours, ...apply_settings } = draft
    update.mutate(
      { apply_settings, run_interval_hours },
      {
        onSuccess: (p) => {
          setDraft(pickRules(p))
          setSaved(true)
          toast.success('Apply rules saved')
        },
      }
    )
  }

  return (
    <SettingsSection
      id="rules"
      title="Apply rules"
      description="How often the agent runs, how many applications it emails, and when they go out."
      footer={{
        dirty,
        saving: update.isPending,
        invalid,
        error: update.isError ? friendlyErrorMessage(update.error) : null,
        saved: saved && !dirty,
        onSave: save,
        onReset: () => {
          reset()
          update.reset()
        },
      }}
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Field id="rules-interval" label="Run schedule" error={errors.run_interval_hours} hint="While autopilot is on.">
          <select
            id="rules-interval"
            value={presetInterval ? String(draft.run_interval_hours) : 'custom'}
            onChange={(e) => {
              if (e.target.value !== 'custom') patch({ run_interval_hours: Number(e.target.value) })
            }}
            aria-describedby={errors.run_interval_hours ? 'rules-interval-error' : 'rules-interval-hint'}
            className={ui.select}
          >
            {RUN_INTERVALS.map((r) => (
              <option key={r.hours} value={r.hours}>
                {r.label}
              </option>
            ))}
            {!presetInterval && <option value="custom">Every {draft.run_interval_hours} hours</option>}
          </select>
        </Field>
        <Field
          id="rules-daily-limit"
          label="Daily application limit"
          error={errors.daily_limit}
          hint={`At most this many emails a day (${LIMITS.dailyLimit.min}–${LIMITS.dailyLimit.max}). A new mailbox starts at 5 a day and works up to it over about two weeks.`}
        >
          <input
            id="rules-daily-limit"
            type="number"
            inputMode="numeric"
            min={LIMITS.dailyLimit.min}
            max={LIMITS.dailyLimit.max}
            value={Number.isNaN(draft.daily_limit) ? '' : draft.daily_limit}
            onChange={(e) => patch({ daily_limit: e.target.value === '' ? Number.NaN : Number(e.target.value) })}
            aria-invalid={!!errors.daily_limit || undefined}
            aria-describedby={errors.daily_limit ? 'rules-daily-limit-error' : 'rules-daily-limit-hint'}
            className={ui.input}
          />
        </Field>
      </div>

      <div className="space-y-4 rounded-xl border border-border p-4">
        <div>
          <p className="text-sm font-medium text-foreground">Sending</p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Every application is an email. Prepared emails wait, then go out one at a time, several minutes apart, during
            these hours — the way you'd send them yourself, which keeps them out of spam folders.
          </p>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            id="rules-send-delay"
            label="Wait before sending"
            error={errors.send_delay_minutes}
            hint="Your window to read or cancel an application after it's prepared."
          >
            <select
              id="rules-send-delay"
              value={presetDelay ? String(draft.send_delay_minutes) : 'custom'}
              onChange={(e) => {
                if (e.target.value !== 'custom') patch({ send_delay_minutes: Number(e.target.value) })
              }}
              aria-describedby={errors.send_delay_minutes ? 'rules-send-delay-error' : 'rules-send-delay-hint'}
              className={ui.select}
            >
              {SEND_DELAYS.map((d) => (
                <option key={d.minutes} value={d.minutes}>
                  At least {d.label}
                </option>
              ))}
              {!presetDelay && <option value="custom">At least {draft.send_delay_minutes} minutes</option>}
            </select>
          </Field>
          <Field id="rules-timezone" label="Timezone" hint="Sending hours are in this timezone — pick where most companies you apply to are.">
            <select
              id="rules-timezone"
              value={draft.send_timezone || 'UTC'}
              onChange={(e) => patch({ send_timezone: e.target.value === 'UTC' ? '' : e.target.value })}
              aria-describedby="rules-timezone-hint"
              className={ui.select}
            >
              {zones.map((z) => (
                <option key={z} value={z}>
                  {z.replace(/_/g, ' ')}
                </option>
              ))}
            </select>
          </Field>
          <Field id="rules-window-start" label="Send from">
            <select
              id="rules-window-start"
              value={draft.send_window_start}
              onChange={(e) => patch({ send_window_start: Number(e.target.value) })}
              className={ui.select}
            >
              {START_HOURS.map((h) => (
                <option key={h} value={h}>
                  {hourLabel(h)}
                </option>
              ))}
            </select>
          </Field>
          <Field id="rules-window-end" label="Until" error={errors.send_window_end}>
            <select
              id="rules-window-end"
              value={draft.send_window_end}
              onChange={(e) => patch({ send_window_end: Number(e.target.value) })}
              aria-invalid={!!errors.send_window_end || undefined}
              aria-describedby={errors.send_window_end ? 'rules-window-end-error' : undefined}
              className={ui.select}
            >
              {END_HOURS.map((h) => (
                <option key={h} value={h}>
                  {hourLabel(h)}
                </option>
              ))}
            </select>
          </Field>
        </div>
        <ToggleRow
          title="Weekdays only"
          description="Hold applications prepared on a weekend until Monday morning."
          control={
            <Switch
              checked={draft.send_weekdays_only}
              onCheckedChange={(send_weekdays_only) => patch({ send_weekdays_only })}
              aria-label="Send on weekdays only"
            />
          }
        />
      </div>

      <div className="divide-y divide-border rounded-xl border border-border">
        <ToggleRow
          className="p-4"
          title="Write a tailored email"
          description="A short email for each application, written from your resume and the posting. Off: a brief standard note with your resume attached."
          control={
            <Switch checked={draft.cover_letters} onCheckedChange={(cover_letters) => patch({ cover_letters })} aria-label="Write a tailored email" />
          }
        />
        <ToggleRow
          className="p-4"
          title="Cold-email when a posting can't be read"
          description="If a posting has closed or can't be found, the agent emails an address the company publishes (careers@, jobs@) with your resume instead of giving up. At most one email per address every two weeks."
          control={
            <Switch
              checked={draft.cold_email_fallback}
              onCheckedChange={(cold_email_fallback) => patch({ cold_email_fallback })}
              aria-label="Cold-email when a posting can't be read"
            />
          }
        />
        <ToggleRow
          className="p-4"
          title="Digest emails"
          description="A summary to your account email after each run."
          control={
            <Switch checked={draft.digest_emails} onCheckedChange={(digest_emails) => patch({ digest_emails })} aria-label="Digest emails" />
          }
        />
        <ToggleRow
          className="p-4"
          title="Important-mail alerts"
          description="Forward interviews, assessments and offers to your account email right away."
          control={
            <Switch checked={draft.important_alerts} onCheckedChange={(important_alerts) => patch({ important_alerts })} aria-label="Important-mail alerts" />
          }
        />
      </div>

      <div className="rounded-xl border border-border p-4">
        <ToggleRow
          title="Auto-approve strong matches"
          description="Off by default. When on, jobs scoring at or above the threshold are approved without review and prepared in the same run."
          control={
            <Switch
              checked={autoApprove}
              onCheckedChange={(on) => patch({ auto_approve_score: on ? DEFAULT_AUTO_APPROVE : null })}
              aria-label="Auto-approve strong matches"
            />
          }
        />
        {autoApprove && (
          <div className="mt-4 space-y-3">
            <Field
              id="rules-auto-approve"
              label={`Approve automatically at ${Number.isNaN(draft.auto_approve_score) ? '—' : draft.auto_approve_score} or higher`}
              error={errors.auto_approve_score}
            >
              <input
                id="rules-auto-approve"
                type="range"
                min={LIMITS.autoApprove.min}
                max={LIMITS.autoApprove.max}
                step={1}
                value={draft.auto_approve_score ?? DEFAULT_AUTO_APPROVE}
                onChange={(e) => patch({ auto_approve_score: Number(e.target.value) })}
                className="w-full accent-brand"
              />
            </Field>
            <p className="flex items-start gap-2 rounded-lg border border-warning/30 bg-warning/[0.08] px-3 py-2 text-xs text-foreground">
              <AlertTriangle className="mt-px size-3.5 shrink-0 text-warning" aria-hidden />
              Applications are emailed without you seeing them first (still within your daily limit and sending window).
              You can cancel any that haven't gone out from Applications.
            </p>
          </div>
        )}
      </div>
    </SettingsSection>
  )
}
