/**
 * Multi-step job creation modal.
 *
 * Step machine:
 *   input_method → provide_job → select_resume → processing → result
 *
 * Polling: during processing, GET /jobs/:id every 3s until pipeline completes.
 * Stops on: success, terminal error, unmount, or modal close.
 */
import { useState, useEffect, useRef } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { motion, AnimatePresence } from 'framer-motion'
import {
  X, Link2, FileText, ChevronRight, CheckCircle2,
  AlertCircle, Loader2, ArrowLeft,
} from 'lucide-react'
import { useResumes } from '@/hooks/useResumes'
import { useCreateJob } from '@/hooks/useJobs'
import { useJobDetail } from '@/hooks/useJobs'
import { useAIGate } from '@/hooks/useAIGate'
import { ApiKeyStatusBanner } from '@/components/settings/ApiKeyStatusBanner'
import { urlJobSchema, textJobSchema } from '@/lib/validators/job.schema'
import type { ApiJob } from '@/lib/types'
import { cn } from '@/lib/utils'

type CreateStep =
  | 'input_method'
  | 'provide_job'
  | 'select_resume'
  | 'processing'
  | 'result'

interface Props {
  open: boolean
  onClose: () => void
  onSuccess?: (job: ApiJob) => void
}

const MAX_TEXT_BYTES = 50_000

