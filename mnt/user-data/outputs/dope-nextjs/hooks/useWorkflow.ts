// ============================================================
// hooks/useWorkflow.ts
// Frontend hook — the only interface the UI needs.
// Replaces dispatch() + useState + observeIdeas() entirely.
//
// State rebuilds automatically from Supabase Realtime events.
// Same reducer as the server — deterministic, identical output.
// ============================================================

"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { getBrowserClient, getSessionId } from "@/lib/supabase";
import type { RealtimeChannel } from "@supabase/supabase-js";

// ── STATE SHAPE (mirrors server reducer) ──────────────────────

export interface WorkflowState {
  phase:        string;
  ideas:        Idea[];
  shortlist:    string[];
  skipped:      string[];
  decision:     string | null;
  compareIds:   string[];
  error:        string | null;
  batchProgress: { done: number; total: number; current: string | null } | null;
}

export interface Idea {
  id:          string;
  name:        string;
  tagline:     string;
  problem:     string;
  target:      string;
  gap:         string;
  signals:     string[];
  tags:        string[];
  score:       number;
  confidence:  number;
  difficulty:  "low" | "medium" | "high";
  marketSize:  "small" | "medium" | "large";
  _lens?:      string;
}

export interface WorkflowEvent {
  id:          string;
  workflow_id: string;
  seq:         number;
  type:        string;
  payload:     Record<string, unknown>;
  source:      string;
  created_at:  string;
}

const INITIAL_STATE: WorkflowState = {
  phase: "idle", ideas: [], shortlist: [], skipped: [],
  decision: null, compareIds: [], error: null, batchProgress: null,
};

// ── REDUCER ───────────────────────────────────────────────────

function reducer(state: WorkflowState, event: WorkflowEvent): WorkflowState {
  const p = event.payload as Record<string, any>;

  switch (event.type) {
    case "WORKFLOW_STARTED":
      return { ...INITIAL_STATE, phase: "researching", batchProgress: null };

    case "BATCH_STARTED":
      return { ...INITIAL_STATE, phase: "researching", batchProgress: { done: 0, total: p.total ?? 4, current: null } };

    case "LENS_STARTED":
      return { ...state, batchProgress: state.batchProgress ? { ...state.batchProgress, current: p.lens } : null };

    case "LENS_COMPLETED": {
      const newIdeas = (p.ideas ?? []).map((i: any) => ({ ...i, _lens: p.lens }));
      return { ...state, ideas: dedup([...state.ideas, ...newIdeas]),
               batchProgress: state.batchProgress ? { ...state.batchProgress, done: state.batchProgress.done + 1, current: null } : null };
    }

    case "IDEAS_MERGED":
      return { ...state, phase: "awaiting_decision", ideas: p.ideas ?? state.ideas, batchProgress: null };

    case "IDEA_SHORTLISTED":
      return { ...state, shortlist: state.shortlist.includes(p.ideaId) ? state.shortlist.filter(id => id !== p.ideaId) : [...state.shortlist, p.ideaId] };

    case "IDEA_UNSHORTLISTED":
      return { ...state, shortlist: state.shortlist.filter(id => id !== p.ideaId) };

    case "IDEA_SKIPPED":
      return { ...state, skipped: state.skipped.includes(p.ideaId) ? state.skipped.filter(id => id !== p.ideaId) : [...state.skipped, p.ideaId] };

    case "COMPARE_TOGGLED":
      return { ...state, compareIds: state.compareIds.includes(p.ideaId) ? state.compareIds.filter(id => id !== p.ideaId) : state.compareIds.length < 2 ? [...state.compareIds, p.ideaId] : [state.compareIds[1], p.ideaId] };

    case "DRILL_STARTED":
      return { ...state, phase: "drilling" };

    case "DRILL_COMPLETED":
      return { ...state, phase: "awaiting_decision" };

    case "HUMAN_DECIDED":
      return { ...state, phase: "decided", decision: p.ideaId };

    case "DECISION_REVOKED":
      return { ...state, phase: "awaiting_decision", decision: null };

    case "WORKFLOW_COMPLETED":
      return { ...state, phase: "complete" };

    case "WORKFLOW_FAILED":
      return { ...state, phase: "error", error: p.message ?? "Unknown error" };

    case "WORKFLOW_ABORTED":
      return { ...state, phase: "aborted", error: p.reason ?? "Aborted" };

    default:
      return state;
  }
}

function dedup(ideas: Idea[]): Idea[] {
  return ideas.reduce((acc: Idea[], idea) => {
    const existing = acc.find(x => x.name?.toLowerCase().slice(0, 6) === idea.name?.toLowerCase().slice(0, 6));
    if (!existing || idea.score > existing.score) {
      return existing ? [...acc.filter(x => x !== existing), idea] : [...acc, idea];
    }
    return acc;
  }, []);
}

// ── HOOK ──────────────────────────────────────────────────────

