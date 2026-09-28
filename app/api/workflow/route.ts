// ============================================================
// app/api/workflow/route.ts
// POST /api/workflow  â€” start a new workflow
// GET  /api/workflow  â€” list recent workflows for a session
// ============================================================

import { NextRequest, NextResponse } from "next/server";
import { getServerClient } from "@/lib/supabase";
import { WorkflowQueue } from "@/lib/queue";

// â”€â”€ POST: Start a new workflow â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

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

  // Enqueue the job â€” worker picks it up, runs activities, emits events
  const queue = new WorkflowQueue(db);
  await queue.enqueue(workflowId, "run_workflow", { context, count, lens, mode, weights, rubric });

  return NextResponse.json({
    workflowId,
    status:  "running",
    message: "Workflow started. Subscribe to workflow_events for live updates.",
  });
}

// â”€â”€ GET: List recent workflows for a session â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

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
