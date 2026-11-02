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
import { useAnswerApplication } from '@/hooks/useAgentApplications'
import type { AgentApplication, NeedsQuestion } from '@/lib/agentTypes'
import { friendlyErrorMessage } from '@/lib/apiError'
import { ui } from '@/lib/styles'
import { toast } from '@/lib/toast'
import { cn } from '@/lib/utils'

interface Props {
  application: AgentApplication | null
  onOpenChange: (open: boolean) => void
}

const MAX_ANSWER = 4000

type Kind = 'multi' | 'radio' | 'select' | 'textarea' | 'text'

function kindOf(q: NeedsQuestion): Kind {
  const type = (q.type ?? '').toLowerCase()
  const options = q.options ?? []
  if (options.length > 0) {
    if (type.includes('checkbox') || type.includes('multi')) return 'multi'
    return options.length <= 4 ? 'radio' : 'select'
  }
  if (type === 'textarea' || q.label.length > 90) return 'textarea'
  return 'text'
}

/** Renders `needs.questions` and posts the answers (saved for every future form). */
export function AnswerQuestionsDialog({ application, onOpenChange }: Props) {
  return (
    <Dialog open={!!application} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-lg">
        {application && <AnswerForm key={application.id} application={application} onDone={() => onOpenChange(false)} />}
      </DialogContent>
    </Dialog>
  )
}

function AnswerForm({ application, onDone }: { application: AgentApplication; onDone: () => void }) {
  const questions = application.needs?.questions ?? []
  const answer = useAnswerApplication()
  const [values, setValues] = useState<Record<string, string | string[]>>({})
  const [showErrors, setShowErrors] = useState(false)

  const valueOf = (q: NeedsQuestion) => values[q.field_id] ?? (kindOf(q) === 'multi' ? [] : '')
  const isAnswered = (q: NeedsQuestion) => {
    const v = valueOf(q)
    return Array.isArray(v) ? v.length > 0 : v.trim().length > 0
  }
  const set = (q: NeedsQuestion, v: string | string[]) => setValues((prev) => ({ ...prev, [q.field_id]: v }))

  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!questions.every(isAnswered)) {
      setShowErrors(true)
      return
    }
    const answers = questions.map((q) => {
      const v = valueOf(q)
      return { question: q.label, answer: (Array.isArray(v) ? v.join(' | ') : v.trim()).slice(0, MAX_ANSWER) }
    })
    answer.mutate(
      { id: application.id, answers },
      {
        onSuccess: () => {
          toast.success('Answers saved', {
            description: 'The agent reuses them on future forms and hands this application back to the extension.',
          })
          onDone()
        },
      }
    )
  }

  return (
    <form onSubmit={submit} className="grid gap-5" noValidate>
      <DialogHeader>
        <DialogTitle className="text-base font-semibold">Answer for the agent</DialogTitle>
        <DialogDescription>
          {application.lead.title} at {application.lead.company}.{' '}
          {application.needs?.message || 'The form asked questions only you can answer.'} Your answers are saved and
          reused on every future form.
        </DialogDescription>
      </DialogHeader>

      {questions.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          The extension didn't send the questions. Open the form to see what it needs, then click Retry.
        </p>
      ) : (
        questions.map((q, i) => {
          const id = `answer-${application.id}-${i}`
          const kind = kindOf(q)
          const invalid = showErrors && !isAnswered(q)
          const errorId = `${id}-error`
          const v = valueOf(q)
          return (
            <div key={q.field_id || i}>
              {kind === 'radio' || kind === 'multi' ? (
                <fieldset aria-describedby={invalid ? errorId : undefined}>
                  <legend className="mb-2 text-sm font-medium text-foreground">{q.label}</legend>
                  <div className="space-y-1.5">
                    {(q.options ?? []).map((option) => {
                      const checked = kind === 'multi' ? (v as string[]).includes(option) : v === option
                      return (
                        <label
                          key={option}
                          className={cn(
                            'flex cursor-pointer items-center gap-2.5 rounded-lg border px-3 py-2 text-sm transition-colors',
                            checked ? 'border-brand/40 bg-brand/[0.05]' : 'border-border hover:bg-muted/40'
                          )}
                        >
                          <input
                            type={kind === 'multi' ? 'checkbox' : 'radio'}
                            name={id}
                            value={option}
                            checked={checked}
                            onChange={(e) => {
                              if (kind === 'multi') {
                                const current = v as string[]
                                set(q, e.target.checked ? [...current, option] : current.filter((o) => o !== option))
                              } else {
                                set(q, option)
                              }
                            }}
                            className="size-4 accent-brand"
                          />
                          <span className="text-foreground">{option}</span>
                        </label>
                      )
                    })}
                  </div>
                </fieldset>
              ) : (
                <>
                  <label htmlFor={id} className="mb-1.5 block text-sm font-medium text-foreground">
                    {q.label}
                  </label>
                  {kind === 'select' ? (
                    <select
                      id={id}
                      value={v as string}
                      onChange={(e) => set(q, e.target.value)}
                      aria-invalid={invalid || undefined}
                      aria-describedby={invalid ? errorId : undefined}
                      className={ui.select}
                    >
                      <option value="">Choose…</option>
                      {(q.options ?? []).map((o) => (
                        <option key={o} value={o}>
                          {o}
                        </option>
                      ))}
                    </select>
                  ) : kind === 'textarea' ? (
                    <textarea
                      id={id}
                      rows={4}
                      maxLength={MAX_ANSWER}
                      value={v as string}
                      onChange={(e) => set(q, e.target.value)}
                      aria-invalid={invalid || undefined}
                      aria-describedby={invalid ? errorId : undefined}
                      className={ui.textarea}
                    />
                  ) : (
                    <input
                      id={id}
                      type="text"
                      maxLength={MAX_ANSWER}
                      value={v as string}
                      onChange={(e) => set(q, e.target.value)}
                      aria-invalid={invalid || undefined}
                      aria-describedby={invalid ? errorId : undefined}
                      className={ui.input}
                    />
                  )}
                </>
              )}
              {invalid && (
                <p id={errorId} className={ui.fieldError}>
                  Answer this so the agent can finish the form.
                </p>
              )}
            </div>
          )
        })
      )}

      {answer.isError && (
        <p role="alert" className="rounded-xl border border-destructive/25 bg-destructive/[0.07] px-3.5 py-3 text-sm text-destructive">
          {friendlyErrorMessage(answer.error)}
        </p>
      )}

      <DialogFooter>
        <button type="button" onClick={onDone} disabled={answer.isPending} className={ui.ghost}>
          Cancel
        </button>
        <button type="submit" disabled={answer.isPending || questions.length === 0} className={ui.primarySm}>
          {answer.isPending && <Loader2 className="size-3.5 animate-spin" aria-hidden />}
          {answer.isPending ? 'Saving…' : 'Save answers'}
        </button>
      </DialogFooter>
    </form>
  )
}
