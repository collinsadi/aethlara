import { Link } from 'react-router-dom'
import { motion } from 'framer-motion'
import { ProfileSection } from '@/components/settings/ProfileSection'
import { AIProviderSection } from '@/components/settings/AIProviderSection'
import { EmailChangeSection } from '@/components/settings/EmailChangeSection'
import { ExtensionSection } from '@/components/settings/ExtensionSection'
import { useHashScroll } from '@/hooks/useHashScroll'

const SECTIONS = [
  { id: 'profile', label: 'Profile' },
  { id: 'ai', label: 'AI provider' },
  { id: 'security', label: 'Email & Security' },
  { id: 'extension', label: 'Extension' },
]

/** `#api-key` predates multi-provider support; keep old links working. */
const HASH_ALIASES = { 'api-key': 'ai' }

export function Settings() {
  useHashScroll(true, HASH_ALIASES)

  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2 }}
      className="max-w-3xl mx-auto px-0 sm:px-4 py-8 space-y-3"
    >
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-foreground font-heading">Settings</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Your account, AI provider and connected browser. Autopilot preferences live in{' '}
          <Link to="/agent/settings" className="font-medium text-foreground underline underline-offset-2 hover:text-brand">
            Autopilot settings
          </Link>
          .
        </p>
      </div>

      <nav aria-label="Settings sections" className="flex items-center gap-1 mb-8 border-b border-border pb-0.5 overflow-x-auto">
        {SECTIONS.map(({ id, label }) => (
          <a
            key={id}
            href={`#${id}`}
            onClick={(e) => {
              e.preventDefault()
              document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
              history.replaceState(null, '', `#${id}`)
            }}
            className="shrink-0 px-3 py-2 text-sm text-muted-foreground hover:text-foreground transition-colors border-b-2 border-transparent hover:border-foreground/30 -mb-px focus-visible:outline-2 focus-visible:outline-brand"
          >
            {label}
          </a>
        ))}
      </nav>

      <div className="space-y-12">
        <section id="profile" className="scroll-mt-24 outline-none">
          <ProfileSection />
        </section>

        <section id="ai" aria-label="AI provider" className="scroll-mt-24 outline-none">
          <AIProviderSection />
        </section>

        <section id="security" className="scroll-mt-24 outline-none">
          <EmailChangeSection />
        </section>

        <section id="extension" className="scroll-mt-24 outline-none">
          <ExtensionSection />
        </section>
      </div>
    </motion.div>
  )
}
