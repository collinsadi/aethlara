import { NavLink, useLocation } from "react-router-dom";
import { motion } from "framer-motion";
import {
  LayoutDashboard,
  FileText,
  Briefcase,
  KanbanSquare,
  Settings,
  ChevronLeft,
} from "lucide-react";

interface SidebarProps {
  collapsed: boolean;
  onToggle: () => void;
}

const navItems = [
  { icon: LayoutDashboard, label: "Dashboard", href: "/dashboard" },
  { icon: FileText, label: "Resumes", href: "/resumes" },
  { icon: Briefcase, label: "Jobs", href: "/jobs" },
  { icon: KanbanSquare, label: "Tracker", href: "/tracker" },
  { icon: Settings, label: "Settings", href: "/settings" },
];

export function Sidebar({ collapsed, onToggle }: SidebarProps) {
  const location = useLocation();

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
          animate={{ opacity: collapsed ? 0 : 1, width: collapsed ? 0 : "auto" }}
          className="flex items-center gap-2 overflow-hidden"
        >
          {/* <div className="logo-mark shrink-0">
            <img src="/logo.svg" alt="Aethlara" className="w-4 h-4" />
          </div> */}
          <span className="text-base font-semibold tracking-tight whitespace-nowrap font-heading">
            Aethlara
          </span>
        </motion.div>
        {collapsed && (
          <div className="logo-mark mx-auto shrink-0">
            {/* <Sparkles className="w-4 h-4" /> */}
          </div>
        )}
        <button
          type="button"
          onClick={onToggle}
          className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted transition-all"
        >
          <motion.div
            animate={{ rotate: collapsed ? 180 : 0 }}
            transition={{ duration: 0.3 }}
          >
            <ChevronLeft className="w-4 h-4" />
          </motion.div>
        </button>
      </div>

      <nav className="flex-1 px-3 py-4 space-y-1">
        {navItems.map((item) => {
          const isActive =
            location.pathname === item.href ||
            (item.href !== "/dashboard" &&
              location.pathname.startsWith(item.href));

          return (
            <NavLink
              key={item.href}
              to={item.href}
              className={`relative flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all duration-200 group ${
                isActive
                  ? "text-foreground"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {isActive && (
                <motion.div
                  layoutId="sidebar-active"
                  className="absolute inset-0 bg-muted rounded-xl border border-border"
                  transition={{
                    type: "spring",
                    stiffness: 350,
                    damping: 30,
                  }}
                />
              )}
              <item.icon
                className={`w-5 h-5 shrink-0 relative z-10 transition-colors ${
                  isActive ? "text-brand" : "group-hover:text-foreground"
                }`}
              />
              <motion.span
                initial={false}
                animate={{
                  opacity: collapsed ? 0 : 1,
                  width: collapsed ? 0 : "auto",
                }}
                className="relative z-10 whitespace-nowrap overflow-hidden"
              >
                {item.label}
              </motion.span>
            </NavLink>
          );
        })}
      </nav>

      <div className="p-3">
        {/* <div
          className={`glass-card p-3 ${collapsed ? "items-center" : ""}`}
          style={{ display: collapsed ? "none" : "block" }}
        >
          <p className="text-xs text-muted-foreground leading-relaxed">
            Tip: paste a job URL or description to start a match analysis.
          </p>
        </div> */}
      </div>
    </motion.aside>
  );
}
