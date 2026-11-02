import { NavLink } from 'react-router-dom'
import { motion } from 'framer-motion'
import { NAV_SECTIONS, type NavItem } from '@/components/layout/navItems'
import { useNavBadges, type NavBadge } from '@/hooks/useNavBadges'
import { cn } from '@/lib/utils'

interface NavListProps {
  /** Icon-only rail (desktop sidebar collapsed). */
  collapsed?: boolean
  /** Called after a link is chosen (closes the mobile menu). */
  onNavigate?: () => void
  /** Distinct per instance so the active-pill animation doesn't jump between menus. */
  layoutId: string
}

export function NavList({ collapsed = false, onNavigate, layoutId }: NavListProps) {
  const badges = useNavBadges()
  return (
    <nav aria-label="Main" className="flex-1 overflow-y-auto px-3 py-4">
      {NAV_SECTIONS.map((section, i) => (
        <div key={section.title ?? i} className={cn(i > 0 && 'mt-3 border-t border-border/70 pt-3')}>
          {section.title && !collapsed && (
            <p className="px-3 pb-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/70">
              {section.title}
            </p>
          )}
          <ul className="space-y-1">
            {section.items.map((item) => (
              <li key={item.href}>
                <NavRow
                  item={item}
                  badge={item.badge ? badges[item.badge] : undefined}
                  collapsed={collapsed}
                  onNavigate={onNavigate}
                  layoutId={layoutId}
                />
              </li>
            ))}
          </ul>
        </div>
      ))}
    </nav>
  )
}

function NavRow({
  item,
  badge,
  collapsed,
  onNavigate,
  layoutId,
}: {
  item: NavItem
  badge?: NavBadge
  collapsed: boolean
  onNavigate?: () => void
  layoutId: string
}) {
  const showBadge = !!badge && badge.count > 0
  return (
    <NavLink
      to={item.href}
      onClick={onNavigate}
      title={collapsed ? item.label : undefined}
      className={({ isActive }) =>
        cn(
          'group relative flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium outline-none transition-colors duration-200',
          'focus-visible:ring-2 focus-visible:ring-brand/40',
          isActive ? 'text-foreground' : 'text-muted-foreground hover:text-foreground'
        )
      }
    >
      {({ isActive }) => (
        <>
          {isActive && (
            <motion.div
              layoutId={layoutId}
              className="absolute inset-0 rounded-xl border border-border bg-muted"
              transition={{ type: 'spring', stiffness: 350, damping: 30 }}
            />
          )}
          <span className="relative z-10 shrink-0">
            <item.icon
              className={cn('size-5 transition-colors', isActive ? 'text-brand' : 'group-hover:text-foreground')}
              aria-hidden
            />
            {collapsed && showBadge && (
              <span
                className={cn(
                  'absolute -right-1 -top-1 size-2 rounded-full ring-2 ring-card',
                  badge.tone === 'warning' ? 'bg-warning' : 'bg-brand'
                )}
                aria-hidden
              />
            )}
          </span>
          <motion.span
            initial={false}
            animate={{ opacity: collapsed ? 0 : 1, width: collapsed ? 0 : 'auto' }}
            className="relative z-10 flex-1 overflow-hidden whitespace-nowrap"
          >
            {item.label}
          </motion.span>
          {showBadge && (
            <>
              {!collapsed && (
                <span
                  aria-hidden
                  className={cn(
                    'relative z-10 inline-flex h-5 min-w-5 items-center justify-center rounded-full px-1.5 text-[10px] font-semibold tabular-nums',
                    badge.tone === 'warning'
                      ? 'bg-warning/15 text-warning'
                      : 'bg-brand text-primary-foreground'
                  )}
                >
                  {badge.count > 99 ? '99+' : badge.count}
                </span>
              )}
              <span className="sr-only">({badge.label})</span>
            </>
          )}
        </>
      )}
    </NavLink>
  )
}
