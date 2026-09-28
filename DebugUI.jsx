// ============================================================
// DebugUI.jsx
// The runtime debugger — makes the entire cognitive stack
// observable in one interface.
//
// Five panels:
//   1. Event Timeline  — scrubber + live event feed
//   2. Causal Graph    — reasoning chain visualization
//   3. Belief State    — per-idea probability distributions
//   4. Agent Monitor   — scheduler status + budget burn
//   5. Simulation Lab  — counterfactual + A/B testing
// ============================================================

import { useState, useEffect, useRef, useCallback } from "react";

// ── THEME ─────────────────────────────────────────────────────
const T = {
  bg:  "#07070f", bg2: "#0a0a14", bg3: "#0d0d1a", bg4: "#111128",
  border: "#1a1a2e", border2: "#252540",
  text: "#e2e8f0", text2: "#94a3b8", text3: "#64748b", text4: "#3d4a5c",
  indigo: "#6366f1", amber: "#f59e0b", emerald: "#10b981",
  rose: "#f43f5e", violet: "#8b5cf6", cyan: "#06b6d4", orange: "#f97316",
};

// ── EVENT TYPE COLORS ─────────────────────────────────────────
const EV_COLOR = {
  LENS_COMPLETED:     T.indigo,  LENS_STARTED:       T.indigo,
  CRITIQUE_COMPLETED: T.amber,   CRITIQUE_STARTED:   T.amber,
  PLAN_PROPOSED:      T.emerald, STRATEGY_SET:       T.emerald,
  DRILL_COMPLETED:    T.violet,  DRILL_STARTED:      T.violet,
  CONFLICT_DETECTED:  T.rose,    CONFLICT_RESOLVED:  T.emerald,
  HUMAN_DECIDED:      T.emerald, IDEA_SHORTLISTED:   T.cyan,
  IDEA_FLAGGED:       T.rose,    WORKFLOW_COMPLETED: T.emerald,
  WORKFLOW_FAILED:    T.rose,    SANDBOX_VIOLATION:  T.rose,
  TOKEN_USAGE:        T.orange,  AGENT_THROTTLED:    T.orange,
};

const ROLE_COLOR = {
  researcher:  T.indigo, critic:      T.amber,
  planner:     T.emerald, executor:   T.violet,
  coordinator: T.rose,
};

