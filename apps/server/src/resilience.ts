export class CircuitBreaker {
  private failures = 0; private openedAt = 0;
  constructor(private readonly threshold = 4, private readonly resetMs = 30_000) {}
  async run<T>(operation: () => Promise<T>): Promise<T> {
    if (this.openedAt && Date.now() - this.openedAt < this.resetMs) throw new Error("Service temporairement isolé après plusieurs échecs");
    if (this.openedAt) { this.openedAt = 0; this.failures = 0; }
    try { const result = await operation(); this.failures = 0; return result; }
    catch (error) { this.failures += 1; if (this.failures >= this.threshold) this.openedAt = Date.now(); throw error; }
  }
  get state(): "closed" | "open" { return this.openedAt && Date.now() - this.openedAt < this.resetMs ? "open" : "closed"; }
}

export async function fetchWithTimeout(url: string, init: RequestInit = {}, timeoutMs = 12_000): Promise<Response> {
  const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), timeoutMs);
  try { return await fetch(url, { ...init, signal: controller.signal }); } finally { clearTimeout(timer); }
}
