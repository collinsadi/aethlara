import { FileText } from 'lucide-react'
import { CopyButton } from '@/components/CopyButton'
import { EmptyState } from '@/components/EmptyState'
import { ErrorState } from '@/components/ErrorState'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Skeleton } from '@/components/ui/skeleton'
import { useApplication } from '@/hooks/useAgentApplications'
import type { AgentApplication } from '@/lib/agentTypes'

interface Props {
  application: AgentApplication | null
  onOpenChange: (open: boolean) => void
}

/** Shows the cover letter the agent wrote (GET /agent/applications/:id). */
export function CoverLetterDialog({ application, onOpenChange }: Props) {
  const { data, isLoading, isError, error, refetch, isRefetching } = useApplication(application?.id ?? null)
  const letter = data?.cover_letter?.trim() ?? ''

  return (
    <Dialog open={!!application} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <div className="flex items-start justify-between gap-3 pr-8">
            <div>
              <DialogTitle className="text-base font-semibold">Cover letter</DialogTitle>
              {application && (
                <DialogDescription>
                  {application.lead.title} at {application.lead.company}
                </DialogDescription>
              )}
            </div>
            {letter && <CopyButton value={letter} label="Copy cover letter">Copy</CopyButton>}
          </div>
        </DialogHeader>
        {isLoading ? (
          <div className="space-y-2" aria-busy="true">
            {[100, 96, 88, 100, 72, 94, 60].map((w, i) => (
              <Skeleton key={i} className="h-3.5" style={{ width: `${w}%` }} />
            ))}
          </div>
        ) : isError ? (
          <ErrorState compact error={error} title="Couldn't load the cover letter" onRetry={() => refetch()} retrying={isRefetching} />
        ) : letter ? (
          <div className="whitespace-pre-wrap break-words rounded-xl border border-border bg-muted/20 p-4 text-sm leading-relaxed text-foreground">
            {letter}
          </div>
        ) : (
          <EmptyState
            compact
            icon={FileText}
            title="No cover letter"
            description="Cover letters are written when the application is prepared (if they're turned on in your apply rules)."
          />
        )}
      </DialogContent>
    </Dialog>
  )
}
