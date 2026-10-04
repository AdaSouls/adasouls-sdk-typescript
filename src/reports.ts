import type { ReportedMetrics, ReportSubject } from "./types.js";

const count = (name: string, n: number): string => {
  if (!Number.isSafeInteger(n) || n < 0) throw new TypeError(`${name} must be a non-negative integer`);
  return String(n);
};

/** The request body for POST /agents/:id/reports. */
export function reportBody(subject: ReportSubject, m: ReportedMetrics) {
  const metrics: { metric: string; value: string; unit?: string }[] = [];
  if (m.computeCost !== undefined) metrics.push({ metric: "compute_cost", value: m.computeCost.amount, unit: m.computeCost.currency });
  if (m.model !== undefined) metrics.push({ metric: "model", value: m.model });
  if (m.inputTokens !== undefined) metrics.push({ metric: "input_tokens", value: count("inputTokens", m.inputTokens) });
  if (m.outputTokens !== undefined) metrics.push({ metric: "output_tokens", value: count("outputTokens", m.outputTokens) });
  if (m.durationMs !== undefined) metrics.push({ metric: "duration_ms", value: count("durationMs", m.durationMs) });
  if (metrics.length === 0) throw new TypeError("report at least one metric");
  return "action" in subject ? { about: "action", ref: subject.action, metrics } : { about: "job", ref: subject.job, metrics };
}
