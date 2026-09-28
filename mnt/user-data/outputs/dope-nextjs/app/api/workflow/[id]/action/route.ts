// ============================================================
// app/api/workflow/[id]/action/route.ts
// POST /api/workflow/:id/action
// Human-sourced events (shortlist, skip, decide, etc.)
// These are logged as source:"human" — appear in audit trail.
// ============================================================

import { NextRequest, NextResponse } from "next/server";
import { getServerClient } from "@/lib/supabase";

type Params = { params: { id: string } };

const ALLOWED_HUMAN_ACTIONS = new Set([
  "IDEA_SHORTLISTED",
  "IDEA_SKIPPED",
  "IDEA_UNSHORTLISTED",
  "IDEA_UNSKIPPED",
  "COMPARE_TOGGLED",
  "HUMAN_DECIDED",
  "DECISION_REVOKED",
  "RUBRIC_SET",
  "WEIGHTS_SET",
]);

export async function POST(req: NextRequest, { params }: Params) {
  const { id: workflowId } = params;
  const body = await req.json().catch(() => ({}));
  const { type, payload = {} } = body;

  if (!type || !ALLOWED_HUMAN_ACTIONS.has(type)) {
    return NextResponse.json(
      { error: `Action "${type}" not allowed. Allowed: ${[...ALLOWED_HUMAN_ACTIONS].join(", ")}` },
      { status: 400 }
    );
  }

  const db = getServerClient();

  // Check workflow exists and is not already ended
  const { data: workflow } = await db
    .from("workflows")
    .select("status")
    .eq("id", workflowId)
    .single();

  if (!workflow) {
    return NextResponse.json({ error: `Workflow ${workflowId} not found` }, { status: 404 });
  }

  if (["completed", "failed", "aborted"].includes(workflow.status)) {
    // Still allow read-only decorations (shortlist/skip) on finished workflows
    const readOnly = new Set(["IDEA_SHORTLISTED", "IDEA_SKIPPED", "IDEA_UNSHORTLISTED", "IDEA_UNSKIPPED"]);
    if (!readOnly.has(type)) {
      return NextResponse.json({ error: `Workflow is ${workflow.status} — cannot apply ${type}` }, { status: 409 });
    }
  }

  // Emit the human action event
  const { data: event, error } = await db
    .from("workflow_events")
    .insert({
      workflow_id: workflowId,
      type,
      payload:     { ...payload, _humanAction: true },
      source:      "human",
    })
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // If decided: update workflow status
  if (type === "HUMAN_DECIDED") {
    await db.from("workflows").update({ status: "completed" }).eq("id", workflowId);
  }

  return NextResponse.json({ event });
}
