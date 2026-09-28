// ============================================================
// app/api/workflow/[id]/route.ts
// GET    /api/workflow/:id          â€” replay state from event log
// DELETE /api/workflow/:id          â€” abort a running workflow
// ============================================================

import { NextRequest, NextResponse } from "next/server";
import { getServerClient } from "@/lib/supabase";

type Params = { params: { id: string } };

// â”€â”€ GET: Replay state â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

export async function GET(req: NextRequest, { params }: Params) {
  const { id: workflowId } = params;
  const db  = getServerClient();
  const seq = req.nextUrl.searchParams.get("seq");   // optional: replay up to seq N

  // Load events
  let query = db
    .from("workflow_events")
    .select("*")
    .eq("workflow_id", workflowId)
    .order("seq", { ascending: true });

  if (seq) query = query.lte("seq", parseInt(seq));

  const { data: events, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Load workflow row
  const { data: workflow } = await db
    .from("workflows")
    .select("*")
    .eq("id", workflowId)
    .single();

  // Replay state from events (same reducer as frontend)
  const state = replayEvents(events ?? []);

  return NextResponse.json({
    workflowId,
    workflow,
    state,
    eventCount: events?.length ?? 0,
    latestSeq:  events?.at(-1)?.seq ?? 0,
  });
}

// â”€â”€ DELETE: Abort workflow â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

export async function DELETE(req: NextRequest, { params }: Params) {
  const { id: workflowId } = params;
  const db = getServerClient();

  // Emit abort event
  await db.from("workflow_events").insert({
    workflow_id: workflowId,
    type:        "WORKFLOW_ABORTED",
    payload:     { reason: "user_cancelled" },
    source:      "human",
  });

  // Update workflow status
  await db.from("workflows").update({ status: "aborted" }).eq("id", workflowId);

  // Cancel any pending jobs
  await db
    .from("workflow_jobs")
    .update({ status: "dead", error: "workflow_aborted" })
    .eq("workflow_id", workflowId)
    .eq("status", "pending");

  return NextResponse.json({ workflowId, status: "aborted" });
}

// â”€â”€ Reducer (server-side mirror of client reducer) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

function replayEvents(events: any[]): Record<string, unknown> {
  const initial = {
    phase: "idle", ideas: [], shortlist: [], skipped: [],
    decision: null, compareIds: [], error: null, batchProgress: null,
  };

  return events
    .sort((a, b) => (a.seq ?? 0) - (b.seq ?? 0))
    .reduce((state: any, event: any) => {
      const p = event.payload ?? {};
      switch (event.type) {
        case "WORKFLOW_STARTED":
        case "BATCH_STARTED":
          return { ...state, phase: "researching", batchProgress: event.type === "BATCH_STARTED" ? { done: 0, total: p.total ?? 4, current: null } : null };
        case "LENS_COMPLETED":
          return { ...state, ideas: dedup([...state.ideas, ...(p.ideas ?? [])]) };
        case "IDEAS_MERGED":
          return { ...state, phase: "awaiting_decision", ideas: p.ideas ?? state.ideas, batchProgress: null };
        case "IDEA_SHORTLISTED":
          return { ...state, shortlist: state.shortlist.includes(p.ideaId) ? state.shortlist.filter((id: string) => id !== p.ideaId) : [...state.shortlist, p.ideaId] };
        case "IDEA_SKIPPED":
          return { ...state, skipped: state.skipped.includes(p.ideaId) ? state.skipped.filter((id: string) => id !== p.ideaId) : [...state.skipped, p.ideaId] };
        case "HUMAN_DECIDED":
          return { ...state, phase: "decided", decision: p.ideaId };
        case "WORKFLOW_COMPLETED":
          return { ...state, phase: "complete" };
        case "WORKFLOW_FAILED":
          return { ...state, phase: "error", error: p.message };
        case "WORKFLOW_ABORTED":
          return { ...state, phase: "aborted", error: p.reason };
        default:
          return state;
      }
    }, initial);
}

function dedup(ideas: any[]): any[] {
  return ideas.reduce((acc: any[], idea) => {
    const existing = acc.find(x => x.name?.toLowerCase().slice(0, 6) === idea.name?.toLowerCase().slice(0, 6));
    if (!existing || idea.score > existing.score) {
      return existing ? [...acc.filter(x => x !== existing), idea] : [...acc, idea];
    }
    return acc;
  }, []);
}
