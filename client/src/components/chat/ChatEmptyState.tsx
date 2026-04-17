import { motion } from 'framer-motion'
import { Sparkles } from 'lucide-react'

interface Props {
  jobTitle?: string
  company?: string
  onPromptSelect: (prompt: string) => void
  disabled?: boolean
}

const SUGGESTIONS = [
  'What are my biggest gaps for this role?',
  'Draft a 3-paragraph cover letter.',
  'Which parts of my resume should I emphasise?',
  'Help me prepare for the first interview.',
]

export function ChatEmptyState({ jobTitle, company, onPromptSelect, disabled }: Props) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
      className="flex flex-col items-center justify-center text-center py-12 px-6"
    >
      <div className="w-14 h-14 rounded-2xl bg-brand/10 border border-border flex items-center justify-center mb-4">
        <Sparkles className="w-7 h-7 text-brand" />
      </div>
      <h3 className="text-base font-semibold text-foreground font-heading mb-1">
        Ask me about this job
      </h3>
      <p className="text-xs text-muted-foreground max-w-xs mb-6">
        I have {jobTitle && company ? (
          <>
            the full description for <span className="text-foreground">{jobTitle}</span> at{' '}
            <span className="text-foreground">{company}</span>
          </>
        ) : (
          'the full job description'
        )}
        , your resume, and the match analysis. I'll help you strategise.
      </p>

      <div className="flex flex-col gap-2 w-full max-w-sm">
        {SUGGESTIONS.map((s) => (
          <motion.button
            key={s}
            type="button"
            whileHover={{ x: 2 }}
            onClick={() => onPromptSelect(s)}
            disabled={disabled}
            className="text-left text-xs text-foreground bg-muted/30 hover:bg-muted/60 border border-border rounded-xl px-3 py-2.5 transition-colors disabled:opacity-50 disabled:pointer-events-none"
          >
            {s}
          </motion.button>
        ))}
      </div>
    </motion.div>
  )
}
