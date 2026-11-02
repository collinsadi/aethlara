import { motion } from 'framer-motion'
import { Plus, Menu, LogOut, Settings } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu'
import { AgentStatusPill } from '@/components/agent/AgentStatusPill'
import { useAuth } from '@/hooks/useAuth'

interface TopbarProps {
  onMobileMenuToggle: () => void
  mobileMenuOpen: boolean
  onNewJob: () => void
}

export function Topbar({ onMobileMenuToggle, mobileMenuOpen, onNewJob }: TopbarProps) {
  const { user, logout } = useAuth()
  const navigate = useNavigate()
  const userInitials =
    user?.full_name
      ?.split(' ')
      .filter(Boolean)
      .map((n) => n[0])
      .join('') || 'U'

  return (
    <motion.header
      initial={{ y: -10, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      transition={{ duration: 0.4, delay: 0.1 }}
      className="sticky top-0 z-30 h-16 glass border-b border-border flex items-center justify-between gap-3 px-4 md:px-6 bg-card/70"
    >
      <div className="flex min-w-0 items-center gap-3">
        <button
          type="button"
          onClick={onMobileMenuToggle}
          aria-label="Open navigation"
          aria-expanded={mobileMenuOpen}
          className="lg:hidden p-2 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted transition-all focus-visible:outline-2 focus-visible:outline-brand"
        >
          <Menu className="w-5 h-5" aria-hidden />
        </button>
        <AgentStatusPill />
      </div>

      <div className="flex items-center gap-3">
        <motion.button
          type="button"
          whileHover={{ scale: 1.02 }}
          whileTap={{ scale: 0.98 }}
          onClick={onNewJob}
          title="Tailor your resume to a job you found yourself"
          className="btn-tf animate-btn-shine inline-flex items-center gap-2 text-sm font-semibold px-4 py-2 min-h-0"
        >
          <Plus className="w-4 h-4" aria-hidden />
          <span className="hidden sm:inline">New Job</span>
          <span className="sr-only sm:hidden">New job</span>
        </motion.button>

        <DropdownMenu>
          <DropdownMenuTrigger
            aria-label="Account menu"
            className="flex items-center gap-2 p-1.5 rounded-lg hover:bg-muted transition-colors focus-visible:outline-2 focus-visible:outline-brand"
          >
            <Avatar className="w-8 h-8 border border-border">
              <AvatarFallback className="bg-muted text-foreground text-xs font-semibold font-heading">
                {userInitials}
              </AvatarFallback>
            </Avatar>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56 border-border bg-popover">
            <div className="px-3 py-2">
              <p className="text-sm font-medium text-foreground">{user?.full_name}</p>
              <p className="text-xs text-muted-foreground">{user?.email}</p>
            </div>
            <DropdownMenuSeparator className="bg-border" />
            <DropdownMenuItem
              onClick={() => navigate('/settings')}
              className="text-muted-foreground hover:text-foreground focus:text-foreground focus:bg-muted cursor-pointer"
            >
              <Settings className="w-4 h-4 mr-2" aria-hidden />
              Settings
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={logout}
              className="text-muted-foreground hover:text-foreground focus:text-foreground focus:bg-muted cursor-pointer"
            >
              <LogOut className="w-4 h-4 mr-2" aria-hidden />
              Log out
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </motion.header>
  )
}