// ── MOCK DATA (replace with DOPERuntime.view() in production) ─
function generateMockRuntime() {
  const events = [
    { id: "e1", seq: 0, type: "WORKFLOW_STARTED",    agent_id: "planner-1",    agent_role: "planner",     confidence: 80, payload: { context: "healthcare" },             created_at: new Date(Date.now()-120000).toISOString() },
    { id: "e2", seq: 1, type: "PLAN_PROPOSED",        agent_id: "planner-1",    agent_role: "planner",     confidence: 75, payload: { lenses: ["market_gap","pain_driven"] }, created_at: new Date(Date.now()-115000).toISOString() },
    { id: "e3", seq: 2, type: "STRATEGY_SET",         agent_id: "planner-1",    agent_role: "planner",     confidence: 82, payload: { strategy: "parallel" },               created_at: new Date(Date.now()-114000).toISOString() },
    { id: "e4", seq: 3, type: "LENS_STARTED",         agent_id: "researcher-1", agent_role: "researcher",  confidence: 70, payload: { lens: "market_gap" },                  created_at: new Date(Date.now()-110000).toISOString() },
    { id: "e5", seq: 4, type: "LENS_COMPLETED",       agent_id: "researcher-1", agent_role: "researcher",  confidence: 72, payload: { lens: "market_gap", ideas: [{id:"idea_1",name:"HealthFlow",score:74},{id:"idea_2",name:"ClaimBot",score:68}] }, created_at: new Date(Date.now()-95000).toISOString() },
    { id: "e6", seq: 5, type: "LENS_COMPLETED",       agent_id: "researcher-1", agent_role: "researcher",  confidence: 68, payload: { lens: "pain_driven",  ideas: [{id:"idea_3",name:"PriorAuth AI",score:81},{id:"idea_4",name:"NoteSync",score:62}] }, created_at: new Date(Date.now()-80000).toISOString() },
    { id: "e7", seq: 6, type: "CRITIQUE_STARTED",     agent_id: "critic-1",     agent_role: "critic",      confidence: 85, payload: { ideaCount: 4 },                        created_at: new Date(Date.now()-75000).toISOString() },
    { id: "e8", seq: 7, type: "CRITIQUE_COMPLETED",   agent_id: "critic-1",     agent_role: "critic",      confidence: 88, payload: { ideaId: "idea_1", verdict: "strong", revisedScore: 78, reasoning: "Clear pain point, defensible moat via integrations" }, created_at: new Date(Date.now()-70000).toISOString() },
    { id: "e9", seq: 8, type: "CRITIQUE_COMPLETED",   agent_id: "critic-1",     agent_role: "critic",      confidence: 82, payload: { ideaId: "idea_3", verdict: "strong", revisedScore: 85, reasoning: "Prior auth is genuinely broken. Strong urgency signal." }, created_at: new Date(Date.now()-68000).toISOString() },
    { id:"e10", seq: 9, type: "IDEA_FLAGGED",         agent_id: "critic-1",     agent_role: "critic",      confidence: 90, payload: { ideaId: "idea_4", reason: "No recurring revenue model, low switching cost" }, created_at: new Date(Date.now()-65000).toISOString() },
    { id:"e11", seq:10, type: "CONFLICT_DETECTED",    agent_id: "coordinator-1",agent_role: "coordinator", confidence: 95, payload: { type: "score", agentA: "researcher-1", agentB: "critic-1", description: "Score conflict on idea_1: Δ4", severity: "low" }, created_at: new Date(Date.now()-60000).toISOString() },
    { id:"e12", seq:11, type: "CONFLICT_RESOLVED",    agent_id: "coordinator-1",agent_role: "coordinator", confidence: 78, payload: { conflictId: "e11", resolution: { strategy: "confidence_weight", winnerId: "critic-1", reasoning: "Confidence: 88 vs 72" } }, created_at: new Date(Date.now()-59000).toISOString() },
    { id:"e13", seq:12, type: "DRILL_STARTED",        agent_id: "executor-1",   agent_role: "executor",    confidence: 80, payload: { ideaId: "idea_3" },                     created_at: new Date(Date.now()-55000).toISOString() },
    { id:"e14", seq:13, type: "DRILL_COMPLETED",      agent_id: "executor-1",   agent_role: "executor",    confidence: 85, payload: { ideaId: "idea_3", report: { verdict: "GO", verdictReason: "Clear ROI, no good incumbent", mvpWeeks: 12, mvpCost: "$5-15k", arr12m: "$180k" } }, created_at: new Date(Date.now()-30000).toISOString() },
    { id:"e15", seq:14, type: "WORKFLOW_COMPLETED",   agent_id: "coordinator-1",agent_role: "coordinator", confidence: 92, payload: { ideaCount: 3, drillCount: 1 },           created_at: new Date(Date.now()-5000).toISOString() },
  ];

  const ideas = [
    { id: "idea_1", name: "HealthFlow",    tagline: "EHR workflow automation for small practices", score: 74, confidence: 76, difficulty: "medium", marketSize: "medium", tags: ["health-tech","workflow","B2B"], _lens: "market_gap",   belief: { mean: 76, std: 8,  ci95: [60,92], uncertainty: 22, verdict: "uncertain" } },
    { id: "idea_3", name: "PriorAuth AI",  tagline: "AI-powered prior authorization for insurers",  score: 85, confidence: 85, difficulty: "high",   marketSize: "large",  tags: ["health-tech","AI-native","compliance"], _lens: "pain_driven", belief: { mean: 85, std: 4,  ci95: [77,93], uncertainty: 12, verdict: "strong"   } },
    { id: "idea_2", name: "ClaimBot",      tagline: "Automated claims processing for billing depts", score: 65, confidence: 61, difficulty: "low",    marketSize: "medium", tags: ["health-tech","automation","B2B"], _lens: "market_gap",   belief: { mean: 64, std: 14, ci95: [36,92], uncertainty: 48, verdict: "uncertain" } },
    { id: "idea_4", name: "NoteSync",      tagline: "Clinical note sync across EHR systems",        score: 52, confidence: 55, difficulty: "medium", marketSize: "small",  tags: ["health-tech","data"], _lens: "pain_driven",  belief: { mean: 48, std: 18, ci95: [12,84], uncertainty: 72, verdict: "weak"     }, flagged: true },
  ];

  const agents = [
    { id: "planner-1",    role: "planner",     eventsEmitted: 3,  budgetRemaining: 27, currentRate: 0, status: "idle" },
    { id: "researcher-1", role: "researcher",  eventsEmitted: 4,  budgetRemaining: 46, currentRate: 0, status: "idle" },
    { id: "critic-1",     role: "critic",      eventsEmitted: 4,  budgetRemaining: 96, currentRate: 0, status: "idle" },
    { id: "executor-1",   role: "executor",    eventsEmitted: 2,  budgetRemaining: 38, currentRate: 0, status: "idle" },
    { id: "coordinator-1",role: "coordinator", eventsEmitted: 3,  budgetRemaining: 17, currentRate: 0, status: "idle" },
  ];

  const budget = { globalSpendCents: 42, globalBudgetCents: 100, utilizationPct: 42, topConsumer: "researcher-1",
    agentBreakdown: [
      { agentId: "researcher-1", spendCents: 18, tokens: 4200, operations: 2 },
      { agentId: "critic-1",     spendCents: 12, tokens: 2800, operations: 2 },
      { agentId: "executor-1",   spendCents: 8,  tokens: 1900, operations: 1 },
      { agentId: "planner-1",    spendCents: 3,  tokens: 700,  operations: 1 },
      { agentId: "coordinator-1",spendCents: 1,  tokens: 300,  operations: 1 },
    ]};

  const policies = [
    { id: "confidence_weight", name: "Confidence Weight", weight: 0.82, applied: 2, accuracy: 0.85 },
    { id: "role_priority",     name: "Role Priority",     weight: 0.70, applied: 3, accuracy: 0.67 },
    { id: "historical_lens",   name: "Historical Lens",   weight: 0.60, applied: 0, accuracy: 0    },
    { id: "merge_scores",      name: "Merge Scores",      weight: 0.50, applied: 1, accuracy: 0.50 },
    { id: "recency",           name: "Recency",           weight: 0.40, applied: 1, accuracy: 0.40 },
  ];

  const causalStats = { nodeCount: 15, edgeCount: 18, traceCount: 3, maxDepth: 6, contradictions: 2, resolutions: 1, cycles: 0 };

  return { events, ideas, agents, budget, policies, causalStats, workflowId: "wf_healthcare_001", eventCount: 15, latestSeq: 14 };
}

// ── SHARED COMPONENTS ─────────────────────────────────────────

function Panel({ title, icon, children, style }) {
  return (
    <div style={{ background: T.bg2, border: `1px solid ${T.border}`, borderRadius: 6, overflow: "hidden", ...style }}>
      <div style={{ padding: "10px 14px", borderBottom: `1px solid ${T.border}`, display: "flex", alignItems: "center", gap: 8, background: T.bg3 }}>
        <span style={{ fontSize: 14 }}>{icon}</span>
        <span style={{ fontSize: 11, letterSpacing: 2, color: T.text2, fontFamily: "monospace" }}>{title}</span>
      </div>
      <div style={{ padding: 14 }}>{children}</div>
    </div>
  );
}

