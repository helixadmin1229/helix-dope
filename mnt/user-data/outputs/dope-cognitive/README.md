# DOPE Cognitive Layer
## Causal Graph · Incremental Projections · Policy Resolver · Belief State · Replay Engine

This layer is the "production-grade Temporal-for-agents" upgrade.
It sits on top of the multi-agent layer and adds the 5 missing pieces.

---

## Files

| File                   | Upgrade it implements                                         |
|------------------------|---------------------------------------------------------------|
| `CausalGraph.ts`       | #1 Causal threading — parent_ids, trace chains, cycle detection |
| `ProjectionEngine.ts`  | #2 Incremental materialized views — O(1) per event, not O(n) |
| `PolicyResolver.ts`    | #3 Adaptive policy-based conflict resolution with learning    |
| `BeliefState.ts`       | #5 System-wide belief graph with Bayesian score propagation   |
| `BudgetScheduler.ts`   | #4 Token budgets, cost prediction, allocation optimiser       |
| `ReplayEngine.ts`      | #5 Deterministic replay, timeline branching, A/B simulation   |

---

## Upgrade 1: Causal Graph (`CausalGraph.ts`)

**Problem:** Events exist but there's no record of *why* each one happened.
You can't trace a bad decision back to its root cause.

**Solution:** Every event carries `parent_ids` and typed `causal_links`.

```typescript
// Agent emits with causal context
const causal = CausalContext.root()
  .triggeredBy(lensCompletedEventId, "researcher found ideas", 0.9);

await ctx.emit("CRITIQUE_STARTED", { ...payload, ...causal.build() });
```

**What you gain:**
- `graph.traceAncestors(decisionEventId)` → full reasoning chain
- `graph.findCommonAncestor(conflictA, conflictB)` → root of disagreement
- `graph.detectCycles()` → catch reasoning loops before they spiral
- `graph.toDOT()` → export as a visual graph for debugging

**Causal link types:** `triggered_by`, `contradicts`, `refines`, `resolves`, `compensates`, `parallel_to`

---

## Upgrade 2: Incremental Projections (`ProjectionEngine.ts`)

**Problem:** `projectMemory(allEvents)` rebuilds state from scratch on every query — O(n events).
At 500 events this becomes a measurable bottleneck.

**Solution:** 8 materialized views, each maintaining their own slice:
- `IdeasView` — deduplication + score blending
- `ShortlistView` — set operations only
- `CritiqueView` — per-agent critiques indexed by ideaId
- `PlanView` — pending plans + accepted flag
- `ConflictView` — open/resolved conflicts
- `LensPerformanceView` — running average per lens
- `AgentActivityView` — event counts per agent
- `PhaseView` — workflow phase state machine

Each view processes only its subscribed event types. Total cost: O(views) per event,
not O(events). Each view is O(1) to read.

```typescript
const engine = new ProjectionEngine();
engine.apply(newEvent);                     // O(1) — fast path
const memory = engine.buildMemoryView(agents);  // O(1) — reads from views
```

---

## Upgrade 3: Policy Resolver (`PolicyResolver.ts`)

**Problem:** Conflict resolution uses hard-coded heuristics. The coordinator
becomes a "hard-coded dictator" that never improves.

**Solution:** A policy registry where each policy has:
- A condition (`applies()`)
- A decision function (`decide()`)
- A weight that evolves via `learn()`

Five built-in policies, all composable:
1. `ROLE_PRIORITY_POLICY` — higher authority wins
2. `CONFIDENCE_POLICY` — higher confidence wins (activates at Δ≥15)
3. `HISTORICAL_LENS_POLICY` — uses SemanticMemory to pick better plan
4. `MERGE_SCORES_POLICY` — averages conflicting scores
5. `RECENCY_POLICY` — newer event wins (fallback)

Resolution is a weighted vote across all applicable policies:

```typescript
const resolver = new PolicyResolver([myCustomPolicy]);
const resolution = resolver.resolve(conflict, memory);
resolver.learn(outcomeEvents, humanDecision);  // update weights
console.log(resolver.report());  // see which policies are most accurate
```

After 10 workflows, policy weights reflect which heuristics were actually right.

---

## Upgrade 4: Budget Scheduler (`BudgetScheduler.ts`)

**Problem:** Researcher dominates token spend. No visibility into cost until after.

**Solution:** Per-agent token budgets + pre-flight cost checks + global optimizer.

