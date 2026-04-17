import { useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { requestEmailChangeApi, confirmEmailChangeApi } from '@/api/settings'

export type EmailChangeStep = 'idle' | 'enter_email' | 'enter_otp' | 'done'

export function useEmailChange() {
  const [step, setStep] = useState<EmailChangeStep>('idle')
  const [pendingEmail, setPendingEmail] = useState('')

  const requestMutation = useMutation({
    mutationFn: (newEmail: string) => requestEmailChangeApi(newEmail),
    onSuccess: (_data, newEmail) => {
      setPendingEmail(newEmail)
      setStep('enter_otp')
    },
  })

  const confirmMutation = useMutation({
    mutationFn: (otp: string) => confirmEmailChangeApi(pendingEmail, otp),
    onSuccess: () => {
      setStep('done')
    },
  })

  return {
    step,
    pendingEmail,
    setStep,
    requestChange: (email: string) => requestMutation.mutateAsync(email),
    confirmChange: (otp: string) => confirmMutation.mutateAsync(otp),
    isRequestPending: requestMutation.isPending,
    isConfirmPending: confirmMutation.isPending,
    requestError: requestMutation.error,
    confirmError: confirmMutation.error,
  }
}
