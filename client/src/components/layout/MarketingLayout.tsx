import { Outlet, Link, useLocation } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import { useState } from "react";
import { Menu, X } from "lucide-react";
import { AnimatedOrbs } from "@/components/AnimatedOrbs";
import { ThemeSwitcher } from "@/components/ThemeSwitcher";

const navLinks = [
  { label: "Home", href: "/" },
  { label: "About", href: "/about" },
  { label: "Contact", href: "/contact" },
];

const footerLinks = [
  { label: "Home", href: "/" },
  { label: "About", href: "/about" },
  { label: "Contact", href: "/contact" },
  { label: "Privacy Policy", href: "/privacy" },
  { label: "Terms of Service", href: "/terms" },
];

export function MarketingLayout() {
  const [mobileOpen, setMobileOpen] = useState(false);
  const location = useLocation();

  return (
    <div className="min-h-screen bg-cosmic relative text-foreground">
      <AnimatedOrbs />

      <header className="fixed top-0 left-0 right-0 z-50 pt-10 pb-2 md:pt-12">
        <div className="mx-auto max-w-[1424px] w-full px-4 md:px-8">
          <motion.nav
            initial={{ y: -16, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            transition={{ duration: 0.55, ease: [0.22, 1, 0.36, 1] }}
            className="header-pill flex max-w-[807px] mx-auto items-center justify-between gap-4"
          >
            <Link to="/" className="flex items-center gap-2.5 shrink-0 group">
              <span className="text-base font-semibold tracking-tight font-heading">
                Aethlara
              </span>
            </Link>

            <div className="hidden md:flex flex-1 items-center justify-center gap-6">
              {navLinks.map((link) => (
                <Link
                  key={link.href}
                  to={link.href}
                  data-active={location.pathname === link.href ? "true" : undefined}
                  className="nav-link-tf"
                >
                  {link.label}
                </Link>
              ))}
              <a
                href="https://github.com/collinsadi/aethlara"
                target="_blank"
                rel="noopener noreferrer"
                className="nav-link-tf"
              >
                GitHub
              </a>
            </div>

            <div className="hidden md:flex items-center gap-3 shrink-0 pr-1">
              <Link to="/login" className="nav-link-tf text-sm px-1">
                Log in
              </Link>
              <Link
                to="/signup"
                className="btn-tf animate-btn-shine inline-flex items-center justify-center text-sm font-semibold px-5 py-2.5 min-h-0"
              >
                Get Started
              </Link>
            </div>

            <button
              type="button"
              onClick={() => setMobileOpen(!mobileOpen)}
              className="md:hidden p-2 rounded-full text-muted-foreground hover:text-foreground transition-colors"
              aria-expanded={mobileOpen}
            >
              {mobileOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
            </button>
          </motion.nav>
        </div>

        <AnimatePresence>
          {mobileOpen && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: "auto" }}
              exit={{ opacity: 0, height: 0 }}
              transition={{ duration: 0.3 }}
              className="md:hidden mx-4 overflow-hidden"
            >
              <div className="glass-card mt-3 p-4 space-y-1">
                {navLinks.map((link) => (
                  <Link
                    key={link.href}
                    to={link.href}
                    onClick={() => setMobileOpen(false)}
                    data-active={location.pathname === link.href ? "true" : undefined}
                    className={`nav-link-tf block px-3 py-3 rounded-xl ${
                      location.pathname === link.href ? "bg-muted" : ""
                    }`}
                  >
                    {link.label}
                  </Link>
                ))}
                <a
                  href="https://github.com/collinsadi/aethlara"
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={() => setMobileOpen(false)}
                  className="nav-link-tf block px-3 py-3 rounded-xl"
                >
                  GitHub
                </a>
                <div className="pt-3 mt-2 border-t border-border space-y-2">
                  <Link
                    to="/login"
                    onClick={() => setMobileOpen(false)}
                    className="block px-3 py-3 rounded-xl text-sm font-semibold text-muted-foreground hover:text-foreground"
                  >
                    Log in
                  </Link>
                  <Link
                    to="/signup"
                    onClick={() => setMobileOpen(false)}
                    className="btn-tf animate-btn-shine flex w-full items-center justify-center text-center text-sm font-semibold py-3"
                  >
                    Get Started
                  </Link>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </header>

      <main className="relative z-10 pt-28 md:pt-32">
        <AnimatePresence mode="wait">
          <motion.div
            key={location.pathname}
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
          >
            <Outlet />
          </motion.div>
        </AnimatePresence>
      </main>

      <footer className="relative z-10 border-t border-border mt-24 md:mt-32">
        <div className="max-w-7xl mx-auto px-6 py-10">
          <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-6">
            <span className="text-sm font-medium text-muted-foreground">
              Aethlara © {new Date().getFullYear()}
            </span>
            <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
              {footerLinks.map((link) => (
                <Link
                  key={link.href}
                  to={link.href}
                  className="text-sm text-muted-foreground hover:text-foreground transition-colors"
                >
                  {link.label}
                </Link>
              ))}
              <a
                href="https://github.com/collinsadi/aethlara"
                target="_blank"
                rel="noopener noreferrer"
                className="text-sm text-muted-foreground hover:text-foreground transition-colors"
              >
                GitHub
              </a>
              <ThemeSwitcher compact />
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}
