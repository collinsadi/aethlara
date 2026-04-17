import { create } from "zustand";
import type { User } from "@/lib/types";

interface AuthState {
  accessToken: string | null;
  user: User | null;
  isAuthenticated: boolean;
  isInitialising: boolean;

  setAccessToken: (token: string) => void;
  setUser: (user: User) => void;
  setSession: (token: string, user: User) => void;
  clearAuth: () => void;
  setInitialising: (v: boolean) => void;
}

export const useAuthStore = create<AuthState>((set) => ({
  accessToken: null,
  user: null,
  isAuthenticated: false,
  isInitialising: true,

  setAccessToken: (token) => set({ accessToken: token }),
  setUser: (user) => set({ user }),
  setSession: (token, user) =>
    set({ accessToken: token, user, isAuthenticated: true }),
  clearAuth: () =>
    set({
      accessToken: null,
      user: null,
      isAuthenticated: false,
    }),
  setInitialising: (v) => set({ isInitialising: v }),
}));
