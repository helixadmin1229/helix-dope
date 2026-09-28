// ============================================================
// app/api/worker/route.ts
// GET /api/worker â€” claim and process one job from the queue.
//
// Trigger this endpoint every 5â€“10 seconds via:
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

// â”€â”€ Lens prompts (self-contained â€” no external imports) â”€â”€â”€â”€â”€â”€â”€

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

// â”€â”€ Worker endpoint â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

export async function GET(req: NextRequest) {
  // Optional secret check in production
  const secret = req.headers.get("x-cron-secret") ?? req.nextUrl.searchParams.get("secret");
  if (CRON_SECRET && secret !== CRON_SECRET) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const db = getServerClient();

  // Claim one job atomically
  const { data: job, error } = await db.rpc("claim_next_job");
  if (error || !job) {
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

// â”€â”€ Job processors â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

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

// â”€â”€ Activity functions â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

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
  const user   = `Second opinion on: ${idea.name} â€” ${idea.tagline}\nProblem: ${idea.problem}\n\nReturn ONLY: {"agreement":"agree|partial|disagree","newAngle":"What this adds","revisedScore":72,"revisedConfidence":65,"keyInsight":"Most important insight"}`;

  const opinion = await callLLMJSON({ system, user, maxTokens: 600 }, { agreement: "partial", newAngle: "", revisedScore: idea.score, revisedConfidence: 50, keyInsight: "" });

  await db.from("workflow_events").insert({ workflow_id: workflowId, type: "OPINION_COMPLETED", payload: { ideaId: idea.id, lens, opinion }, source: "llm" });
}

function dedup(ideas: any[]): any[] {
  return ideas.reduce((acc: any[], idea) => {
    const ex = acc.find(x => x.name?.toLowerCase().slice(0, 6) === idea.name?.toLowerCase().slice(0, 6));
    return (!ex || idea.score > ex.score) ? [...(ex ? acc.filter(x => x !== ex) : acc), idea] : acc;
  }, []);
}