```typescript
const scheduler = new BudgetScheduler(DEFAULT_WORKFLOW_BUDGET);

// Pre-flight: can researcher afford another lens run?
const check = scheduler.canAfford("researcher-1", "lens_run");
if (!check.allowed) {
  console.log(check.reason);  // "Agent researcher-1 budget exhausted (38¢/40¢)"
}

// Predict total cost before running
const prediction = scheduler.predict({ lensCount: 4, ideaCount: 5, drillCount: 3, rounds: 3 });
console.log(prediction.recommendation);  // "OK to proceed" or "Over budget by $0.23"

// Record actual spend after each LLM call
scheduler.record("researcher-1", "lens_run", 850, 1200);

// Get current status
console.log(scheduler.status());
// { globalSpendCents: 45, utilizationPct: 45, topConsumer: "researcher-1" }
```

Default budget: $1.00 per workflow. Researcher capped at $0.40.
Reserve: 15% held back for coordinator + retries.

---

## Upgrade 5: Belief State (`BeliefState.ts`)

**Problem:** Each agent has its own confidence score, but there's no system-wide
belief — no way to know when agents agree vs when they're fundamentally uncertain.

**Solution:** A Bayesian belief graph over idea quality.

Each idea has:
- **Prior distribution** — mean + variance from researcher's initial score
- **Per-agent beliefs** — each agent's posterior (narrow = confident)
- **Consensus distribution** — precision-weighted Bayesian combination
- **Uncertainty** — disagreement between agents (std of their means)
- **Verdict estimate** — `strong` / `uncertain` / `weak`

```
Researcher: score=72, variance=20 (high uncertainty)
Critic A:   revisedScore=65, confidence=80 → variance=6 (tight)
Critic B:   revisedScore=70, confidence=60 → variance=12

Consensus:  mean=68, variance=4.5, CI95=[59,77], uncertainty=18 → "uncertain"
```

```typescript
const beliefManager = new BeliefStateManager();
beliefManager.ingest(critiqueEvent, ideas);

const ranked = beliefManager.rankIdeas(ideas);
// Ideas sorted by: mean - 0.5*std (conservative — penalises uncertainty)
```

---

## Replay + Simulation (`ReplayEngine.ts`)

**Deterministic replay:**
```typescript
const replay = new ReplayEngine(agents);
const result = replay.replayTo(events, targetSeq);  // state at any point
```

**Timeline scrubber (for debug UI):**
```typescript
const frames = replay.scrub(events, 5);  // state every 5 events
// → [{seq, phase, ideaCount, topIdea, uncertainty, conflictCount}, ...]
```

**Counterfactual simulation:**
```typescript
const sim = new SimulationEngine(agents);
const result = sim.simulate(events, branchSeq, { revisedScore: 85 });
// What if critic had scored this idea 85 instead of 55?
console.log(result.diff);    // "ideas: +2, shortlist: +1"
console.log(result.ideaDelta);  // which ideas changed rank
```

**A/B strategy test:**
```typescript
const ab = sim.abTest(baseEvents, plannerStrategyA, plannerStrategyB, insertAfterSeq);
console.log(ab.winner);  // "A" | "B" | "tie"
```

**Timeline branch:**
```typescript
const branch = new BranchEngine(db, agents);
const result = await branch.branch(workflowId, seq, { payload: { lenses: ["market_gap"] } });
console.log(result.diff.summary);  // "phase: researching→decided, ideas: +3"
```

---

## Wiring into MultiAgentEngine

```typescript
// In MultiAgentEngine constructor:
this.projectionEngine = new ProjectionEngine();
this.beliefManager    = new BeliefStateManager();
this.policyResolver   = new PolicyResolver();
this.budgetScheduler  = new BudgetScheduler(budget);
this.causalStore      = new CausalGraphStore(db, workflowId);

// In memory.ingest():
this.projectionEngine.apply(event);
this.beliefManager.ingest(event, this.projectionEngine.buildMemoryView(agents).working.ideas);
this.causalStore.ingest(event);

// In conflict resolution:
const resolution = this.policyResolver.resolve(conflict, memory);

// In agent emit (pre-flight):
const check = this.budgetScheduler.canAfford(agentId, operation);
if (!check.allowed) throw new AgentViolation(check.reason!);
```

---

## What you now have

```
Event log (Supabase)
    ↓
CausalGraph          — why did each event happen?
    ↓
ProjectionEngine     — what is the current state? (O(1))
    ↓
BeliefState          — how confident are we about each idea? (Bayesian)
    ↓
PolicyResolver       — which agent is right when they disagree? (adaptive)
    ↓
BudgetScheduler      — how much have we spent? can we afford more? (cost control)
    ↓
ReplayEngine         — what would have happened if X had been different? (simulation)
```

**This is the architecture described as:**
> "a deterministic runtime for distributed reasoning processes"

Closest analogies:
- **Temporal** — event sourcing + execution semantics
- **Blackboard systems** — shared memory projection
- **Probabilistic programming** — belief distributions over outcomes
- **Git** — branching timelines, counterfactual diffs
