import type { KeyEntry, KeyState } from "./types.js";

// Parse comma-separated or JSON array env value. *_JSON takes priority.
// NEVER log the parsed values.
export function parseKeys(envVarName: string): string[] {
  const jsonVar = process.env[envVarName + "_JSON"];
  if (jsonVar) {
    try {
      const parsed = JSON.parse(jsonVar);
      if (Array.isArray(parsed)) {
        return parsed.map(String).map((k) => k.trim()).filter(Boolean);
      }
    } catch {
      // fall through
    }
  }
  const plain = process.env[envVarName];
  if (!plain) return [];
  return plain.split(",").map((k) => k.trim()).filter(Boolean);
}

export class KeyPool {
  private keys: KeyEntry[];
  private cursor = 0;
  readonly providerId: string;

  constructor(providerId: string, rawKeys: string[]) {
    this.providerId = providerId;
    this.keys = rawKeys.map((value) => ({
      value,
      state: "healthy" as KeyState,
      successCount: 0,
      failCount: 0,
    }));
  }

  get size() {
    return this.keys.length;
  }

  get healthyCount() {
    const now = Date.now();
    let count = 0;
    for (const k of this.keys) {
      if (k.state === "healthy") { count++; continue; }
      if (k.state === "cooldown" && k.cooldownUntil && now >= k.cooldownUntil) {
        k.state = "healthy";
        count++;
      }
    }
    return count;
  }

  nextKey(): { value: string; index: number } | null {
    const now = Date.now();
    const total = this.keys.length;
    if (!total) return null;
    for (let i = 0; i < total; i++) {
      const idx = (this.cursor + i) % total;
      const entry = this.keys[idx];
      if (entry.state === "cooldown" && entry.cooldownUntil && now >= entry.cooldownUntil) {
        entry.state = "healthy";
      }
      if (entry.state === "healthy" || entry.state === "unknown") {
        this.cursor = (idx + 1) % total;
        entry.lastUsedAt = now;
        return { value: entry.value, index: idx };
      }
    }
    return null;
  }

  markResult(index: number, httpStatus: number, durationMs: number): void {
    const entry = this.keys[index];
    if (!entry) return;
    if (httpStatus === 200 || httpStatus === 201) {
      entry.state = "healthy";
      entry.successCount++;
    } else if (httpStatus === 429) {
      entry.state = "cooldown";
      entry.cooldownUntil = Date.now() + 60_000;
      entry.failCount++;
    } else if (httpStatus === 401 || httpStatus === 403) {
      entry.state = "invalid";
      entry.failCount++;
      console.warn(`[providers] ${this.providerId} key[${index}] invalid (HTTP ${httpStatus}) ${durationMs}ms`);
    } else if (httpStatus >= 500) {
      entry.state = "cooldown";
      entry.cooldownUntil = Date.now() + 30_000;
      entry.failCount++;
    }
  }

  summary(): { keyCount: number; healthyCount: number; states: KeyState[] } {
    const now = Date.now();
    return {
      keyCount: this.keys.length,
      healthyCount: this.healthyCount,
      states: this.keys.map((k) => {
        if (k.state === "cooldown" && k.cooldownUntil && now >= k.cooldownUntil) return "healthy";
        return k.state;
      }),
    };
  }
}