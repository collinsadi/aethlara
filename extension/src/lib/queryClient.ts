import { QueryClient } from '@tanstack/react-query'
import { isSignedOutError } from '@/background/api'

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 1000 * 30,
      gcTime: 1000 * 60 * 10,
      // A signed-out device will not recover by retrying; the sign-in screen takes over.
      retry: (failureCount, error) => !isSignedOutError(error) && failureCount < 1,
      refetchOnWindowFocus: true,
    },
    mutations: {
      retry: false,
    },
  },
})
