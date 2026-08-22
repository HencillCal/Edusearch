import { KeyPool, parseKeys } from "./key-pool.js";
import type { AIProviderAdapter, Capability, ModelInfo } from "./types.js";
import { OpenAICompatAdapter } from "./adapters/openai-compat.js";
import { ElevenLabsAdapter } from "./adapters/elevenlabs.js";
import { OcrSpaceAdapter } from "./adapters/ocrspace.js";
import { DavidCyrilAdapter } from "./adapters/davidcyril.js";
import { SilvaTechAdapter } from "./adapters/silvatech.js";
import { getDb } from "../db.js";

interface CachedModels { models: ModelInfo[]; cachedAt: number; }
const MODEL_CACHE_TTL = 15 * 60 * 1000;

class ProviderRegistry {
  private adapters = new Map<string, AIProviderAdapter>();
  private modelCache = new Map<string, CachedModels>();
  private _initialized = false;

  init() {
    if (this._initialized) return;
    this._initialized = true;

    // ── GROQ (gsk_...) ──────────────────────────────────────────────────────
    this.add(new OpenAICompatAdapter(
      { id: "groq", name: "Groq", baseUrl: "https://api.groq.com/openai/v1", authMode: "bearer", capabilities: ["chat", "vision"], modelsPath: "/models", chatPath: "/chat/completions", verified: true },
      new KeyPool("groq", parseKeys("GROQ_API_KEYS")),
    ));

    // ── OPENAI (sk-...) ──────────────────────────────────────────────────────
    this.add(new OpenAICompatAdapter(
      { id: "openai", name: "OpenAI", baseUrl: "https://api.openai.com/v1", authMode: "bearer", capabilities: ["chat", "vision", "embeddings", "image_gen"], modelsPath: "/models", chatPath: "/chat/completions", embeddingsPath: "/embeddings", verified: true },
      new KeyPool("openai", parseKeys("OPENAI_API_KEYS")),
    ));

    // ── GEMINI (AIza...) ─────────────────────────────────────────────────────
    this.add(new OpenAICompatAdapter(
      { id: "gemini", name: "Google Gemini", baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai", authMode: "bearer", capabilities: ["chat", "vision"], modelsPath: "/models", chatPath: "/chat/completions", verified: true },
      new KeyPool("gemini", parseKeys("GEMINI_API_KEYS")),
    ));

    // ── NVIDIA NIM (nvapi-...) ───────────────────────────────────────────────
    this.add(new OpenAICompatAdapter(
      { id: "nvidia", name: "NVIDIA NIM", baseUrl: "https://integrate.api.nvidia.com/v1", authMode: "bearer", capabilities: ["chat", "vision", "embeddings"], modelsPath: "/models", chatPath: "/chat/completions", embeddingsPath: "/embeddings", verified: true },
      new KeyPool("nvidia", parseKeys("NVIDIA_API_KEYS")),
    ));

    // ── ELEVENLABS (xi-api-key) ───────────────────────────────────────────────
    this.add(new ElevenLabsAdapter(
      { id: "elevenlabs", name: "ElevenLabs", baseUrl: "https://api.elevenlabs.io/v1", authMode: "xi_api_key", capabilities: ["tts", "stt"], modelsPath: "/models", ttsPath: "/text-to-speech", sttPath: "/speech-to-text", verified: true },
      new KeyPool("elevenlabs", parseKeys("ELEVENLABS_API_KEYS")),
    ));

    // ── OCR.SPACE (apikey in POST body) ───────────────────────────────────────
    this.add(new OcrSpaceAdapter(
      { id: "ocrspace", name: "OCR.space", baseUrl: "https://api.ocr.space", authMode: "api_key_query", capabilities: ["ocr"], ocrPath: "/parse/image", verified: true },
      new KeyPool("ocrspace", parseKeys("OCRSPACE_API_KEYS")),
    ));

    // ── DAVID CYRIL (no auth) ─────────────────────────────────────────────────
    this.add(new DavidCyrilAdapter(
      { id: "davidcyril", name: "David Cyril APIs", baseUrl: process.env.DAVIDCYRIL_BASE_URL ?? "https://apis.davidcyril.name.ng", authMode: "none", capabilities: ["chat"], noAuth: true, chatPath: "/ai/deepseek-v3", verified: true },
      new KeyPool("davidcyril", []),
    ));

    // ── SILVATECH (no auth, Pollinations proxy) ────────────────────────────────
    this.add(new SilvaTechAdapter(
      { id: "silvatech", name: "SilvaTech Nexus", baseUrl: process.env.SILVATECH_BASE_URL ?? "https://api.silvatech.co.ke", authMode: "none", capabilities: ["chat"], noAuth: true, verified: false },
      new KeyPool("silvatech", []),
    ));

    // ── LEGACY COMPAT: AI_BASE_URL / AI_API_KEY ───────────────────────────────
    const legacyBase = process.env.AI_BASE_URL;
    const legacyKey = process.env.AI_API_KEY;
    if (legacyBase && legacyKey) {
      this.add(new OpenAICompatAdapter(
        { id: "legacy", name: "Legacy AI (AI_BASE_URL)", baseUrl: legacyBase, authMode: "bearer", capabilities: ["chat", "embeddings"], chatPath: "/chat/completions", modelsPath: "/models", verified: false },
        new KeyPool("legacy", [legacyKey]),
      ));
    }

    // ── CUSTOM OPENAI-COMPATIBLE ──────────────────────────────────────────────
    const customBase = process.env.CUSTOM_AI_BASE_URL;
    if (customBase) {
      this.add(new OpenAICompatAdapter(
        { id: "custom", name: "Custom AI Provider", baseUrl: customBase, authMode: "bearer", capabilities: ["chat"], chatPath: "/chat/completions", modelsPath: "/models", verified: false },
        new KeyPool("custom", parseKeys("CUSTOM_AI_API_KEYS")),
      ));
    }
  }

  private add(adapter: AIProviderAdapter) {
    this.adapters.set(adapter.config.id, adapter);
  }

  getProvider(id: string) { return this.adapters.get(id); }
  getAllProviders() { return [...this.adapters.values()]; }

  getCapableProviders(cap: Capability): AIProviderAdapter[] {
    const db = getDb();
    let routes: Array<{ provider_id: string; priority: number; enabled: number }> = [];
    try {
      routes = db.prepare(
        "SELECT provider_id, priority, enabled FROM provider_routes WHERE capability=? ORDER BY priority ASC"
      ).all(cap) as typeof routes;
    } catch { /* table may not exist on first boot */ }

    const enabledIds = new Set(routes.filter((r) => r.enabled).map((r) => r.provider_id));
    const ordered: AIProviderAdapter[] = [];
    // Priority-ordered from DB first
    for (const r of routes.filter((r) => r.enabled)) {
      const a = this.adapters.get(r.provider_id);
      if (a && a.config.capabilities.includes(cap)) ordered.push(a);
    }
    // Then remaining capable adapters (not in DB routes)
    for (const a of this.adapters.values()) {
      if (a.config.capabilities.includes(cap) && !enabledIds.has(a.config.id)) ordered.push(a);
    }
    return ordered;
  }

  async getModels(providerId: string, forceRefresh = false): Promise<ModelInfo[]> {
    const cached = this.modelCache.get(providerId);
    if (!forceRefresh && cached && Date.now() - cached.cachedAt < MODEL_CACHE_TTL) return cached.models;
    const adapter = this.adapters.get(providerId);
    if (!adapter) return [];
    const models = await adapter.listModels();
    this.modelCache.set(providerId, { models, cachedAt: Date.now() });
    return models;
  }
}

export const registry = new ProviderRegistry();