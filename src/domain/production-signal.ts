import { z } from "zod";

const label = z.string().regex(/^[A-Za-z0-9_.:-]{1,80}$/);
export const ProductionSignalSchema = z.object({
  schemaVersion: z.literal(1),
  signalId: z.string().uuid(),
  observerId: label,
  service: label,
  environment: z.literal("production"),
  ruleId: z.enum(["http_5xx", "redirect_shift", "empty_response_shift", "response_contract", "latency_contract"]),
  ruleVersion: z.literal(1),
  route: label, // Operator-defined label, never a raw URL or user identifier.
  windowStart: z.number().int().nonnegative(),
  windowEnd: z.number().int().nonnegative(),
  sampleCount: z.number().int().min(1).max(100000000),
  violationCount: z.number().int().nonnegative(),
  baselineRate: z.number().min(0).max(1).nullable(),
  observedRate: z.number().min(0).max(1),
  evidence: z.array(z.object({
    status: z.number().int().min(100).max(599),
    bytes: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
    durationMs: z.number().min(0).max(86400000).optional(),
  }).strict()).max(5),
  quality: z.object({ complete: z.boolean(), parsed: z.number().int().nonnegative(), rejected: z.number().int().nonnegative() }).strict(),
}).strict().superRefine((s, ctx) => {
  if (s.windowEnd <= s.windowStart || s.windowEnd - s.windowStart > 3600 || s.violationCount > s.sampleCount ||
      Math.abs(s.observedRate - s.violationCount / s.sampleCount) > 0.000001) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Inconsistent observation window or counts" });
  }
});
export type ProductionSignal = z.infer<typeof ProductionSignalSchema>;
