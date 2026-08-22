// Provider infrastructure — shared types
// NEVER expose key values to the browser or logs.

export type Capability =
  | "chat"
  | "vision"
  | "ocr"
  | "tts"
  | "stt"
  | "image_gen"
  | "embeddings";

export type KeyState =
  | "healthy"
  | "cooldown"
  | "invalid"
  | "rate_limited"
  | "disabled"
  | "unknown";

export type AuthMode =
  | "none"
  | "bearer"
  | "api_key_header"
  | "api_key_query"
  | "xi_api_key"
  | "custom_header";

export interface ProviderConfig {
  id: string;
  name: string;
  baseUrl: string;
  authMode: AuthMode;
  authHeader?: string;
  authQueryParam?: string;
  capabilities: Capability[];
  modelsPath?: string;
  chatPath?: string;
  embeddingsPath?: string;
  visionPath?: string;
  ocrPath?: string;
  ttsPath?: string;
  sttPath?: string;
  verified: boolean;
  noAuth?: boolean;
}

export interface KeyEntry {
  value: string; // never log
  state: KeyState;
  cooldownUntil?: number;
  lastUsedAt?: number;
  successCount: number;
  failCount: number;
}

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface ChatRequest {
  model?: string;
  messages: ChatMessage[];
  temperature?: number;
  responseFormat?: { type: "json_object" | "text" };
  timeoutMs?: number;
}

export interface ChatResult {
  content: string;
  model: string;
  providerId: string;
  keyIndex: number;
  durationMs: number;
}

export interface ModelInfo {
  modelId: string;
  displayName: string;
  capabilities: Capability[];
  contextLength?: number;
  inputTypes?: string[];
  outputTypes?: string[];
}

export interface ProviderHealth {
  providerId: string;
  status:
    | "connected"
    | "degraded"
    | "rate_limited"
    | "invalid_key"
    | "unreachable"
    | "not_configured";
  latencyMs?: number;
  keyCount: number;
  healthyKeyCount: number;
  message?: string;
  checkedAt: number;
}

export interface OcrRequest {
  imageBase64: string;
  language?: string;
  engine?: number;
  timeoutMs?: number;
}

export interface OcrResult {
  text: string;
  confidence?: number;
  providerId: string;
  durationMs: number;
}

export interface TtsRequest {
  text: string;
  voiceId?: string;
  model?: string;
  timeoutMs?: number;
}

export interface AudioResult {
  audioBase64: string;
  mimeType: string;
  providerId: string;
  durationMs: number;
}

export interface SttRequest {
  audioBase64: string;
  mimeType: string;
  model?: string;
  timeoutMs?: number;
}

export interface TranscriptResult {
  text: string;
  providerId: string;
  durationMs: number;
}

export interface AIProviderAdapter {
  readonly config: ProviderConfig;
  health(): Promise<ProviderHealth>;
  listModels(): Promise<ModelInfo[]>;
  chat?(req: ChatRequest): Promise<ChatResult>;
  ocr?(req: OcrRequest): Promise<OcrResult>;
  tts?(req: TtsRequest): Promise<AudioResult>;
  stt?(req: SttRequest): Promise<TranscriptResult>;
}