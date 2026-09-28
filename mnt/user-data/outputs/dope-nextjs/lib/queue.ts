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
