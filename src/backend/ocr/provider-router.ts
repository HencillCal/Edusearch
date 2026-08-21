import { readFile } from "node:fs/promises";
import sharp from "sharp";

export type VisionProviderResult = {
  text: string;
  provider: string;
  model?: string;
  confidence: number | null;
  durationMs: number;
  attempts: Array<{ provider: string; model?: string; keySlot?: number; outcome: string }>;
  warnings: string[];
};

type ProviderAttempt = {
  provider: string;
  model: string;
  keySlot: number;
  timeoutMs: number;
  run: () => Promise<string>;
};

const RETRYABLE_STATUS = new Set([429, 500, 502, 503, 504]);
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// Circuit breaker state
const providerCooldowns = new Map<string, number>();
const misconfiguredProviders = new Set<string>();

export function getProviderHealthSummary() {
  const now = Date.now();
  return {
    cooldowns: Array.from(providerCooldowns.entries())
      .filter(([, expires]) => expires > now)
      .map(([provider, expires]) => ({ provider, remainingSec: Math.ceil((expires - now) / 1000) })),
    misconfigured: Array.from(misconfiguredProviders),
  };
}

function keys(name: string) {
  return String(process.env[name] || "")
    .split(",")
    .map((key) => key.trim())
    .filter((key) => key && !/^your[-_]/i.test(key));
}

function models(name: string, defaults: string[]) {
  const configured = String(process.env[name] || "")
    .split(",")
    .map((model) => model.trim())
    .filter(Boolean);
  return configured.length ? configured : defaults;
}

function isRetryableMessage(message: string) {
  return /429|quota|rate limit|resource exhausted|503|service unavailable|overloaded|high demand|try again later|timeout|fetch failed/i.test(
    message,
  );
}

function isMisconfigurationMessage(status: number, message: string) {
  if (status === 401 || status === 403) return true;
  return /invalid[ _]?api[ _]?key|authentication failed|permission denied|unauthorized|account inactive/i.test(
    message,
  );
}

async function fetchJson(url: string, init: RequestInit, timeoutMs: number) {
  const response = await fetch(url, {
    ...init,
    signal: AbortSignal.timeout(timeoutMs),
  });
  const body = await response.text();
  let payload: Record<string, unknown> = {};
  try {
    payload = JSON.parse(body) as Record<string, unknown>;
  } catch {
    // Preserve the HTTP failure below.
  }
  if (!response.ok) {
    const error = new Error(
      `${response.status} ${String(payload.error || payload.message || body.slice(0, 240))}`,
    ) as Error & { status?: number };
    error.status = response.status;
    throw error;
  }
  return payload;
}

async function runAttempt(
  attempt: ProviderAttempt,
  maxRetries: number,
  attempts: VisionProviderResult["attempts"],
) {
  const providerKey = `${attempt.provider}:${attempt.model}:${attempt.keySlot}`;

  for (let retry = 0; retry <= maxRetries; retry += 1) {
    try {
      const text = (await attempt.run()).trim();
      attempts.push({
        provider: attempt.provider,
        model: attempt.model,
        keySlot: attempt.keySlot,
        outcome: text ? `success:${text.length}` : "empty-response",
      });
      // Clear cooldown on success
      providerCooldowns.delete(attempt.provider);
      return text;
    } catch (error) {
      const status = Number((error as { status?: number })?.status || 0);
      const message = error instanceof Error ? error.message : String(error);
      const isMisconfig = isMisconfigurationMessage(status, message);
      const retryable = !isMisconfig && (RETRYABLE_STATUS.has(status) || isRetryableMessage(message));

      attempts.push({
        provider: attempt.provider,
        model: attempt.model,
        keySlot: attempt.keySlot,
        outcome: `error:${message.slice(0, 180)}`,
      });

      if (isMisconfig) {
        misconfiguredProviders.add(providerKey);
        // Do not retry misconfigured credentials
        throw error;
      }

      if (retryable && retry < maxRetries) {
        await sleep(Math.min(3_000, 500 * 2 ** retry));
        continue;
      }

      // Mark cooldown for 60s on failure
      providerCooldowns.set(attempt.provider, Date.now() + 60_000);
      throw error;
    }
  }
  return "";
}