function Badge({ label, color, small }) {
  return (
    <span style={{ fontSize: small ? 9 : 10, color, border: `1px solid ${color}44`, borderRadius: 3, padding: small ? "1px 4px" : "2px 6px", fontFamily: "monospace", letterSpacing: 1, whiteSpace: "nowrap" }}>
      {label}
    </span>
  );
}

function MiniBar({ value, max, color, height = 4 }) {
  return (
    <div style={{ height, background: T.border, borderRadius: 2, overflow: "hidden" }}>
      <div style={{ width: `${Math.min(100, (value / max) * 100)}%`, height: "100%", background: color, transition: "width 0.4s" }} />
    </div>
  );
}

// ── PANEL 1: EVENT TIMELINE ───────────────────────────────────

function EventTimeline({ events, onSeek, seekSeq }) {
  const [filter, setFilter] = useState("all");
  const bottomRef = useRef(null);

  const eventTypes = ["all", ...new Set(events.map(e => e.type))];
  const filtered = filter === "all" ? events : events.filter(e => e.type === filter);

  const typeOptions = Object.fromEntries(eventTypes.map(t => [t, t === "all" ? "All events" : t]));

  return (
    <Panel title="EVENT TIMELINE" icon="⟳" style={{ height: "100%", display: "flex", flexDirection: "column" }}>
      <div style={{ display: "flex", gap: 8, marginBottom: 12, alignItems: "center" }}>
        <select value={filter} onChange={e => setFilter(e.target.value)} style={{ background: T.bg3, border: `1px solid ${T.border2}`, color: T.text2, fontSize: 11, padding: "4px 8px", borderRadius: 3, fontFamily: "monospace", flex: 1 }}>
          {Object.entries(typeOptions).map(([k,v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        <span style={{ color: T.text3, fontSize: 10, fontFamily: "monospace" }}>{filtered.length} events</span>
      </div>

      {/* Scrubber */}
      <div style={{ marginBottom: 12 }}>
        <div style={{ fontSize: 10, color: T.text4, letterSpacing: 1, marginBottom: 4 }}>TIMELINE SCRUBBER</div>
        <input type="range" min={0} max={events.length - 1} value={seekSeq ?? events.length - 1}
          onChange={e => onSeek(events[parseInt(e.target.value)]?.seq ?? 0)}
          style={{ width: "100%", accentColor: T.indigo }} />
        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 9, color: T.text4, fontFamily: "monospace" }}>
          <span>seq:0</span>
          <span style={{ color: T.indigo }}>seq:{seekSeq ?? events.at(-1)?.seq ?? 0}</span>
          <span>seq:{events.at(-1)?.seq ?? 0}</span>
        </div>
      </div>

      {/* Event list */}
      <div style={{ flex: 1, overflow: "auto", display: "flex", flexDirection: "column", gap: 2 }}>
        {filtered.map(e => {
          const color   = EV_COLOR[e.type] ?? T.text3;
          const isSeeked = e.seq === seekSeq;
          return (
            <div key={e.id} onClick={() => onSeek(e.seq)}
              style={{ display: "flex", gap: 8, padding: "5px 8px", borderRadius: 3, cursor: "pointer", background: isSeeked ? T.bg4 : "transparent", border: `1px solid ${isSeeked ? color + "44" : "transparent"}`, transition: "all 0.1s" }}>
              <span style={{ color: T.text4, fontSize: 10, minWidth: 28, fontFamily: "monospace" }}>{String(e.seq).padStart(3,"0")}</span>
              <div style={{ width: 2, background: color, borderRadius: 1, alignSelf: "stretch", minWidth: 2 }} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: "flex", gap: 6, alignItems: "center", marginBottom: 1 }}>
                  <span style={{ color, fontSize: 10, fontFamily: "monospace" }}>{e.type}</span>
                  <Badge label={e.agent_role} color={ROLE_COLOR[e.agent_role] ?? T.text3} small />
                  <span style={{ color: T.text4, fontSize: 9, marginLeft: "auto" }}>{e.confidence}%</span>
                </div>
                <div style={{ color: T.text3, fontSize: 10, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {JSON.stringify(e.payload ?? {}).slice(0, 55)}
                </div>
              </div>
            </div>
          );
        })}
        <div ref={bottomRef} />
      </div>
    </Panel>
  );
}

// ── PANEL 2: CAUSAL GRAPH ─────────────────────────────────────

function CausalGraphPanel({ events, stats, selectedSeq }) {
  // Build a simple visual from event sequence (real version uses CausalGraph.toDOT())
  const relevant = events.filter(e => e.seq <= (selectedSeq ?? 999));
  const CAUSAL_TRIGGERS = {
    STRATEGY_SET:      "PLAN_PROPOSED",
    CRITIQUE_STARTED:  "LENS_COMPLETED",
    CRITIQUE_COMPLETED:"CRITIQUE_STARTED",
    DRILL_STARTED:     "CRITIQUE_COMPLETED",
    DRILL_COMPLETED:   "DRILL_STARTED",
    CONFLICT_RESOLVED: "CONFLICT_DETECTED",
    WORKFLOW_COMPLETED:"DRILL_COMPLETED",
  };

  const chains = relevant.reduce((acc, e) => {
    const parent = CAUSAL_TRIGGERS[e.type];
    if (parent) {
      const parentEvt = relevant.findLast(p => p.type === parent);
      if (parentEvt) acc.push({ from: parentEvt, to: e });
    }
    return acc;
  }, []);

  return (
    <Panel title="CAUSAL GRAPH" icon="◈">
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: 8, marginBottom: 14 }}>
        {[["Nodes", stats.nodeCount, T.indigo],["Edges", stats.edgeCount, T.cyan],["Contradictions", stats.contradictions, T.rose],["Cycles", stats.cycles, stats.cycles > 0 ? T.rose : T.emerald]].map(([l,v,c]) => (
          <div key={l} style={{ background: T.bg3, borderRadius: 4, padding: "8px 10px", textAlign: "center" }}>
            <div style={{ fontSize: 18, color: c, fontFamily: "monospace" }}>{v}</div>
            <div style={{ fontSize: 9, color: T.text4, letterSpacing: 1 }}>{l.toUpperCase()}</div>
          </div>
        ))}
      </div>

      <div style={{ fontSize: 10, color: T.text4, letterSpacing: 1, marginBottom: 8 }}>REASONING CHAINS (up to seq {selectedSeq ?? "latest"})</div>
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        {chains.slice(-6).map((chain, i) => {
          const fromColor = EV_COLOR[chain.from.type] ?? T.text3;
          const toColor   = EV_COLOR[chain.to.type]   ?? T.text3;
          return (
            <div key={i} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 10, fontFamily: "monospace" }}>
              <span style={{ color: fromColor, fontSize: 9 }}>[{chain.from.seq}] {chain.from.type.split("_").slice(0,2).join("_")}</span>
              <span style={{ color: T.text4 }}>→</span>
              <span style={{ color: toColor,   fontSize: 9 }}>[{chain.to.seq}] {chain.to.type.split("_").slice(0,2).join("_")}</span>
              <span style={{ color: T.text4, fontSize: 9, marginLeft: "auto" }}>{chain.to.agent_role}</span>
            </div>
          );
        })}
      </div>

      <div style={{ marginTop: 12, padding: 8, background: T.bg3, borderRadius: 4 }}>
        <div style={{ fontSize: 10, color: T.text4, marginBottom: 4 }}>TRACE DEPTH</div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <div style={{ flex: 1, height: 6, background: T.border, borderRadius: 3 }}>
            <div style={{ width: `${(stats.maxDepth / 10) * 100}%`, height: "100%", background: `linear-gradient(90deg,${T.indigo},${T.violet})`, borderRadius: 3 }} />
          </div>
          <span style={{ fontSize: 11, color: T.indigo, fontFamily: "monospace" }}>depth:{stats.maxDepth}</span>
        </div>
      </div>
    </Panel>
  );
}

