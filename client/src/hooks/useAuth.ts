/**
 * Central auth hook exposing signup, login, OTP verification, logout, and session state.
 *
 * All auth mutations go through this hook. Token storage is handled internally
 * (access token in Zustand memory store, refresh token in js-cookie).
 */
import { useCallback, useEffect } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { useAuthStore } from "@/stores/authStore";
import {
  signupApi,
  loginApi,
  verifyOtpApi,
  logoutApi,
  refreshTokenApi,
  getMeApi,
} from "@/api/auth";
import {
  setRefreshToken,
  getRefreshToken,
  clearAllAuthCookies,
  setSessionFlag,
  hasSessionFlag,
} from "@/lib/cookies";
import { queryClient } from "@/lib/queryClient";
import type { ApiError, User } from "@/lib/types";

/** Runs once per page load — not per useAuth() caller (avoids duplicate refresh/me storms). */
let authHydrationStarted = false;

export interface UseAuth {
  user: User | null;
  isAuthenticated: boolean;
  isInitialising: boolean;
  signup: (fullName: string, email: string) => Promise<void>;
  login: (email: string) => Promise<void>;
  verifyOtp: (
    email: string,
    otp: string,
    type: "signup" | "login"
  ) => Promise<void>;
  logout: () => Promise<void>;
  refreshToken: () => Promise<void>;
}

export function useAuth(): UseAuth {
  const store = useAuthStore();
  const navigate = useNavigate();
  const location = useLocation();

  // ── Silent auth initialisation on app load (single flight) ──────
  useEffect(() => {
    if (authHydrationStarted) return;
    authHydrationStarted = true;

    void (async () => {
      if (!hasSessionFlag()) {
        store.setInitialising(false);
        return;
      }

      const rt = getRefreshToken();
      if (!rt) {
        clearAllAuthCookies();
        store.setInitialising(false);
        return;
      }

      try {
        const tokens = await refreshTokenApi(rt);
        store.setAccessToken(tokens.access_token);
        setRefreshToken(tokens.refresh_token);
        setSessionFlag();

        const user = await getMeApi();
        store.setSession(tokens.access_token, user);
      } catch {
        clearAllAuthCookies();
        store.clearAuth();
      } finally {
        store.setInitialising(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const signup = useCallback(async (fullName: string, email: string) => {
    await signupApi(fullName, email);
  }, []);

  const login = useCallback(async (email: string) => {
    await loginApi(email);
  }, []);

  const verifyOtp = useCallback(
    async (email: string, otp: string, type: "signup" | "login") => {
      const data = await verifyOtpApi(email, otp, type);

      store.setSession(data.access_token, data.user);
      setRefreshToken(data.refresh_token);
      setSessionFlag();

      queryClient.clear();

      const from =
        (location.state as { from?: { pathname: string } })?.from?.pathname ??
        "/dashboard";
      navigate(from, { replace: true });
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [navigate, location]
  );

  const logout = useCallback(async () => {
    const rt = getRefreshToken();
    try {
      if (rt) await logoutApi(rt);
    } catch {
      // best effort
    }
    store.clearAuth();
    clearAllAuthCookies();
    queryClient.clear();
    navigate("/login", { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [navigate]);

  const refreshTokenFn = useCallback(async () => {
    const rt = getRefreshToken();
    if (!rt) throw new Error("No refresh token available");

    try {
      const tokens = await refreshTokenApi(rt);
      store.setAccessToken(tokens.access_token);
      setRefreshToken(tokens.refresh_token);
      setSessionFlag();
    } catch (err) {
      store.clearAuth();
      clearAllAuthCookies();
      queryClient.clear();
      throw err as ApiError;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return {
    user: store.user,
    isAuthenticated: store.isAuthenticated,
    isInitialising: store.isInitialising,
    signup,
    login,
    verifyOtp,
    logout,
    refreshToken: refreshTokenFn,
  };
}
