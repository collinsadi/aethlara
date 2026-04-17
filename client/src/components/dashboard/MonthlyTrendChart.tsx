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
  data: DashboardAnalytics['monthly_trend']
}

function formatMonth(m: string) {
  const [year, month] = m.split('-')
  return new Date(Number(year), Number(month) - 1).toLocaleString('default', {
    month: 'short',
  })
}

const currentMonth = new Date().toISOString().slice(0, 7)

export function MonthlyTrendChart({ data }: Props) {
  if (!data.length || data.every((d) => d.count === 0)) {
    return (
      <EmptyChart label="No data yet — jobs added per month will appear here." />
    )
  }

  const sorted = [...data].sort((a, b) => a.month.localeCompare(b.month))

  return (
    <div role="img" aria-label="Monthly job additions over the last 6 months">
      <ResponsiveContainer width="100%" height={180}>
        <BarChart data={sorted} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
          <XAxis
            dataKey="month"
            tickFormatter={formatMonth}
            tick={{ fontSize: 11, fill: 'var(--color-muted-foreground)' }}
            axisLine={false}
            tickLine={false}
          />
          <YAxis
            allowDecimals={false}
            tick={{ fontSize: 11, fill: 'var(--color-muted-foreground)' }}
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
            formatter={(value) => [Number(value ?? 0), 'Jobs']}
            labelFormatter={(label) => formatMonth(String(label))}
          />
          <Bar dataKey="count" radius={[4, 4, 0, 0]} maxBarSize={40}>
            {sorted.map((entry) => (
              <Cell
                key={entry.month}
                fill={
                  entry.month === currentMonth
                    ? 'var(--color-brand)'
                    : 'var(--color-muted-foreground)'
                }
                fillOpacity={entry.month === currentMonth ? 1 : 0.45}
              />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}

function EmptyChart({ label }: { label: string }) {
  return (
    <div
      role="img"
      aria-label={label}
      className="h-[180px] flex items-center justify-center border border-dashed border-border rounded-xl"
    >
      <p className="text-xs text-muted-foreground/60 text-center px-4">{label}</p>
    </div>
  )
}