export function CreateJobModal({ open, onClose, onSuccess }: Props) {
  const { hasKey, isLoading: gateLoading } = useAIGate()
  const [step, setStep] = useState<CreateStep>('input_method')
  const [inputMethod, setInputMethod] = useState<'url' | 'text'>('url')
  const [createdJob, setCreatedJob] = useState<ApiJob | null>(null)
  const [error, setError] = useState<{ code: string; message: string; match_score?: number } | null>(null)
  const [resumeId, setResumeId] = useState('')
  const [pollEnabled, setPollEnabled] = useState(false)

  const createJob = useCreateJob()
  const { data: resumes } = useResumes()

  // ── URL form ────────────────────────────────────────────────────────────────
  const urlForm = useForm({
    resolver: zodResolver(urlJobSchema),
    defaultValues: { input_method: 'url' as const, job_url: '' },
  })

  // ── Text form ───────────────────────────────────────────────────────────────
  const textForm = useForm({
    resolver: zodResolver(textJobSchema),
    defaultValues: {
      input_method: 'text' as const,
      company_name: '',
      role: '',
      job_text: '',
    },
  })

  const jobText = textForm.watch('job_text')

  // ── Polling ─────────────────────────────────────────────────────────────────
  const pollingJobId = createdJob?.id ?? null
  const { data: polledJob } = useJobDetail(
    pollEnabled ? pollingJobId : null
  )

  // Check if pipeline is done
  useEffect(() => {
    if (!polledJob || !pollEnabled) return
    const { extraction_status, alignment_status } = polledJob
    const isTerminal = (s: string) =>
      ['completed', 'failed', 'misaligned'].includes(s)

    if (isTerminal(extraction_status) && isTerminal(alignment_status)) {
      setPollEnabled(false)
      setCreatedJob(polledJob)
      setStep('result')
    }
  }, [polledJob, pollEnabled])

  // Poll every 3 seconds while in processing step
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)
  useEffect(() => {
    if (step === 'processing' && pollEnabled && pollingJobId) {
      pollRef.current = setInterval(() => {
        // Invalidation handled by useJobDetail's refetch — we just keep the
        // query enabled and let React Query's staleTime handle freshness.
        // Force refetch by toggling:
      }, 3000)
    }
    return () => {
      if (pollRef.current) clearInterval(pollRef.current)
    }
  }, [step, pollEnabled, pollingJobId])

  const reset = () => {
    setStep('input_method')
    setInputMethod('url')
    setCreatedJob(null)
    setError(null)
    setResumeId('')
    setPollEnabled(false)
    urlForm.reset()
    textForm.reset()
  }

  const handleClose = () => {
    if (step === 'processing') return // prevent close during pipeline
    reset()
    onClose()
  }

  // ── Submit ──────────────────────────────────────────────────────────────────
  const submitJob = async () => {
    setError(null)
    setStep('processing')

    try {
      let job: ApiJob
      if (inputMethod === 'url') {
        const values = urlForm.getValues()
        job = await createJob.mutateAsync({
          input_method: 'url',
          job_url: values.job_url,
          resume_id: resumeId,
        })
      } else {
        const values = textForm.getValues()
        job = await createJob.mutateAsync({
          input_method: 'text',
          company_name: values.company_name,
          role: values.role,
          job_text: values.job_text,
          resume_id: resumeId,
        })
      }

      setCreatedJob(job)

      // Check if already complete (sync pipeline)
      if (
        job.extraction_status === 'completed' &&
        (job.alignment_status === 'completed' || job.alignment_status === 'misaligned' || job.alignment_status === 'failed')
      ) {
        setStep('result')
      } else {
        // Start polling for async pipeline
        setPollEnabled(true)
      }
    } catch (err: unknown) {
      const apiErr = err as { response?: { data?: { error?: { code?: string; message?: string; match_score?: number } } } }
      const errBody = apiErr?.response?.data?.error
      const code = errBody?.code ?? 'UNKNOWN_ERROR'
      const message = errBody?.message ?? 'Something went wrong.'
      setError({ code, message, match_score: errBody?.match_score })
      setStep('result')
    }
  }

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={handleClose}
      />
      <motion.div
        initial={{ opacity: 0, scale: 0.96, y: 8 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.96 }}
        transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
        className="relative glass-card w-full max-w-lg max-h-[90vh] overflow-y-auto shadow-2xl"
      >
        {/* Header */}
        <div className="flex items-center justify-between p-5 border-b border-border">
          <div className="flex items-center gap-2">
            {step !== 'input_method' && step !== 'processing' && step !== 'result' && (
              <button
                type="button"
                onClick={() => {
                  if (step === 'provide_job') setStep('input_method')
                  if (step === 'select_resume') setStep('provide_job')
                }}
                className="p-1 rounded-lg text-muted-foreground hover:text-foreground transition-colors"
                aria-label="Go back"
              >
                <ArrowLeft className="w-4 h-4" />
              </button>
            )}
            <h2 className="text-base font-semibold text-foreground font-heading">
              {step === 'input_method' && 'Add a Job'}
              {step === 'provide_job' && (inputMethod === 'url' ? 'Paste Job URL' : 'Paste Job Text')}
              {step === 'select_resume' && 'Select Resume'}
              {step === 'processing' && 'Analysing…'}
              {step === 'result' && (error ? 'Something went wrong' : 'Job Created!')}
            </h2>
          </div>
          {step !== 'processing' && (
            <button
              type="button"
              onClick={handleClose}
              className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground transition-colors"
              aria-label="Close"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>

        {/* Body */}
        <div className="p-5">
          {!gateLoading && !hasKey ? (
            <ApiKeyStatusBanner variant="inline" />
          ) : (
          <AnimatePresence mode="wait">
            {step === 'input_method' && (
              <StepInputMethod
                key="input_method"
                selected={inputMethod}
                onSelect={(m) => {
                  setInputMethod(m)
                  setStep('provide_job')
                }}
              />
            )}
            {step === 'provide_job' && inputMethod === 'url' && (
              <StepURL
                key="provide_url"
                form={urlForm}
                onNext={() => setStep('select_resume')}
              />
            )}
            {step === 'provide_job' && inputMethod === 'text' && (
              <StepText
                key="provide_text"
                form={textForm}
                charCount={jobText?.length ?? 0}
                onNext={() => setStep('select_resume')}
              />
            )}
            {step === 'select_resume' && (
              <StepSelectResume
                key="select_resume"
                resumes={resumes ?? []}
                selected={resumeId}
                onSelect={setResumeId}
                onNext={submitJob}
              />
            )}
            {step === 'processing' && (
              <StepProcessing key="processing" job={createdJob} />
            )}
            {step === 'result' && (
              <StepResult
                key="result"
                job={createdJob}
                error={error}
                inputMethod={inputMethod}
                onAddAnother={() => reset()}
                onViewJob={() => {
                  if (createdJob) onSuccess?.(createdJob)
                  handleClose()
                }}
                onRetryWithText={() => {
                  reset()
                  setInputMethod('text')
                  setStep('provide_job')
                }}
              />
            )}
          </AnimatePresence>
          )}
        </div>
      </motion.div>
    </div>
  )
}

// ── Step: Input Method ────────────────────────────────────────────────────────

