# DOPE â€” Step-by-Step Deployment Guide

Everything you need to go from files to live app.
Follow the steps in order. Each step has a verification command.

---

## Prerequisites

- Node.js 18+ â†’ `node --version`
- A Supabase account â†’ supabase.com (free tier works)
- An Anthropic API key â†’ console.anthropic.com
- A Vercel account (for deploy) â†’ vercel.com (free tier works)

---

## Step 1 â€” Assemble the project

All generated packages belong in one Next.js project.
Create the folder structure:

```
mkdir dope && cd dope
```

Copy files in this order:

```
dope-nextjs/          â†’ root of your project
  package.json
  tsconfig.json
  next.config.js
  vercel.json
  .env.local.example
  app/
  hooks/
  lib/

dope-backend/         â†’ lib/  (copy these files into lib/)
  WorkflowEngine.ts   â†’ lib/WorkflowEngine.ts
  lenses.ts           â†’ lib/lenses.ts
  snapshots.ts        â†’ lib/snapshots.ts
  compensation.ts     â†’ lib/compensation.ts
  versioning.ts       â†’ lib/versioning.ts
  sandbox.ts          â†’ lib/sandbox.ts
  queue.ts            â†’ lib/queue-engine.ts   (rename to avoid clash with lib/queue.ts)

dope-agents/          â†’ lib/agents/
  types.ts            â†’ lib/agents/types.ts
  SharedMemory.ts     â†’ lib/agents/SharedMemory.ts
  AgentScheduler.ts   â†’ lib/agents/AgentScheduler.ts
  ConflictResolver.ts â†’ lib/agents/ConflictResolver.ts
  agents.ts           â†’ lib/agents/agents.ts
  MultiAgentEngine.ts â†’ lib/agents/MultiAgentEngine.ts
  swarm.ts            â†’ lib/agents/swarm.ts
```

**Note:** For initial deployment you only need `dope-nextjs/` files.
The agent and cognitive layers are optional â€” the worker in
`app/api/worker/route.ts` is self-contained and deploys standalone.

---

## Step 2 â€” Install dependencies

```bash
cd dope   # your project root
npm install
```

Verify:
```bash
npm list @supabase/supabase-js @anthropic-ai/sdk next
# should show version numbers, no errors
```

---

## Step 3 â€” Create Supabase project

