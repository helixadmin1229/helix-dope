// ============================================================
// app/api/workflow/[id]/simulate/route.ts
// POST /api/workflow/:id/simulate
// Runs a counterfactual or A/B simulation server-side.
// Read-only — no DB writes, no LLM calls.
// ============================================================

import { NextRequest, NextResponse } from "next/server";
import { getServerClient } from "@/lib/supabase";

type Params    = { params: { id: string } };
type SimMode   = "counterfactual" | "abtest" | "scrub";

export async function POST(req: NextRequest, { params }: Params) {
  const { id: workflowId } = params;
  const body = await req.json().catch(() => ({}));
  const { mode = "counterfactual", targetSeq, altPayload, stepSize = 5 } = body as {
    mode:        SimMode;
    targetSeq?:  number;
    altPayload?: Record<string, unknown>;
    stepSize?:   number;
  };

  const db = getServerClient();

  // Load all events
  const { data: rawEvents, error } = await db
    .from("workflow_events")
    .select("*")
    .eq("workflow_id", workflowId)
    .order("seq", { ascending: true });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const events = rawEvents ?? [];

  if (mode === "counterfactual") {
    if (targetSeq === undefined || !altPayload) {
      return NextResponse.json({ error: "targetSeq and altPayload required" }, { status: 400 });
    }

    // Replace event at targetSeq with alt payload, replay
    const modified = events.map(e =>
      e.seq === targetSeq ? { ...e, payload: { ...e.payload, ...altPayload } } : e
    );

    const original  = replayAll(events);
    const simulated = replayAll(modified);

    return NextResponse.json({
      mode: "counterfactual",
      targetSeq,
      altPayload,
      original,
      simulated,
      diff: diffStates(original, simulated),
    });
  }

  if (mode === "scrub") {
    // Return state snapshots at every stepSize events
    const frames = [];
    for (let i = stepSize; i <= events.length; i += stepSize) {
      const slice = events.slice(0, i);
      const state = replayAll(slice);
      frames.push({
        seq:          slice.at(-1)?.seq ?? 0,
        eventIndex:   i,
        phase:        state.phase,
        ideaCount:    (state.ideas as any[]).length,
        conflictCount: (state.conflicts as any[])?.length ?? 0,
      });
    }
    return NextResponse.json({ mode: "scrub", frames });
  }

  return NextResponse.json({ error: `Unknown simulation mode: ${mode}` }, { status: 400 });
}

// ── Reducer (same logic as client) ────────────────────────────

function replayAll(events: any[]): any {
  const initial = {
    phase: "idle", ideas: [], shortlist: [], skipped: [],
    decision: null, conflicts: [], error: null,
  };
  return events
    .sort((a, b) => (a.seq ?? 0) - (b.seq ?? 0))
    .reduce(applyEvent, initial);
}

function applyEvent(state: any, event: any): any {
  const p = event.payload ?? {};
  switch (event.type) {
    case "WORKFLOW_STARTED":
    case "BATCH_STARTED":  return { ...state, phase: "researching" };
    case "LENS_COMPLETED": return { ...state, ideas: dedup([...state.ideas, ...(p.ideas ?? [])]) };
    case "IDEAS_MERGED":   return { ...state, phase: "awaiting_decision", ideas: p.ideas ?? state.ideas };
    case "IDEA_SHORTLISTED": return { ...state, shortlist: toggle(state.shortlist, p.ideaId) };
    case "HUMAN_DECIDED":  return { ...state, phase: "decided", decision: p.ideaId };
    case "WORKFLOW_COMPLETED": return { ...state, phase: "complete" };
    case "WORKFLOW_FAILED": return { ...state, phase: "error", error: p.message };
    case "CONFLICT_DETECTED": return { ...state, conflicts: [...state.conflicts, { id: event.id, ...p }] };
    default: return state;
  }
}

function toggle(arr: string[], id: string): string[] {
  return arr.includes(id) ? arr.filter(x => x !== id) : [...arr, id];
}

function dedup(ideas: any[]): any[] {
  return ideas.reduce((acc: any[], idea) => {
    const ex = acc.find(x => x.name?.toLowerCase().slice(0, 6) === idea.name?.toLowerCase().slice(0, 6));
    return (!ex || idea.score > ex.score) ? [...(ex ? acc.filter(x => x !== ex) : acc), idea] : acc;
  }, []);
}

function diffStates(a: any, b: any): Record<string, unknown> {
  const parts: string[] = [];
  if (a.phase !== b.phase)                    parts.push(`phase: ${a.phase}→${b.phase}`);
  if (a.ideas.length !== b.ideas.length)      parts.push(`ideas: ${a.ideas.length}→${b.ideas.length}`);
  if (a.shortlist.length !== b.shortlist.length) parts.push(`shortlist Δ${b.shortlist.length - a.shortlist.length}`);
  if (a.decision !== b.decision)              parts.push(`decision changed`);
  return {
    phaseChanged:    a.phase !== b.phase,
    ideaCountDelta:  b.ideas.length - a.ideas.length,
    shortlistDelta:  b.shortlist.length - a.shortlist.length,
    decisionChanged: a.decision !== b.decision,
    summary:         parts.join(", ") || "no change",
  };
}
