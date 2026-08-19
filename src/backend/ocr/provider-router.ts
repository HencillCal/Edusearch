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
  run: () => Promise<string>;
};

const RETRYABLE_STATUS = new Set([429, 500, 502, 503, 504]);
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

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
  return /429|quota|rate limit|resource exhausted|503|service unavailable|overloaded|high demand|try again later|timeout/i.test(
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
  for (let retry = 0; retry <= maxRetries; retry += 1) {
    try {
      const text = (await attempt.run()).trim();
      attempts.push({
        provider: attempt.provider,
        model: attempt.model,
        keySlot: attempt.keySlot,
        outcome: text ? `success:${text.length}` : "empty-response",
      });
      return text;
    } catch (error) {
      const status = Number((error as { status?: number })?.status || 0);
      const message = error instanceof Error ? error.message : String(error);
      const retryable = RETRYABLE_STATUS.has(status) || isRetryableMessage(message);
      attempts.push({
        provider: attempt.provider,
        model: attempt.model,
        keySlot: attempt.keySlot,
        outcome: `error:${message.slice(0, 180)}`,
      });
      if (!retryable || retry >= maxRetries) throw error;
      await sleep(Math.min(8_000, 750 * 2 ** retry));
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
): ProviderAttempt[] {
  return modelList.flatMap((model) =>
    keysList.map((key, index) => ({
      provider,
      model,
      keySlot: index + 1,
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
          Number(process.env.OCR_PROVIDER_TIMEOUT_MS || 45_000),
        );
        const choices = Array.isArray(payload.choices) ? payload.choices : [];
        const message = choices[0] as Record<string, unknown> | undefined;
        return String((message?.message as Record<string, unknown> | undefined)?.content || "");
      },
    })),
  );
}

function providerAttempts(base64: string, mimeType: string, language: string) {
  const attempts: ProviderAttempt[] = [];
  const geminiKeys = keys("GEMINI_API_KEYS").concat(keys("API_KEYS"));
  const geminiModels = models("GEMINI_MODELS", ["gemini-2.5-flash", "gemini-2.0-flash"]);
  for (const model of geminiModels)
    for (const [index, key] of geminiKeys.entries())
      attempts.push({
        provider: "gemini",
        model,
        keySlot: index + 1,
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
            Number(process.env.OCR_PROVIDER_TIMEOUT_MS || 45_000),
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

  attempts.push(
    ...openAiAttempts(
      "aimlapi",
      "https://api.aimlapi.com/v1",
      keys("AIML_API_KEYS"),
      models("AIML_MODELS", ["gpt-4o", "gpt-4-turbo"]),
      base64,
      mimeType,
      language,
    ),
    ...openAiAttempts(
      "openai",
      String(process.env.OPENAI_BASE_URL || "https://api.openai.com/v1"),
      keys("OPENAI_API_KEYS"),
      models("OPENAI_MODELS", ["gpt-4o", "gpt-4-turbo"]),
      base64,
      mimeType,
      language,
    ),
    ...openAiAttempts(
      "groq",
      "https://api.groq.com/openai/v1",
      keys("GROQ_API_KEYS"),
      models("GROQ_MODELS", ["llama-3.2-90b-vision-preview", "llama-3.2-11b-vision-preview"]),
      base64,
      mimeType,
      language,
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

/**
 * Reference-provider cascade adapted from TextScan. It is intentionally optional:
 * no configured key means no network call, while OCRTextract can be deployed as a
 * local/private service without putting credentials in EduSearch.
 */
export async function runVisionProviderCascade(
  imagePath: string,
  mimeType: string,
  language: string,
  mode: "fast" | "accurate" = "accurate",
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
  const candidates: ProviderAttempt[] = [];
  if (externalUrl) {
    candidates.push({
      provider: "OCRTextract",
      model: "pytesseract-ensemble",
      keySlot: 0,
      run: async () => {
        const payload = await fetchJson(
          `${externalUrl}/ocr-api/unified`,
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ image: base64, lang: language }),
          },
          Number(process.env.OCR_PROVIDER_TIMEOUT_MS || 45_000),
        );
        return String(payload.text || "");
      },
    });
  }
  candidates.push(...providerAttempts(base64, mimeType, language));
  if (!candidates.length) return results;

  const limit = mode === "fast" ? 1 : Math.max(1, Number(process.env.OCR_VISION_MAX_RESULTS || 3));
  if (mode === "fast") {
    for (const candidate of candidates) {
      try {
        const text = await runAttempt(
          candidate,
          Number(process.env.OCR_PROVIDER_RETRIES || 2),
          attempts,
        );
        if (text && resultScore(text) >= Number(process.env.OCR_MIN_EXTERNAL_SCORE || 35)) {
          results.push({
            text,
            provider: candidate.provider,
            model: candidate.model,
            confidence: null,
            durationMs: Date.now() - startedAt,
            attempts,
            warnings: [],
          });
          break;
        }
      } catch {
        // Continue to the next key/model/provider.
      }
    }
  } else {
    for (const candidate of candidates) {
      if (results.length >= limit) break;
      try {
        const text = await runAttempt(
          candidate,
          Number(process.env.OCR_PROVIDER_RETRIES || 2),
          attempts,
        );
        if (!text) continue;
        results.push({
          text,
          provider: candidate.provider,
          model: candidate.model,
          confidence: null,
          durationMs: Date.now() - startedAt,
          attempts: [...attempts],
          warnings: [],
        });
      } catch {
        // Continue to the next model, key, and provider.
      }
    }
  }
  return results.sort((left, right) => resultScore(right.text) - resultScore(left.text));
}
