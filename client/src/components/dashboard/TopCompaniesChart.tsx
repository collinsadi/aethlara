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
  data: DashboardAnalytics['top_companies']
}

function truncate(s: string, n = 18) {
  return s.length > n ? s.slice(0, n) + '…' : s
}

export function TopCompaniesChart({ data }: Props) {
  if (!data.length) {
    return (
      <div
        role="img"
        aria-label="No company data yet"
        className="h-[160px] flex items-center justify-center border border-dashed border-border rounded-xl"
      >
        <p className="text-xs text-muted-foreground/60 text-center px-4">
          Top companies will appear after you add jobs.
        </p>
      </div>
    )
  }

  const sorted = [...data]
    .sort((a, b) => b.count - a.count)
    .slice(0, 5)
    .map((d, i) => ({ ...d, fill: i === 0 ? 'var(--color-brand)' : 'var(--color-muted-foreground)' }))

  return (
    <div role="img" aria-label="Top companies by job count">
      <ResponsiveContainer width="100%" height={160}>
        <BarChart
          layout="vertical"
          data={sorted}
          margin={{ top: 0, right: 16, left: 0, bottom: 0 }}
        >
          <XAxis
            type="number"
            allowDecimals={false}
            tick={{ fontSize: 10, fill: 'var(--color-muted-foreground)' }}
            axisLine={false}
            tickLine={false}
          />
          <YAxis
            type="category"
            dataKey="company"
            width={90}
            tickFormatter={(value) => truncate(String(value))}
            tick={{ fontSize: 11, fill: 'var(--color-foreground)' }}
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
          />
          <Bar dataKey="count" radius={[0, 4, 4, 0]} maxBarSize={20}>
            {sorted.map((d) => (
              <Cell key={d.company} fill={d.fill} fillOpacity={d.fill.includes('brand') ? 1 : 0.55} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}
