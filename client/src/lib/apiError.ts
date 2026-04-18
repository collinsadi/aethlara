/**
 * Type guards and extractors for the normalised `ApiError` shape produced
 * by the axios response interceptor (`@/api/client`).
 *
 * Rationale: the interceptor preserves the full server `error.data` payload
 * on every failure. Features that need to react to specific error codes
 * (mismatch modal, API-key CTA, rate limit toasts) use these guards to
 * narrow the error without re-inspecting raw axios internals.
 */
import type { ApiError, MismatchErrorData } from "@/lib/types";

/** True if `error` is a normalised ApiError (not a plain Error). */
export function isApiError(error: unknown): error is ApiError {
  if (typeof error !== "object" || error === null) return false;
  const candidate = error as Record<string, unknown>;
  return (
    typeof candidate.code === "string" &&
    typeof candidate.status === "number" &&
    typeof candidate.message === "string"
  );
}

/** True if the server returned a 422 RESUME_MISALIGNED with usable data. */
export function isMismatchError(error: unknown): error is ApiError & {
  data: MismatchErrorData;
} {
  return (
    isApiError(error) &&
    error.code === "RESUME_MISALIGNED" &&
    error.data !== null &&
    typeof error.data === "object" &&
    "match_score" in error.data
  );
}

/** True if the server returned a 403 API_KEY_REQUIRED. */
export function isApiKeyRequiredError(error: unknown): error is ApiError {
  return isApiError(error) && error.code === "API_KEY_REQUIRED";
}

/** True if the server returned a 504 AI_TIMEOUT. */
export function isAITimeoutError(error: unknown): error is ApiError {
  return isApiError(error) && error.code === "AI_TIMEOUT";
}

/**
 * Extract the typed mismatch payload from an ApiError.
 *
 * Returns `null` if the error does not carry a mismatch payload, if any
 * required field is missing, or if types don't line up. Callers should
 * fall through to their generic error handler in that case.
 */
export function extractMismatchData(
  error: unknown
): MismatchErrorData | null {
  if (!isMismatchError(error)) return null;
  const raw = error.data as Record<string, unknown>;

  const matchScore = raw.match_score;
  if (typeof matchScore !== "number") return null;

  const jobTitle = typeof raw.job_title === "string" ? raw.job_title : "";
  const company = typeof raw.company === "string" ? raw.company : "";
  const reason = typeof raw.reason === "string" ? raw.reason : "";
  const suggestion =
    typeof raw.suggestion === "string" ? raw.suggestion : "";
  const learnMoreUrl =
    typeof raw.learn_more_url === "string" ? raw.learn_more_url : undefined;
  const jobId = typeof raw.job_id === "string" ? raw.job_id : "";

  const gapsValue = raw.gaps;
  const gaps = Array.isArray(gapsValue)
    ? gapsValue.filter((g): g is string => typeof g === "string")
    : [];

  const breakdownValue = raw.match_breakdown;
  const breakdown =
    breakdownValue && typeof breakdownValue === "object"
      ? (breakdownValue as MismatchErrorData["match_breakdown"])
      : null;

  return {
    job_id: jobId,
    job_title: jobTitle,
    company,
    match_score: matchScore,
    match_breakdown: breakdown,
    reason,
    gaps,
    suggestion,
    learn_more_url: learnMoreUrl,
  };
}

/**
 * Friendly message for display in generic error toasts/banners. Always
 * falls back to something human-readable even on unrecognised shapes.
 */
export function apiErrorMessage(error: unknown): string {
  if (isApiError(error)) return error.message;
  if (error instanceof Error) return error.message;
  return "Something went wrong. Please try again.";
}
