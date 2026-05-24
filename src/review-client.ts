import { ReviewResponseSchema, type ReviewResponse } from "./schema";
import type { ReviewRequest } from "./pr-context";

interface RequestReviewArgs {
  apiUrl: string;
  apiKey: string;
  timeoutMs: number;
  request: ReviewRequest;
}

export async function requestReview(
  args: RequestReviewArgs,
): Promise<ReviewResponse> {
  const { apiUrl, apiKey, timeoutMs, request } = args;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(apiUrl, {
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

    const bodyText = await response.text();
    if (!response.ok) {
      const detail = bodyText ? ` Response: ${bodyText.slice(0, 500)}` : "";
      throw new Error(
        `Review API returned HTTP ${response.status}.${detail}`,
      );
    }

    let parsed: unknown;
    try {
      parsed = bodyText ? JSON.parse(bodyText) : {};
    } catch {
      throw new Error("Review API returned invalid JSON.");
    }

    return ReviewResponseSchema.parse(parsed);
  } finally {
    clearTimeout(timer);
  }
}
