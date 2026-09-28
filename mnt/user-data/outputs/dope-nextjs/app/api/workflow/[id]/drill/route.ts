// ============================================================
// app/api/workflow/[id]/drill/route.ts
// POST /api/workflow/:id/drill
// Enqueues a drill job. Result streams back via Realtime.
// ============================================================

import { NextRequest, NextResponse } from "next/server";
import { getServerClient } from "@/lib/supabase";
import { WorkflowQueue } from "@/lib/queue";

type Params = { params: { id: string } };

export async function POST(req: NextRequest, { params }: Params) {
  const { id: workflowId } = params;
  const { idea } = await req.json().catch(() => ({}));

  if (!idea?.id) {
    return NextResponse.json({ error: "idea.id is required" }, { status: 400 });
  }

  const db    = getServerClient();
  const queue = new WorkflowQueue(db);

  // Emit DRILL_STARTED immediately (shows up in UI right away)
  await db.from("workflow_events").insert({
    workflow_id: workflowId,
    type:        "DRILL_STARTED",
    payload:     { ideaId: idea.id, _human: true },
    source:      "human",
  });

  // Enqueue the actual drill work
  await queue.enqueue(workflowId, "run_drill", { idea });

  return NextResponse.json({ queued: true, ideaId: idea.id });
}
