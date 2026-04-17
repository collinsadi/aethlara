/**
 * Auth API calls.
 *
 * POST /auth/signup     → { message }  (always same response)
 * POST /auth/login      → { message }  (always same response)
 * POST /auth/verify-otp → { data: TokenPairResponse }
 * POST /auth/refresh    → { data: { access_token, refresh_token, expires_in } }
 * POST /auth/logout     → { message }
 */
import { apiClient } from "@/api/client";
import type { ApiSuccessResponse, TokenPairResponse, User } from "@/lib/types";

export async function signupApi(fullName: string, email: string) {
  const res = await apiClient.post<ApiSuccessResponse>("/auth/signup", {
    full_name: fullName,
    email,
  });
  return res.data;
}

export async function loginApi(email: string) {
  const res = await apiClient.post<ApiSuccessResponse>("/auth/login", {
    email,
  });
  return res.data;
}

export async function verifyOtpApi(
  email: string,
  otp: string,
  type: "signup" | "login"
) {
  const res = await apiClient.post<ApiSuccessResponse<TokenPairResponse>>(
    "/auth/verify-otp",
    { email, otp, type }
  );
  return res.data.data!;
}

export async function refreshTokenApi(refreshToken: string) {
  const res = await apiClient.post<
    ApiSuccessResponse<{
      access_token: string;
      refresh_token: string;
      expires_in: number;
    }>
  >("/auth/refresh", { refresh_token: refreshToken });
  return res.data.data!;
}

export async function logoutApi(refreshToken: string) {
  const res = await apiClient.post<ApiSuccessResponse>("/auth/logout", {
    refresh_token: refreshToken,
  });
  return res.data;
}

export async function getMeApi() {
  const res = await apiClient.get<ApiSuccessResponse<User>>("/user/me");
  return res.data.data!;
}
