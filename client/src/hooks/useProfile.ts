import { useMutation, useQueryClient } from '@tanstack/react-query'
import { queryKeys } from '@/lib/queryKeys'
import { updateProfileApi } from '@/api/settings'
import { useAuthStore } from '@/stores/authStore'

export function useUpdateProfile() {
  const qc = useQueryClient()
  const setUser = useAuthStore((s) => s.setUser)

  return useMutation({
    mutationFn: (fullName: string) => updateProfileApi(fullName),
    onSuccess: (data) => {
      // Update the in-memory user so the nav shows the new name immediately.
      const current = useAuthStore.getState().user
      if (current) {
        setUser({ ...current, full_name: data.full_name })
      }
      qc.invalidateQueries({ queryKey: queryKeys.user.me() })
      qc.invalidateQueries({ queryKey: queryKeys.settings.profile() })
    },
  })
}