function openAiAttempts(
  provider: string,
  baseUrl: string,
  keysList: string[],
  modelList: string[],
  base64: string,
  mimeType: string,
  language: string,
  timeoutMs: number,
): ProviderAttempt[] {
  return modelList.flatMap((model) =>
    keysList.map((key, index) => ({
      provider,
      model,
      keySlot: index + 1,
      timeoutMs,
      run: async () => {
        const payload = await fetchJson(
          `${baseUrl.replace(/\/$/, "")}/chat/completions`,
          {
            method: "POST",
            headers: {
              "content-type": "application/json",
              authorization: `Bearer ${key}`,
            },
            body: JSON.stringify({
              model,
              temperature: 0,
              max_tokens: 8_000,
              messages: [
                {
                  role: "user",
                  content: [
                    {
                      type: "image_url",
                      image_url: { url: `data:${mimeType};base64,${base64}` },
                    },
                    {
                      type: "text",
                      text: `Extract every visible character from this academic document image in ${language}. Preserve line breaks, question numbers, marks, punctuation and symbols. Return only transcription. Do not summarize, answer questions, correct uncertain words, or invent text.`,
                    },
                  ],
                },
              ],
            }),
          },
          timeoutMs,
        );
        const choices = Array.isArray(payload.choices) ? payload.choices : [];
        const message = choices[0] as Record<string, unknown> | undefined;
        return String((message?.message as Record<string, unknown> | undefined)?.content || "");
      },
    })),
  );
}

function providerAttempts(
  base64: string,
  mimeType: string,
  language: string,
  timeoutMs: number,
) {
  const attempts: ProviderAttempt[] = [];
  const geminiKeys = keys("GEMINI_API_KEYS").concat(keys("API_KEYS"));
  const geminiModels = models("GEMINI_MODELS", ["gemini-2.5-flash", "gemini-2.0-flash"]);

  for (const model of geminiModels) {
    for (const [index, key] of geminiKeys.entries()) {
      attempts.push({
        provider: "gemini",
        model,
        keySlot: index + 1,
        timeoutMs,
        run: async () => {
          const payload = await fetchJson(
            `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(key)}`,
            {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({
                contents: [
                  {
                    parts: [
                      { inline_data: { mime_type: mimeType, data: base64 } },
                      {
                        text: `Extract every visible character from this academic document image in ${language}. Preserve line breaks, question numbers, marks, punctuation and symbols. Return only transcription. Do not summarize, answer questions, correct uncertain words, or invent text.`,
                      },
                    ],
                  },
                ],
                generationConfig: { temperature: 0 },
              }),
            },
            timeoutMs,
          );
          const candidates = Array.isArray(payload.candidates) ? payload.candidates : [];
          const content = candidates[0] as Record<string, unknown> | undefined;
          const parts = Array.isArray(
            (content?.content as Record<string, unknown> | undefined)?.parts,
          )
            ? ((content?.content as Record<string, unknown>).parts as Array<
                Record<string, unknown>
              >)
            : [];
          return parts.map((part) => String(part.text || "")).join("\n");
        },
      });
    }
  }

  attempts.push(
    ...openAiAttempts(
      "aimlapi",
      "https://api.aimlapi.com/v1",
      keys("AIML_API_KEYS"),
      models("AIML_MODELS", ["gpt-4o", "gpt-4-turbo"]),
      base64,
      mimeType,
      language,
      timeoutMs,
    ),
    ...openAiAttempts(
      "openai",
      String(process.env.OPENAI_BASE_URL || "https://api.openai.com/v1"),
      keys("OPENAI_API_KEYS"),
      models("OPENAI_MODELS", ["gpt-4o", "gpt-4-turbo"]),
      base64,
      mimeType,
      language,
      timeoutMs,
    ),
    ...openAiAttempts(
      "groq",
      "https://api.groq.com/openai/v1",
      keys("GROQ_API_KEYS"),
      models("GROQ_MODELS", ["llama-3.2-90b-vision-preview", "llama-3.2-11b-vision-preview"]),
      base64,
      mimeType,
      language,
      timeoutMs,
    ),
  );
  return attempts;
}

