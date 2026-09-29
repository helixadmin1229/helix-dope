// ============================================================
// lib/llm.ts
// LLM wrapper â€” OpenRouter (free) first, Ollama as fallback.
// ============================================================

const OPENROUTER_MODEL = process.env.OPENROUTER_MODEL
  ?? "meta-llama/llama-3.1-8b-instruct:free";

const OLLAMA_URL   = process.env.OLLAMA_URL   ?? "http://localhost:11434";
const OLLAMA_MODEL = process.env.OLLAMA_MODEL ?? "llama3.2";

export interface LLMResult {
  text:         string;
  inputTokens:  number;
  outputTokens: number;
  model:        string;
  durationMs:   number;
  provider:     string;
}

export async function callLLM(opts: {
  system:     string;
  user:       string;
  maxTokens?: number;
  model?:     string;
}): Promise<LLMResult> {
  const { system, user, maxTokens = 1500, model } = opts;

  // â”€â”€ Try OpenRouter first â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const key = process.env.OPENROUTER_API_KEY;
  if (key) {
    try {
      const start = Date.now();
      const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type":  "application/json",
          "Authorization": `Bearer ${key}`,
          "HTTP-Referer":  process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000",
          "X-Title":       "DOPE â€” Helix AI",
        },
        body: JSON.stringify({
          model:      model ?? OPENROUTER_MODEL,
          max_tokens: maxTokens,
          messages: [
            { role: "system", content: system },
            { role: "user",   content: user   },
          ],
        }),
      });

      if (res.ok) {
        const data = await res.json();
        // Check for OpenRouter-level error in body
        if (data.error) throw new Error(data.error.message ?? "OpenRouter error");
        const text = data.choices?.[0]?.message?.content ?? "";
        if (text) {
          return {
            text,
            inputTokens:  data.usage?.prompt_tokens     ?? 0,
            outputTokens: data.usage?.completion_tokens ?? 0,
            model:        data.model ?? OPENROUTER_MODEL,
            durationMs:   Date.now() - start,
            provider:     "openrouter",
          };
        }
      } else {
        const err = await res.text();
        console.warn(`[llm] OpenRouter failed (${res.status}): ${err.slice(0, 100)} â€” trying Ollama`);
      }
    } catch (e) {
      console.warn("[llm] OpenRouter error:", (e as Error).message, "â€” trying Ollama");
    }
  }

  // â”€â”€ Fallback: Ollama â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  try {
    const start = Date.now();
    const res = await fetch(`${OLLAMA_URL}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model:   OLLAMA_MODEL,
        stream:  false,
        options: { num_predict: maxTokens, temperature: 0.7 },
        messages: [
          { role: "system", content: system },
          { role: "user",   content: user   },
        ],
      }),
    });

    if (!res.ok) throw new Error(`Ollama HTTP ${res.status}`);
    const data = await res.json();
    const text = data.message?.content ?? "";
    return {
      text,
      inputTokens:  0,
      outputTokens: 0,
      model:        OLLAMA_MODEL,
      durationMs:   Date.now() - start,
      provider:     "ollama",
    };
  } catch (e) {
    console.warn("[llm] Ollama error:", (e as Error).message);
  }

  throw new Error(
    "All LLM providers failed. " +
    "Check OPENROUTER_API_KEY in Vercel env vars, " +
    "or start Ollama locally with: OLLAMA_ORIGINS=\"*\" ollama serve"
  );
}

export async function callLLMJSON<T>(
  opts:     Parameters<typeof callLLM>[0],
  fallback: T,
): Promise<T> {
  const result = await callLLM(opts);
  const clean  = result.text.replace(/```json|```/g, "").trim();
  const match  = clean.match(/\{[\s\S]*\}/);
  try { return JSON.parse(match ? match[0] : clean) as T; }
  catch { return fallback; }
}
