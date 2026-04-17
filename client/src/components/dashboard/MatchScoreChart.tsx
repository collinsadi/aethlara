import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  Cell,
} from 'recharts'
import type { DashboardAnalytics } from '@/lib/types'

interface Props {
  data: DashboardAnalytics['match_score_distribution']
}

const BUCKETS = [
  { key: 'low',    label: 'Low (0–40)',    fill: '#ef4444' },
  { key: 'medium', label: 'Medium (41–70)', fill: '#f59e0b' },
  { key: 'high',   label: 'High (71–100)', fill: '#10b981' },
] as const

export function MatchScoreChart({ data }: Props) {
  const chartData = BUCKETS.map((b) => ({
    label: b.label,
    count: data[b.key],
    fill:  b.fill,
  }))

  const total = chartData.reduce((s, d) => s + d.count, 0)

  if (total === 0) {
    return (
      <div
        role="img"
        aria-label="No match score data yet"
        className="h-[160px] flex items-center justify-center border border-dashed border-border rounded-xl"
      >
        <p className="text-xs text-muted-foreground/60 text-center px-4">
          Match scores will appear after jobs are analysed.
        </p>
      </div>
    )
  }

  return (
    <div role="img" aria-label="Match score distribution: low, medium, high">
      <ResponsiveContainer width="100%" height={160}>
        <BarChart
          data={chartData}
          margin={{ top: 4, right: 4, left: -20, bottom: 0 }}
        >
          <XAxis
            dataKey="label"
            tick={{ fontSize: 10, fill: 'var(--color-muted-foreground)' }}
            axisLine={false}
            tickLine={false}
          />
          <YAxis
            allowDecimals={false}
            tick={{ fontSize: 10, fill: 'var(--color-muted-foreground)' }}
            axisLine={false}
            tickLine={false}
          />
          <Tooltip
            cursor={{ fill: 'var(--color-muted)', opacity: 0.5 }}
            contentStyle={{
              background: 'var(--color-card)',
              border: '1px solid var(--color-border)',
              borderRadius: 10,
              fontSize: 12,
            }}
            formatter={(v: number) => [v, 'Jobs']}
          />
          <Bar dataKey="count" radius={[4, 4, 0, 0]} maxBarSize={56}>
            {chartData.map((d) => (
              <Cell key={d.label} fill={d.fill} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}