export function useWorkflow() {
  const [state,      setState]      = useState<WorkflowState>({ ...INITIAL_STATE });
  const [workflowId, setWorkflowId] = useState<string | null>(null);
  const [eventLog,   setEventLog]   = useState<WorkflowEvent[]>([]);
  const [drillData,  setDrillData]  = useState<Record<string, unknown>>({});
  const [opinions,   setOpinions]   = useState<Record<string, unknown>>({});
  const [isLoading,  setIsLoading]  = useState(false);

  const stateRef  = useRef(state);
  const channelRef = useRef<RealtimeChannel | null>(null);

  useEffect(() => { stateRef.current = state; }, [state]);

  // ── Subscribe to a workflow ───────────────────────────────

  const subscribe = useCallback((wfId: string) => {
    channelRef.current?.unsubscribe();
    const db = getBrowserClient();

    // Fetch all existing events first (for resume/reload)
    db.from("workflow_events")
      .select("*")
      .eq("workflow_id", wfId)
      .order("seq", { ascending: true })
      .then(({ data }) => {
        if (!data) return;
        const events = data as WorkflowEvent[];
        const state  = events.reduce(reducer, { ...INITIAL_STATE });
        stateRef.current = state;
        setState(state);
        setEventLog(events);

        // Extract drill/opinion data from events
        const drills: Record<string, unknown> = {};
        const ops:    Record<string, unknown> = {};
        for (const e of events) {
          if (e.type === "DRILL_COMPLETED")   drills[(e.payload as any).ideaId] = (e.payload as any).report;
          if (e.type === "OPINION_COMPLETED") ops[(e.payload as any).ideaId]    = (e.payload as any).opinion;
        }
        setDrillData(drills);
        setOpinions(ops);
      });

    // Subscribe to new events via Realtime
    channelRef.current = db
      .channel(`workflow:${wfId}`)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "workflow_events", filter: `workflow_id=eq.${wfId}` },
        (payload) => {
          const event = payload.new as WorkflowEvent;
          const newState = reducer(stateRef.current, event);
          stateRef.current = newState;
          setState(newState);
          setEventLog(prev => [...prev, event]);

          if (event.type === "DRILL_COMPLETED")
            setDrillData(prev => ({ ...prev, [(event.payload as any).ideaId]: (event.payload as any).report }));
          if (event.type === "OPINION_COMPLETED")
            setOpinions(prev => ({ ...prev, [(event.payload as any).ideaId]: (event.payload as any).opinion }));
        })
      .subscribe();
  }, []);

  useEffect(() => () => { channelRef.current?.unsubscribe(); }, []);

  // ── Start a workflow ──────────────────────────────────────

  const startWorkflow = useCallback(async (params: {
    context?: string; count?: number; mode?: string; lens?: string;
    weights?: Record<string, number>; rubric?: Record<string, boolean>;
  }) => {
    setIsLoading(true);
    setState({ ...INITIAL_STATE, phase: "researching" });
    setEventLog([]); setDrillData({}); setOpinions({});

    try {
      const res = await fetch("/api/workflow", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId: getSessionId(), ...params }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to start workflow");

      setWorkflowId(data.workflowId);
      subscribe(data.workflowId);
      return data.workflowId as string;
    } finally {
      setIsLoading(false);
    }
  }, [subscribe]);

  // ── Resume a workflow ─────────────────────────────────────

  const resumeWorkflow = useCallback((wfId: string) => {
    setWorkflowId(wfId);
    setState({ ...INITIAL_STATE });
    setEventLog([]); setDrillData({}); setOpinions({});
    subscribe(wfId);
  }, [subscribe]);

  // ── Human action ──────────────────────────────────────────

  const sendAction = useCallback(async (type: string, payload: Record<string, unknown>) => {
    if (!workflowId) throw new Error("No active workflow");
    await fetch(`/api/workflow/${workflowId}/action`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: type.toUpperCase(), payload }),
    });
    // State updates via Realtime — no local dispatch needed
  }, [workflowId]);

  // ── Drill an idea ─────────────────────────────────────────

  const drillIdea = useCallback(async (idea: Idea) => {
    if (!workflowId) throw new Error("No active workflow");
    await fetch(`/api/workflow/${workflowId}/drill`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ idea }),
    });
    // DRILL_COMPLETED arrives via Realtime
  }, [workflowId]);

  // ── Abort workflow ────────────────────────────────────────

  const abortWorkflow = useCallback(async () => {
    if (!workflowId) return;
    await fetch(`/api/workflow/${workflowId}`, { method: "DELETE" });
  }, [workflowId]);

  // ── Reset ─────────────────────────────────────────────────

  const reset = useCallback(() => {
    channelRef.current?.unsubscribe();
    channelRef.current = null;
    setWorkflowId(null);
    setState({ ...INITIAL_STATE });
    setEventLog([]); setDrillData({}); setOpinions({});
  }, []);

  const isRunning = ["researching", "drilling", "batch_running"].includes(state.phase);

  return {
    state, workflowId, eventLog, drillData, opinions,
    isRunning, isLoading,
    startWorkflow, resumeWorkflow, sendAction, drillIdea, abortWorkflow, reset,
  };
}
