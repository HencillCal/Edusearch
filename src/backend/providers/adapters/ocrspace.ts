import type { AIProviderAdapter, ModelInfo, OcrRequest, OcrResult, ProviderConfig, ProviderHealth } from "../types.js";
import { KeyPool } from "../key-pool.js";

// OCR.space — apikey in POST body, OCR only
export class OcrSpaceAdapter implements AIProviderAdapter {
  readonly config: ProviderConfig;
  private pool: KeyPool;
  constructor(config: ProviderConfig, pool: KeyPool) { this.config = config; this.pool = pool; }

  async health(): Promise<ProviderHealth> {
    const summary = this.pool.summary();
    if (!summary.keyCount) return { providerId: this.config.id, status: "not_configured", keyCount: 0, healthyKeyCount: 0, checkedAt: Date.now() };
    return { providerId: this.config.id, status: summary.healthyCount > 0 ? "connected" : "invalid_key", keyCount: summary.keyCount, healthyKeyCount: summary.healthyCount, message: summary.healthyCount > 0 ? undefined : "All keys exhausted", checkedAt: Date.now() };
  }

  async listModels(): Promise<ModelInfo[]> {
    return [
      { modelId: "ocrspace-engine1", displayName: "OCR.space Engine 1 (General)", capabilities: ["ocr"] },
      { modelId: "ocrspace-engine2", displayName: "OCR.space Engine 2 (Photo)", capabilities: ["ocr"] },
      { modelId: "ocrspace-engine3", displayName: "OCR.space Engine 3 (Math)", capabilities: ["ocr"] },
    ];
  }

  async ocr(req: OcrRequest): Promise<OcrResult> {
    const kv = this.pool.nextKey();
    if (!kv) throw new Error("ocrspace: no healthy keys");
    const form = new FormData();
    form.append("apikey", kv.value);
    form.append("base64Image", `data:image/png;base64,${req.imageBase64}`);
    form.append("language", req.language ?? "eng");
    form.append("OCREngine", String(req.engine ?? 1));
    form.append("isTable", "false");
    form.append("scale", "true");
    const start = Date.now();
    const res = await fetch("https://api.ocr.space/parse/image", { method: "POST", body: form, signal: AbortSignal.timeout(req.timeoutMs ?? 60_000) });
    const durationMs = Date.now() - start;
    this.pool.markResult(kv.index, res.status, durationMs);
    if (!res.ok) throw new Error(`ocrspace: HTTP ${res.status}`);
    const payload = (await res.json()) as { ParsedResults?: Array<{ ParsedText?: string }>; IsErroredOnProcessing?: boolean; ErrorMessage?: string };
    if (payload.IsErroredOnProcessing) throw new Error(`ocrspace: ${payload.ErrorMessage ?? "processing error"}`);
    const text = (payload.ParsedResults ?? []).map((r) => r.ParsedText ?? "").join("\n").trim();
    return { text, providerId: this.config.id, durationMs };
  }
}