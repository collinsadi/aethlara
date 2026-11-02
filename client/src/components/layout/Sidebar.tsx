import { motion } from 'framer-motion'
import { ChevronLeft } from 'lucide-react'
import { NavList } from '@/components/layout/NavList'

interface SidebarProps {
  collapsed: boolean
  onToggle: () => void
}

export function Sidebar({ collapsed, onToggle }: SidebarProps) {
  return (
    <motion.aside
      initial={false}
      animate={{ width: collapsed ? 72 : 240 }}
      transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
      className="hidden lg:flex flex-col h-screen sticky top-0 glass border-r border-border z-40 bg-card/80"
    >
      <div className="flex items-center justify-between p-4 h-16">
        <motion.div
          initial={false}
          animate={{ opacity: collapsed ? 0 : 1, width: collapsed ? 0 : 'auto' }}
          className="flex items-center gap-2 overflow-hidden"
        >
          <span className="text-base font-semibold tracking-tight whitespace-nowrap font-heading">
            Aethlara
          </span>
        </motion.div>
        {collapsed && <div className="logo-mark mx-auto shrink-0" aria-hidden />}
        <button
          type="button"
          onClick={onToggle}
          aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          aria-expanded={!collapsed}
          className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted transition-all focus-visible:outline-2 focus-visible:outline-brand"
        >
          <motion.div animate={{ rotate: collapsed ? 180 : 0 }} transition={{ duration: 0.3 }}>
            <ChevronLeft className="w-4 h-4" aria-hidden />
          </motion.div>
        </button>
      </div>

      <NavList collapsed={collapsed} layoutId="sidebar-active" />
    </motion.aside>
  )
}
