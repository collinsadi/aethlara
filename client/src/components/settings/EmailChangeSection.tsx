import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Mail, ArrowRight, Loader2, CheckCircle2 } from 'lucide-react'
import { OtpInput } from '@/components/OtpInput'
import { useEmailChange } from '@/hooks/useEmailChange'
import { useAuthStore } from '@/stores/authStore'

const emailSchema = z.object({
  new_email: z.string().email('Enter a valid email address'),
})

export function EmailChangeSection() {
  const user = useAuthStore((s) => s.user)
  const clearAuth = useAuthStore((s) => s.clearAuth)
  const { step, pendingEmail, setStep, requestChange, confirmChange, isRequestPending, isConfirmPending, requestError, confirmError } = useEmailChange()
  const [otp, setOtp] = useState(Array(6).fill(''))

  const { register, handleSubmit, formState: { errors } } = useForm({
    resolver: zodResolver(emailSchema),
  })

  const handleRequest = async ({ new_email }: { new_email: string }) => {
    await requestChange(new_email)
  }

  const handleConfirm = async () => {
    const code = otp.join('')
    if (code.length < 6) return
    await confirmChange(code)
  }

  const errorMessage = (err: unknown): string => {
    if (!err) return ''
    const apiErr = err as { response?: { data?: { error?: { message?: string } } } }
    return apiErr?.response?.data?.error?.message ?? 'Something went wrong'
  }

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-base font-semibold text-foreground font-heading">Email & Security</h2>
        <p className="text-sm text-muted-foreground mt-0.5">Change your login email address.</p>
      </div>

      <div className="glass-card p-5">
        <AnimatePresence mode="wait">
          {step === 'idle' && (
            <motion.div
              key="idle"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="space-y-4"
            >
              <div>
                <p className="text-xs font-medium text-muted-foreground mb-1">Current email</p>
                <p className="text-sm text-foreground">{user?.email}</p>
              </div>
              <button
                type="button"
                onClick={() => setStep('enter_email')}
                className="flex items-center gap-2 text-sm text-brand hover:text-brand/80 transition-colors font-medium"
              >
                <Mail className="w-4 h-4" />
                Change email address
                <ArrowRight className="w-3.5 h-3.5" />
              </button>
            </motion.div>
          )}

          {step === 'enter_email' && (
            <motion.div
              key="enter_email"
              initial={{ opacity: 0, x: 12 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -12 }}
              className="space-y-4"
            >
              <p className="text-sm text-muted-foreground">
                Enter your new email address. We'll send a verification code to confirm.
              </p>
              <form onSubmit={handleSubmit(handleRequest)} className="space-y-3">
                <div>
                  <label className="text-xs font-medium text-muted-foreground block mb-1.5">
                    New email address
                  </label>
                  <input
                    type="email"
                    {...register('new_email')}
                    placeholder="you@example.com"
                    autoFocus
                    className="field-input w-full text-sm"
                  />
                  {errors.new_email && (
                    <p className="text-xs text-red-500 mt-1">{errors.new_email.message}</p>
                  )}
                  {requestError && (
                    <p className="text-xs text-red-500 mt-1">{errorMessage(requestError)}</p>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setStep('idle')}
                    disabled={isRequestPending}
                    className="px-4 py-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={isRequestPending}
                    className="btn-tf animate-btn-shine px-5 py-2 text-sm font-semibold disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
                  >
                    {isRequestPending ? (
                      <><Loader2 className="w-4 h-4 animate-spin" /> Sending…</>
                    ) : (
                      'Send code'
                    )}
                  </button>
                </div>
              </form>
            </motion.div>
          )}

          {step === 'enter_otp' && (
            <motion.div
              key="enter_otp"
              initial={{ opacity: 0, x: 12 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -12 }}
              className="space-y-5"
            >
              <div>
                <p className="text-sm font-medium text-foreground">Check your inbox</p>
                <p className="text-sm text-muted-foreground mt-1">
                  We sent a 6-digit code to{' '}
                  <span className="font-medium text-foreground">{pendingEmail}</span>.
                </p>
              </div>

              <OtpInput
                value={otp}
                onChange={setOtp}
                disabled={isConfirmPending}
              />

              {confirmError && (
                <p className="text-xs text-red-500 text-center">{errorMessage(confirmError)}</p>
              )}

              <div className="flex items-center gap-2 justify-center">
                <button
                  type="button"
                  onClick={() => { setOtp(Array(6).fill('')); setStep('enter_email') }}
                  disabled={isConfirmPending}
                  className="px-4 py-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
                >
                  Back
                </button>
                <button
                  type="button"
                  onClick={handleConfirm}
                  disabled={isConfirmPending || otp.join('').length < 6}
                  className="btn-tf animate-btn-shine px-5 py-2 text-sm font-semibold disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
                >
                  {isConfirmPending ? (
                    <><Loader2 className="w-4 h-4 animate-spin" /> Verifying…</>
                  ) : (
                    'Verify & change'
                  )}
                </button>
              </div>
            </motion.div>
          )}

          {step === 'done' && (
            <motion.div
              key="done"
              initial={{ opacity: 0, scale: 0.96 }}
              animate={{ opacity: 1, scale: 1 }}
              className="text-center py-4 space-y-4"
            >
              <CheckCircle2 className="w-10 h-10 text-emerald-500 mx-auto" />
              <div>
                <p className="text-sm font-semibold text-foreground font-heading">Email updated</p>
                <p className="text-sm text-muted-foreground mt-1">
                  Your email has been changed. You'll be signed out now.
                </p>
              </div>
              <button
                type="button"
                onClick={() => clearAuth()}
                className="btn-tf animate-btn-shine px-5 py-2 text-sm font-semibold"
              >
                Sign out
              </button>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  )
}
