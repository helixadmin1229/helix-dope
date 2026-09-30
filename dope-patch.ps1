# DOPE patch — diagnostics + OpenRouter + Ollama fallback
$Root = "C:\projects\helix-dope"

# lib/llm.ts
[System.IO.File]::WriteAllText("$Root\lib\llm.ts", @'
// ============================================================
// lib/llm.ts
// LLM wrapper — OpenRouter (free) first, Ollama as fallback.
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

  // ── Try OpenRouter first ──────────────────────────────────
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
          "X-Title":       "DOPE — Helix AI",
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
        console.warn(`[llm] OpenRouter failed (${res.status}): ${err.slice(0, 100)} — trying Ollama`);
      }
    } catch (e) {
      console.warn("[llm] OpenRouter error:", (e as Error).message, "— trying Ollama");
    }
  }

  // ── Fallback: Ollama ──────────────────────────────────────
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

'@, (New-Object System.Text.UTF8Encoding $false))
Write-Host "[ok] lib/llm.ts" -ForegroundColor Green

# app/api/worker/route.ts
[System.IO.File]::WriteAllText("$Root\app\api\worker\route.ts", @'
// ============================================================
// app/api/worker/route.ts
// GET /api/worker — claim and process one job from the queue.
//
// Trigger this endpoint every 5–10 seconds via:
//   - Supabase Edge Functions cron
//   - Vercel cron (vercel.json)
//   - External scheduler (cron-job.org, etc.)
//
// Each invocation processes ONE job and returns.
// Run multiple concurrent invocations for parallelism.
// ============================================================

import { NextRequest, NextResponse } from "next/server";
import { getServerClient } from "@/lib/supabase";
import { callLLMJSON, callLLM } from "@/lib/llm";

const CRON_SECRET = process.env.WORKER_CRON_SECRET ?? "";

// ── Lens prompts (self-contained — no external imports) ───────

const LENS_CONFIGS: Record<string, { system: string; userPrompt: (ctx: string, count: number) => string }> = {
  market_gap: {
    system: "You are a sharp SaaS market researcher. Find real market gaps where existing tools are weak.",
    userPrompt: (ctx, n) => `Research SaaS market gaps ${ctx ? "in: " + ctx : "across B2B software"}.\nReturn ONLY: {"ideas":[{"id":"idea_1","name":"Name","tagline":"Value prop","problem":"Pain","target":"Persona","gap":"Why solutions fail","signals":["s1","s2"],"difficulty":"low","marketSize":"medium","score":72,"confidence":80,"tags":["B2B"]}]}\nGenerate ${n} ideas. No markdown.`,
  },
  pain_driven: {
    system: "You are a SaaS researcher who mines reviews and Reddit for recurring complaints.",
    userPrompt: (ctx, n) => `Find SaaS ideas from documented pain points ${ctx ? "in " + ctx : "in B2B"}.\nReturn ONLY: {"ideas":[{"id":"idea_1","name":"Name","tagline":"Value prop","problem":"Complaint","target":"Who","gap":"Why no fix","signals":["s1","s2"],"difficulty":"low","marketSize":"medium","score":72,"confidence":80,"tags":["B2B"]}]}\nGenerate ${n} ideas. No markdown.`,
  },
  trend_riding: {
    system: "You are a SaaS trend analyst. Find structural shifts and the SaaS opportunities they create.",
    userPrompt: (ctx, n) => `Find SaaS ideas riding structural trends ${ctx ? "in " + ctx : ""}.\nReturn ONLY: {"ideas":[{"id":"idea_1","name":"Name","tagline":"Value prop","problem":"Trend need","target":"Who","gap":"Why solutions miss","signals":["s1","s2"],"difficulty":"low","marketSize":"medium","score":72,"confidence":80,"tags":["AI-native"]}]}\nGenerate ${n} ideas. No markdown.`,
  },
  niche_vertical: {
    system: "You are a vertical SaaS researcher. Find industries where generic tools fail.",
    userPrompt: (ctx, n) => `Find vertical SaaS opportunities ${ctx ? "in " + ctx : ""}.\nReturn ONLY: {"ideas":[{"id":"idea_1","name":"Name","tagline":"Value prop","problem":"Generic tool pain","target":"Role + industry","gap":"What generic tools miss","signals":["s1","s2"],"difficulty":"low","marketSize":"medium","score":72,"confidence":80,"tags":["vertical"]}]}\nGenerate ${n} ideas. No markdown.`,
  },
};

const ALL_LENSES = Object.keys(LENS_CONFIGS);

// ── Worker endpoint ───────────────────────────────────────────

export async function GET(req: NextRequest) {
  // Optional secret check in production
  const secret = req.headers.get("x-cron-secret") ?? req.nextUrl.searchParams.get("secret");
  if (CRON_SECRET && secret !== CRON_SECRET) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // ── Diagnostics: check env vars first ────────────────────
  const diagMode = req.nextUrl.searchParams.get("diag") === "1";
  if (diagMode) {
    return NextResponse.json({
      env: {
        SUPABASE_URL:        !!process.env.NEXT_PUBLIC_SUPABASE_URL,
        SUPABASE_ANON_KEY:   !!process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
        SERVICE_ROLE_KEY:    !!process.env.SUPABASE_SERVICE_ROLE_KEY,
        OPENROUTER_API_KEY:  !!process.env.OPENROUTER_API_KEY,
        LLM_PROVIDER:        process.env.LLM_PROVIDER ?? "openrouter (default)",
        OPENROUTER_MODEL:    process.env.OPENROUTER_MODEL ?? "meta-llama/llama-3.1-8b-instruct:free (default)",
        WORKER_CRON_SECRET:  !!process.env.WORKER_CRON_SECRET,
      }
    });
  }

  let db: any;
  try {
    db = getServerClient();
  } catch (e) {
    return NextResponse.json({
      processed: false,
      error: "Supabase config error: " + String(e),
      hint: "Check NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in Vercel env vars"
    }, { status: 500 });
  }

  // ── Claim one job atomically ──────────────────────────────
  let job: any = null;
  try {
    const { data, error } = await db.rpc("claim_next_job");
    if (error) {
      return NextResponse.json({
        processed: false,
        error: error.message,
        hint: error.message.includes("claim_next_job")
          ? "Schema not applied — run schema.sql in Supabase SQL Editor"
          : "Database error"
      }, { status: 500 });
    }
    job = data;
  } catch (e) {
    return NextResponse.json({
      processed: false,
      error: String(e),
      hint: "Could not connect to Supabase — check your env vars"
    }, { status: 500 });
  }

  if (!job) {
    return NextResponse.json({ processed: false, reason: "no_jobs" });
  }

  console.log(`[worker] processing job ${job.id} (${job.job_type}) for workflow ${job.workflow_id}`);
  const start = Date.now();

  try {
    await processJob(db, job);
    await db.from("workflow_jobs").update({ status: "completed", completed_at: new Date().toISOString() }).eq("id", job.id);
    console.log(`[worker] job ${job.id} completed in ${Date.now() - start}ms`);
    return NextResponse.json({ processed: true, jobId: job.id, durationMs: Date.now() - start });

  } catch (err) {
    const message = String(err);
    console.error(`[worker] job ${job.id} failed:`, message);

    const attempts    = (job.attempts ?? 1);
    const maxAttempts = job.max_attempts ?? 3;
    const isDead      = attempts >= maxAttempts;
    const retryAt     = new Date(Date.now() + Math.pow(2, attempts) * 1000).toISOString();

    await db.from("workflow_jobs").update({
      status:   isDead ? "dead" : "pending",
      error:    message,
      run_at:   isDead ? undefined : retryAt,
    }).eq("id", job.id);

    if (isDead) {
      await db.from("workflow_events").insert({
        workflow_id: job.workflow_id,
        type:        "WORKFLOW_FAILED",
        payload:     { message, jobId: job.id, jobType: job.job_type },
        source:      "system",
      });
    }

    return NextResponse.json({ processed: false, error: message }, { status: 500 });
  }
}

// ── Job processors ────────────────────────────────────────────

async function processJob(db: any, job: any): Promise<void> {
  const p = job.payload as Record<string, any>;

  switch (job.job_type) {

    case "run_workflow": {
      const { context = "", count = 5, lens, mode = "batch" } = p;
      const lenses = mode === "batch" ? ALL_LENSES : [lens ?? "market_gap"];

      for (const lensId of lenses) {
        await runLens(db, job.workflow_id, lensId, context, count);
      }

      // Emit IDEAS_MERGED after all lenses done
      const { data: ideaEvents } = await db
        .from("workflow_events")
        .select("payload")
        .eq("workflow_id", job.workflow_id)
        .eq("type", "LENS_COMPLETED");

      const allIdeas = (ideaEvents ?? []).flatMap((e: any) => e.payload?.ideas ?? []);
      const merged   = dedup(allIdeas);

      await db.from("workflow_events").insert({
        workflow_id: job.workflow_id,
        type:        "IDEAS_MERGED",
        payload:     { ideas: merged },
        source:      "system",
      });

      await db.from("workflow_events").insert({
        workflow_id: job.workflow_id,
        type:        "WORKFLOW_COMPLETED",
        payload:     { ideaCount: merged.length },
        source:      "system",
      });

      await db.from("workflows").update({ status: "completed" }).eq("id", job.workflow_id);
      break;
    }

    case "run_lens": {
      const { lensId, context = "", count = 5 } = p;
      await runLens(db, job.workflow_id, lensId, context, count);
      break;
    }

    case "run_drill": {
      const { idea } = p;
      if (!idea) throw new Error("run_drill: idea missing from payload");
      await runDrill(db, job.workflow_id, idea);
      break;
    }

    case "run_opinion": {
      const { idea, originalLens } = p;
      if (!idea) throw new Error("run_opinion: idea missing from payload");
      await runOpinion(db, job.workflow_id, idea, originalLens ?? "market_gap");
      break;
    }

    default:
      throw new Error(`Unknown job type: ${job.job_type}`);
  }
}

// ── Activity functions ────────────────────────────────────────

async function runLens(db: any, workflowId: string, lensId: string, context: string, count: number): Promise<void> {
  const cfg = LENS_CONFIGS[lensId];
  if (!cfg) throw new Error(`Unknown lens: ${lensId}`);

  await db.from("workflow_events").insert({ workflow_id: workflowId, type: "LENS_STARTED", payload: { lens: lensId }, source: "system" });

  const result = await callLLMJSON({ system: cfg.system, user: cfg.userPrompt(context, count), maxTokens: 2500 }, { ideas: [] });
  const ideas  = (result.ideas ?? []).map((idea: any, i: number) => ({ ...idea, id: `${lensId}_${i}_${Date.now()}`, _lens: lensId }));

  await db.from("workflow_events").insert({ workflow_id: workflowId, type: "LENS_COMPLETED", payload: { lens: lensId, ideas }, source: "llm" });
}

async function runDrill(db: any, workflowId: string, idea: any): Promise<void> {
  const system = "You are a SaaS due-diligence analyst. Rigorous, name real competitors, identify real risks. Return JSON only.";
  const user   = `Deep-dive and return ONLY:\n{"competitors":[{"name":"X","weakness":"Y"}],"gtm":"First 100 customers","techRisk":"Risk","marketRisk":"Risk","arr12m":"ARR","verdict":"GO","verdictReason":"One line","mvpWeeks":8,"mvpTeam":"solo","mvpCost":"$0-5k","summary":"200 word analysis"}\n\nName: ${idea.name}\nProblem: ${idea.problem}\nTarget: ${idea.target}\nGap: ${idea.gap}`;

  const report = await callLLMJSON({ system, user, maxTokens: 1500 }, { verdict: "MAYBE", verdictReason: "Parse error", competitors: [], gtm: "", techRisk: "", marketRisk: "", arr12m: "", mvpWeeks: null, mvpTeam: "", mvpCost: "", summary: "" });

  await db.from("workflow_events").insert({ workflow_id: workflowId, type: "DRILL_COMPLETED", payload: { ideaId: idea.id, report }, source: "llm" });
}

async function runOpinion(db: any, workflowId: string, idea: any, originalLens: string): Promise<void> {
  const others = ALL_LENSES.filter(l => l !== originalLens);
  const lens   = others[Math.floor(Math.random() * others.length)];

  const system = `You are a SaaS analyst giving a second opinion from a ${lens} perspective.`;
  const user   = `Second opinion on: ${idea.name} — ${idea.tagline}\nProblem: ${idea.problem}\n\nReturn ONLY: {"agreement":"agree|partial|disagree","newAngle":"What this adds","revisedScore":72,"revisedConfidence":65,"keyInsight":"Most important insight"}`;

  const opinion = await callLLMJSON({ system, user, maxTokens: 600 }, { agreement: "partial", newAngle: "", revisedScore: idea.score, revisedConfidence: 50, keyInsight: "" });

  await db.from("workflow_events").insert({ workflow_id: workflowId, type: "OPINION_COMPLETED", payload: { ideaId: idea.id, lens, opinion }, source: "llm" });
}

function dedup(ideas: any[]): any[] {
  return ideas.reduce((acc: any[], idea) => {
    const ex = acc.find(x => x.name?.toLowerCase().slice(0, 6) === idea.name?.toLowerCase().slice(0, 6));
    return (!ex || idea.score > ex.score) ? [...(ex ? acc.filter(x => x !== ex) : acc), idea] : acc;
  }, []);
}

'@, (New-Object System.Text.UTF8Encoding $false))
Write-Host "[ok] app/api/worker/route.ts" -ForegroundColor Green

# lib/supabase.ts
[System.IO.File]::WriteAllText("$Root\lib\supabase.ts", @'
// ============================================================
// lib/supabase.ts
// Supabase client factory.
// Browser client: uses anon key (safe to expose)
// Server client: uses service role key (never expose)
// ============================================================

import { createClient, SupabaseClient } from "@supabase/supabase-js";

// ── Browser client (singleton) ────────────────────────────────
// Use in React components and hooks.

let _browser: SupabaseClient | null = null;

export function getBrowserClient(): SupabaseClient {
  if (!_browser) {
    _browser = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    );
  }
  return _browser;
}

// ── Server client ─────────────────────────────────────────────
// Use in API routes and server components.
// Bypasses RLS — only use server-side.

export function getServerClient(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !key) {
    throw new Error(
      "Missing Supabase env vars. Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY."
    );
  }

  return createClient(url, key, {
    auth: { persistSession: false },   // no cookie auth on server
  });
}

