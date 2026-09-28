# DOPE Next.js — Production Deployment Guide

## Project structure

```
dope-nextjs/
├── app/
│   ├── layout.tsx              ← Root layout
│   ├── page.tsx                ← Main UI page (swap with your DOPE UI)
│   └── api/
│       ├── worker/
│       │   └── route.ts        ← Job queue worker (cron target)
│       └── workflow/
│           ├── route.ts        ← POST: start, GET: list
│           └── [id]/
│               ├── route.ts    ← GET: replay state, DELETE: abort
│               ├── action/
│               │   └── route.ts ← POST: human actions
│               ├── drill/
│               │   └── route.ts ← POST: drill an idea
│               └── simulate/
│                   └── route.ts ← POST: counterfactual/scrub
│
├── hooks/
│   └── useWorkflow.ts          ← Frontend hook (replaces dispatch+useState)
│
├── lib/
│   ├── supabase.ts             ← Client factory (browser + server)
│   ├── llm.ts                  ← Anthropic SDK with retry + token tracking
│   └── queue.ts                ← WorkflowQueue (server-side only)
│
├── package.json
├── tsconfig.json
├── next.config.js
├── vercel.json                 ← Cron config + function timeouts
└── .env.local.example          ← Copy to .env.local and fill in
```

---

## Setup in 5 steps

### Step 1 — Create a Supabase project

1. Go to [supabase.com](https://supabase.com) → New project
2. Note your project URL and keys (Settings → API)

### Step 2 — Run the schema

In Supabase Dashboard → SQL Editor, paste and run `schema.sql` from `dope-backend/`.

Then add the Realtime tables:
```sql
alter publication supabase_realtime add table workflow_events;
alter publication supabase_realtime add table workflows;
alter publication supabase_realtime add table workflow_jobs;
```

### Step 3 — Install dependencies

```bash
npm install
```

### Step 4 — Set environment variables

```bash
cp .env.local.example .env.local
# Fill in: SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY, ANTHROPIC_API_KEY
```

### Step 5 — Run locally

```bash
npm run dev
# App at http://localhost:3000
# Worker at http://localhost:3000/api/worker
```

To trigger the worker locally (simulates cron):
```bash
curl http://localhost:3000/api/worker
```

---

## Deploy to Vercel

```bash
npx vercel deploy
```

Then add environment variables in Vercel Dashboard → Settings → Environment Variables:
- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`
- `ANTHROPIC_API_KEY`
- `WORKER_CRON_SECRET` (any random string, e.g. `openssl rand -hex 32`)

The `vercel.json` cron triggers `/api/worker` every 10 minutes automatically.
For faster processing (near-real-time), use Supabase pg_cron instead:

```sql
-- Run in Supabase SQL Editor
select cron.schedule(
  'dope-worker',
  '*/10 * * * *',
  $$select net.http_get(url := 'https://your-app.vercel.app/api/worker', headers := '{"x-cron-secret":"your-secret"}') as request_id$$
);
```

---

## Integrating your existing DOPE UI

Your current DOPE artifact (dope.jsx) uses local state. To migrate it to this backend:

### 1. Replace the state setup

```tsx
// REMOVE:
const logRef   = useRef(new InputLog());
const execRef  = useRef(new Executor(logRef.current));
const [state, setState]   = useState({ ...initialState });
const [logEntries, ...]   = useState([]);
const [drillData, ...]    = useState({});
const dispatch = useCallback(...);

// ADD:
const { state, eventLog, drillData, opinions, isRunning,
        startWorkflow, sendAction, drillIdea, reset } = useWorkflow();
```

### 2. Replace runResearch

```tsx
// REMOVE:
const runResearch = async () => {
  dispatch({ type: "research_started", ... });
  const ideas = await observeIdeas(...);
  dispatch({ type: "ideas_observed", ... });
};

// ADD:
const runResearch = () => startWorkflow({
  context: effectiveContext,
  count:   parseInt(ideaCount, 10),
  mode:    batchMode ? "batch" : "single",
  lens,
});
```

### 3. Replace handleIdeaAction

```tsx
// REMOVE:
const handleIdeaAction = async (action, idea) => {
  if (action === "shortlist") dispatch({ type: "idea_shortlisted", ... });
  if (action === "drill")     { /* call observeDrill */ }
  ...
};

// ADD:
const handleIdeaAction = async (action, idea) => {
  if (action === "shortlist") await sendAction("idea_shortlisted", { ideaId: idea.id });
  if (action === "skip")      await sendAction("idea_skipped",     { ideaId: idea.id });
  if (action === "compare")   await sendAction("compare_toggled",  { ideaId: idea.id });
  if (action === "drill")     await drillIdea(idea);
  if (action === "decide")    await sendAction("human_decided",    { ideaId: idea.id });
  if (action === "opinion")   {
    await fetch(`/api/workflow/${workflowId}/action`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "run_opinion_queued", payload: { idea, originalLens: state.lens } })
    });
  }
};
```

That's the full migration. Your JSX, components, styling — completely unchanged.

---

## How a workflow runs end-to-end

```
1. User clicks RUN →
   useWorkflow.startWorkflow({ context: "healthcare", mode: "batch" })
     → POST /api/workflow
       → creates workflows row
       → emits BATCH_STARTED event
       → enqueues "run_workflow" job
       → returns { workflowId }

