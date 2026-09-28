# DOPE Multi-Agent Layer
## Researcher · Critic · Planner · Executor · Coordinator

This layer sits on top of the backend (WorkflowEngine + Supabase).
It turns the single-workflow engine into a distributed cognition system.

---

## Files

| File                   | What it does                                          |
|------------------------|-------------------------------------------------------|
| `types.ts`             | All shared types: AgentRole, AgentConfig, memory layers |
| `SharedMemory.ts`      | Projection layer — continuously rebuilt from event log |
| `ConflictResolver.ts`  | Detects + resolves agent disagreements               |
| `AgentScheduler.ts`    | Lifecycle, rate limits, scope enforcement            |
| `agents.ts`            | The 5 agent implementations (Researcher through Coordinator) |
| `MultiAgentEngine.ts`  | Top-level orchestrator — wires all pieces            |
| `swarm.ts`             | Declarative DSL for defining agent teams             |

---

## Quickstart

```typescript
import { swarm, researcher, critic, executor, deepResearch } from "./swarm";
import { createClient } from "@supabase/supabase-js";

const db = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

// Option A: preset
const result = await deepResearch("healthcare").run(db, sessionId);

// Option B: custom swarm
const result = await swarm({
  context: "developer tools",
  agents:  [researcher(), critic(), executor()],
  strategy: "parallel",
  terminateOn: [allDrilled(2)],
}).run(db, sessionId);

console.log(result.ideas);      // ideas with critic-revised scores
console.log(result.agentStats); // who did what
```

---

## Architecture

```
                    EVENT LOG (Supabase)
                          │
          ┌───────────────┼───────────────┐
          │               │               │
    Researcher        Critic           Executor
    (discovers)    (evaluates)        (drills)
          │               │               │
          └───────────────┼───────────────┘
                          │
                  SharedMemory (projection)
                  Working + Episodic + Semantic
                          │
                    Coordinator
                  (conflicts + termination)
                          │
                   Frontend (Realtime)
```

**Key invariant:** Agents never directly read or write shared state.
They only emit events (write) and read memory projections (read).
The projection is always a deterministic fold over the event log.

---

## The 5 Agents

### Researcher
Runs lens activities to discover raw ideas. Takes direction from Planner's strategy.
Skips lenses that already have results (idempotent). Emits `LENS_COMPLETED` per lens.

### Critic
Evaluates all ideas in a single LLM call. Emits `CRITIQUE_COMPLETED` per idea.
Flags invalid ideas with `IDEA_FLAGGED` — Executor skips flagged ideas.
Uses Bayesian score blending: original score × (1 - confidence×0.5) + revised × confidence×0.5.

### Planner
Decides which lenses to run based on historical lens performance (from SemanticMemory).
Emits `PLAN_PROPOSED` then `STRATEGY_SET` if confident enough. Researcher reads the plan.

### Executor
Runs drills on the top 3 non-flagged ideas. Respects Critic's flags.
Emits `DRILL_STARTED` + `DRILL_COMPLETED` per idea.

### Coordinator
Runs every round. Resolves open conflicts. Checks termination conditions.
Can nudge the Executor if ideas exist but no drills have run.
Emits `WORKFLOW_COMPLETED` or `WORKFLOW_FAILED`.

---

## Conflict Resolution

Three strategies applied in order:

1. **Role priority** — Coordinator > Critic > Planner > Executor > Researcher
2. **Confidence weighting** — higher-confidence agent wins (for score conflicts)
3. **Arbitration** — uses SemanticMemory (historical lens performance) to decide

Conflict types detected automatically:
- **Score conflict** — two agents score same idea >30 points apart
- **Plan conflict** — two planners propose incompatible lens sets
- **Flag conflict** — executor drills an idea critic invalidated
- **Loop conflict** — same two agents exchange >5 turns in last 20 events

---

## Swarm DSL

```typescript
// Preset swarms
quickScan("fintech")           // fast, researcher only
deepResearch("legal")          // all agents, parallel
adversarialReview("e-commerce") // two critics, pressure-test
soloFounderFilter("SaaS")      // filter for solo-buildable only

// Custom
swarm({
  context: "HR tools",
  agents: [
    researcher().withBudget(30).withRate(15),
    critic().withPrompt("Focus on regulatory risks"),
    executor().withBudget(20),
  ],
  strategy: "parallel",
  terminateOn: [anyOf(decided(), allDrilled(3))],
  maxRounds: 6,
});

// Inspect before running (cost estimate)
const w = deepResearch("healthcare");
console.log(w.inspect());
// { agentCount: 4, roles: ["planner","researcher","critic","executor","coordinator"],
//   strategy: "parallel", estimatedCost: "~$0.72 max" }
```

---

## Schema additions (add to schema.sql)

```sql
-- Agent metadata on workflow_events
-- Already stored in payload._agentId and payload._agentRole
-- No schema change needed — agent info rides in the event payload.

-- Optional: materialised agent activity view
create or replace view agent_activity as
select
  workflow_id,
  payload->>'_agentId'   as agent_id,
  payload->>'_agentRole' as agent_role,
  type,
  count(*)               as event_count,
  max(created_at)        as last_active
from workflow_events
where payload->>'_agentId' is not null
group by workflow_id, payload->>'_agentId', payload->>'_agentRole', type
order by last_active desc;
```

---

## Hard rules (enforced by AgentScheduler)

1. **Scope** — agents may only emit their role's event types (ROLE_SCOPES in types.ts)
2. **Rate limit** — max N events per minute per agent (configurable)
3. **Budget** — max total events per agent per workflow run
4. **Lifecycle** — no emission after workflow_completed/failed
5. **Termination** — coordinator can terminate any agent at any time

All violations emit a `SANDBOX_VIOLATION` event — auditable in the event log.

---

## What you've built

```
Single workflow engine   →   Distributed cognition system
Sequential lens loop     →   Parallel autonomous agents
One reducer              →   Multi-stream event projection
Manual dedup             →   Critic-adjusted Bayesian scoring
No conflict handling     →   3-strategy conflict resolution
Static lens selection    →   Planner learns from history
```

This is conceptually equivalent to:
- **LangGraph** — but persistent (event log survives restarts)
- **AutoGen** — but event-sourced (full audit trail)
- **CrewAI** — but with formal conflict resolution
- **Temporal** — but AI-native (agents as workflow activities)