function StepInputMethod({
  selected,
  onSelect,
}: {
  selected: 'url' | 'text'
  onSelect: (m: 'url' | 'text') => void
}) {
  const options = [
    {
      id: 'url' as const,
      icon: Link2,
      title: 'Paste a Job URL',
      desc: "We'll scrape the listing automatically",
    },
    {
      id: 'text' as const,
      icon: FileText,
      title: 'Paste Job Text',
      desc: 'Copy-paste the job description directly',
    },
  ]

  return (
    <motion.div
      initial={{ opacity: 0, x: 12 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: -12 }}
      className="space-y-3"
    >
      {options.map(({ id, icon: Icon, title, desc }) => (
        <button
          key={id}
          type="button"
          onClick={() => onSelect(id)}
          className={cn(
            'w-full flex items-center gap-4 p-4 rounded-xl border transition-all text-left',
            selected === id
              ? 'border-brand bg-brand/5 text-foreground'
              : 'border-border hover:border-border/80 hover:bg-muted/40 text-muted-foreground hover:text-foreground'
          )}
        >
          <div className={cn('p-2.5 rounded-xl', selected === id ? 'bg-brand/10' : 'bg-muted')}>
            <Icon className={cn('w-5 h-5', selected === id ? 'text-brand' : 'text-muted-foreground')} />
          </div>
          <div className="flex-1">
            <p className="text-sm font-semibold font-heading">{title}</p>
            <p className="text-xs text-muted-foreground mt-0.5">{desc}</p>
          </div>
          <ChevronRight className="w-4 h-4 text-muted-foreground/50" />
        </button>
      ))}
    </motion.div>
  )
}

// ── Step: URL ─────────────────────────────────────────────────────────────────

function StepURL({
  form,
  onNext,
}: {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  form: any
  onNext: () => void
}) {
  const { register, handleSubmit, formState: { errors } } = form

  return (
    <motion.div
      initial={{ opacity: 0, x: 12 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: -12 }}
    >
      <form onSubmit={handleSubmit(onNext)} className="space-y-4">
        <div>
          <label className="text-xs font-medium text-muted-foreground mb-1.5 block">
            Job URL
          </label>
          <input
            type="url"
            {...register('job_url')}
            placeholder="https://jobs.example.com/..."
            className="field-input w-full text-sm"
            autoFocus
          />
          {errors.job_url && (
            <p className="text-xs text-red-500 mt-1">{String(errors.job_url.message)}</p>
          )}
          <p className="text-[11px] text-muted-foreground/60 mt-1.5">
            Make sure this is a direct job posting URL, not a search results page.
          </p>
        </div>
        <button type="submit" className="btn-tf animate-btn-shine w-full text-sm font-semibold py-2.5">
          Continue
          <ChevronRight className="w-4 h-4 ml-1" />
        </button>
      </form>
    </motion.div>
  )
}

// ── Step: Text ────────────────────────────────────────────────────────────────

function StepText({
  form,
  charCount,
  onNext,
}: {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  form: any
  charCount: number
  onNext: () => void
}) {
  const { register, handleSubmit, formState: { errors } } = form

  return (
    <motion.div
      initial={{ opacity: 0, x: 12 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: -12 }}
    >
      <form onSubmit={handleSubmit(onNext)} className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-xs font-medium text-muted-foreground mb-1.5 block">
              Company
            </label>
            <input
              type="text"
              {...register('company_name')}
              placeholder="Acme Corp"
              className="field-input w-full text-sm"
            />
            {errors.company_name && (
              <p className="text-xs text-red-500 mt-1">{String(errors.company_name.message)}</p>
            )}
          </div>
          <div>
            <label className="text-xs font-medium text-muted-foreground mb-1.5 block">
              Role
            </label>
            <input
              type="text"
              {...register('role')}
              placeholder="Senior Engineer"
              className="field-input w-full text-sm"
            />
            {errors.role && (
              <p className="text-xs text-red-500 mt-1">{String(errors.role.message)}</p>
            )}
          </div>
        </div>
        <div>
          <div className="flex justify-between mb-1.5">
            <label className="text-xs font-medium text-muted-foreground">
              Job Description
            </label>
            <span className={cn(
              'text-[11px]',
              charCount > MAX_TEXT_BYTES * 0.9 ? 'text-amber-500' : 'text-muted-foreground/60'
            )}>
              {charCount.toLocaleString()} / {MAX_TEXT_BYTES.toLocaleString()}
            </span>
          </div>
          <textarea
            {...register('job_text')}
            rows={8}
            placeholder="Paste the full job description here…"
            className="field-input w-full text-sm resize-none"
          />
          {errors.job_text && (
            <p className="text-xs text-red-500 mt-1">{String(errors.job_text.message)}</p>
          )}
        </div>
        <button type="submit" className="btn-tf animate-btn-shine w-full text-sm font-semibold py-2.5">
          Continue
          <ChevronRight className="w-4 h-4 ml-1" />
        </button>
      </form>
    </motion.div>
  )
}