2. useWorkflow subscribes to workflow_events via Supabase Realtime

3. /api/worker (cron, every 10s):
   → claims job from workflow_jobs (FOR UPDATE SKIP LOCKED)
   → calls runLens("market_gap", ...) → LLM → emits LENS_COMPLETED
   → calls runLens("pain_driven", ...) → LLM → emits LENS_COMPLETED
   → calls runLens("trend_riding", ...) → LLM → emits LENS_COMPLETED
   → calls runLens("niche_vertical", ...) → LLM → emits LENS_COMPLETED
   → deduplicates ideas → emits IDEAS_MERGED
   → emits WORKFLOW_COMPLETED
   → marks job completed

4. Each event INSERT fires Supabase Realtime → browser receives it
   → reducer(currentState, event) → setState(newState)
   → UI re-renders with new ideas as they arrive

5. User drills an idea:
   drillIdea(idea)
     → POST /api/workflow/:id/drill
       → emits DRILL_STARTED
       → enqueues "run_drill" job

6. Worker picks up drill job → LLM → emits DRILL_COMPLETED
   → Realtime fires → drillData[idea.id] = report → UI shows verdict
```

---

## API Reference

| Method | Path                              | Description                        |
|--------|-----------------------------------|------------------------------------|
| POST   | `/api/workflow`                   | Start a new workflow               |
| GET    | `/api/workflow?sessionId=X`       | List recent workflows              |
| GET    | `/api/workflow/:id`               | Replay state from event log        |
| GET    | `/api/workflow/:id?seq=N`         | Replay state up to seq N           |
| DELETE | `/api/workflow/:id`               | Abort a running workflow           |
| POST   | `/api/workflow/:id/action`        | Human action (shortlist, decide…)  |
| POST   | `/api/workflow/:id/drill`         | Drill an idea                      |
| POST   | `/api/workflow/:id/simulate`      | Counterfactual/scrub simulation    |
| GET    | `/api/worker`                     | Process one job from the queue     |

---

## What you now have

```
Layer 1: Backend foundation
  WorkflowEngine · schema.sql · Supabase · queue · snapshots · compensation · versioning

Layer 2: Multi-agent runtime
  SharedMemory · AgentScheduler · ConflictResolver · 5 agents · swarm DSL

Layer 3: Cognitive infrastructure
  CausalGraph · ProjectionEngine · PolicyResolver · BeliefState · BudgetScheduler · ReplayEngine

Layer 4: Production runtime
  DOPERuntime · DebugUI

Layer 5: Next.js deployment (this package)
  API routes · useWorkflow hook · worker cron · Vercel config
```

One `npm install` + one schema run + four env vars = fully deployed durable AI workflow engine.
