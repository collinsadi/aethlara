import { Link } from 'react-router-dom'
import { ArrowLeft } from 'lucide-react'
import { ApplicationProfileSection } from '@/components/agent/settings/ApplicationProfileSection'
import { ApplyRulesSection } from '@/components/agent/settings/ApplyRulesSection'
import { MailboxSection } from '@/components/agent/settings/MailboxSection'
import { ResumeSection } from '@/components/agent/settings/ResumeSection'
import { SavedAnswersSection } from '@/components/agent/settings/SavedAnswersSection'
import { SearchSection } from '@/components/agent/settings/SearchSection'
import { SourcesSection } from '@/components/agent/settings/SourcesSection'
import { WatchlistSection } from '@/components/agent/settings/WatchlistSection'
import { ErrorState } from '@/components/ErrorState'
import { PageHeader } from '@/components/PageHeader'
import { Skeleton } from '@/components/ui/skeleton'
import { useAgentOverview, useAgentProfile } from '@/hooks/useAgent'
import { useHashScroll } from '@/hooks/useHashScroll'
import { ui } from '@/lib/styles'

const SECTIONS = [
  { id: 'search', label: 'What to look for' },
  { id: 'sources', label: 'Where to search' },
  { id: 'watchlist', label: 'Company watchlist' },
  { id: 'profile', label: 'Application profile' },
  { id: 'rules', label: 'Apply rules' },
  { id: 'mailbox', label: 'Agent mailbox' },
  { id: 'resume', label: 'Resume' },
  { id: 'answers', label: 'Saved answers' },
]

/** /agent/settings — everything the autopilot uses, saved per section. */
export function AgentSettings() {
  const profile = useAgentProfile()
  const overview = useAgentOverview()
  const ready = !!profile.data
  useHashScroll(ready)

  return (
    <div className="space-y-6">
      <div>
        <Link to="/agent" className={`${ui.ghost} -ml-2.5 mb-2`}>
          <ArrowLeft className="size-3.5" aria-hidden />
          Autopilot
        </Link>
        <PageHeader
          title="Autopilot settings"
          description="What the agent looks for, where it searches, and how it applies. Each section saves on its own."
        />
      </div>

      {profile.isLoading && !profile.data ? (
        <div className="space-y-6" aria-busy="true" aria-label="Loading settings">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-72 w-full rounded-2xl" />
          ))}
        </div>
      ) : profile.isError && !profile.data ? (
        <div className="glass-card">
          <ErrorState
            error={profile.error}
            title="Couldn't load your autopilot settings"
            onRetry={() => profile.refetch()}
            retrying={profile.isRefetching}
          />
        </div>
      ) : profile.data ? (
        <div className="grid gap-8 lg:grid-cols-[12rem_minmax(0,1fr)]">
          <nav aria-label="Settings sections" className="hidden lg:block">
            <ul className="sticky top-24 space-y-0.5">
              {SECTIONS.map((s) => (
                <li key={s.id}>
                  <a
                    href={`#${s.id}`}
                    className="block rounded-lg px-3 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-brand"
                  >
                    {s.label}
                  </a>
                </li>
              ))}
            </ul>
          </nav>
          <div className="min-w-0 space-y-6">
            <SearchSection profile={profile.data} />
            <SourcesSection profile={profile.data} webSearchAvailable={overview.data?.setup.web_search_available ?? false} />
            <WatchlistSection profile={profile.data} />
            <ApplicationProfileSection profile={profile.data} />
            <ApplyRulesSection profile={profile.data} />
            <MailboxSection profile={profile.data} inboundEnabled={overview.data?.setup.inbound_enabled ?? false} />
            <ResumeSection profile={profile.data} />
            <SavedAnswersSection />
          </div>
        </div>
      ) : null}
    </div>
  )
}
