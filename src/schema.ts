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

export const FindingSchema = z.object({
  severity: SeveritySchema,
  file: z.string().min(1).optional(),
  line: z.number().int().positive().optional(),
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
