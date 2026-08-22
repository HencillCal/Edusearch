import type {
  AIProviderAdapter,
  ChatRequest,
  ChatResult,
  ModelInfo,
  ProviderConfig,
  ProviderHealth,
} from "../types.js";
import { KeyPool } from "../key-pool.js";

// Generic OpenAI-compatible adapter.
// Used for: Groq (gsk_...), OpenAI (sk-...), Gemini (AIza...), NVIDIA NIM (nvapi-...), custom.
export class OpenAICompatAdapter implements AIProviderAdapter {
  readonly config: ProviderConfig;
  private pool: KeyPool;

  constructor(config: ProviderConfig, pool: KeyPool) {
    this.config = config;
    this.pool = pool;
  }

  private base() {
    return this.config.baseUrl.replace(/\/$/, "");
  }

  private authHeaders(key: string): Record<string, string> {
    return { authorization: `Bearer ${key}` };
  }

  async health(): Promise<ProviderHealth> {
    const summary = this.pool.summary();
    if (!summary.keyCount && !this.config.noAuth) {
      return {
        providerId: this.config.id,
        status: "not_configured",
        keyCount: 0,
        healthyKeyCount: 0,
        checkedAt: Date.now(),
      };
    }
    const start = Date.now();
    try {
      const kv = this.config.noAuth ? null : this.pool.nextKey();
      if (!kv && !this.config.noAuth) {
        return {
          providerId: this.config.id,
          status: "invalid_key",
          keyCount: summary.keyCount,
          healthyKeyCount: 0,
          message: "All keys exhausted or invalid",
          checkedAt: Date.now(),
        };
      }
      const headers: Record<string, string> = { "content-type": "application/json" };
      if (kv) Object.assign(headers, this.authHeaders(kv.value));
      const url = `${this.base()}${this.config.modelsPath ?? "/models"}`;
      const res = await fetch(url, { headers, signal: AbortSignal.timeout(10_000) });
      const latencyMs = Date.now() - start;
      if (kv) this.pool.markResult(kv.index, res.status, latencyMs);
      const status = res.ok
        ? "connected"
        : res.status === 429
        ? "rate_limited"
        : res.status === 401 || res.status === 403
        ? "invalid_key"
        : "degraded";
      return {
        providerId: this.config.id,
        status,
        latencyMs,
        keyCount: summary.keyCount,
        healthyKeyCount: this.pool.healthyCount,
        checkedAt: Date.now(),
      };
    } catch (err) {
      return {
        providerId: this.config.id,
        status: "unreachable",
        latencyMs: Date.now() - start,
        keyCount: summary.keyCount,
        healthyKeyCount: this.pool.healthyCount,
        message: err instanceof Error ? err.message : String(err),
        checkedAt: Date.now(),
      };
    }
  }

  async listModels(): Promise<ModelInfo[]> {
    const kv = this.config.noAuth ? null : this.pool.nextKey();
    const headers: Record<string, string> = {};
    if (kv) Object.assign(headers, this.authHeaders(kv.value));
    const url = `${this.base()}${this.config.modelsPath ?? "/models"}`;
    try {
      const res = await fetch(url, { headers, signal: AbortSignal.timeout(15_000) });
      if (!res.ok) return [];
      const payload = (await res.json()) as {
        data?: Array<{ id: string; owned_by?: string }>;
      };
      return (payload.data ?? []).map((m) => ({
        modelId: m.id,
        displayName: m.id,
        capabilities: ["chat" as const],
      }));
    } catch {
      return [];
    }
  }

  async chat(req: ChatRequest): Promise<ChatResult> {
    const kv = this.config.noAuth ? null : this.pool.nextKey();
    if (!kv && !this.config.noAuth)
      throw new Error(`${this.config.id}: no healthy keys available`);
    const headers: Record<string, string> = { "content-type": "application/json" };
    if (kv) Object.assign(headers, this.authHeaders(kv.value));
    const model = req.model ?? "";
    const body: Record<string, unknown> = {
      model,
      messages: req.messages,
      temperature: req.temperature ?? 0.1,
    };
    if (req.responseFormat) body.response_format = req.responseFormat;
    const url = `${this.base()}${this.config.chatPath ?? "/chat/completions"}`;
    const start = Date.now();
    const res = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(req.timeoutMs ?? 30_000),
    });
    const durationMs = Date.now() - start;
    if (kv) this.pool.markResult(kv.index, res.status, durationMs);
    if (!res.ok) throw new Error(`${this.config.id}: HTTP ${res.status}`);
    const payload = (await res.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
      model?: string;
    };
    const content = String(payload.choices?.[0]?.message?.content ?? "");
    return {
      content,
      model: payload.model ?? model,
      providerId: this.config.id,
      keyIndex: kv?.index ?? -1,
      durationMs,
    };
  }
}