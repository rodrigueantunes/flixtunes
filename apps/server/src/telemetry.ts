const requestDurations: number[] = [];
const statuses = new Map<number, number>();
let totalRequests = 0; let totalErrors = 0;

export function recordRequest(durationMs: number, statusCode: number): void {
  totalRequests += 1; if (statusCode >= 500) totalErrors += 1;
  statuses.set(statusCode, (statuses.get(statusCode) ?? 0) + 1);
  requestDurations.push(durationMs); if (requestDurations.length > 2000) requestDurations.splice(0, requestDurations.length - 2000);
}

function percentile(values: number[], ratio: number): number {
  if (!values.length) return 0; const sorted = [...values].sort((a, b) => a - b);
  return Math.round((sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * ratio))] ?? 0) * 100) / 100;
}

export function telemetrySnapshot() {
  return { requests: totalRequests, serverErrors: totalErrors, errorRate: totalRequests ? totalErrors / totalRequests : 0,
    latencyMs: { p50: percentile(requestDurations, .5), p95: percentile(requestDurations, .95), p99: percentile(requestDurations, .99) },
    statuses: Object.fromEntries(statuses), sampledRequests: requestDurations.length };
}
