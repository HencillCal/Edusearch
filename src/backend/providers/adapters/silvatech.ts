import type { AIProviderAdapter, ChatRequest, ChatResult, ModelInfo, ProviderConfig, ProviderHealth } from "../types.js";
import { KeyPool } from "../key-pool.js";

// SilvaTech Nexus — no auth, Pollinations.ai proxy (unverified contract)
export class SilvaTechAdapter implements AIProviderAdapter {
  readonly config: ProviderConfig;
  private pool: KeyPool;
  constructor(config: ProviderConfig, pool: KeyPool) { this.config = config; this.pool = pool; }
  private base() { return this.config.baseUrl.replace(/\/$/, ""); }

  async health(): Promise<ProviderHealth> {
    const start = Date.now();
    try {
      const res = await fetch(`${this.base()}/ai`, { signal: AbortSignal.timeout(8_000) });
      return { providerId: this.config.id, status: res.ok ? "connected" : "degraded", latencyMs: Date.now() - start, keyCount: 0, healthyKeyCount: 0, message: "No auth — Pollinations proxy", checkedAt: Date.now() };
    } catch (err) {
      return { providerId: this.config.id, status: "unreachable", latencyMs: Date.now() - start, keyCount: 0, healthyKeyCount: 0, message: err instanceof Error ? err.message : String(err), checkedAt: Date.now() };
    }
  }

  async listModels(): Promise<ModelInfo[]> {
    return [{ modelId: "silvatech-blackbox", displayName: "Blackbox AI (SilvaTech)", capabilities: ["chat"] }];
  }

  async chat(req: ChatRequest): Promise<ChatResult> {
    const userMsg = req.messages.filter((m) => m.role !== "system").map((m) => m.content).join(" ");
    const start = Date.now();
    const url = `${this.base()}/api/ai/blackbox?q=${encodeURIComponent(userMsg)}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(req.timeoutMs ?? 30_000) });
    const durationMs = Date.now() - start;
    if (!res.ok) throw new Error(`silvatech: HTTP ${res.status}`);
    const text = await res.text();
    return { content: text, model: "silvatech-blackbox", providerId: this.config.id, keyIndex: -1, durationMs };
  }
}