// ── PANEL 3: BELIEF STATE ─────────────────────────────────────

function BeliefStatePanel({ ideas }) {
  return (
    <Panel title="BELIEF STATE" icon="◎">
      <div style={{ fontSize: 10, color: T.text4, letterSpacing: 1, marginBottom: 10 }}>
        BAYESIAN DISTRIBUTIONS — mean ± std
      </div>
      {ideas.map(idea => {
        const b   = idea.belief;
        const vc  = b.verdict === "strong" ? T.emerald : b.verdict === "weak" ? T.rose : T.amber;
        return (
          <div key={idea.id} style={{ marginBottom: 14 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
              <span style={{ fontSize: 12, color: T.text, fontWeight: 600 }}>{idea.name}</span>
              {idea.flagged && <Badge label="FLAGGED" color={T.rose} small />}
              <Badge label={b.verdict.toUpperCase()} color={vc} small />
              <span style={{ marginLeft: "auto", fontSize: 10, color: T.text3, fontFamily: "monospace" }}>
                uncertainty:{b.uncertainty}%
              </span>
            </div>

            {/* Distribution bar */}
            <div style={{ position: "relative", height: 20, background: T.bg3, borderRadius: 3, overflow: "hidden", marginBottom: 3 }}>
              {/* CI95 band */}
              <div style={{ position: "absolute", left: `${b.ci95[0]}%`, width: `${b.ci95[1] - b.ci95[0]}%`, height: "100%", background: vc + "22" }} />
              {/* ±1 std band */}
              <div style={{ position: "absolute", left: `${Math.max(0, b.mean - b.std)}%`, width: `${b.std * 2}%`, height: "100%", background: vc + "44" }} />
              {/* Mean line */}
              <div style={{ position: "absolute", left: `${b.mean}%`, width: 2, height: "100%", background: vc }} />
            </div>

            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 9, color: T.text4, fontFamily: "monospace" }}>
              <span>CI95: [{b.ci95[0]}, {b.ci95[1]}]</span>
              <span style={{ color: vc }}>μ={b.mean} σ={b.std}</span>
              <span>confidence: {idea.confidence}%</span>
            </div>
          </div>
        );
      })}

      <div style={{ borderTop: `1px solid ${T.border}`, paddingTop: 10, marginTop: 4 }}>
        <div style={{ fontSize: 10, color: T.text4, letterSpacing: 1, marginBottom: 6 }}>SYSTEM BELIEF SUMMARY</div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 6 }}>
          {[
            ["STRONG",    ideas.filter(i => i.belief.verdict === "strong").length,    T.emerald],
            ["UNCERTAIN", ideas.filter(i => i.belief.verdict === "uncertain").length, T.amber],
            ["WEAK",      ideas.filter(i => i.belief.verdict === "weak").length,      T.rose],
          ].map(([l,v,c]) => (
            <div key={l} style={{ background: T.bg3, borderRadius: 4, padding: "6px 8px", textAlign: "center" }}>
              <div style={{ fontSize: 16, color: c }}>{v}</div>
              <div style={{ fontSize: 9, color: T.text4, letterSpacing: 1 }}>{l}</div>
            </div>
          ))}
        </div>
      </div>
    </Panel>
  );
}

// ── PANEL 4: AGENT MONITOR ────────────────────────────────────

