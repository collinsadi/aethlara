import { QueryClient } from "@tanstack/react-query";
import type { ApiError } from "@/lib/types";

const NO_RETRY_STATUSES = [401, 403, 404, 422];

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 1000 * 60 * 5,
      gcTime: 1000 * 60 * 10,
      retry: (failureCount, error) => {
        const status = (error as ApiError).status;
        if (NO_RETRY_STATUSES.includes(status)) return false;
        return failureCount < 2;
      },
      refetchOnWindowFocus: false,
    },
    mutations: {
      retry: false,
    },
  },
});