// ── Session ID helper ─────────────────────────────────────────
// Simple browser-persisted session ID (no auth required).
// Replace with real auth if you add user accounts.

export function getSessionId(): string {
  if (typeof window === "undefined") return "server";

  let id = localStorage.getItem("dope_session_id");
  if (!id) {
    id = `sess_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    localStorage.setItem("dope_session_id", id);
  }
  return id;
}

'@, (New-Object System.Text.UTF8Encoding $false))
Write-Host "[ok] lib/supabase.ts" -ForegroundColor Green

# lib/queue.ts
[System.IO.File]::WriteAllText("$Root\lib\queue.ts", @'
// ============================================================
// lib/queue.ts
// WorkflowQueue — server-side only, used by API routes.
// Thin wrapper around the workflow_jobs table.
// ============================================================

import { SupabaseClient } from "@supabase/supabase-js";

export type JobType = "run_workflow" | "run_lens" | "run_drill" | "run_opinion";

export class WorkflowQueue {
  constructor(private db: SupabaseClient) {}

  async enqueue(
    workflowId:  string,
    jobType:     JobType,
    payload:     Record<string, unknown>,
    runAt?:      Date,
    maxAttempts: number = 3,
  ): Promise<{ id: string }> {
    const { data, error } = await this.db
      .from("workflow_jobs")
      .insert({
        workflow_id:  workflowId,
        job_type:     jobType,
        payload,
        run_at:       runAt?.toISOString() ?? new Date().toISOString(),
        max_attempts: maxAttempts,
      })
      .select("id")
      .single();

    if (error || !data) throw new Error(`enqueue failed: ${error?.message}`);
    return data;
  }

  async pending(workflowId: string): Promise<number> {
    const { count } = await this.db
      .from("workflow_jobs")
      .select("id", { count: "exact", head: true })
      .eq("workflow_id", workflowId)
      .eq("status", "pending");
    return count ?? 0;
  }
}

'@, (New-Object System.Text.UTF8Encoding $false))
Write-Host "[ok] lib/queue.ts" -ForegroundColor Green

# app/api/workflow/route.ts
[System.IO.File]::WriteAllText("$Root\app\api\workflow\route.ts", @'
// ============================================================
// app/api/workflow/route.ts
// POST /api/workflow  — start a new workflow
// GET  /api/workflow  — list recent workflows for a session
// ============================================================

import { NextRequest, NextResponse } from "next/server";
import { getServerClient } from "@/lib/supabase";
import { WorkflowQueue } from "@/lib/queue";

// ── POST: Start a new workflow ────────────────────────────────

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));

  const {
    sessionId  = "anon",
    context    = "",
    count      = 5,
    mode       = "batch",       // "single" | "batch" | "multi-agent"
    lens       = "market_gap",  // used when mode = "single"
    weights    = { viability: 40, ease: 30, market: 20, confidence: 10 },
    rubric     = {},
  } = body;

  const db = getServerClient();

  // Create the workflow row
  const { data: workflow, error } = await db
    .from("workflows")
    .insert({
      session_id: sessionId,
      status:     "running",
      input:      { context, count, lens },
      config:     { mode, weights, rubric },
    })
    .select("id")
    .single();

  if (error || !workflow) {
    return NextResponse.json({ error: error?.message ?? "Failed to create workflow" }, { status: 500 });
  }

  const workflowId = workflow.id;

  // Emit WORKFLOW_STARTED event
  await db.from("workflow_events").insert({
    workflow_id: workflowId,
    type:        mode === "batch" ? "BATCH_STARTED" : "WORKFLOW_STARTED",
    payload:     { context, count, lens, mode, total: mode === "batch" ? 4 : 1 },
    source:      "system",
  });

  // Enqueue the job — worker picks it up, runs activities, emits events
  const queue = new WorkflowQueue(db);
  await queue.enqueue(workflowId, "run_workflow", { context, count, lens, mode, weights, rubric });

  return NextResponse.json({
    workflowId,
    status:  "running",
    message: "Workflow started. Subscribe to workflow_events for live updates.",
  });
}

// ── GET: List recent workflows for a session ──────────────────

export async function GET(req: NextRequest) {
  const sessionId = req.nextUrl.searchParams.get("sessionId") ?? "anon";
  const limit     = parseInt(req.nextUrl.searchParams.get("limit") ?? "10");

  const db = getServerClient();

  const { data, error } = await db
    .from("workflow_summary")
    .select("*")
    .eq("session_id", sessionId)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ workflows: data ?? [] });
}

'@, (New-Object System.Text.UTF8Encoding $false))
Write-Host "[ok] app/api/workflow/route.ts" -ForegroundColor Green

cd $Root
git add lib/llm.ts app/api/worker/route.ts lib/supabase.ts lib/queue.ts app/api/workflow/route.ts
git commit -m "fix: diagnostics endpoint + better error handling + OpenRouter fallback"
git push origin main
Write-Host ""
Write-Host "Pushed. Wait ~1 min for Vercel to deploy." -ForegroundColor Green
Write-Host ""
Write-Host "Then run diagnostics:" -ForegroundColor Yellow
Write-Host "  curl https://helix-dope.vercel.app/api/worker?diag=1" -ForegroundColor Yellow