// ── Step: Select Resume ───────────────────────────────────────────────────────

import type { ResumeItem } from '@/lib/types'

function StepSelectResume({
  resumes,
  selected,
  onSelect,
  onNext,
}: {
  resumes: ResumeItem[]
  selected: string
  onSelect: (id: string) => void
  onNext: () => void
}) {
  const completedResumes = resumes.filter((r) => r.extraction_status === 'completed')

  if (resumes.length === 0) {
    return (
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        className="text-center py-8"
      >
        <FileText className="w-10 h-10 text-muted-foreground/40 mx-auto mb-3" />
        <p className="text-sm text-muted-foreground">
          Upload a resume first before adding a job.
        </p>
      </motion.div>
    )
  }

  return (
    <motion.div
      initial={{ opacity: 0, x: 12 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: -12 }}
      className="space-y-4"
    >
      <div className="space-y-2">
        {resumes.map((r) => {
          const ready = r.extraction_status === 'completed'
          return (
            <button
              key={r.id}
              type="button"
              disabled={!ready}
              onClick={() => ready && onSelect(r.id)}
              title={!ready ? 'This resume is still being processed' : undefined}
              className={cn(
                'w-full flex items-center gap-3 p-3.5 rounded-xl border text-left transition-all',
                selected === r.id
                  ? 'border-brand bg-brand/5'
                  : ready
                    ? 'border-border hover:border-border/80 hover:bg-muted/30'
                    : 'border-border opacity-50 cursor-not-allowed'
              )}
            >
              <div className="w-9 h-9 rounded-lg bg-muted border border-border flex items-center justify-center shrink-0">
                <FileText className="w-4 h-4 text-muted-foreground" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-foreground truncate">{r.name}</p>
                <p className="text-[11px] text-muted-foreground">
                  {r.file_format.toUpperCase()} ·{' '}
                  {new Date(r.uploaded_at).toLocaleDateString()}
                </p>
              </div>
              {!ready && (
                <span className="text-[10px] text-amber-500 shrink-0">Processing…</span>
              )}
              {selected === r.id && ready && (
                <CheckCircle2 className="w-4 h-4 text-brand shrink-0" />
              )}
            </button>
          )
        })}
      </div>
      <button
        type="button"
        disabled={!selected || !completedResumes.find((r) => r.id === selected)}
        onClick={onNext}
        className="btn-tf animate-btn-shine w-full text-sm font-semibold py-2.5 disabled:opacity-50 disabled:cursor-not-allowed"
      >
        Analyse Job
      </button>
    </motion.div>
  )
}

// ── Step: Processing ──────────────────────────────────────────────────────────

function StepProcessing({ job }: { job: ApiJob | null }) {
  const stages = [
    { label: 'Job details received', done: true },
    { label: 'Extracting job requirements…', active: !job || job.extraction_status === 'processing' || job.extraction_status === 'pending', done: job?.extraction_status === 'completed' },
    { label: 'Analysing resume alignment…', active: job?.extraction_status === 'completed' && (job.alignment_status === 'processing' || job.alignment_status === 'pending'), done: job?.alignment_status === 'completed' },
    { label: 'Generating tailored resume…', active: job?.alignment_status === 'completed' && !job.pdf_generated_at, done: !!job?.pdf_generated_at },
  ]

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="py-4 space-y-5"
    >
      <div className="text-center mb-2">
        <Loader2 className="w-10 h-10 text-brand mx-auto mb-3 animate-spin" />
        <p className="text-sm font-medium text-foreground">AI pipeline running</p>
        <p className="text-xs text-muted-foreground mt-1">This usually takes 15–30 seconds</p>
      </div>

      <div className="space-y-2.5">
        {stages.map((stage) => (
          <div key={stage.label} className="flex items-center gap-3">
            <div className="w-5 h-5 shrink-0 flex items-center justify-center">
              {stage.done ? (
                <CheckCircle2 className="w-4 h-4 text-emerald-500" />
              ) : stage.active ? (
                <Loader2 className="w-4 h-4 text-brand animate-spin" />
              ) : (
                <div className="w-3 h-3 rounded-full border border-muted-foreground/30" />
              )}
            </div>
            <span className={cn(
              'text-sm',
              stage.done ? 'text-foreground' : stage.active ? 'text-foreground' : 'text-muted-foreground/50'
            )}>
              {stage.label}
            </span>
          </div>
        ))}
      </div>

      <p className="text-[11px] text-muted-foreground/60 text-center">
        You can close this modal — the job will continue processing in the background.
      </p>
    </motion.div>
  )
}

