import axios, {
  type AxiosError,
  type AxiosRequestConfig,
  type InternalAxiosRequestConfig,
} from "axios";
import type { ApiError, ApiErrorResponse } from "@/lib/types";
import { useAuthStore } from "@/stores/authStore";
import { getRefreshToken, clearAllAuthCookies, setRefreshToken, setSessionFlag } from "@/lib/cookies";

const APP_VERSION = "1.0.0";

export const apiClient = axios.create({
  baseURL: import.meta.env.VITE_API_URL,
  timeout: 15000,
  withCredentials: true,
  headers: {
    "Content-Type": "application/json",
    "X-Client-Version": APP_VERSION,
  },
});

// ── Request interceptor ──────────────────────────────────────────────
apiClient.interceptors.request.use((config: InternalAxiosRequestConfig) => {
  const token = useAuthStore.getState().accessToken;
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  config.headers["X-Request-ID"] = crypto.randomUUID();
  return config;
});

// ── Response interceptor — silent refresh with request queuing ───────
let isRefreshing = false;
let failedQueue: {
  resolve: (token: string) => void;
  reject: (err: unknown) => void;
}[] = [];

function processQueue(error: unknown, token: string | null) {
  failedQueue.forEach((p) => {
    if (token) p.resolve(token);
    else p.reject(error);
  });
  failedQueue = [];
}

function forceLogout() {
  useAuthStore.getState().clearAuth();
  clearAllAuthCookies();
  window.location.href = "/login";
}

apiClient.interceptors.response.use(
  (response) => response,
  async (error: AxiosError<ApiErrorResponse>) => {
    const originalRequest = error.config as InternalAxiosRequestConfig & {
      _retry?: boolean;
      _retry429?: boolean;
    };

    // One retry after global rate limit (burst-heavy first paint)
    if (error.response?.status === 429 && !originalRequest._retry429) {
      originalRequest._retry429 = true;
      const ra = error.response.headers["retry-after"];
      const sec = ra ? Math.min(60, Math.max(1, parseInt(String(ra), 10))) : 2;
      await new Promise((r) => setTimeout(r, sec * 1000));
      return apiClient(originalRequest);
    }

    if (error.response?.status === 401 && !originalRequest._retry) {
      const refreshToken = getRefreshToken();
      if (!refreshToken) {
        forceLogout();
        return Promise.reject(normalizeError(error));
      }

      if (isRefreshing) {
        return new Promise<string>((resolve, reject) => {
          failedQueue.push({ resolve, reject });
        }).then((newToken) => {
          originalRequest.headers.Authorization = `Bearer ${newToken}`;
          return apiClient(originalRequest);
        });
      }

      originalRequest._retry = true;
      isRefreshing = true;

      try {
        const res = await axios.post(
          `${import.meta.env.VITE_API_URL}/auth/refresh`,
          { refresh_token: refreshToken },
          { withCredentials: true }
        );
        const { access_token, refresh_token } = res.data.data;
        useAuthStore.getState().setAccessToken(access_token);
        setRefreshToken(refresh_token);
        setSessionFlag();
        processQueue(null, access_token);
        originalRequest.headers.Authorization = `Bearer ${access_token}`;
        return apiClient(originalRequest);
      } catch (refreshError) {
        processQueue(refreshError, null);
        forceLogout();
        return Promise.reject(normalizeError(error));
      } finally {
        isRefreshing = false;
      }
    }

    if (error.response?.status === 403) {
      // Could redirect to /403 if you have a forbidden page
    }

    return Promise.reject(normalizeError(error));
  }
);

// ── Error normalisation ──────────────────────────────────────────────
//
// CRITICAL: this function MUST preserve the full `error.data` payload from
// the server, verbatim. Downstream features (mismatch modal, API-key CTA,
// rate limit toasts) rely on structured data and type guards in
// `@/lib/apiError`. Never flatten a server error into a plain `Error` — a
// lost `data` field breaks the mismatch modal silently.
function normalizeError(error: AxiosError<ApiErrorResponse>): ApiError {
  const requestId =
    (error.response?.headers?.["x-request-id"] as string | undefined) ??
    (error.config?.headers?.["X-Request-ID"] as string) ??
    undefined;

  const serverErr = error.response?.data?.error;

  if (serverErr) {
    const retryAfterHeader = error.response?.headers?.["retry-after"];
    const retryAfter =
      typeof retryAfterHeader === "string" && retryAfterHeader
        ? parseInt(retryAfterHeader, 10)
        : undefined;

    return {
      code: serverErr.code,
      message: serverErr.message,
      status: error.response?.status ?? 0,
      data: serverErr.data ?? null,
      requestId,
      ...(Number.isFinite(retryAfter) ? { retryAfter } : {}),
    };
  }

  if (error.response?.status === 429) {
    const retryAfter = error.response.headers["retry-after"];
    const retryAfterNum =
      typeof retryAfter === "string" && retryAfter
        ? parseInt(retryAfter, 10)
        : undefined;
    return {
      code: "RATE_LIMITED",
      message: retryAfter
        ? `Too many requests. Please wait ${retryAfter} seconds.`
        : "Too many requests. Please wait a moment and try again.",
      status: 429,
      data: null,
      requestId,
      ...(Number.isFinite(retryAfterNum) ? { retryAfter: retryAfterNum } : {}),
    };
  }

  if (error.code === "ECONNABORTED" || error.message === "Network Error") {
    return {
      code: "NETWORK_ERROR",
      message: "Unable to reach the server. Please check your connection.",
      status: 0,
      data: null,
      requestId,
    };
  }

  if (!error.response) {
    return {
      code: "NETWORK_ERROR",
      message: "Unable to reach the server. Please check your connection.",
      status: 0,
      data: null,
      requestId,
    };
  }

  return {
    code: "UNKNOWN_ERROR",
    message: "An unexpected error occurred. Please try again.",
    status: error.response?.status ?? 0,
    data: null,
    requestId,
  };
}

/** Type-safe GET helper */
export async function apiGet<T>(
  url: string,
  config?: AxiosRequestConfig
): Promise<T> {
  const res = await apiClient.get<{ data: T }>(url, config);
  return res.data.data;
}

/** Type-safe POST helper */
export async function apiPost<T>(
  url: string,
  data?: unknown,
  config?: AxiosRequestConfig
): Promise<T> {
  const res = await apiClient.post<{ data: T }>(url, data, config);
  return res.data.data;
}

/** Type-safe DELETE helper */
export async function apiDelete<T>(
  url: string,
  config?: AxiosRequestConfig
): Promise<T> {
  const res = await apiClient.delete<{ data: T }>(url, config);
  return res.data.data;
}
