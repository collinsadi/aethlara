import { motion } from 'framer-motion'
import {
  Briefcase,
  Target,
  FileText,
  TrendingUp,
} from 'lucide-react'
import { StatsCard } from '@/components/StatsCard'
import { ThemeSwitcher } from '@/components/ThemeSwitcher'
import { MonthlyTrendChart } from '@/components/dashboard/MonthlyTrendChart'
import { StatusBreakdownChart } from '@/components/dashboard/StatusBreakdownChart'
import { MatchScoreChart } from '@/components/dashboard/MatchScoreChart'
import { TopCompaniesChart } from '@/components/dashboard/TopCompaniesChart'
import { useAnalytics } from '@/hooks/useAnalytics'
import { useAuth } from '@/hooks/useAuth'

const STAT_SKELETON = '—'

export function Dashboard() {
  const { user } = useAuth()
  const { data: analytics, isLoading } = useAnalytics()

  const firstName = user?.full_name.split(' ')[0] ?? 'there'

  const avgMatchStr = isLoading
    ? STAT_SKELETON
    : `${(analytics?.average_match_rate ?? 0).toFixed(1)}%`

  const avgMatchColor =
    !analytics ? 'indigo'
    : analytics.average_match_rate >= 70 ? 'teal'
    : analytics.average_match_rate >= 40 ? 'amber'
    : 'indigo'

  const totalActive =
    analytics
      ? Object.values(analytics.jobs_by_status).reduce((s, n) => s + n, 0)
      : 0

  return (
    <div className="space-y-8">
      {/* Header */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
      >
        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div>
            <h1 className="text-2xl md:text-3xl font-semibold text-foreground tracking-tight font-heading">
              Welcome back,{' '}
              <span className="text-gradient">{firstName}</span>
            </h1>
            <p className="text-sm text-muted-foreground mt-1">
              {new Date().toLocaleDateString('en-US', {
                weekday: 'long', month: 'long', day: 'numeric',
              })}
            </p>
          </div>
          <ThemeSwitcher />
        </div>
      </motion.div>

      {/* Stats Row */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatsCard
          icon={Briefcase}
          label="Jobs This Month"
          value={isLoading ? STAT_SKELETON : (analytics?.total_jobs_this_month ?? 0)}
          subtext="Added this month"
          color="indigo"
          index={0}
        />
        <StatsCard
          icon={Target}
          label="Avg. Match Rate"
          value={avgMatchStr}
          subtext="Across all analysed jobs"
          color={avgMatchColor}
          index={1}
        />
        <StatsCard
          icon={FileText}
          label="Resumes"
          value={isLoading ? STAT_SKELETON : (analytics?.total_resumes ?? 0)}
          subtext="Active resumes"
          color="purple"
          index={2}
        />
        <StatsCard
          icon={TrendingUp}
          label="Applied"
          value={isLoading ? STAT_SKELETON : (analytics?.applied_jobs ?? 0)}
          subtext="Applied + interview + offer"
          color="amber"
          index={3}
        />
      </div>

      {/* Charts Row 1: Monthly Trend + Status Breakdown */}
      <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.1 }}
          className="lg:col-span-3 glass-card p-5"
        >
          <h2 className="text-sm font-semibold text-foreground font-heading mb-4">
            Monthly Activity
          </h2>
          {isLoading ? (
            <div className="h-[180px] bg-muted/30 animate-pulse rounded-xl" />
          ) : (
            <MonthlyTrendChart data={analytics?.monthly_trend ?? []} />
          )}
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.15 }}
          className="lg:col-span-2 glass-card p-5"
        >
          <h2 className="text-sm font-semibold text-foreground font-heading mb-4">
            By Status
          </h2>
          {isLoading ? (
            <div className="h-[180px] bg-muted/30 animate-pulse rounded-xl" />
          ) : (
            <StatusBreakdownChart
              data={analytics?.jobs_by_status ?? {} as Record<string, number>}
              totalActive={totalActive}
            />
          )}
        </motion.div>
      </div>

      {/* Charts Row 2: Match Score + Top Companies */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.2 }}
          className="glass-card p-5"
        >
          <h2 className="text-sm font-semibold text-foreground font-heading mb-4">
            Match Score Distribution
          </h2>
          {isLoading ? (
            <div className="h-[160px] bg-muted/30 animate-pulse rounded-xl" />
          ) : (
            <MatchScoreChart
              data={analytics?.match_score_distribution ?? { low: 0, medium: 0, high: 0 }}
            />
          )}
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.25 }}
          className="glass-card p-5"
        >
          <h2 className="text-sm font-semibold text-foreground font-heading mb-4">
            Top Companies
          </h2>
          {isLoading ? (
            <div className="h-[160px] bg-muted/30 animate-pulse rounded-xl" />
          ) : (
            <TopCompaniesChart data={analytics?.top_companies ?? []} />
          )}
        </motion.div>
      </div>
    </div>
  )
}
