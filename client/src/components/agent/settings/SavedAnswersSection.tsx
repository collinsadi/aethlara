import { useState } from 'react'
import { Loader2, MessageSquareText, Pencil, Plus, Trash2 } from 'lucide-react'
import { SettingsSection } from '@/components/agent/settings/SettingsSection'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import { EmptyState } from '@/components/EmptyState'
import { ErrorState } from '@/components/ErrorState'
import { Skeleton } from '@/components/ui/skeleton'
import { useNow } from '@/hooks/useNow'
import { useDeleteSavedAnswer, useSavedAnswers, useUpsertSavedAnswer } from '@/hooks/useSavedAnswers'
import type { SavedAnswer } from '@/lib/agentTypes'
import { formatRelative } from '@/lib/agentFormat'
import { LIMITS } from '@/lib/agentSettings'
import { friendlyErrorMessage } from '@/lib/apiError'
import { ui } from '@/lib/styles'
import { toast } from '@/lib/toast'

/** Saved form answers: the agent reuses them on every application. */
export function SavedAnswersSection() {
  const now = useNow()
  const answers = useSavedAnswers()
  const remove = useDeleteSavedAnswer()
  const [adding, setAdding] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [deleting, setDeleting] = useState<SavedAnswer | null>(null)
  const list = answers.data ?? []

  return (
    <SettingsSection
      id="answers"
      title="Saved answers"
      description="Answers to form questions the agent couldn't fill from your profile. Questions match even when forms word them a little differently."
    >
      <div className="flex justify-end">
        {!adding && (
          <button type="button" onClick={() => setAdding(true)} className={ui.outline}>
            <Plus className="size-3.5" aria-hidden />
            Add an answer
          </button>
        )}
      </div>

      {adding && (
        <AnswerForm
          onCancel={() => setAdding(false)}
          onSaved={() => setAdding(false)}
        />
      )}

      {answers.isLoading ? (
        <div className="space-y-2" aria-busy="true">
          <Skeleton className="h-16 w-full rounded-xl" />
          <Skeleton className="h-16 w-full rounded-xl" />
        </div>
      ) : answers.isError ? (
        <ErrorState compact error={answers.error} title="Couldn't load saved answers" onRetry={() => answers.refetch()} />
      ) : list.length === 0 && !adding ? (
        <div className="rounded-xl border border-dashed border-border">
          <EmptyState
            compact
            icon={MessageSquareText}
            title="No saved answers yet"
            description="When a form asks something only you can answer, the agent asks you once in Applications and saves it here."
          />
        </div>
      ) : (
        <ul className="divide-y divide-border rounded-xl border border-border">
          {list.map((a) =>
            editingId === a.id ? (
              <li key={a.id} className="p-4">
                <AnswerForm existing={a} onCancel={() => setEditingId(null)} onSaved={() => setEditingId(null)} />
              </li>
            ) : (
              <li key={a.id} className="flex flex-col gap-2 p-4 sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-foreground">{a.question}</p>
                  <p className="mt-0.5 whitespace-pre-wrap break-words text-sm text-foreground/80">{a.answer}</p>
                  <p className="mt-1 text-[11px] text-muted-foreground">
                    {a.source === 'user' ? 'Answered by you' : 'Learned by the agent'} · updated {formatRelative(a.updated_at, now)}
                  </p>
                </div>
                <div className="flex shrink-0 gap-1">
                  <button type="button" onClick={() => setEditingId(a.id)} className={ui.ghost} aria-label={`Edit answer to: ${a.question}`}>
                    <Pencil className="size-3.5" aria-hidden />
                    Edit
                  </button>
                  <button
                    type="button"
                    onClick={() => setDeleting(a)}
                    className={`${ui.ghost} hover:text-destructive`}
                    aria-label={`Delete answer to: ${a.question}`}
                  >
                    <Trash2 className="size-3.5" aria-hidden />
                    Delete
                  </button>
                </div>
              </li>
            )
          )}
        </ul>
      )}

      <ConfirmDialog
        open={!!deleting}
        onOpenChange={(open) => !open && setDeleting(null)}
        title="Delete this answer?"
        description={deleting ? `"${deleting.question}" — the agent will ask you again the next time a form needs it.` : undefined}
        confirmLabel="Delete"
        pendingLabel="Deleting…"
        destructive
        pending={remove.isPending}
        onConfirm={() => {
          if (!deleting) return
          remove.mutate(deleting.id, {
            onSuccess: () => toast.success('Answer deleted'),
            onError: (err) => toast.error("Couldn't delete the answer", { description: friendlyErrorMessage(err) }),
            onSettled: () => setDeleting(null),
          })
        }}
      />
    </SettingsSection>
  )
}

function AnswerForm({
  existing,
  onCancel,
  onSaved,
}: {
  existing?: SavedAnswer
  onCancel: () => void
  onSaved: () => void
}) {
  const upsert = useUpsertSavedAnswer()
  const [question, setQuestion] = useState(existing?.question ?? '')
  const [answer, setAnswer] = useState(existing?.answer ?? '')
  const idBase = existing ? `answer-${existing.id}` : 'answer-new'
  const valid = question.trim().length > 0 && answer.trim().length > 0

  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!valid) return
    upsert.mutate(
      { question: question.trim(), answer: answer.trim() },
      {
        onSuccess: () => {
          toast.success(existing ? 'Answer updated' : 'Answer saved')
          onSaved()
        },
      }
    )
  }

  return (
    <form onSubmit={submit} className="space-y-3 rounded-xl border border-border bg-muted/20 p-4">
      <div>
        <label htmlFor={`${idBase}-q`} className={ui.label}>
          Question
        </label>
        <input
          id={`${idBase}-q`}
          type="text"
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          readOnly={!!existing}
          maxLength={LIMITS.answerQuestion}
          placeholder="e.g. Do you hold an active security clearance?"
          aria-describedby={existing ? `${idBase}-q-hint` : undefined}
          className={`${ui.input} read-only:bg-muted/40 read-only:text-muted-foreground`}
          autoFocus={!existing}
        />
        {existing && (
          <p id={`${idBase}-q-hint`} className={ui.hint}>
            To change the question, delete this answer and add a new one.
          </p>
        )}
      </div>
      <div>
        <label htmlFor={`${idBase}-a`} className={ui.label}>
          Answer
        </label>
        <textarea
          id={`${idBase}-a`}
          rows={3}
          value={answer}
          onChange={(e) => setAnswer(e.target.value)}
          maxLength={LIMITS.answer}
          className={ui.textarea}
          autoFocus={!!existing}
        />
      </div>
      {upsert.isError && (
        <p role="alert" className={ui.fieldError}>
          {friendlyErrorMessage(upsert.error)}
        </p>
      )}
      <div className="flex justify-end gap-2">
        <button type="button" onClick={onCancel} disabled={upsert.isPending} className={ui.ghost}>
          Cancel
        </button>
        <button type="submit" disabled={!valid || upsert.isPending} className={ui.primarySm}>
          {upsert.isPending && <Loader2 className="size-3.5 animate-spin" aria-hidden />}
          {existing ? 'Save answer' : 'Add answer'}
        </button>
      </div>
    </form>
  )
}
