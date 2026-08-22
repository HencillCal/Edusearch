import type { AIProviderAdapter, ChatRequest, ChatResult, ModelInfo, ProviderConfig, ProviderHealth } from "../types.js";
import { KeyPool } from "../key-pool.js";

// David Cyril APIs — no authentication required
// Docs: https://apis.davidcyril.name.ng/docs
// POST /ai/deepseek-v3  body:{text,systemPrompt,sessionId}  response:{success,result,timestamp}
export class DavidCyrilAdapter implements AIProviderAdapter {
  readonly config: ProviderConfig;
  private pool: KeyPool;
  constructor(config: ProviderConfig, pool: KeyPool) { this.config = config; this.pool = pool; }
  private base() { return this.config.baseUrl.replace(/\/$/, ""); }

  async health(): Promise<ProviderHealth> {
    const start = Date.now();
    try {
      const res = await fetch(`${this.base()}/ai/deepseek-v3`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text: "ping", systemPrompt: "Reply ok", sessionId: "healthcheck" }),
        signal: AbortSignal.timeout(10_000),
      });
      return { providerId: this.config.id, status: res.ok ? "connected" : "degraded", latencyMs: Date.now() - start, keyCount: 0, healthyKeyCount: 0, checkedAt: Date.now() };
    } catch (err) {
      return { providerId: this.config.id, status: "unreachable", latencyMs: Date.now() - start, keyCount: 0, healthyKeyCount: 0, message: err instanceof Error ? err.message : String(err), checkedAt: Date.now() };
    }
  }

  async listModels(): Promise<ModelInfo[]> {
    return [{ modelId: "deepseek-v3", displayName: "DeepSeek V3 (David Cyril)", capabilities: ["chat"] }];
  }

  async chat(req: ChatRequest): Promise<ChatResult> {
    const systemMsg = req.messages.find((m) => m.role === "system")?.content ?? "";
    const userMsg = req.messages.filter((m) => m.role !== "system").map((m) => m.content).join("\n");
    const start = Date.now();
    const res = await fetch(`${this.base()}/ai/deepseek-v3`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text: userMsg, systemPrompt: systemMsg, sessionId: "edusearch" }),
      signal: AbortSignal.timeout(req.timeoutMs ?? 30_000),
    });
    const durationMs = Date.now() - start;
    if (!res.ok) throw new Error(`davidcyril: HTTP ${res.status}`);
    const payload = (await res.json()) as { success?: boolean; result?: string };
    if (!payload.success) throw new Error("davidcyril: success=false");
    return { content: String(payload.result ?? ""), model: "deepseek-v3", providerId: this.config.id, keyIndex: -1, durationMs };
  }
}