function AgentMonitor({ agents, budget, policies }) {
  return (
    <Panel title="AGENT MONITOR" icon="⬡">
      {/* Global budget */}
      <div style={{ marginBottom: 14 }}>
        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10, color: T.text3, marginBottom: 4 }}>
          <span style={{ letterSpacing: 1 }}>GLOBAL BUDGET</span>
          <span style={{ fontFamily: "monospace", color: budget.utilizationPct > 80 ? T.rose : T.amber }}>
            {budget.globalSpendCents}¢ / {budget.globalBudgetCents}¢
          </span>
        </div>
        <MiniBar value={budget.globalSpendCents} max={budget.globalBudgetCents}
          color={budget.utilizationPct > 80 ? T.rose : budget.utilizationPct > 50 ? T.amber : T.emerald} height={6} />
      </div>

      {/* Per-agent breakdown */}
      <div style={{ fontSize: 10, color: T.text4, letterSpacing: 1, marginBottom: 8 }}>AGENT SPEND</div>
      <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 14 }}>
        {budget.agentBreakdown.map(a => {
          const ag    = agents.find(x => x.id === a.agentId);
          const color = ROLE_COLOR[ag?.role] ?? T.text3;
          const maxCents = { researcher: 40, critic: 25, planner: 10, executor: 20, coordinator: 5 }[ag?.role] ?? 20;
          return (
            <div key={a.agentId}>
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 3 }}>
                <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                  <span style={{ fontSize: 10, color, fontFamily: "monospace" }}>{a.agentId}</span>
                  <Badge label={ag?.role?.toUpperCase() ?? "?"} color={color} small />
                </div>
                <span style={{ fontSize: 10, color: T.text3, fontFamily: "monospace" }}>{a.spendCents}¢ · {a.tokens.toLocaleString()}tok</span>
              </div>
              <MiniBar value={a.spendCents} max={maxCents} color={color} height={3} />
            </div>
          );
        })}
      </div>

      {/* Policy weights */}
      <div style={{ fontSize: 10, color: T.text4, letterSpacing: 1, marginBottom: 8 }}>POLICY WEIGHTS (adaptive)</div>
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        {policies.map(p => (
          <div key={p.id}>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10, marginBottom: 2 }}>
              <span style={{ color: T.text2 }}>{p.name}</span>
              <span style={{ fontFamily: "monospace", color: T.text3 }}>
                {p.applied > 0 ? `${Math.round(p.accuracy * 100)}% acc` : "unused"} · w={p.weight.toFixed(2)}
              </span>
            </div>
            <MiniBar value={p.weight * 100} max={100}
              color={p.weight > 0.7 ? T.emerald : p.weight > 0.5 ? T.amber : T.text4} height={3} />
          </div>
        ))}
      </div>
    </Panel>
  );
}

// ── PANEL 5: SIMULATION LAB ───────────────────────────────────

