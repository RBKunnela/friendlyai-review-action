import { ReviewResponseSchema, type ReviewResponse } from "./schema";
import type { ReviewRequest } from "./pr-context";

interface RequestReviewArgs {
  apiUrl: string;
  apiKey: string;
  timeoutMs: number;
  request: ReviewRequest;
}

/**
 * Why the review call became unavailable. Drives the NEUTRAL check title so the
 * maintainer sees *why* the reviewer abstained instead of a generic red crash.
 */
export type ReviewUnavailableKind =
  | "credits" // 402 / 429 / quota / insufficient_quota — out of LLM credits
  | "timeout" // request aborted by our timeout, or transport abort
  | "upstream" // 5xx or other non-2xx that is not a credit signal
  | "malformed"; // 2xx but the body could not be parsed/coerced into a verdict

/**
 * Discriminated result of a review attempt.
 *
 * `ok: true`  → a real verdict was produced (may itself be success/neutral/failure).
 * `ok: false` → the reviewer could not produce a trustworthy verdict; the caller
 *               fails OPEN to a neutral check. `kind` explains why.
 */
export type ReviewResult =
  | { ok: true; response: ReviewResponse }
  | { ok: false; kind: ReviewUnavailableKind; message: string };

/**
 * Heuristic: does this HTTP status + body look like LLM credit/quota exhaustion?
 *
 * 402 (payment required) and 429 (too many requests / quota) are the strong
 * signals; we also sniff the body for the common provider quota phrases because
 * some gateways wrap quota errors in a 500. Kept deliberately broad — a false
 * "credits" label is harmless (still NEUTRAL), it only changes the message.
 */
function looksLikeCreditExhaustion(status: number, bodyText: string): boolean {
  if (status === 402 || status === 429) return true;
  const haystack = bodyText.toLowerCase();
  return (
    haystack.includes("insufficient_quota") ||
    haystack.includes("out of credits") ||
    haystack.includes("quota") ||
    haystack.includes("billing") ||
    haystack.includes("rate limit") ||
    haystack.includes("rate_limit")
  );
}

function isAbortError(err: unknown): boolean {
  return (
    err instanceof Error &&
    (err.name === "AbortError" || /abort/i.test(err.message))
  );
}

/**
 * Calls the private review API and returns a typed result.
 *
 * This function NEVER throws for reviewer-side problems (HTTP errors, timeouts,
 * malformed/degraded bodies). It only surfaces those as `ok: false` so the
 * action can fail OPEN to a neutral check rather than crashing the step.
 *
 * @param args - apiUrl, apiKey, timeoutMs and the prepared review request.
 * @returns A {@link ReviewResult}: a parsed verdict, or a classified unavailable reason.
 */
export async function requestReview(
  args: RequestReviewArgs,
): Promise<ReviewResult> {
  const { apiUrl, apiKey, timeoutMs, request } = args;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    let response: Response;
    try {
      response = await fetch(apiUrl, {
        method: "POST",
        headers: {
          Accept: "application/json",
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
          "User-Agent": "friendlyai-review-action",
        },
        body: JSON.stringify(request),
        signal: controller.signal,
      });
    } catch (err) {
      // fetch rejected: timeout/abort, DNS, connection reset, etc.
      if (isAbortError(err)) {
        return {
          ok: false,
          kind: "timeout",
          message: `Review API request timed out after ${timeoutMs}ms.`,
        };
      }
      const msg = err instanceof Error ? err.message : String(err);
      return { ok: false, kind: "upstream", message: `Review API request failed: ${msg}` };
    }

    const bodyText = await response.text();

    if (!response.ok) {
      const detail = bodyText ? ` Response: ${bodyText.slice(0, 500)}` : "";
      const message = `Review API returned HTTP ${response.status}.${detail}`;
      if (looksLikeCreditExhaustion(response.status, bodyText)) {
        return { ok: false, kind: "credits", message };
      }
      return { ok: false, kind: "upstream", message };
    }

    let parsed: unknown;
    try {
      parsed = bodyText ? JSON.parse(bodyText) : {};
    } catch {
      return {
        ok: false,
        kind: "malformed",
        message: "Review API returned a 2xx response with invalid JSON.",
      };
    }

    const result = ReviewResponseSchema.safeParse(parsed);
    if (!result.success) {
      return {
        ok: false,
        kind: "malformed",
        message: `Review API response failed schema validation: ${result.error.message}`,
      };
    }

    return { ok: true, response: result.data };
  } finally {
    clearTimeout(timer);
  }
}
