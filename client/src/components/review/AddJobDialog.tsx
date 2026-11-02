import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Link2, Loader2 } from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { useAddLead } from '@/hooks/useLeads'
import type { Lead } from '@/lib/agentTypes'
import { errorAction, friendlyErrorMessage } from '@/lib/apiError'
import { ui } from '@/lib/styles'
import { cn } from '@/lib/utils'

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  onAdded: (lead: Lead, approved: boolean) => void
}

function validateUrl(value: string): string | null {
  const trimmed = value.trim()
  if (!trimmed) return 'Paste the link to the job posting.'
  try {
    const url = new URL(trimmed)
    if (url.protocol !== 'https:') return 'Use the https:// link to the posting.'
  } catch {
    return "That doesn't look like a link. Paste the full URL, starting with https://"
  }
  return null
}

/** "Add a job by URL": the server scrapes, extracts and scores the posting. */
export function AddJobDialog({ open, onOpenChange, onAdded }: Props) {
  const addLead = useAddLead()
  const [url, setUrl] = useState('')
  const [approve, setApprove] = useState(false)
  const [fieldError, setFieldError] = useState<string | null>(null)

  const close = (next: boolean) => {
    if (addLead.isPending) return
    if (!next) {
      setUrl('')
      setApprove(false)
      setFieldError(null)
      addLead.reset()
    }
    onOpenChange(next)
  }

  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    const problem = validateUrl(url)
    setFieldError(problem)
    if (problem) return
    addLead.mutate(
      { url: url.trim(), approve },
      {
        onSuccess: ({ lead, application }) => {
          onAdded(lead, !!application)
          close(false)
        },
      }
    )
  }

  const serverError = addLead.error
  const action = serverError ? errorAction(serverError) : null

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="sm:max-w-lg">
        <form onSubmit={submit} className="grid gap-4" noValidate>
          <DialogHeader>
            <DialogTitle className="text-base font-semibold">Add a job by URL</DialogTitle>
            <DialogDescription>
              Found a posting yourself? The agent reads it, scores it against your resume and adds it to your review queue.
            </DialogDescription>
          </DialogHeader>

          <div>
            <label htmlFor="add-job-url" className={ui.label}>
              Job posting URL
            </label>
            <div className="relative">
              <Link2 className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
              <input
                id="add-job-url"
                type="url"
                inputMode="url"
                autoComplete="off"
                autoFocus
                value={url}
                onChange={(e) => {
                  setUrl(e.target.value)
                  if (fieldError) setFieldError(null)
                }}
                placeholder="https://jobs.ashbyhq.com/company/…"
                aria-invalid={!!fieldError || undefined}
                aria-describedby={fieldError ? 'add-job-url-error' : undefined}
                disabled={addLead.isPending}
                className={cn(ui.input, 'pl-9 pr-3', fieldError && 'border-destructive')}
              />
            </div>
            {fieldError && (
              <p id="add-job-url-error" className={ui.fieldError}>
                {fieldError}
              </p>
            )}
          </div>

          <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-border px-3.5 py-3">
            <input
              type="checkbox"
              checked={approve}
              onChange={(e) => setApprove(e.target.checked)}
              disabled={addLead.isPending}
              className="mt-0.5 size-4 accent-brand"
            />
            <span className="text-sm">
              <span className="font-medium text-foreground">Approve it right away</span>
              <span className="block text-xs text-muted-foreground">
                Skip review — the agent applies on its next run.
              </span>
            </span>
          </label>

          {addLead.isPending && (
            <p className="flex items-center gap-2 text-xs text-muted-foreground" aria-live="polite">
              <Loader2 className="size-3.5 animate-spin" aria-hidden />
              Reading the posting and scoring it against your resume — this can take up to a minute.
            </p>
          )}

          {serverError && !addLead.isPending && (
            <div role="alert" className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-destructive/25 bg-destructive/[0.07] px-3.5 py-3 text-sm text-destructive">
              <span>{friendlyErrorMessage(serverError)}</span>
              {action && (
                <Link to={action.path} onClick={() => close(false)} className={ui.primarySm}>
                  {action.label}
                </Link>
              )}
            </div>
          )}

          <DialogFooter>
            <button type="button" onClick={() => close(false)} disabled={addLead.isPending} className={ui.ghost}>
              Cancel
            </button>
            <button type="submit" disabled={addLead.isPending} className={ui.primarySm}>
              {addLead.isPending && <Loader2 className="size-3.5 animate-spin" aria-hidden />}
              {addLead.isPending ? 'Adding…' : approve ? 'Add & approve' : 'Add to review'}
            </button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
