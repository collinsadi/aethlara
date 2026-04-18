import { useEffect, useRef } from 'react'
import { useLocation } from 'react-router-dom'
import { motion } from 'framer-motion'
import { ProfileSection } from '@/components/settings/ProfileSection'
import { ApiKeySection } from '@/components/settings/ApiKeySection'
import { EmailChangeSection } from '@/components/settings/EmailChangeSection'
import { ExtensionSection } from '@/components/settings/ExtensionSection'

const SECTIONS = [
  { id: 'profile', label: 'Profile' },
  { id: 'api-key', label: 'API Key' },
  { id: 'security', label: 'Email & Security' },
  { id: 'extension', label: 'Extension' },
]

export function Settings() {
  const { hash } = useLocation()
  const initialized = useRef(false)

  useEffect(() => {
    if (initialized.current) return
    initialized.current = true
    const id = hash.replace('#', '')
    if (!id) return
    setTimeout(() => {
      document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }, 100)
  }, [hash])

  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2 }}
      className="max-w-2xl mx-auto px-4 py-8 space-y-3"
    >
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-foreground font-heading">Settings</h1>
        <p className="text-sm text-muted-foreground mt-1">Manage your account and preferences.</p>
      </div>

      {/* Nav anchors */}
      <nav className="flex items-center gap-1 mb-8 border-b border-border pb-0.5">
        {SECTIONS.map(({ id, label }) => (
          <a
            key={id}
            href={`#${id}`}
            onClick={(e) => {
              e.preventDefault()
              document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
              history.replaceState(null, '', `#${id}`)
            }}
            className="px-3 py-2 text-sm text-muted-foreground hover:text-foreground transition-colors border-b-2 border-transparent hover:border-foreground/30 -mb-px"
          >
            {label}
          </a>
        ))}
      </nav>

      {/* Sections */}
      <div className="space-y-12">
        <section id="profile" className="scroll-mt-6">
          <ProfileSection />
        </section>

        <section id="api-key" className="scroll-mt-6">
          <ApiKeySection />
        </section>

        <section id="security" className="scroll-mt-6">
          <EmailChangeSection />
        </section>

        <section id="extension" className="scroll-mt-6">
          <ExtensionSection />
        </section>
      </div>
    </motion.div>
  )
}
