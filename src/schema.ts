import { z } from "zod";

export const RISK_ORDER = [
  "NONE",
  "VERY_LOW",
  "LOW",
  "MEDIUM",
  "HIGH",
  "CRITICAL",
] as const;

export type Risk = (typeof RISK_ORDER)[number];

const SeveritySchema = z.enum(["info", "low", "medium", "high", "critical"]);

/**
 * Line numbers from the review API are advisory pointers, not contract-critical
 * data. The API may emit `line: 0` (or other non-positive values) for a finding
 * that is not tied to a specific line; a strict `positive()` here would reject
 * the whole response on a single such finding — exactly the crash seen on
 * paybot-sdk PR #57.
 *
 * Models commonly emit `line: 0` (or a float, or a negative) when they cannot
 * map a finding to a concrete line. We must NOT lose the finding over an
 * unreliable pointer, so we coerce: any value that is not a usable 1-indexed
 * integer line is dropped (the field becomes `undefined`). Downstream
 * (`report.ts findingsToAnnotations`) already skips findings without a `line`,
 * so dropping is the correct, lossless-for-the-issue behavior.
 *
 * @returns the clamped line (>= 1, integer) or `undefined` to drop the field.
 */
function coerceLine(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) return undefined;
  const asInt = Math.trunc(value);
  return asInt >= 1 ? asInt : undefined;
}

const LineSchema = z.preprocess(coerceLine, z.number().int().positive().optional());

export const FindingSchema = z.object({
  severity: SeveritySchema,
  file: z.string().min(1).optional(),
  line: LineSchema,
  issue: z.string().min(1).max(1000),
  suggestion: z.string().min(1).max(2000),
});

export const ReviewResponseSchema = z.object({
  conclusion: z.enum(["success", "failure", "neutral"]),
  reason: z.string().min(1).max(1000),
  summary: z.string().min(1).max(4000).optional(),
  maxRisk: z.enum(RISK_ORDER).optional(),
  findings: z.array(FindingSchema).default([]),
  reportUrl: z.string().url().optional(),
  metadata: z.record(z.unknown()).optional(),
});

export type Finding = z.infer<typeof FindingSchema>;
export type ReviewResponse = z.infer<typeof ReviewResponseSchema>;

export function countBlockingFindings(findings: Finding[]): number {
  return findings.filter((finding) =>
    ["medium", "high", "critical"].includes(finding.severity),
  ).length;
}
