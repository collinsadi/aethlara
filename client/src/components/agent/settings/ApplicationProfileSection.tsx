import { useState } from 'react'
import { Field } from '@/components/agent/settings/Field'
import { SettingsSection } from '@/components/agent/settings/SettingsSection'
import { useUpdateAgentProfile } from '@/hooks/useAgent'
import { useDraft } from '@/hooks/useDraft'
import type { AgentProfile, ApplicationProfile } from '@/lib/agentTypes'
import { EEO_OPTIONS, LIMITS, validateApplicationProfile } from '@/lib/agentSettings'
import { friendlyErrorMessage } from '@/lib/apiError'
import { ui } from '@/lib/styles'
import { toast } from '@/lib/toast'

type TextKey = {
  [K in keyof ApplicationProfile]: ApplicationProfile[K] extends string ? K : never
}[keyof ApplicationProfile]

const CONTACT_FIELDS: { key: TextKey; label: string; type?: string; placeholder?: string; autoComplete?: string }[] = [
  { key: 'full_name', label: 'Full name', autoComplete: 'name' },
  { key: 'phone', label: 'Phone', type: 'tel', autoComplete: 'tel', placeholder: '+1 555 0100' },
  { key: 'location', label: 'City / location', autoComplete: 'address-level2', placeholder: 'Lagos, Nigeria' },
  { key: 'country', label: 'Country', autoComplete: 'country-name' },
  { key: 'linkedin', label: 'LinkedIn', type: 'url', placeholder: 'https://linkedin.com/in/…' },
  { key: 'github', label: 'GitHub', type: 'url', placeholder: 'https://github.com/…' },
  { key: 'portfolio', label: 'Portfolio', type: 'url', placeholder: 'https://…' },
  { key: 'website', label: 'Website', type: 'url', placeholder: 'https://…' },
]

const DETAIL_FIELDS: { key: TextKey; label: string; placeholder?: string; hint?: string }[] = [
  { key: 'notice_period', label: 'Notice period', placeholder: '2 weeks' },
  { key: 'earliest_start_date', label: 'Earliest start date', placeholder: 'Immediately, or 2027-01-15' },
  { key: 'salary_expectation', label: 'Salary expectation', placeholder: 'USD 90,000', hint: 'Used when a form asks for a number.' },
  { key: 'pronouns', label: 'Pronouns', placeholder: 'Optional' },
  { key: 'how_did_you_hear', label: 'How did you hear about us?', placeholder: 'Company website' },
]

function boolToSelect(v: boolean | null): string {
  return v === null ? '' : v ? 'yes' : 'no'
}
function selectToBool(v: string): boolean | null {
  return v === '' ? null : v === 'yes'
}

