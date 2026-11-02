import { useState } from 'react'
import { Link } from 'react-router-dom'
import { FileText } from 'lucide-react'
import { SettingsSection } from '@/components/agent/settings/SettingsSection'
import { ErrorState } from '@/components/ErrorState'
import { Skeleton } from '@/components/ui/skeleton'
import { useUpdateAgentProfile } from '@/hooks/useAgent'
import { useResumes } from '@/hooks/useResumes'
import type { AgentProfile } from '@/lib/agentTypes'
import { formatDate } from '@/lib/agentFormat'
import { friendlyErrorMessage } from '@/lib/apiError'
import { ui } from '@/lib/styles'
import { toast } from '@/lib/toast'
import { cn } from '@/lib/utils'

export function ResumeSection({ profile }: { profile: AgentProfile }) {
  const resumes = useResumes()
  const update = useUpdateAgentProfile()
  const [pendingId, setPendingId] = useState<string | null>(null)

  const choose = (id: string) => {
    if (id === profile.resume_id) return
    setPendingId(id)
    update.mutate(
      { resume_id: id },
      {
        onSuccess: () => toast.success('Resume updated', { description: 'New postings are scored against it from the next run.' }),
        onSettled: () => setPendingId(null),
      }
    )
  }

  return (
    <SettingsSection
      id="resume"
      title="Resume to use"
      description="Every posting is scored against this resume, and it's tailored for each application."
    >
      {resumes.isLoading ? (
        <div className="space-y-2" aria-busy="true">
          <Skeleton className="h-14 w-full rounded-xl" />
          <Skeleton className="h-14 w-full rounded-xl" />
        </div>
      ) : resumes.isError ? (
        <ErrorState compact error={resumes.error} title="Couldn't load your resumes" onRetry={() => resumes.refetch()} />
      ) : (resumes.data ?? []).length === 0 ? (
        <div className="flex flex-col items-start gap-3 rounded-xl border border-dashed border-border p-4 text-sm text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
          <span>Upload a resume first — the agent can't score or apply without one.</span>
          <Link to="/resumes" className={ui.primarySm}>
            Upload resume
          </Link>
        </div>
      ) : (
        <div role="radiogroup" aria-label="Resume" className="space-y-2">
          {(resumes.data ?? []).map((r) => {
            const selected = r.id === profile.resume_id
            const ready = r.extraction_status === 'completed'
            return (
              <label
                key={r.id}
                className={cn(
                  'flex cursor-pointer items-center gap-3 rounded-xl border px-4 py-3 transition-colors',
                  selected ? 'border-brand/40 bg-brand/[0.05]' : 'border-border hover:bg-muted/40',
                  !ready && 'cursor-not-allowed opacity-60'
                )}
              >
                <input
                  type="radio"
                  name="agent-resume"
                  value={r.id}
                  checked={selected}
                  disabled={!ready || update.isPending}
                  onChange={() => choose(r.id)}
                  className="size-4 accent-brand"
                />
                <FileText className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium text-foreground">{r.name}</span>
                  <span className="block text-xs text-muted-foreground">
                    {r.file_format.toUpperCase()} · uploaded {formatDate(r.uploaded_at)}
                    {!ready && (r.extraction_status === 'failed' ? ' · processing failed' : ' · still processing')}
                  </span>
                </span>
                {pendingId === r.id && <span className="text-xs text-muted-foreground">Saving…</span>}
                {selected && pendingId === null && <span className="text-xs font-medium text-brand">In use</span>}
              </label>
            )
          })}
        </div>
      )}
      {update.isError && (
        <p role="alert" className={ui.fieldError}>
          {friendlyErrorMessage(update.error)}
        </p>
      )}
      <p className="text-xs text-muted-foreground">
        Manage files on the{' '}
        <Link to="/resumes" className={ui.link}>
          Resumes
        </Link>{' '}
        page.
      </p>
    </SettingsSection>
  )
}
