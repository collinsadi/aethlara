import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer } from 'recharts'
import { useNavigate } from 'react-router-dom'
import type { DashboardAnalytics, JobStatus } from '@/lib/types'

interface Props {
  data: DashboardAnalytics['jobs_by_status']
  totalActive: number
}

const STATUS_COLORS: Record<string, string> = {
  not_applied: 'var(--color-muted-foreground)',
  applied:     'var(--color-brand)',
  interview:   '#a3a3a3',
  offer:       '#10b981',
  rejected:    '#ef4444',
  withdrawn:   '#8b5cf6',
}

const STATUS_LABELS: Record<string, string> = {
  not_applied: 'Not Applied',
  applied:     'Applied',
  interview:   'Interview',
  offer:       'Offer',
  rejected:    'Rejected',
  withdrawn:   'Withdrawn',
}

export function StatusBreakdownChart({ data, totalActive }: Props) {
  const navigate = useNavigate()

  const chartData = Object.entries(data)
    .map(([status, count]) => ({ status, count }))
    .filter((d) => d.count > 0)

  if (chartData.length === 0 || chartData.every((d) => d.count === 0)) {
    return (
      <div
        role="img"
        aria-label="No job status data yet"
        className="h-[180px] flex items-center justify-center border border-dashed border-border rounded-xl"
      >
        <p className="text-xs text-muted-foreground/60 text-center px-4">
          No jobs yet — status breakdown will appear here.
        </p>
      </div>
    )
  }

  const handleClick = (entry: { status: string }) => {
    navigate(`/jobs?status=${entry.status}`)
  }

  return (
    <div role="img" aria-label="Job status breakdown donut chart">
      <div className="relative">
        <ResponsiveContainer width="100%" height={180}>
          <PieChart>
            <Pie
              data={chartData}
              dataKey="count"
              nameKey="status"
              cx="50%"
              cy="50%"
              innerRadius={50}
              outerRadius={80}
              paddingAngle={2}
              onClick={handleClick}
              style={{ cursor: 'pointer' }}
            >
              {chartData.map((entry) => (
                <Cell
                  key={entry.status}
                  fill={STATUS_COLORS[entry.status] ?? '#999'}
                />
              ))}
            </Pie>
            <Tooltip
              contentStyle={{
                background: 'var(--color-card)',
                border: '1px solid var(--color-border)',
                borderRadius: 10,
                fontSize: 12,
              }}
              formatter={(v: number, name: string) => [
                v,
                STATUS_LABELS[name] ?? name,
              ]}
            />
          </PieChart>
        </ResponsiveContainer>

        {/* Centre label */}
        <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
          <span className="text-2xl font-bold text-foreground font-heading">
            {totalActive}
          </span>
          <span className="text-[10px] text-muted-foreground">total</span>
        </div>
      </div>

      {/* Legend */}
      <div className="flex flex-wrap justify-center gap-x-3 gap-y-1 mt-2">
        {chartData.map((d) => (
          <button
            key={d.status}
            type="button"
            onClick={() => handleClick(d)}
            className="flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground transition-colors"
            aria-label={`Filter by ${STATUS_LABELS[d.status]}`}
          >
            <span
              className="w-2 h-2 rounded-full"
              style={{ background: STATUS_COLORS[d.status] ?? '#999' }}
            />
            {STATUS_LABELS[d.status as JobStatus] ?? d.status}
          </button>
        ))}
      </div>
    </div>
  )
}