function SimulationLab({ events, ideas }) {
  const [mode, setMode] = useState("counterfactual");  // counterfactual | abtest | branch
  const [targetSeq, setTargetSeq] = useState(events[7]?.seq ?? 0);
  const [altScore, setAltScore]   = useState(30);
  const [simResult, setSimResult] = useState(null);

  function runSim() {
    // In production: calls SimulationEngine.simulate()
    // Here: mock the result
    const targetEvent = events.find(e => e.seq === targetSeq);
    if (!targetEvent) return;
    const originalIdea = ideas.find(i => i.id === targetEvent.payload?.ideaId);
    if (!originalIdea) return;

    setSimResult({
      original: { ideaName: originalIdea.name, score: originalIdea.score, verdict: originalIdea.belief.verdict },
      simulated: { ideaName: originalIdea.name, score: altScore, verdict: altScore >= 70 ? "strong" : altScore >= 45 ? "uncertain" : "weak" },
      diff: {
        scoreDelta: altScore - originalIdea.score,
        phaseChanged: false,
        summary: `${originalIdea.name} score: ${originalIdea.score} → ${altScore} (Δ${altScore - originalIdea.score > 0 ? "+" : ""}${altScore - originalIdea.score})`,
      },
    });
  }

  const critiqueEvents = events.filter(e => e.type === "CRITIQUE_COMPLETED");

  return (
    <Panel title="SIMULATION LAB" icon="⟲">
      {/* Mode selector */}
      <div style={{ display: "flex", gap: 1, marginBottom: 14, border: `1px solid ${T.border2}`, borderRadius: 4, overflow: "hidden" }}>
        {[["counterfactual","Counterfactual"],["abtest","A/B Test"],["branch","Branch"]].map(([m,l]) => (
          <button key={m} onClick={() => setMode(m)} style={{ flex: 1, background: mode === m ? T.indigo : T.bg3, color: mode === m ? "#fff" : T.text3, border: "none", padding: "7px 0", cursor: "pointer", fontSize: 10, fontFamily: "monospace", letterSpacing: 1 }}>{l.toUpperCase()}</button>
        ))}
      </div>

      {mode === "counterfactual" && (
        <div>
          <div style={{ fontSize: 10, color: T.text4, letterSpacing: 1, marginBottom: 8 }}>
            WHAT IF A CRITIQUE HAD SCORED DIFFERENTLY?
          </div>
          <div style={{ marginBottom: 10 }}>
            <div style={{ fontSize: 10, color: T.text3, marginBottom: 4 }}>Target event (seq)</div>
            <select value={targetSeq} onChange={e => setTargetSeq(parseInt(e.target.value))}
              style={{ width: "100%", background: T.bg3, border: `1px solid ${T.border2}`, color: T.text2, fontSize: 11, padding: "6px 8px", borderRadius: 3, fontFamily: "monospace" }}>
              {critiqueEvents.map(e => (
                <option key={e.seq} value={e.seq}>[{e.seq}] {e.type} → {e.payload?.ideaId} ({e.payload?.revisedScore})</option>
              ))}
            </select>
          </div>
          <div style={{ marginBottom: 12 }}>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10, color: T.text3, marginBottom: 4 }}>
              <span>Alternative score</span>
              <span style={{ fontFamily: "monospace", color: T.indigo }}>{altScore}</span>
            </div>
            <input type="range" min={0} max={100} value={altScore} onChange={e => setAltScore(parseInt(e.target.value))}
              style={{ width: "100%", accentColor: T.indigo }} />
          </div>
          <button onClick={runSim} style={{ width: "100%", background: T.indigo, color: "#fff", border: "none", borderRadius: 4, padding: "8px 0", cursor: "pointer", fontSize: 11, fontFamily: "monospace", letterSpacing: 1 }}>
            RUN SIMULATION →
          </button>

          {simResult && (
            <div style={{ marginTop: 12, padding: 10, background: T.bg3, borderRadius: 4 }}>
              <div style={{ fontSize: 10, color: T.indigo, letterSpacing: 1, marginBottom: 8 }}>SIMULATION RESULT</div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 8 }}>
                {[["ORIGINAL", simResult.original],["SIMULATED", simResult.simulated]].map(([label, d]) => {
                  const vc = d.verdict === "strong" ? T.emerald : d.verdict === "weak" ? T.rose : T.amber;
                  return (
                    <div key={label} style={{ background: T.bg4, borderRadius: 4, padding: 8 }}>
                      <div style={{ fontSize: 9, color: T.text4, letterSpacing: 1, marginBottom: 4 }}>{label}</div>
                      <div style={{ fontSize: 13, color: T.text, marginBottom: 2 }}>{d.ideaName}</div>
                      <div style={{ display: "flex", gap: 6 }}>
                        <span style={{ fontSize: 12, color: vc, fontFamily: "monospace" }}>{d.score}</span>
                        <Badge label={d.verdict.toUpperCase()} color={vc} small />
                      </div>
                    </div>
                  );
                })}
              </div>
              <div style={{ fontSize: 11, color: T.text2, fontFamily: "monospace" }}>{simResult.diff.summary}</div>
              {simResult.diff.scoreDelta > 10 && (
                <div style={{ marginTop: 6, fontSize: 10, color: T.amber }}>
                  ⚠ Large score shift — this idea might have ranked differently
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {mode === "abtest" && (
        <div style={{ color: T.text3, fontSize: 12, textAlign: "center", padding: 30 }}>
          <div style={{ fontSize: 24, marginBottom: 8 }}>⟲</div>
          <div>A/B test: inject two planner strategies at any branch point and compare outcomes.</div>
          <div style={{ marginTop: 8, fontSize: 10, color: T.text4 }}>Wire to SimulationEngine.abTest() in production</div>
        </div>
      )}

      {mode === "branch" && (
        <div style={{ color: T.text3, fontSize: 12, textAlign: "center", padding: 30 }}>
          <div style={{ fontSize: 24, marginBottom: 8 }}>⎇</div>
          <div>Branch: fork the event timeline at any seq and replay with an alternative event.</div>
          <div style={{ marginTop: 8, fontSize: 10, color: T.text4 }}>Wire to BranchEngine.branch() in production</div>
        </div>
      )}
    </Panel>
  );
}

// ── MAIN DEBUG UI ─────────────────────────────────────────────

export default function DebugUI() {
  const [runtime]    = useState(generateMockRuntime);
  const [seekSeq,    setSeekSeq]    = useState(null);
  const [activeTab,  setActiveTab]  = useState("timeline");
  const [liveMode,   setLiveMode]   = useState(false);

  // Simulate a new live event every 3s when liveMode is on
  useEffect(() => {
    if (!liveMode) return;
    const id = setInterval(() => {
      // In production: new events arrive via DOPERuntime.subscribeRealtime()
    }, 3000);
    return () => clearInterval(id);
  }, [liveMode]);

  const seekedEvents = seekSeq !== null
    ? runtime.events.filter(e => e.seq <= seekSeq)
    : runtime.events;

  const tabs = ["timeline","causal","beliefs","agents","simulation"];
  const tabLabels = { timeline:"Event Timeline", causal:"Causal Graph", beliefs:"Belief State", agents:"Agent Monitor", simulation:"Simulation Lab" };
  const tabIcons  = { timeline:"⟳", causal:"◈", beliefs:"◎", agents:"⬡", simulation:"⟲" };

  return (
    <div style={{ minHeight: "100vh", background: T.bg, color: T.text, fontFamily: "'IBM Plex Mono','Courier New',monospace", display: "flex", flexDirection: "column" }}>

      {/* Header */}
      <div style={{ borderBottom: `1px solid ${T.border}`, padding: "10px 20px", background: T.bg2, display: "flex", alignItems: "center", gap: 14 }}>
        <div>
          <div style={{ fontSize: 14, letterSpacing: 6, fontWeight: 700 }}>DOPE</div>
          <div style={{ fontSize: 9, color: T.text4, letterSpacing: 2 }}>COGNITIVE RUNTIME DEBUGGER</div>
        </div>
        <div style={{ width: 1, background: T.border, height: 32 }} />
        <div style={{ fontSize: 11, color: T.text3, fontFamily: "monospace" }}>
          wf: <span style={{ color: T.indigo }}>{runtime.workflowId}</span>
        </div>
        <div style={{ fontSize: 11, color: T.text3 }}>
          {runtime.eventCount} events · seq:{runtime.latestSeq}
        </div>
        <div style={{ flex: 1 }} />

        {/* Budget pill */}
        <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "4px 10px", background: T.bg3, borderRadius: 20, border: `1px solid ${T.border2}` }}>
          <div style={{ width: 48, height: 4, background: T.border, borderRadius: 2, overflow: "hidden" }}>
            <div style={{ width: `${runtime.budget.utilizationPct}%`, height: "100%", background: runtime.budget.utilizationPct > 80 ? T.rose : T.emerald }} />
          </div>
          <span style={{ fontSize: 10, color: T.text2, fontFamily: "monospace" }}>${(runtime.budget.globalSpendCents / 100).toFixed(2)}</span>
        </div>

        {/* Live mode toggle */}
        <button onClick={() => setLiveMode(l => !l)} style={{ background: liveMode ? T.emerald + "22" : T.bg3, border: `1px solid ${liveMode ? T.emerald : T.border2}`, borderRadius: 4, color: liveMode ? T.emerald : T.text3, padding: "4px 10px", cursor: "pointer", fontSize: 10, fontFamily: "monospace" }}>
          {liveMode ? "● LIVE" : "○ LIVE"}
        </button>
      </div>

      {/* Tab bar */}
      <div style={{ borderBottom: `1px solid ${T.border}`, background: T.bg2, display: "flex", padding: "0 20px", gap: 0 }}>
        {tabs.map(tab => (
          <button key={tab} onClick={() => setActiveTab(tab)} style={{ background: "none", border: "none", borderBottom: activeTab === tab ? `2px solid ${T.indigo}` : "2px solid transparent", color: activeTab === tab ? T.text : T.text3, padding: "9px 14px", cursor: "pointer", fontSize: 10, fontFamily: "monospace", letterSpacing: 1, display: "flex", gap: 6, alignItems: "center" }}>
            <span>{tabIcons[tab]}</span>{tabLabels[tab].toUpperCase()}
          </button>
        ))}
      </div>

      {/* Body */}
      <div style={{ flex: 1, overflow: "auto", padding: 16 }}>
        {activeTab === "timeline" && (
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, height: "calc(100vh - 130px)" }}>
            <EventTimeline events={runtime.events} onSeek={setSeekSeq} seekSeq={seekSeq} />
            <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
              {/* Seeked state summary */}
              <Panel title="STATE AT seq:" icon="→">
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8 }}>
                  {[
                    ["Ideas",    seekedEvents.filter(e=>e.type==="LENS_COMPLETED").flatMap(e=>e.payload?.ideas??[]).length, T.indigo],
                    ["Critiques",seekedEvents.filter(e=>e.type==="CRITIQUE_COMPLETED").length, T.amber],
                    ["Conflicts",seekedEvents.filter(e=>e.type==="CONFLICT_DETECTED").length, T.rose],
                    ["Resolved", seekedEvents.filter(e=>e.type==="CONFLICT_RESOLVED").length, T.emerald],
                    ["Drills",   seekedEvents.filter(e=>e.type==="DRILL_COMPLETED").length, T.violet],
                    ["Phase",    seekedEvents.findLast(e=>["STRATEGY_SET","IDEAS_MERGED","WORKFLOW_COMPLETED"].includes(e.type))?.type?.replace("_"," ").toLowerCase() ?? "idle", T.cyan],
                  ].map(([l,v,c]) => (
                    <div key={l} style={{ background: T.bg3, borderRadius: 4, padding: "8px 10px", textAlign: "center" }}>
                      <div style={{ fontSize: 14, color: c, fontFamily: "monospace" }}>{v}</div>
                      <div style={{ fontSize: 9, color: T.text4, letterSpacing: 1 }}>{String(l).toUpperCase()}</div>
                    </div>
                  ))}
                </div>
              </Panel>
              <Panel title="ACTIVE AGENTS" icon="⬡">
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  {runtime.agents.map(a => (
                    <div key={a.id} style={{ display: "flex", gap: 10, alignItems: "center" }}>
                      <div style={{ width: 6, height: 6, borderRadius: "50%", background: ROLE_COLOR[a.role] }} />
                      <span style={{ fontSize: 11, color: T.text2, minWidth: 110, fontFamily: "monospace" }}>{a.id}</span>
                      <div style={{ flex: 1 }}><MiniBar value={a.eventsEmitted} max={a.eventsEmitted + a.budgetRemaining} color={ROLE_COLOR[a.role]} /></div>
                      <span style={{ fontSize: 10, color: T.text3, fontFamily: "monospace" }}>{a.eventsEmitted} emitted</span>
                    </div>
                  ))}
                </div>
              </Panel>
            </div>
          </div>
        )}

        {activeTab === "causal" && (
          <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: 16 }}>
            <CausalGraphPanel events={runtime.events} stats={runtime.causalStats} selectedSeq={seekSeq} />
            <Panel title="REASONING CHAIN LEGEND" icon="◈">
              {[["triggered_by","A directly caused B",T.indigo],["contradicts","B disagrees with A",T.rose],["refines","B updates A",T.amber],["resolves","B settles A vs C",T.emerald],["compensates","B undoes A",T.orange],["parallel_to","Concurrent",T.text4]].map(([type,desc,c]) => (
                <div key={type} style={{ display: "flex", gap: 10, marginBottom: 10, alignItems: "flex-start" }}>
                  <div style={{ width: 3, minWidth: 3, height: 28, background: c, borderRadius: 1, marginTop: 2 }} />
                  <div>
                    <div style={{ fontSize: 10, color: c, fontFamily: "monospace", letterSpacing: 1 }}>{type}</div>
                    <div style={{ fontSize: 10, color: T.text3 }}>{desc}</div>
                  </div>
                </div>
              ))}
            </Panel>
          </div>
        )}

        {activeTab === "beliefs" && (
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
            <BeliefStatePanel ideas={runtime.ideas} />
            <Panel title="RANKED BY EFFECTIVE SCORE" icon="↓">
              <div style={{ fontSize: 10, color: T.text4, letterSpacing: 1, marginBottom: 10 }}>
                effective score = μ − 0.5σ (penalises uncertainty)
              </div>
              {[...runtime.ideas]
                .map(i => ({ ...i, effective: Math.round(i.belief.mean - i.belief.std * 0.5) }))
                .sort((a, b) => b.effective - a.effective)
                .map((idea, rank) => {
                  const vc = idea.belief.verdict === "strong" ? T.emerald : idea.belief.verdict === "weak" ? T.rose : T.amber;
                  return (
                    <div key={idea.id} style={{ display: "flex", gap: 10, marginBottom: 12, alignItems: "flex-start" }}>
                      <span style={{ fontSize: 18, color: rank === 0 ? T.emerald : T.text4, fontFamily: "monospace", minWidth: 24 }}>#{rank + 1}</span>
                      <div style={{ flex: 1 }}>
                        <div style={{ display: "flex", gap: 8, marginBottom: 3, alignItems: "center" }}>
                          <span style={{ fontSize: 12, color: T.text }}>{idea.name}</span>
                          {idea.flagged && <Badge label="FLAGGED" color={T.rose} small />}
                        </div>
                        <div style={{ marginBottom: 3 }}>
                          <div style={{ height: 4, background: T.border, borderRadius: 2, overflow: "hidden" }}>
                            <div style={{ width: `${idea.effective}%`, height: "100%", background: vc }} />
                          </div>
                        </div>
                        <div style={{ display: "flex", gap: 8, fontSize: 10, color: T.text3, fontFamily: "monospace" }}>
                          <span>effective: <span style={{ color: vc }}>{idea.effective}</span></span>
                          <span>raw: {idea.score}</span>
                          <span>σ: {idea.belief.std}</span>
                        </div>
                      </div>
                    </div>
                  );
                })}
            </Panel>
          </div>
        )}

        {activeTab === "agents" && (
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
            <AgentMonitor agents={runtime.agents} budget={runtime.budget} policies={runtime.policies} />
            <Panel title="COST PREDICTION" icon="$">
              <div style={{ fontSize: 10, color: T.text4, letterSpacing: 1, marginBottom: 10 }}>
                ESTIMATED vs ACTUAL SPEND
              </div>
              {[
                ["lens_run (×4)",       "researcher-1", 16, T.indigo],
                ["critique_batch (×2)", "critic-1",      8, T.amber],
                ["drill_single (×1)",   "executor-1",    6, T.violet],
                ["plan_single (×1)",    "planner-1",     2, T.emerald],
                ["coordinator (×2)",    "coordinator-1", 1, T.rose],
              ].map(([op, agent, est, c]) => {
                const actual = runtime.budget.agentBreakdown.find(a => a.agentId === agent)?.spendCents ?? 0;
                return (
                  <div key={op} style={{ marginBottom: 10 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10, marginBottom: 3 }}>
                      <span style={{ color: T.text2 }}>{op}</span>
                      <span style={{ fontFamily: "monospace", color: T.text3 }}>est:{est}¢ · actual:{actual}¢</span>
                    </div>
                    <div style={{ display: "flex", gap: 2, height: 6 }}>
                      <div style={{ width: `${est}%`, height: "100%", background: c + "55", borderRadius: 1 }} />
                      <div style={{ width: `${actual}%`, height: "100%", background: c, borderRadius: 1 }} />
                    </div>
                  </div>
                );
              })}
              <div style={{ borderTop: `1px solid ${T.border}`, paddingTop: 10, marginTop: 4, fontSize: 11, color: T.text2, fontFamily: "monospace" }}>
                Total: est 33¢ · actual 42¢ (27% over)
              </div>
            </Panel>
          </div>
        )}

        {activeTab === "simulation" && (
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
            <SimulationLab events={runtime.events} ideas={runtime.ideas} />
            <Panel title="SIMULATION GUIDE" icon="⟲">
              {[
                ["Counterfactual", "Change one event's payload. See how the full workflow state would differ. Use to debug: 'why did the critic score this idea low?'"],
                ["A/B Test", "Inject two different planner strategies at the same point. Compare which produces higher-scoring ideas. Use before committing to a research approach."],
                ["Branch", "Fork the timeline at any seq. Apply an alternative event. See what state you'd get without the tail events. The original timeline is preserved."],
              ].map(([name, desc]) => (
                <div key={name} style={{ marginBottom: 14 }}>
                  <div style={{ fontSize: 11, color: T.indigo, marginBottom: 4, letterSpacing: 1 }}>{name.toUpperCase()}</div>
                  <div style={{ fontSize: 11, color: T.text3, lineHeight: 1.6 }}>{desc}</div>
                </div>
              ))}
              <div style={{ padding: 10, background: T.bg3, borderRadius: 4, fontSize: 10, color: T.text4, lineHeight: 1.7 }}>
                All simulation modes are read-only — they replay events in memory only.
                No DB writes, no agent calls, no token spend. Pure state projection.
              </div>
            </Panel>
          </div>
        )}
      </div>

      {/* Footer */}
      <div style={{ borderTop: `1px solid ${T.border}`, padding: "5px 20px", fontSize: 10, color: T.text4, display: "flex", gap: 16 }}>
        <span>cognitive runtime v1</span>
        <span>causal:{runtime.causalStats.nodeCount} nodes</span>
        <span>beliefs:{runtime.ideas.length} ideas</span>
        <span>policies:{runtime.policies.length} active</span>
        <span>spend:${(runtime.budget.globalSpendCents/100).toFixed(2)}</span>
      </div>

      <style>{`
        * { box-sizing: border-box; }
        ::-webkit-scrollbar { width: 4px; height: 4px; }
        ::-webkit-scrollbar-track { background: ${T.bg}; }
        ::-webkit-scrollbar-thumb { background: ${T.border2}; border-radius: 2px; }
        select, input[type=range] { outline: none; }
      `}</style>
    </div>
  );
}