1. Go to [supabase.com](https://supabase.com) â†’ **New project**
2. Choose a name (e.g. `dope`), pick a region close to you, set a DB password
3. Wait ~2 minutes for provisioning

Get your keys:
- Dashboard â†’ Settings â†’ API
- Copy: **Project URL**, **anon public**, **service_role secret**

---

## Step 4 â€” Run the schema

1. Dashboard â†’ **SQL Editor** â†’ **New query**
2. Paste the entire contents of `dope-backend/schema.sql`
3. Click **Run**

You should see: `Success. No rows returned`

Verify tables exist:
```sql
-- Run in SQL Editor
select table_name from information_schema.tables
where table_schema = 'public'
order by table_name;
```

Expected output includes:
```
drill_reports
ideas
workflow_events
workflow_jobs
workflow_snapshots
workflows
```

Also verify the claim function exists:
```sql
select routine_name from information_schema.routines
where routine_schema = 'public' and routine_name = 'claim_next_job';
```

Should return one row.

---

## Step 5 â€” Enable Realtime

In Supabase Dashboard â†’ **Database** â†’ **Replication**:

Toggle ON for these tables:
- `workflow_events`  â† most important
- `workflows`
- `workflow_jobs`

Or run in SQL Editor:
```sql
alter publication supabase_realtime add table workflow_events;
alter publication supabase_realtime add table workflows;
alter publication supabase_realtime add table workflow_jobs;
```

---

## Step 6 â€” Set environment variables

```bash
cp .env.local.example .env.local
```

Edit `.env.local`:
```env
NEXT_PUBLIC_SUPABASE_URL=https://xxxxxxxxxxxx.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
SUPABASE_SERVICE_ROLE_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
ANTHROPIC_API_KEY=sk-ant-api03-...
NEXT_PUBLIC_APP_URL=http://localhost:3000
WORKER_CRON_SECRET=any-random-string-you-choose
```

**Where to find each value:**
- `SUPABASE_URL` â†’ Supabase Dashboard â†’ Settings â†’ API â†’ Project URL
- `SUPABASE_ANON_KEY` â†’ Settings â†’ API â†’ `anon` `public`
- `SUPABASE_SERVICE_ROLE_KEY` â†’ Settings â†’ API â†’ `service_role` `secret`
- `ANTHROPIC_API_KEY` â†’ console.anthropic.com â†’ API Keys â†’ Create Key

---

## Step 7 â€” Test locally

```bash
npm run dev
```

App runs at `http://localhost:3000`

**Trigger the worker manually** (in a second terminal):
```bash
curl http://localhost:3000/api/worker
# Expected: {"processed":false,"reason":"no_jobs"}
# (no jobs yet â€” that's correct)
```

**Run a test workflow:**
```bash
curl -X POST http://localhost:3000/api/workflow \
  -H "Content-Type: application/json" \
  -d '{"sessionId":"test","context":"healthcare","count":2,"mode":"single","lens":"market_gap"}'
```

Copy the `workflowId` from the response, then trigger the worker:
```bash
curl http://localhost:3000/api/worker
# Expected: {"processed":true,"jobId":"...","durationMs":...}
```

Check state (replace WORKFLOW_ID):
```bash
curl http://localhost:3000/api/workflow/WORKFLOW_ID
# Expected: {"state":{"phase":"complete","ideas":[...],...}}
```

---

## Step 8 â€” Run verification script

```bash
node verify.js
# Runs 10 checks against localhost:3000
# All should pass
```

---

## Step 9 â€” Deploy to Vercel

**Install Vercel CLI if needed:**
```bash
npm install -g vercel
```

**Login:**
```bash
vercel login
```

**Deploy:**
```bash
vercel deploy --prod
```

The CLI will ask:
- Set up and deploy? â†’ `Y`
- Which scope? â†’ select your account
- Link to existing project? â†’ `N` (first time)
- Project name? â†’ `dope` (or whatever you want)
- Directory? â†’ `.` (current)
- Override settings? â†’ `N`

Copy the deployment URL (e.g. `https://dope-xxxx.vercel.app`).

---

## Step 10 â€” Set Vercel environment variables

**Option A: Vercel Dashboard (easiest)**

Go to vercel.com â†’ your project â†’ Settings â†’ Environment Variables

Add each variable:
```
NEXT_PUBLIC_SUPABASE_URL        = (your value)     [All environments]
NEXT_PUBLIC_SUPABASE_ANON_KEY   = (your value)     [All environments]
SUPABASE_SERVICE_ROLE_KEY       = (your value)     [Production only]
ANTHROPIC_API_KEY               = (your value)     [Production only]
WORKER_CRON_SECRET              = (your value)     [All environments]
```

**Option B: Vercel CLI**
```bash
vercel env add NEXT_PUBLIC_SUPABASE_URL
vercel env add NEXT_PUBLIC_SUPABASE_ANON_KEY
vercel env add SUPABASE_SERVICE_ROLE_KEY
vercel env add ANTHROPIC_API_KEY
vercel env add WORKER_CRON_SECRET
```

After adding env vars, **redeploy**:
```bash
vercel deploy --prod
```

---

## Step 11 â€” Verify production deployment

```bash
node verify.js https://your-app.vercel.app
# Replace with your actual Vercel URL
```

All 10 checks should pass.

---

## Step 12 â€” Set up the worker cron

Vercel's `vercel.json` already configures cron at every 10 minutes.
Verify it's active: Vercel Dashboard â†’ your project â†’ Cron Jobs tab.

For faster processing (every 10 seconds), use Supabase pg_cron:

1. Enable pg_cron: Supabase Dashboard â†’ Extensions â†’ search "pg_cron" â†’ Enable
2. Run in SQL Editor:

```sql
-- Replace URL and secret with your values
select cron.schedule(
  'dope-worker',
  '*/1 * * * *',
  $$
    select net.http_get(
      url     := 'https://your-app.vercel.app/api/worker',
      headers := '{"x-cron-secret": "your-worker-cron-secret"}'::jsonb
    ) as request_id;
  $$
);
```

Verify it's scheduled:
```sql
select jobname, schedule, active from cron.job;
```

---

## Step 13 â€” Wire your DOPE UI

Replace the minimal `app/page.tsx` with your full DOPE artifact.

In your DOPE.jsx, make 3 changes:

**Change 1 â€” Replace state setup:**
```tsx
// Remove all of this:
const logRef   = useRef(new InputLog());
const execRef  = useRef(new Executor(logRef.current));
const [state, setState]   = useState({ ...initialState });
const [logEntries, ...]   = useState([]);
const [drillData, ...]    = useState({});
const dispatch = useCallback(...);

// Add this one line:
const { state, eventLog, drillData, opinions, isRunning,
        startWorkflow, sendAction, drillIdea, reset } = useWorkflow();
```

**Change 2 â€” Replace runResearch:**
```tsx
// Remove:
const runResearch = async () => {
  dispatch({ type: "research_started", ... });
  const ideas = await observeIdeas(...);
  dispatch({ type: "ideas_observed", ... });
};

// Add:
const runResearch = () => startWorkflow({
  context: effectiveContext,
  count:   parseInt(ideaCount, 10),
  mode:    batchMode ? "batch" : "single",
  lens,
});
```

**Change 3 â€” Replace handleIdeaAction:**
```tsx
// Remove the entire function body, replace with:
const handleIdeaAction = async (action, idea) => {
  if (action === "shortlist") await sendAction("idea_shortlisted", { ideaId: idea.id });
  if (action === "skip")      await sendAction("idea_skipped",     { ideaId: idea.id });
  if (action === "compare")   await sendAction("compare_toggled",  { ideaId: idea.id });
  if (action === "drill")     await drillIdea(idea);
  if (action === "decide")    await sendAction("human_decided",    { ideaId: idea.id });
};
```

Add the import at the top of your file:
```tsx
import { useWorkflow } from "@/hooks/useWorkflow";
```

Deploy again:
```bash
vercel deploy --prod
```

---

## Troubleshooting

### "No jobs" from worker
Normal if no workflow has been started yet.
Start one via the UI or curl, then trigger the worker.

### Worker returns error 500
Check Vercel function logs: Dashboard â†’ your project â†’ Functions tab â†’ worker.
Common causes:
- `ANTHROPIC_API_KEY` not set or invalid
- `SUPABASE_SERVICE_ROLE_KEY` not set
- Schema not applied (tables don't exist)

### Ideas not appearing in UI
Realtime not enabled. Go back to Step 5.
Or check browser console for Supabase Realtime connection errors.

### "relation workflow_jobs does not exist"
Schema not fully applied. Re-run `schema.sql` in Supabase SQL Editor.

### TypeScript errors on build
Run `npm run typecheck` locally.
Most common: import path mismatches between the layers.
The worker (`app/api/worker/route.ts`) is self-contained â€” it has no imports
from the agent or cognitive layers, so it always builds cleanly.

### Cron not triggering
Vercel free tier crons run every 10 minutes minimum.
For faster: use Supabase pg_cron (Step 12).
Manual trigger anytime: `curl https://your-app.vercel.app/api/worker`

---

## Architecture recap

```
Browser
  useWorkflow() hook
    â†’ Realtime subscription (live event stream)
    â†’ sendAction() / startWorkflow() / drillIdea()

Next.js API routes
  POST /api/workflow      â†’ create workflow + enqueue job
  GET  /api/workflow/:id  â†’ replay state from event log
  POST /api/workflow/:id/action  â†’ human events
  POST /api/workflow/:id/drill   â†’ enqueue drill job
  GET  /api/worker        â†’ claim + process one job (cron target)

Supabase
  workflows         â†’ one row per session
  workflow_events   â†’ append-only event log (source of truth)
  workflow_jobs     â†’ durable job queue
  workflow_snapshots â†’ cached state for fast replay
  Realtime          â†’ pushes events to browser instantly
```

**Key invariant:** The API never mutates state directly.
It only appends events. State is always a deterministic fold over the event log.
