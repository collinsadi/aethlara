/**
 * Token lifecycle utilities.
 *
 * TOKEN LIFECYCLE:
 * 1. Created:   POST /auth/verify-otp returns { access_token, refresh_token }
 * 2. Stored:    access_token → in-memory Zustand store (never persisted)
 *               refresh_token → js-cookie (__rt) with sameSite=strict, secure in prod
 * 3. Used:      access_token attached via Authorization header on every API request
 * 4. Refreshed: on 401, POST /auth/refresh with refresh_token → new pair
 * 5. Expired:   refresh failure → full logout, all stores and cookies cleared
 *
 * Access tokens are JWTs (HS256) with { sub, uid, iat, exp, jti }.
 * Refresh tokens are opaque hex strings (64 chars); the server stores only their SHA-256 hash.
 */

interface JWTPayload {
  sub: string;
  uid: string;
  iat: number;
  exp: number;
  jti: string;
}

export function parseAccessToken(token: string): JWTPayload | null {
  try {
    const parts = token.split(".");
    if (parts.length !== 3) return null;
    const payload = JSON.parse(atob(parts[1])) as JWTPayload;
    return payload;
  } catch {
    return null;
  }
}

export function isTokenExpired(token: string, bufferSeconds = 30): boolean {
  const payload = parseAccessToken(token);
  if (!payload) return true;
  const nowSeconds = Math.floor(Date.now() / 1000);
  return payload.exp - bufferSeconds <= nowSeconds;
}

export function getTokenUserId(token: string): string | null {
  const payload = parseAccessToken(token);
  return payload?.uid ?? null;
}