// ── Step: Result ──────────────────────────────────────────────────────────────

const ERROR_MESSAGES: Record<string, { title: string; desc: string }> = {
  INVALID_JOB_INPUT: {
    title: "Couldn't read that page",
    desc: "We couldn't read that page as a job posting. Try pasting the text instead.",
  },
  INSUFFICIENT_JOB_DATA: {
    title: "Job description seems incomplete",
    desc: "The job description seems incomplete. Try pasting more of the page text.",
  },
  RESUME_MISALIGNED: {
    title: "Low alignment",
    desc: "Your resume and this job are quite different. You can still save it to track.",
  },
  DUPLICATE_JOB: {
    title: "Already added",
    desc: "You've already added a job from this URL in the last 24 hours.",
  },
  SCRAPE_FAILED: {
    title: "Couldn't access that URL",
    desc: "We couldn't access that URL. Try pasting the job text instead.",
  },
}

function StepResult({
  job,
  error,
  inputMethod,
  onAddAnother,
  onViewJob,
  onRetryWithText,
}: {
  job: ApiJob | null
  error: { code: string; message: string; match_score?: number } | null
  inputMethod: 'url' | 'text'
  onAddAnother: () => void
  onViewJob: () => void
  onRetryWithText: () => void
}) {
  if (error) {
    const known = ERROR_MESSAGES[error.code]
    const isMisaligned = error.code === 'RESUME_MISALIGNED'
    const needsTextSwitch = ['INVALID_JOB_INPUT', 'SCRAPE_FAILED'].includes(error.code) && inputMethod === 'url'

    return (
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        className="text-center py-4 space-y-4"
      >
        <AlertCircle className={cn('w-12 h-12 mx-auto', isMisaligned ? 'text-amber-500' : 'text-red-500')} />
        <div>
          <p className="text-base font-semibold text-foreground font-heading">
            {known?.title ?? 'Something went wrong'}
          </p>
          {isMisaligned && error.match_score != null && (
            <p className="text-3xl font-bold text-amber-500 font-heading mt-2">
              {error.match_score}%
            </p>
          )}
          <p className={cn(
            'text-sm text-muted-foreground mt-1.5',
            isMisaligned && 'text-left max-h-48 overflow-y-auto'
          )}>
            {isMisaligned ? error.message : (known?.desc ?? error.message)}
          </p>
        </div>
        <div className="flex flex-col gap-2">
          {isMisaligned && job && (
            <button
              type="button"
              onClick={onViewJob}
              className="btn-tf animate-btn-shine w-full text-sm font-semibold py-2.5"
            >
              Save anyway
            </button>
          )}
          {needsTextSwitch && (
            <button
              type="button"
              onClick={onRetryWithText}
              className="btn-tf animate-btn-shine w-full text-sm font-semibold py-2.5"
            >
              Try with text
            </button>
          )}
          <button
            type="button"
            onClick={onAddAnother}
            className="w-full py-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
          >
            Start over
          </button>
        </div>
      </motion.div>
    )
  }

  if (!job) return null

  const score = job.match_score ?? 0
  const scoreLabel =
    score >= 80 ? 'Excellent match' : score >= 60 ? 'Good match' : score >= 40 ? 'Fair match' : 'Low match'
  const scoreColor =
    score >= 70 ? 'text-emerald-500' : score >= 40 ? 'text-amber-500' : 'text-red-500'

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className="text-center py-4 space-y-5"
    >
      <CheckCircle2 className="w-12 h-12 text-emerald-500 mx-auto" />

      <div>
        <p className="text-base font-semibold text-foreground font-heading">Job created!</p>
        <p className="text-sm text-muted-foreground mt-1">
          {job.job_title} at {job.company}
        </p>
      </div>

      {job.match_score !== null && (
        <div className="glass-card p-4 text-center">
          <p className={cn('text-4xl font-bold font-heading', scoreColor)}>
            {score}%
          </p>
          <p className="text-xs text-muted-foreground mt-1">{scoreLabel}</p>
        </div>
      )}

      <div className="flex gap-2">
        <button
          type="button"
          onClick={onViewJob}
          className="btn-tf animate-btn-shine flex-1 text-sm font-semibold py-2.5"
        >
          View Job
        </button>
        <button
          type="button"
          onClick={onAddAnother}
          className="flex-1 py-2 text-sm text-muted-foreground hover:text-foreground border border-border rounded-xl transition-colors"
        >
          Add Another
        </button>
      </div>
    </motion.div>
  )
}
