import { ActivityFeed } from '@/components/agent/ActivityFeed'
import { AutopilotControlPanel } from '@/components/agent/AutopilotControlPanel'
import { CountTiles } from '@/components/agent/CountTiles'
import { ExtensionWarning } from '@/components/agent/ExtensionWarning'
import { RunSummaryCard } from '@/components/agent/RunSummaryCard'
import { SetupChecklist } from '@/components/agent/SetupChecklist'
import { ErrorState } from '@/components/ErrorState'
import { Skeleton } from '@/components/ui/skeleton'
import { useAgentOverview } from '@/hooks/useAgent'

/** /agent — the autopilot command center (home after login). */
export function Autopilot() {
  const { data, dataUpdatedAt, isLoading, isError, error, refetch, isRefetching } = useAgentOverview()

  if (isLoading) return <AutopilotSkeleton />

  if (isError || !data) {
    return (
      <div className="glass-card">
        <ErrorState
          error={error}
          title="Couldn't load your autopilot"
          onRetry={() => refetch()}
          retrying={isRefetching}
        />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <AutopilotControlPanel overview={data} />
      <ExtensionWarning overview={data} />
      <SetupChecklist setup={data.setup} profile={data.profile} />
      <CountTiles overview={data} />
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-5">
        <RunSummaryCard overview={data} className="lg:col-span-2 lg:self-start" />
        <ActivityFeed
          className="lg:col-span-3"
          seed={{ events: data.recent_events, updatedAt: dataUpdatedAt }}
        />
      </div>
    </div>
  )
}

function AutopilotSkeleton() {
  return (
    <div className="space-y-6" aria-busy="true" aria-label="Loading autopilot">
      <div className="glass-card flex items-start gap-4 p-6">
        <Skeleton className="size-12 rounded-2xl" />
        <div className="flex-1 space-y-2">
          <Skeleton className="h-6 w-56" />
          <Skeleton className="h-4 w-80 max-w-full" />
          <Skeleton className="h-3 w-64 max-w-full" />
        </div>
        <Skeleton className="hidden h-11 w-32 rounded-full md:block" />
      </div>
      <Skeleton className="h-20 w-full rounded-2xl" />
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
        {Array.from({ length: 5 }).map((_, i) => (
          <Skeleton key={i} className="h-28 rounded-2xl" />
        ))}
      </div>
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-5">
        <Skeleton className="h-80 rounded-2xl lg:col-span-2" />
        <Skeleton className="h-80 rounded-2xl lg:col-span-3" />
      </div>
    </div>
  )
}
