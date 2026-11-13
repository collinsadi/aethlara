import { useState } from 'react'
import { Loader2 } from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { useSetApplicationRecipient } from '@/hooks/useAgentApplications'
import type { AgentApplication } from '@/lib/agentTypes'
import { friendlyErrorMessage } from '@/lib/apiError'
import { ui } from '@/lib/styles'
import { toast } from '@/lib/toast'

interface Props {
  application: AgentApplication | null
  onOpenChange: (open: boolean) => void
}

const EMAIL_RE = /^[^\s@,;<>"']+@[^\s@,;<>"']+\.[a-z]{2,}$/i

/**
 * Sends an application to an address the user chose: the posting had none,
 * the company publishes none, or the one the agent used bounced.
 */
export function RecipientDialog({ application, onOpenChange }: Props) {
  return (
    <Dialog open={!!application} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        {application && (
          <RecipientForm key={application.id} application={application} onDone={() => onOpenChange(false)} />
        )}
      </DialogContent>
    </Dialog>
  )
}

function RecipientForm({ application, onDone }: { application: AgentApplication; onDone: () => void }) {
  const setRecipient = useSetApplicationRecipient()
  const [value, setValue] = useState('')
  const [touched, setTouched] = useState(false)
  const email = value.trim()
  const invalid = !EMAIL_RE.test(email)
  const serverError = setRecipient.isError ? friendlyErrorMessage(setRecipient.error) : null
  const error = touched && invalid ? 'Enter one email address, like jobs@company.com.' : serverError
  const bounced = application.delivery_status === 'bounced' || application.delivery_status === 'suppressed'

  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    setTouched(true)
    if (invalid) return
    setRecipient.mutate(
      { id: application.id, email },
      {
        onSuccess: () => {
          toast.success('Address saved', {
            description: `The next run prepares the email to ${email.toLowerCase()} and schedules it. Run the agent now to speed it up.`,
          })
          onDone()
        },
      }
    )
  }

  return (
    <form onSubmit={submit} className="grid gap-5" noValidate>
      <DialogHeader>
        <DialogTitle className="text-base font-semibold">Where should it go?</DialogTitle>
        <DialogDescription>
          {application.lead.title} at {application.lead.company}.{' '}
          {bounced && application.apply_email
            ? `The email to ${application.apply_email} didn't arrive. `
            : "The agent couldn't find an address to send it to. "}
          Add the recruiter's or the company's hiring address — it's checked before anything is sent.
        </DialogDescription>
      </DialogHeader>
      <div>
        <label htmlFor={`recipient-${application.id}`} className={ui.label}>
          Email address
        </label>
        <input
          id={`recipient-${application.id}`}
          type="email"
          inputMode="email"
          autoComplete="off"
          autoFocus
          maxLength={254}
          value={value}
          onChange={(e) => {
            setValue(e.target.value)
            if (setRecipient.isError) setRecipient.reset()
          }}
          onBlur={() => setTouched(true)}
          placeholder="jobs@company.com"
          aria-invalid={!!error || undefined}
          aria-describedby={error ? `recipient-${application.id}-error` : undefined}
          className={ui.input}
        />
        {error && (
          <p id={`recipient-${application.id}-error`} className={ui.fieldError}>
            {error}
          </p>
        )}
      </div>
      <DialogFooter>
        <button type="button" onClick={onDone} className={ui.outline}>
          Cancel
        </button>
        <button type="submit" disabled={setRecipient.isPending} className={ui.primarySm}>
          {setRecipient.isPending && <Loader2 className="size-3.5 animate-spin" aria-hidden />}
          Send it here
        </button>
      </DialogFooter>
    </form>
  )
}