function resultScore(text: string) {
  const compact = text.replace(/\s/g, "");
  if (!compact) return 0;
  const readable = (compact.match(/[\p{L}\p{N}]/gu) || []).length / compact.length;
  const structure = (
    text.match(/\b(?:question|section|marks|instructions?)\b|\b\d{1,3}[.)]/gi) || []
  ).length;
  return Math.max(0, Math.min(100, Math.round(readable * 70 + Math.min(30, structure * 3))));
}

export async function runVisionProviderCascade(
  imagePath: string,
  mimeType: string,
  language: string,
  mode: "fast" | "balanced" | "accurate" = "balanced",
): Promise<VisionProviderResult[]> {
  const results: VisionProviderResult[] = [];
  const startedAt = Date.now();
  const attempts: VisionProviderResult["attempts"] = [];
  const bytes = await readFile(imagePath);
  const prepared =
    bytes.length > Number(process.env.OCR_CLOUD_MAX_BYTES || 2_500_000)
      ? await sharp(imagePath)
          .resize({ width: 2200, height: 2200, fit: "inside", withoutEnlargement: true })
          .jpeg({ quality: 88 })
          .toBuffer()
      : bytes;
  const base64 = prepared.toString("base64");
  const externalUrl = String(process.env.OCR_TEXTRACT_URL || "").replace(/\/$/, "");

  const timeoutMs =
    mode === "fast"
      ? 15_000
      : mode === "balanced"
        ? 20_000
        : Number(process.env.OCR_PROVIDER_TIMEOUT_MS || 35_000);

  const candidates: ProviderAttempt[] = [];
  if (externalUrl) {
    candidates.push({
      provider: "OCRTextract",
      model: "pytesseract-ensemble",
      keySlot: 0,
      timeoutMs,
      run: async () => {
        const payload = await fetchJson(
          `${externalUrl}/ocr-api/unified`,
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ image: base64, lang: language }),
          },
          timeoutMs,
        );
        return String(payload.text || "");
      },
    });
  }
  candidates.push(...providerAttempts(base64, mimeType, language, timeoutMs));
  if (!candidates.length) return results;

  // Filter candidates by circuit breaker
  const now = Date.now();
  const availableCandidates = candidates.filter((c) => {
    const providerKey = `${c.provider}:${c.model}:${c.keySlot}`;
    if (misconfiguredProviders.has(providerKey)) return false;
    const cooldownExpires = providerCooldowns.get(c.provider) || 0;
    return cooldownExpires <= now;
  });

  if (!availableCandidates.length) return results;

  // Mode limits: Fast = 1 attempt, Balanced = max 2 attempts, Accurate = max 3 attempts
  const maxAttemptsToTry = mode === "fast" ? 1 : mode === "balanced" ? 2 : 3;
  const retriesPerAttempt = Number(process.env.OCR_PROVIDER_RETRIES || 1);

  let triedCount = 0;
  for (const candidate of availableCandidates) {
    if (triedCount >= maxAttemptsToTry) break;
    triedCount++;

    try {
      const text = await runAttempt(candidate, retriesPerAttempt, attempts);
      if (text && resultScore(text) >= Number(process.env.OCR_MIN_EXTERNAL_SCORE || 35)) {
        results.push({
          text,
          provider: candidate.provider,
          model: candidate.model,
          confidence: null,
          durationMs: Date.now() - startedAt,
          attempts: [...attempts],
          warnings: [],
        });
        // Fast & Balanced stop on first strong result
        if (mode === "fast" || mode === "balanced") break;
      }
    } catch {
      // Continue to next available candidate
    }
  }

  return results.sort((left, right) => resultScore(right.text) - resultScore(left.text));
}
