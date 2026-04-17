/**
 * Centralised cookie management for session tokens.
 *
 * SECURITY NOTES:
 * - Access tokens are NEVER stored here — they live only in JS memory (Zustand store).
 * - Refresh tokens are stored in a js-cookie entry because the Go backend does not
 *   set HttpOnly cookies directly (it returns tokens in JSON). This is a known trade-off:
 *   an XSS attack could read the cookie. HttpOnly server-set cookies are preferred when
 *   the backend supports them.
 * - Cookie keys are deliberately short and non-descriptive to avoid telegraphing their
 *   purpose to a casual inspector.
 * - sameSite: "strict" mitigates CSRF.
 * - secure: true in production ensures cookies only travel over HTTPS.
 * - No PII is ever stored in cookies.
 */
import Cookies from "js-cookie";

const COOKIE_CONFIG: Cookies.CookieAttributes = {
  secure: import.meta.env.PROD,
  sameSite: "strict" as const,
  expires: 30,
  path: "/",
};

const COOKIE_KEYS = {
  REFRESH_TOKEN: "__rt",
  SESSION_FLAG: "__sf",
} as const;

export function setRefreshToken(token: string) {
  Cookies.set(COOKIE_KEYS.REFRESH_TOKEN, token, COOKIE_CONFIG);
}

export function getRefreshToken(): string | undefined {
  return Cookies.get(COOKIE_KEYS.REFRESH_TOKEN);
}

export function clearRefreshToken() {
  Cookies.remove(COOKIE_KEYS.REFRESH_TOKEN, { path: "/" });
}

export function setSessionFlag() {
  Cookies.set(COOKIE_KEYS.SESSION_FLAG, "1", COOKIE_CONFIG);
}

export function hasSessionFlag(): boolean {
  return !!Cookies.get(COOKIE_KEYS.SESSION_FLAG);
}

export function clearSessionFlag() {
  Cookies.remove(COOKIE_KEYS.SESSION_FLAG, { path: "/" });
}

export function clearAllAuthCookies() {
  clearRefreshToken();
  clearSessionFlag();
}
