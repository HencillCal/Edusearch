import { registry } from "./registry.js";
import type { Capability, ChatRequest, ChatResult, OcrRequest, OcrResult } from "./types.js";

function logRequest(entry: {
  provider: string; model: string; capability: Capability;
  keyIndex: number; durationMs: number; status: "ok" | "error"; fallbackUsed: boolean;
}) {
  // key index only — never log key value
  console.info(`[providers] ${entry.capability} => ${entry.provider} model=${entry.model} key=[${entry.keyIndex}] ${entry.durationMs}ms ${entry.status}${entry.fallbackUsed ? " (fallback)" : ""}`);
}

export class ProviderRouter {
  /** Route a chat request through configured providers with key rotation and fallback */
  static async chat(req: ChatRequest): Promise<ChatResult> {
    registry.init();
    const providers = registry.getCapableProviders("chat");
    let lastErr: Error | undefined;
    let fallbackUsed = false;
    for (const adapter of providers) {
      if (!adapter.chat) continue;
      const start = Date.now();
      try {
        const result = await adapter.chat(req);
        logRequest({ provider: adapter.config.id, model: result.model, capability: "chat", keyIndex: result.keyIndex, durationMs: result.durationMs, status: "ok", fallbackUsed });
        return result;
      } catch (err) {
        lastErr = err instanceof Error ? err : new Error(String(err));
        console.warn(`[providers] chat ${adapter.config.id} failed (${Date.now() - start}ms): ${lastErr.message}`);
        fallbackUsed = true;
      }
    }
    throw lastErr ?? new Error("No chat providers available or configured");
  }

  /** Route an OCR request; callers should catch and fall back to Tesseract if needed */
  static async ocr(req: OcrRequest): Promise<OcrResult> {
    registry.init();
    const providers = registry.getCapableProviders("ocr");
    let lastErr: Error | undefined;
    let fallbackUsed = false;
    for (const adapter of providers) {
      if (!adapter.ocr) continue;
      const start = Date.now();
      try {
        const result = await adapter.ocr(req);
        logRequest({ provider: adapter.config.id, model: "ocr", capability: "ocr", keyIndex: -1, durationMs: result.durationMs, status: "ok", fallbackUsed });
        return result;
      } catch (err) {
        lastErr = err instanceof Error ? err : new Error(String(err));
        console.warn(`[providers] ocr ${adapter.config.id} failed (${Date.now() - start}ms): ${lastErr.message}`);
        fallbackUsed = true;
      }
    }
    throw lastErr ?? new Error("No OCR providers available or configured");
  }
}