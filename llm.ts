// ============================================================
// lib/llm.ts
// Anthropic SDK wrapper.
// Handles: retries, timeouts, token tracking, error normalisation.
// All LLM calls in the project go through here.
// ============================================================

import Anthropic from "@anthropic-ai/sdk";

const client = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

export interface LLMCallOptions {
  system:       string;
  user:         string;
  maxTokens?:   number;
  model?:       string;
  maxRetries?:  number;
  timeoutMs?:   number;
}

export interface LLMResult {
  text:         string;
  inputTokens:  number;
  outputTokens: number;
  totalTokens:  number;
  model:        string;
  durationMs:   number;
}

const DEFAULT_MODEL    = "claude-sonnet-4-20250514";
const DEFAULT_TOKENS   = 1500;
const DEFAULT_RETRIES  = 3;
const DEFAULT_TIMEOUT  = 45_000;

// ── Main call ─────────────────────────────────────────────────

export async function callLLM(opts: LLMCallOptions): Promise<LLMResult> {
  const {
    system, user,
    maxTokens  = DEFAULT_TOKENS,
    model      = DEFAULT_MODEL,
    maxRetries = DEFAULT_RETRIES,
    timeoutMs  = DEFAULT_TIMEOUT,
  } = opts;

  const start = Date.now();
  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const response = await withTimeout(
        client.messages.create({
          model,
          max_tokens: maxTokens,
          system,
          messages: [{ role: "user", content: user }],
        }),
        timeoutMs,
        `LLM call timed out after ${timeoutMs}ms`,
      );

      const text = response.content
        .filter(b => b.type === "text")
        .map(b => (b as Anthropic.TextBlock).text)
        .join("");

      return {
        text,
        inputTokens:  response.usage.input_tokens,
        outputTokens: response.usage.output_tokens,
        totalTokens:  response.usage.input_tokens + response.usage.output_tokens,
        model:        response.model,
        durationMs:   Date.now() - start,
      };

    } catch (err) {
      lastError = err as Error;
      const isRetryable = isRetryableError(err);

      if (!isRetryable || attempt === maxRetries) break;

      // Exponential backoff: 1s → 2s → 4s
      const delay = Math.pow(2, attempt - 1) * 1000;
      console.warn(`[llm] attempt ${attempt} failed (${lastError.message}), retrying in ${delay}ms`);
      await sleep(delay);
    }
  }

  throw new Error(`LLM call failed after ${maxRetries} attempts: ${lastError?.message}`);
}

// ── JSON call — parses response as JSON ───────────────────────

export async function callLLMJSON<T>(
  opts:     LLMCallOptions,
  fallback: T,
): Promise<T> {
  const result = await callLLM(opts);
  const clean  = result.text.replace(/```json|```/g, "").trim();
  try {
    return JSON.parse(clean) as T;
  } catch (e) {
    console.warn("[llm] JSON parse failed, returning fallback:", clean.slice(0, 100));
    return fallback;
  }
}

// ── Helpers ───────────────────────────────────────────────────

function isRetryableError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  const msg = err.message.toLowerCase();
  return (
    msg.includes("timeout") ||
    msg.includes("rate limit") ||
    msg.includes("overloaded") ||
    msg.includes("529") ||
    msg.includes("503") ||
    msg.includes("502")
  );
}

function sleep(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms));
}

function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error(message)), ms)),
  ]);
}