export function ApplicationProfileSection({ profile }: { profile: AgentProfile }) {
  const { draft, setDraft, patch, dirty, reset } = useDraft(profile.application_profile)
  const update = useUpdateAgentProfile()
  const [saved, setSaved] = useState(false)
  const errors = validateApplicationProfile(draft)
  const invalid = Object.keys(errors).length > 0

  const save = () =>
    update.mutate(
      { application_profile: draft },
      {
        onSuccess: (p) => {
          setDraft(p.application_profile)
          setSaved(true)
          toast.success('Application profile saved', { description: 'The agent uses it to fill every form.' })
        },
      }
    )

  const textInput = (key: TextKey, opts: { type?: string; placeholder?: string; autoComplete?: string; hint?: string; label: string }) => {
    const id = `profile-${key}`
    const error = errors[key]
    return (
      <Field key={key} id={id} label={opts.label} error={error} hint={opts.hint}>
        <input
          id={id}
          type={opts.type ?? 'text'}
          value={draft[key]}
          onChange={(e) => patch({ [key]: e.target.value } as Partial<ApplicationProfile>)}
          placeholder={opts.placeholder}
          autoComplete={opts.autoComplete ?? 'off'}
          maxLength={LIMITS.profileText}
          aria-invalid={!!error || undefined}
          aria-describedby={error ? `${id}-error` : opts.hint ? `${id}-hint` : undefined}
          className={ui.input}
        />
      </Field>
    )
  }

  return (
    <SettingsSection
      id="profile"
      title="Application profile"
      description="The answers application forms ask for. The extension fills them in; anything missing, the agent asks you once and remembers."
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
      <fieldset>
        <legend className="mb-3 text-sm font-semibold text-foreground">Contact &amp; links</legend>
        <p className="-mt-2 mb-3 text-xs text-muted-foreground">
          Forms get your agent mailbox as the email address, so replies come back to the agent.
        </p>
        <div className="grid gap-4 sm:grid-cols-2">{CONTACT_FIELDS.map((f) => textInput(f.key, f))}</div>
      </fieldset>

      <div className="border-t border-border pt-5">
      <fieldset>
        <legend className="mb-3 text-sm font-semibold text-foreground">Work eligibility</legend>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            id="profile-work-authorization"
            label="Work authorization"
            error={errors.work_authorization}
            hint="Say it the way you'd write it on a form."
            className="sm:col-span-2"
          >
            <textarea
              id="profile-work-authorization"
              rows={2}
              maxLength={LIMITS.workAuthorization}
              value={draft.work_authorization}
              onChange={(e) => patch({ work_authorization: e.target.value })}
              placeholder="e.g. Nigerian citizen; needs sponsorship to work in the US"
              aria-describedby={errors.work_authorization ? 'profile-work-authorization-error' : 'profile-work-authorization-hint'}
              className={ui.textarea}
            />
          </Field>
          <Field id="profile-sponsorship" label="Requires visa sponsorship?">
            <select
              id="profile-sponsorship"
              value={boolToSelect(draft.requires_sponsorship)}
              onChange={(e) => patch({ requires_sponsorship: selectToBool(e.target.value) })}
              className={ui.select}
            >
              <option value="">Not set</option>
              <option value="yes">Yes</option>
              <option value="no">No</option>
            </select>
          </Field>
          <Field id="profile-relocate" label="Willing to relocate?">
            <select
              id="profile-relocate"
              value={boolToSelect(draft.willing_to_relocate)}
              onChange={(e) => patch({ willing_to_relocate: selectToBool(e.target.value) })}
              className={ui.select}
            >
              <option value="">Not set</option>
              <option value="yes">Yes</option>
              <option value="no">No</option>
            </select>
          </Field>
        </div>
      </fieldset>
      </div>

      <div className="border-t border-border pt-5">
      <fieldset>
        <legend className="mb-3 text-sm font-semibold text-foreground">Availability &amp; background</legend>
        <div className="grid gap-4 sm:grid-cols-2">
          {DETAIL_FIELDS.map((f) => textInput(f.key, f))}
          <Field id="profile-years" label="Years of experience" error={errors.years_of_experience}>
            <input
              id="profile-years"
              type="number"
              inputMode="numeric"
              min={LIMITS.yearsOfExperience.min}
              max={LIMITS.yearsOfExperience.max}
              value={draft.years_of_experience === null || Number.isNaN(draft.years_of_experience) ? '' : draft.years_of_experience}
              onChange={(e) =>
                patch({ years_of_experience: e.target.value === '' ? null : Number(e.target.value) })
              }
              aria-invalid={!!errors.years_of_experience || undefined}
              aria-describedby={errors.years_of_experience ? 'profile-years-error' : undefined}
              className={ui.input}
            />
          </Field>
          <Field
            id="profile-additional"
            label="Anything else the agent should know"
            error={errors.additional_info}
            hint="Used for open-ended questions. Plain facts work best."
            className="sm:col-span-2"
          >
            <textarea
              id="profile-additional"
              rows={4}
              maxLength={LIMITS.additionalInfo}
              value={draft.additional_info}
              onChange={(e) => patch({ additional_info: e.target.value })}
              aria-describedby={errors.additional_info ? 'profile-additional-error' : 'profile-additional-hint'}
              className={ui.textarea}
            />
          </Field>
        </div>
      </fieldset>
      </div>

      <div className="border-t border-border pt-5">
      <fieldset>
        <legend className="text-sm font-semibold text-foreground">Voluntary self-identification</legend>
        <p className="mb-3 mt-0.5 text-xs text-muted-foreground">
          Optional. US forms often ask these; the agent answers "Decline to self-identify" unless you choose otherwise.
        </p>
        <div className="grid gap-4 sm:grid-cols-2">
          {(Object.keys(EEO_OPTIONS) as (keyof typeof EEO_OPTIONS)[]).map((key) => {
            const meta = EEO_OPTIONS[key]
            const current = draft.eeo[key]
            const options = current && !meta.options.includes(current) ? [current, ...meta.options] : meta.options
            return (
              <Field key={key} id={`eeo-${key}`} label={meta.label}>
                <select
                  id={`eeo-${key}`}
                  value={current}
                  onChange={(e) => patch({ eeo: { ...draft.eeo, [key]: e.target.value } })}
                  className={ui.select}
                >
                  <option value="">Decline to self-identify</option>
                  {options.map((o) => (
                    <option key={o} value={o}>
                      {o}
                    </option>
                  ))}
                </select>
              </Field>
            )
          })}
        </div>
      </fieldset>
      </div>
    </SettingsSection>
  )
}
