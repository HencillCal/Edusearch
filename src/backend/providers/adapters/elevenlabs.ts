import { Buffer } from "node:buffer";
import type {
  AIProviderAdapter, AudioResult, ModelInfo, ProviderConfig,
  ProviderHealth, SttRequest, TranscriptResult, TtsRequest,
} from "../types.js";
import { KeyPool } from "../key-pool.js";

// ElevenLabs — uses xi-api-key header (NOT Bearer)
export class ElevenLabsAdapter implements AIProviderAdapter {
  readonly config: ProviderConfig;
  private pool: KeyPool;
  constructor(config: ProviderConfig, pool: KeyPool) {
    this.config = config; this.pool = pool;
  }
  private base() { return this.config.baseUrl.replace(/\/$/, ""); }

  async health(): Promise<ProviderHealth> {
    const summary = this.pool.summary();
    if (!summary.keyCount) return { providerId: this.config.id, status: "not_configured", keyCount: 0, healthyKeyCount: 0, checkedAt: Date.now() };
    const kv = this.pool.nextKey();
    if (!kv) return { providerId: this.config.id, status: "invalid_key", keyCount: summary.keyCount, healthyKeyCount: 0, checkedAt: Date.now() };
    const start = Date.now();
    try {
      const res = await fetch(`${this.base()}/models`, { headers: { "xi-api-key": kv.value }, signal: AbortSignal.timeout(10_000) });
      const latencyMs = Date.now() - start;
      this.pool.markResult(kv.index, res.status, latencyMs);
      const status = res.ok ? "connected" : res.status === 429 ? "rate_limited" : res.status === 401 ? "invalid_key" : "degraded";
      return { providerId: this.config.id, status, latencyMs, keyCount: summary.keyCount, healthyKeyCount: this.pool.healthyCount, checkedAt: Date.now() };
    } catch (err) {
      return { providerId: this.config.id, status: "unreachable", latencyMs: Date.now() - start, keyCount: summary.keyCount, healthyKeyCount: 0, message: err instanceof Error ? err.message : String(err), checkedAt: Date.now() };
    }
  }

  async listModels(): Promise<ModelInfo[]> {
    const kv = this.pool.nextKey();
    if (!kv) return [];
    try {
      const res = await fetch(`${this.base()}/models`, { headers: { "xi-api-key": kv.value }, signal: AbortSignal.timeout(15_000) });
      if (!res.ok) return [];
      const data = (await res.json()) as Array<{ model_id: string; name: string; can_do_text_to_speech?: boolean; can_do_voice_conversion?: boolean }>;
      return data.map((m) => ({
        modelId: m.model_id, displayName: m.name,
        capabilities: [...(m.can_do_text_to_speech ? ["tts" as const] : []), ...(m.can_do_voice_conversion ? ["stt" as const] : [])],
      }));
    } catch { return []; }
  }

  async tts(req: TtsRequest): Promise<AudioResult> {
    const kv = this.pool.nextKey();
    if (!kv) throw new Error("elevenlabs: no healthy keys");
    const voiceId = req.voiceId ?? "21m00Tcm4TlvDq8ikWAM";
    const start = Date.now();
    const res = await fetch(`${this.base()}/text-to-speech/${voiceId}`, {
      method: "POST",
      headers: { "xi-api-key": kv.value, "content-type": "application/json" },
      body: JSON.stringify({ text: req.text, model_id: req.model ?? "eleven_flash_v2_5" }),
      signal: AbortSignal.timeout(req.timeoutMs ?? 60_000),
    });
    const durationMs = Date.now() - start;
    this.pool.markResult(kv.index, res.status, durationMs);
    if (!res.ok) throw new Error(`elevenlabs: HTTP ${res.status}`);
    const buf = await res.arrayBuffer();
    return { audioBase64: Buffer.from(buf).toString("base64"), mimeType: "audio/mpeg", providerId: this.config.id, durationMs };
  }

  async stt(req: SttRequest): Promise<TranscriptResult> {
    const kv = this.pool.nextKey();
    if (!kv) throw new Error("elevenlabs: no healthy keys");
    const audioBuffer = Buffer.from(req.audioBase64, "base64");
    const formData = new FormData();
    formData.append("file", new Blob([audioBuffer], { type: req.mimeType }), "audio.mp3");
    if (req.model) formData.append("model", req.model);
    const start = Date.now();
    const res = await fetch(`${this.base()}/speech-to-text`, { method: "POST", headers: { "xi-api-key": kv.value }, body: formData, signal: AbortSignal.timeout(req.timeoutMs ?? 120_000) });
    const durationMs = Date.now() - start;
    this.pool.markResult(kv.index, res.status, durationMs);
    if (!res.ok) throw new Error(`elevenlabs: HTTP ${res.status}`);
    const payload = (await res.json()) as { text?: string };
    return { text: payload.text ?? "", providerId: this.config.id, durationMs };
  }
}