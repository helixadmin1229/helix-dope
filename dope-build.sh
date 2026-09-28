#!/bin/bash
# DOPE — self-contained project builder
# Run from any directory. Creates ~/dope with all files.
set -e
ROOT=~/dope
mkdir -p "$ROOT/app/api/workflow/[id]/action"
mkdir -p "$ROOT/app/api/workflow/[id]/drill"
mkdir -p "$ROOT/app/api/workflow/[id]/simulate"
mkdir -p "$ROOT/app/api/worker"
mkdir -p "$ROOT/hooks" "$ROOT/lib"
cat > "$ROOT/deploy.sh" << 'DOPE_EOF_DEPLOY_SH'
#!/bin/bash
# ============================================================
# deploy.sh
# One-shot deployment script for DOPE.
# Run from the dope-nextjs directory.
#
# Usage:
#   chmod +x deploy.sh
#   ./deploy.sh
# ============================================================

set -e  # exit on any error

GREEN="\033[0;32m"
YELLOW="\033[1;33m"
RED="\033[0;31m"
BLUE="\033[0;34m"
NC="\033[0m"  # no color

log()    { echo -e "${BLUE}[dope]${NC} $1"; }
ok()     { echo -e "${GREEN}[✓]${NC} $1"; }
warn()   { echo -e "${YELLOW}[!]${NC} $1"; }
fail()   { echo -e "${RED}[✗]${NC} $1"; exit 1; }

echo ""
echo -e "${BLUE}╔══════════════════════════════════════╗${NC}"
echo -e "${BLUE}║  DOPE — Deployment Script            ║${NC}"
echo -e "${BLUE}╚══════════════════════════════════════╝${NC}"
echo ""

# ── Step 1: Check prerequisites ───────────────────────────────
log "Checking prerequisites..."

command -v node  >/dev/null 2>&1 || fail "Node.js not found. Install from nodejs.org"
command -v npm   >/dev/null 2>&1 || fail "npm not found"
command -v git   >/dev/null 2>&1 || fail "git not found"

NODE_VER=$(node --version | sed 's/v//' | cut -d. -f1)
if [ "$NODE_VER" -lt 18 ]; then
  fail "Node.js 18+ required (found v$NODE_VER)"
fi

ok "Node.js $(node --version)"

# Check for .env.local
if [ ! -f ".env.local" ]; then
  if [ -f ".env.local.example" ]; then
    warn ".env.local not found. Copying from example..."
    cp .env.local.example .env.local
    echo ""
    echo -e "${YELLOW}ACTION REQUIRED: Fill in .env.local before continuing.${NC}"
    echo ""
    echo "  NEXT_PUBLIC_SUPABASE_URL=     (from Supabase Dashboard → Settings → API)"
    echo "  NEXT_PUBLIC_SUPABASE_ANON_KEY= (from Supabase Dashboard → Settings → API)"
    echo "  SUPABASE_SERVICE_ROLE_KEY=    (from Supabase Dashboard → Settings → API)"
    echo "  ANTHROPIC_API_KEY=            (from console.anthropic.com)"
    echo ""
    read -p "Press Enter when .env.local is filled in..."
  else
    fail ".env.local not found and no example to copy from"
  fi
fi

# Validate required env vars are set
source .env.local 2>/dev/null || true

[ -z "$NEXT_PUBLIC_SUPABASE_URL"     ] && fail "NEXT_PUBLIC_SUPABASE_URL is not set in .env.local"
[ -z "$NEXT_PUBLIC_SUPABASE_ANON_KEY"] && fail "NEXT_PUBLIC_SUPABASE_ANON_KEY is not set in .env.local"
[ -z "$SUPABASE_SERVICE_ROLE_KEY"    ] && fail "SUPABASE_SERVICE_ROLE_KEY is not set in .env.local"
[ -z "$ANTHROPIC_API_KEY"            ] && fail "ANTHROPIC_API_KEY is not set in .env.local"

ok "Environment variables set"

# ── Step 2: Install dependencies ──────────────────────────────
log "Installing dependencies..."
npm install --silent
ok "Dependencies installed"

# ── Step 3: Type check ────────────────────────────────────────
log "Running type check..."
npx tsc --noEmit && ok "TypeScript OK" || warn "TypeScript errors found (continuing anyway)"

# ── Step 4: Run schema against Supabase ───────────────────────
echo ""
log "Supabase schema setup"
echo ""
echo "  You need to run the schema SQL in your Supabase project."
echo "  Go to: ${NEXT_PUBLIC_SUPABASE_URL}/project/default/sql/new"
echo ""
echo "  Paste the contents of: dope-backend/schema.sql"
echo "  Then run it. This creates:"
echo "    - workflows, workflow_events, ideas, drill_reports"
echo "    - workflow_snapshots, workflow_jobs"
echo "    - workflow_summary view, queue_health view"
echo "    - claim_next_job() function"
echo "    - Row Level Security policies"
echo ""
read -p "Press Enter once the schema is applied in Supabase..."

# ── Step 5: Verify DB connection ──────────────────────────────
log "Verifying database connection..."
node -e "
const { createClient } = require('@supabase/supabase-js');
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) { console.error('Missing env vars'); process.exit(1); }
const db = createClient(url, key);
db.from('workflows').select('id').limit(1).then(({ error }) => {
  if (error) { console.error('DB check failed:', error.message); process.exit(1); }
  console.log('DB connection OK');
}).catch(e => { console.error(e.message); process.exit(1); });
" && ok "Supabase connection verified" || fail "Could not connect to Supabase — check your env vars and schema"

# ── Step 6: Test LLM connection ───────────────────────────────
log "Verifying Anthropic API key..."
node -e "
const https = require('https');
const key   = process.env.ANTHROPIC_API_KEY;
const body  = JSON.stringify({ model: 'claude-haiku-4-5-20251001', max_tokens: 10, messages: [{ role: 'user', content: 'hi' }] });
const req   = https.request({ hostname: 'api.anthropic.com', path: '/v1/messages', method: 'POST',
  headers: { 'Content-Type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01', 'Content-Length': Buffer.byteLength(body) }
}, res => {
  let data = '';
  res.on('data', d => data += d);
  res.on('end', () => {
    const json = JSON.parse(data);
    if (json.error) { console.error('API error:', json.error.message); process.exit(1); }
    console.log('API key valid, model:', json.model);
  });
});
req.on('error', e => { console.error(e.message); process.exit(1); });
req.write(body); req.end();
" && ok "Anthropic API verified" || fail "Anthropic API check failed — verify your ANTHROPIC_API_KEY"

# ── Step 7: Build ─────────────────────────────────────────────
log "Building Next.js app..."
npm run build && ok "Build successful" || fail "Build failed"

# ── Step 8: Deploy or run locally ─────────────────────────────
echo ""
echo -e "${BLUE}╔══════════════════════════════════════╗${NC}"
echo -e "${BLUE}║  Choose deployment target            ║${NC}"
echo -e "${BLUE}╚══════════════════════════════════════╝${NC}"
echo ""
echo "  1) Run locally (http://localhost:3000)"
echo "  2) Deploy to Vercel"
echo "  3) Exit (manual deploy)"
echo ""
read -p "Choice [1/2/3]: " DEPLOY_TARGET

case $DEPLOY_TARGET in
  1)
    ok "Starting local server..."
    echo ""
    echo -e "${GREEN}App running at http://localhost:3000${NC}"
    echo -e "${GREEN}Worker at    http://localhost:3000/api/worker${NC}"
    echo ""
    echo "To trigger the worker manually:"
    echo "  curl http://localhost:3000/api/worker"
    echo ""
    npm run start
    ;;

  2)
    command -v vercel >/dev/null 2>&1 || npm install -g vercel
    log "Deploying to Vercel..."
    echo ""
    echo "You'll need to set environment variables in Vercel."
    echo "The CLI will prompt you — or set them at vercel.com/dashboard."
    echo ""
    vercel deploy --prod
    ok "Deployed to Vercel"
    echo ""
    echo -e "${YELLOW}Remember to set these env vars in Vercel Dashboard:${NC}"
    echo "  NEXT_PUBLIC_SUPABASE_URL"
    echo "  NEXT_PUBLIC_SUPABASE_ANON_KEY"
    echo "  SUPABASE_SERVICE_ROLE_KEY"
    echo "  ANTHROPIC_API_KEY"
    echo "  WORKER_CRON_SECRET"
    ;;

  *)
    ok "Build complete. Deploy manually with:"
    echo "  vercel deploy --prod"
    echo "  OR"
    echo "  npm run start"
    ;;
esac

echo ""
echo -e "${GREEN}╔══════════════════════════════════════╗${NC}"
echo -e "${GREEN}║  DOPE deployment complete            ║${NC}"
echo -e "${GREEN}╚══════════════════════════════════════╝${NC}"
echo ""

DOPE_EOF_DEPLOY_SH
cat > "$ROOT/DEPLOY.md" << 'DOPE_EOF_DEPLOY_MD'
# DOPE — Step-by-Step Deployment Guide

Everything you need to go from files to live app.
Follow the steps in order. Each step has a verification command.

---

## Prerequisites

- Node.js 18+ → `node --version`
- A Supabase account → supabase.com (free tier works)
- An Anthropic API key → console.anthropic.com
- A Vercel account (for deploy) → vercel.com (free tier works)

---

## Step 1 — Assemble the project

All generated packages belong in one Next.js project.
Create the folder structure:

```
mkdir dope && cd dope
```

Copy files in this order:

```
dope-nextjs/          → root of your project
  package.json
  tsconfig.json
  next.config.js
  vercel.json
  .env.local.example
  app/
  hooks/
  lib/

dope-backend/         → lib/  (copy these files into lib/)
  WorkflowEngine.ts   → lib/WorkflowEngine.ts
  lenses.ts           → lib/lenses.ts
  snapshots.ts        → lib/snapshots.ts
  compensation.ts     → lib/compensation.ts
  versioning.ts       → lib/versioning.ts
  sandbox.ts          → lib/sandbox.ts
  queue.ts            → lib/queue-engine.ts   (rename to avoid clash with lib/queue.ts)

dope-agents/          → lib/agents/
  types.ts            → lib/agents/types.ts
  SharedMemory.ts     → lib/agents/SharedMemory.ts
  AgentScheduler.ts   → lib/agents/AgentScheduler.ts
  ConflictResolver.ts → lib/agents/ConflictResolver.ts
  agents.ts           → lib/agents/agents.ts
  MultiAgentEngine.ts → lib/agents/MultiAgentEngine.ts
  swarm.ts            → lib/agents/swarm.ts
```

**Note:** For initial deployment you only need `dope-nextjs/` files.
The agent and cognitive layers are optional — the worker in
`app/api/worker/route.ts` is self-contained and deploys standalone.

---

## Step 2 — Install dependencies

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

## Step 3 — Create Supabase project

1. Go to [supabase.com](https://supabase.com) → **New project**
2. Choose a name (e.g. `dope`), pick a region close to you, set a DB password
3. Wait ~2 minutes for provisioning

Get your keys:
- Dashboard → Settings → API
- Copy: **Project URL**, **anon public**, **service_role secret**

---

## Step 4 — Run the schema

1. Dashboard → **SQL Editor** → **New query**
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

## Step 5 — Enable Realtime

In Supabase Dashboard → **Database** → **Replication**:

Toggle ON for these tables:
- `workflow_events`  ← most important
- `workflows`
- `workflow_jobs`

Or run in SQL Editor:
```sql
alter publication supabase_realtime add table workflow_events;
alter publication supabase_realtime add table workflows;
alter publication supabase_realtime add table workflow_jobs;
```

---

## Step 6 — Set environment variables

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
- `SUPABASE_URL` → Supabase Dashboard → Settings → API → Project URL
- `SUPABASE_ANON_KEY` → Settings → API → `anon` `public`
- `SUPABASE_SERVICE_ROLE_KEY` → Settings → API → `service_role` `secret`
- `ANTHROPIC_API_KEY` → console.anthropic.com → API Keys → Create Key

---

## Step 7 — Test locally

```bash
npm run dev
```

App runs at `http://localhost:3000`

**Trigger the worker manually** (in a second terminal):
```bash
curl http://localhost:3000/api/worker
# Expected: {"processed":false,"reason":"no_jobs"}
# (no jobs yet — that's correct)
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

## Step 8 — Run verification script

```bash
node verify.js
# Runs 10 checks against localhost:3000
# All should pass
```

---

## Step 9 — Deploy to Vercel

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
- Set up and deploy? → `Y`
- Which scope? → select your account
- Link to existing project? → `N` (first time)
- Project name? → `dope` (or whatever you want)
- Directory? → `.` (current)
- Override settings? → `N`

Copy the deployment URL (e.g. `https://dope-xxxx.vercel.app`).

---

## Step 10 — Set Vercel environment variables

**Option A: Vercel Dashboard (easiest)**

Go to vercel.com → your project → Settings → Environment Variables

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

## Step 11 — Verify production deployment

```bash
node verify.js https://your-app.vercel.app
# Replace with your actual Vercel URL
```

All 10 checks should pass.

---

## Step 12 — Set up the worker cron

Vercel's `vercel.json` already configures cron at every 10 minutes.
Verify it's active: Vercel Dashboard → your project → Cron Jobs tab.

For faster processing (every 10 seconds), use Supabase pg_cron:

1. Enable pg_cron: Supabase Dashboard → Extensions → search "pg_cron" → Enable
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

## Step 13 — Wire your DOPE UI

Replace the minimal `app/page.tsx` with your full DOPE artifact.

In your DOPE.jsx, make 3 changes:

**Change 1 — Replace state setup:**
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

**Change 2 — Replace runResearch:**
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

**Change 3 — Replace handleIdeaAction:**
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
Check Vercel function logs: Dashboard → your project → Functions tab → worker.
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
The worker (`app/api/worker/route.ts`) is self-contained — it has no imports
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
    → Realtime subscription (live event stream)
    → sendAction() / startWorkflow() / drillIdea()

Next.js API routes
  POST /api/workflow      → create workflow + enqueue job
  GET  /api/workflow/:id  → replay state from event log
  POST /api/workflow/:id/action  → human events
  POST /api/workflow/:id/drill   → enqueue drill job
  GET  /api/worker        → claim + process one job (cron target)

Supabase
  workflows         → one row per session
  workflow_events   → append-only event log (source of truth)
  workflow_jobs     → durable job queue
  workflow_snapshots → cached state for fast replay
  Realtime          → pushes events to browser instantly
```

**Key invariant:** The API never mutates state directly.
It only appends events. State is always a deterministic fold over the event log.

DOPE_EOF_DEPLOY_MD
cat > "$ROOT/verify.js" << 'DOPE_EOF_VERIFY_JS'
#!/usr/bin/env node
// ============================================================
// verify.js
// Post-deployment health check.
// Run after deploy to confirm everything is wired correctly.
//
// Usage:
//   node verify.js                          # checks localhost:3000
//   node verify.js https://your-app.vercel.app
// ============================================================

const https = require("https");
const http  = require("http");

const BASE = process.argv[2] ?? "http://localhost:3000";
const isHttps = BASE.startsWith("https");

// ── Colours ───────────────────────────────────────────────────
const G = "\x1b[32m", Y = "\x1b[33m", R = "\x1b[31m", B = "\x1b[34m", X = "\x1b[0m";
const ok   = (msg) => console.log(`${G}[✓]${X} ${msg}`);
const warn = (msg) => console.log(`${Y}[!]${X} ${msg}`);
const fail = (msg) => console.log(`${R}[✗]${X} ${msg}`);
const log  = (msg) => console.log(`${B}[·]${X} ${msg}`);

// ── HTTP helper ───────────────────────────────────────────────
function request(path, opts = {}) {
  return new Promise((resolve, reject) => {
    const url     = `${BASE}${path}`;
    const lib     = isHttps ? https : http;
    const method  = opts.method ?? "GET";
    const body    = opts.body ? JSON.stringify(opts.body) : null;

    const reqOpts = {
      method,
      headers: {
        "Content-Type": "application/json",
        ...(opts.headers ?? {}),
        ...(body ? { "Content-Length": Buffer.byteLength(body) } : {}),
      },
    };

    const req = lib.request(url, reqOpts, (res) => {
      let data = "";
      res.on("data", (d) => (data += d));
      res.on("end", () => {
        try {
          resolve({ status: res.statusCode, body: JSON.parse(data), raw: data });
        } catch {
          resolve({ status: res.statusCode, body: null, raw: data });
        }
      });
    });

    req.on("error", reject);
    if (body) req.write(body);
    req.end();
  });
}

// ── Checks ────────────────────────────────────────────────────
const checks = [];
const results = { passed: 0, warned: 0, failed: 0 };

function check(name, fn) {
  checks.push({ name, fn });
}

// ── Run all checks ────────────────────────────────────────────
async function run() {
  console.log(`\n${B}╔══════════════════════════════════════╗${X}`);
  console.log(`${B}║  DOPE — Deployment Verification      ║${X}`);
  console.log(`${B}╚══════════════════════════════════════╝${X}`);
  console.log(`\nTarget: ${BASE}\n`);

  // ── CHECK 1: App is reachable ──────────────────────────────
  check("App is reachable", async () => {
    const res = await request("/");
    if (res.status >= 200 && res.status < 500) {
      ok(`App reachable (HTTP ${res.status})`);
      results.passed++;
    } else {
      fail(`App returned HTTP ${res.status}`);
      results.failed++;
    }
  });

  // ── CHECK 2: Worker endpoint responds ─────────────────────
  check("Worker endpoint responds", async () => {
    const res = await request("/api/worker");
    if (res.status === 200 || res.status === 401) {
      ok(`Worker endpoint OK (HTTP ${res.status}${res.status === 401 ? " — auth required, expected" : ""})`);
      results.passed++;
    } else {
      fail(`Worker returned HTTP ${res.status}: ${res.raw?.slice(0, 100)}`);
      results.failed++;
    }
  });

  // ── CHECK 3: Workflow list endpoint ───────────────────────
  check("GET /api/workflow returns JSON", async () => {
    const res = await request("/api/workflow?sessionId=verify_test");
    if (res.status === 200 && res.body?.workflows !== undefined) {
      ok(`Workflow list OK (${res.body.workflows.length} workflows found)`);
      results.passed++;
    } else {
      fail(`Workflow list failed: HTTP ${res.status} — ${JSON.stringify(res.body)?.slice(0, 100)}`);
      results.failed++;
    }
  });

  // ── CHECK 4: Can create a workflow ────────────────────────
  let workflowId = null;
  check("POST /api/workflow creates workflow", async () => {
    const res = await request("/api/workflow", {
      method: "POST",
      body: { sessionId: "verify_test", context: "test", count: 1, mode: "single", lens: "market_gap" },
    });
    if (res.status === 200 && res.body?.workflowId) {
      workflowId = res.body.workflowId;
      ok(`Workflow created: ${workflowId}`);
      results.passed++;
    } else {
      fail(`Workflow creation failed: HTTP ${res.status} — ${JSON.stringify(res.body)?.slice(0, 100)}`);
      results.failed++;
    }
  });

  // ── CHECK 5: Can replay workflow state ────────────────────
  check("GET /api/workflow/:id replays state", async () => {
    if (!workflowId) { warn("Skipped — no workflow created"); results.warned++; return; }
    const res = await request(`/api/workflow/${workflowId}`);
    if (res.status === 200 && res.body?.state) {
      ok(`Replay OK — phase: "${res.body.state.phase}", events: ${res.body.eventCount}`);
      results.passed++;
    } else {
      fail(`Replay failed: HTTP ${res.status} — ${JSON.stringify(res.body)?.slice(0, 100)}`);
      results.failed++;
    }
  });

  // ── CHECK 6: Human action endpoint ───────────────────────
  check("POST /api/workflow/:id/action accepts human action", async () => {
    if (!workflowId) { warn("Skipped — no workflow created"); results.warned++; return; }
    const res = await request(`/api/workflow/${workflowId}/action`, {
      method: "POST",
      body: { type: "IDEA_SHORTLISTED", payload: { ideaId: "test_idea" } },
    });
    if (res.status === 200 && res.body?.event) {
      ok(`Human action logged — seq: ${res.body.event.seq}`);
      results.passed++;
    } else {
      fail(`Action failed: HTTP ${res.status} — ${JSON.stringify(res.body)?.slice(0, 100)}`);
      results.failed++;
    }
  });

  // ── CHECK 7: Simulate endpoint ────────────────────────────
  check("POST /api/workflow/:id/simulate returns scrub frames", async () => {
    if (!workflowId) { warn("Skipped — no workflow created"); results.warned++; return; }
    const res = await request(`/api/workflow/${workflowId}/simulate`, {
      method: "POST",
      body: { mode: "scrub", stepSize: 1 },
    });
    if (res.status === 200 && Array.isArray(res.body?.frames)) {
      ok(`Simulate OK — ${res.body.frames.length} scrub frames`);
      results.passed++;
    } else {
      fail(`Simulate failed: HTTP ${res.status} — ${JSON.stringify(res.body)?.slice(0, 100)}`);
      results.failed++;
    }
  });

  // ── CHECK 8: Worker processes the job ─────────────────────
  check("Worker processes pending job", async () => {
    if (!workflowId) { warn("Skipped — no workflow created"); results.warned++; return; }

    log("Triggering worker (this calls the LLM — may take 15–30s)...");
    const res = await request("/api/worker", { method: "GET" });

    if (res.status === 200 && res.body?.processed === true) {
      ok(`Worker processed job ${res.body.jobId} in ${res.body.durationMs}ms`);
      results.passed++;
    } else if (res.status === 200 && res.body?.processed === false) {
      warn(`Worker ran but no job was ready (reason: ${res.body.reason})`);
      results.warned++;
    } else {
      fail(`Worker failed: HTTP ${res.status} — ${JSON.stringify(res.body)?.slice(0, 100)}`);
      results.failed++;
    }
  });

  // ── CHECK 9: Verify ideas were produced ───────────────────
  check("Workflow produced ideas after worker run", async () => {
    if (!workflowId) { warn("Skipped"); results.warned++; return; }

    // Wait a moment for events to propagate
    await new Promise(r => setTimeout(r, 2000));

    const res = await request(`/api/workflow/${workflowId}`);
    const ideas = res.body?.state?.ideas ?? [];

    if (ideas.length > 0) {
      ok(`${ideas.length} idea(s) produced — first: "${ideas[0]?.name ?? "?"}"`);
      results.passed++;
    } else if (res.body?.state?.phase === "researching") {
      warn("Worker still running — ideas not yet produced (normal for slow LLM responses)");
      results.warned++;
    } else {
      fail(`No ideas produced — phase: "${res.body?.state?.phase}", error: "${res.body?.state?.error ?? "none"}"`);
      results.failed++;
    }
  });

  // ── CHECK 10: Abort workflow ──────────────────────────────
  check("DELETE /api/workflow/:id aborts workflow", async () => {
    if (!workflowId) { warn("Skipped"); results.warned++; return; }
    const res = await request(`/api/workflow/${workflowId}`, { method: "DELETE" });
    if (res.status === 200 && res.body?.status === "aborted") {
      ok(`Workflow aborted cleanly`);
      results.passed++;
    } else {
      warn(`Abort returned HTTP ${res.status} (non-critical)`);
      results.warned++;
    }
  });

  // ── Run all checks sequentially ───────────────────────────
  for (const { name, fn } of checks) {
    log(`Running: ${name}`);
    try {
      await fn();
    } catch (err) {
      fail(`${name} threw: ${err.message}`);
      results.failed++;
    }
  }

  // ── Summary ───────────────────────────────────────────────
  console.log(`\n${B}╔══════════════════════════════════════╗${X}`);
  console.log(`${B}║  Verification Summary                ║${X}`);
  console.log(`${B}╚══════════════════════════════════════╝${X}`);
  console.log(`\n  ${G}Passed:${X}  ${results.passed}`);
  console.log(`  ${Y}Warned:${X}  ${results.warned}`);
  console.log(`  ${R}Failed:${X}  ${results.failed}`);
  console.log(`\n  Total checks: ${checks.length}`);

  if (results.failed === 0) {
    console.log(`\n${G}  ✓ All checks passed — DOPE is deployed and working.${X}\n`);
    process.exit(0);
  } else {
    console.log(`\n${R}  ✗ ${results.failed} check(s) failed — see above for details.${X}\n`);
    console.log("  Common fixes:");
    console.log("    - Schema not applied → run schema.sql in Supabase SQL Editor");
    console.log("    - Missing env vars   → check .env.local or Vercel dashboard");
    console.log("    - Worker not running → curl /api/worker to trigger manually\n");
    process.exit(1);
  }
}

run().catch((err) => {
  fail(`Verification script crashed: ${err.message}`);
  process.exit(1);
});

DOPE_EOF_VERIFY_JS
cat > "$ROOT/supabase-realtime-test.html" << 'DOPE_EOF_SUPABASE-REALTIME-TEST_HTML'
<!DOCTYPE html>
<!--
  supabase-realtime-test.html
  Open this file directly in a browser to verify Supabase Realtime
  is working before you deploy your full app.

  Steps:
  1. Fill in your SUPABASE_URL and SUPABASE_ANON_KEY below
  2. Open this file in a browser (file:// works)
  3. Click "Connect"
  4. In another tab, insert a row in workflow_events (via SQL Editor)
  5. You should see the event appear in real time here
-->
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>DOPE — Realtime Test</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { background: #07070f; color: #e2e8f0; font-family: monospace; padding: 24px; }
    h1   { font-size: 14px; letter-spacing: 4px; margin-bottom: 20px; color: #6366f1; }
    .row { display: flex; gap: 10px; margin-bottom: 12px; flex-wrap: wrap; }
    input, button { font-family: monospace; font-size: 12px; padding: 8px 12px; border-radius: 4px; border: 1px solid #252540; }
    input  { background: #111122; color: #e2e8f0; flex: 1; min-width: 300px; }
    button { background: #6366f1; color: white; border-color: #6366f1; cursor: pointer; white-space: nowrap; }
    button:disabled { background: #1f2937; color: #4b5563; border-color: #1f2937; cursor: not-allowed; }
    #status { font-size: 11px; padding: 6px 10px; border-radius: 4px; margin-bottom: 16px; }
    .idle       { background: #1f2937; color: #64748b; }
    .connecting { background: #1e1e0a; color: #d97706; }
    .connected  { background: #0a1a0a; color: #10b981; }
    .error      { background: #1a0a0a; color: #f43f5e; }
    #log { background: #0a0a14; border: 1px solid #1a1a2e; border-radius: 4px; padding: 12px; min-height: 200px; max-height: 400px; overflow-y: auto; }
    .event { font-size: 11px; color: #6b7280; margin-bottom: 6px; line-height: 1.4; }
    .event .time  { color: #374151; }
    .event .type  { color: #6366f1; }
    .event .badge { color: #10b981; }
    .event.new    { animation: flash 0.4s ease; }
    @keyframes flash { from { background: #6366f122; } to { background: transparent; } }
    #test-btn { background: #059669; border-color: #059669; }
    .tip { font-size: 11px; color: #374151; margin-top: 16px; line-height: 1.6; }
  </style>
</head>
<body>
  <h1>DOPE — SUPABASE REALTIME TEST</h1>

  <div class="row">
    <input id="url"  type="text" placeholder="https://xxxx.supabase.co" value="" />
    <input id="key"  type="text" placeholder="anon key (eyJ...)"        value="" />
  </div>
  <div class="row">
    <input id="wfid" type="text" placeholder="workflow_id to watch (or leave blank for all)" value="" />
    <button id="connect-btn" onclick="connect()">Connect</button>
    <button id="test-btn"    onclick="insertTest()" disabled>Insert test event</button>
    <button onclick="clearLog()">Clear</button>
  </div>

  <div id="status" class="idle">● Not connected</div>
  <div id="log"><div class="event"><span class="time">--:--:--</span> Waiting for connection...</div></div>

  <div class="tip">
    <strong>To test manually via Supabase SQL Editor:</strong><br>
    INSERT INTO workflow_events (workflow_id, type, payload, source)<br>
    VALUES ('your-workflow-id', 'TEST_EVENT', '{"hello":"world"}', 'system');
  </div>

  <script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.js"></script>
  <script>
    let db = null;
    let channel = null;
    let eventCount = 0;

    function setStatus(msg, cls) {
      const el = document.getElementById("status");
      el.textContent = msg;
      el.className = cls;
    }

    function addLog(html, isNew = false) {
      const log = document.getElementById("log");
      const div = document.createElement("div");
      div.className = "event" + (isNew ? " new" : "");
      div.innerHTML = html;
      log.insertBefore(div, log.firstChild);
    }

    function now() {
      return new Date().toLocaleTimeString();
    }

    function clearLog() {
      document.getElementById("log").innerHTML = "";
    }

    async function connect() {
      const url  = document.getElementById("url").value.trim();
      const key  = document.getElementById("key").value.trim();
      const wfid = document.getElementById("wfid").value.trim();

      if (!url || !key) {
        setStatus("● Enter Supabase URL and anon key", "error");
        return;
      }

      if (channel) { channel.unsubscribe(); channel = null; }

      setStatus("● Connecting...", "connecting");
      addLog(`<span class="time">${now()}</span> Connecting to ${url}...`);

      try {
        db = supabase.createClient(url, key);

        const filter = wfid
          ? { event: "INSERT", schema: "public", table: "workflow_events", filter: `workflow_id=eq.${wfid}` }
          : { event: "INSERT", schema: "public", table: "workflow_events" };

        channel = db.channel("dope-test")
          .on("postgres_changes", filter, (payload) => {
            eventCount++;
            const e   = payload.new;
            const src = e.source === "human" ? "🧑" : e.source === "llm" ? "🤖" : "⚙";
            addLog(
              `<span class="time">${now()}</span> ` +
              `<span class="badge">${src} NEW</span> ` +
              `<span class="type">${e.type}</span> ` +
              `seq:${e.seq ?? "?"} ` +
              `wf:${(e.workflow_id ?? "").slice(0, 8)}... ` +
              `payload:${JSON.stringify(e.payload ?? {}).slice(0, 60)}`,
              true
            );
            document.getElementById("status").textContent = `● Connected — ${eventCount} event(s) received`;
          })
          .subscribe((status) => {
            if (status === "SUBSCRIBED") {
              setStatus("● Connected" + (wfid ? ` — watching ${wfid.slice(0, 8)}...` : " — watching all events"), "connected");
              addLog(`<span class="time">${now()}</span> <span class="badge">✓</span> Realtime subscription active`);
              document.getElementById("test-btn").disabled = false;
            } else if (status === "CHANNEL_ERROR") {
              setStatus("● Connection error — check URL and anon key", "error");
              addLog(`<span class="time">${now()}</span> ❌ Channel error`);
            } else if (status === "TIMED_OUT") {
              setStatus("● Timed out — retrying...", "connecting");
            } else {
              addLog(`<span class="time">${now()}</span> Status: ${status}`);
            }
          });
      } catch (err) {
        setStatus(`● Error: ${err.message}`, "error");
        addLog(`<span class="time">${now()}</span> ❌ ${err.message}`);
      }
    }

    async function insertTest() {
      if (!db) return;

      const wfid = document.getElementById("wfid").value.trim() || "test-" + Date.now();
      const { error } = await db.from("workflow_events").insert({
        workflow_id: wfid,
        type:        "TEST_EVENT",
        payload:     { source: "realtime_test", timestamp: Date.now() },
        source:      "system",
      });

      if (error) {
        addLog(`<span class="time">${now()}</span> ❌ Insert failed: ${error.message} (need service role key to insert)`);
      } else {
        addLog(`<span class="time">${now()}</span> ✓ Test event inserted — should appear above within 1s`);
      }
    }

    // Pre-fill from URL params if provided
    const params = new URLSearchParams(window.location.search);
    if (params.get("url")) document.getElementById("url").value = params.get("url");
    if (params.get("key")) document.getElementById("key").value = params.get("key");
    if (params.get("wfid")) document.getElementById("wfid").value = params.get("wfid");
  </script>
</body>
</html>

DOPE_EOF_SUPABASE-REALTIME-TEST_HTML
cat > "$ROOT/package.json" << 'DOPE_EOF_PACKAGE_JSON'
{
  "name": "dope-runtime",
  "version": "1.0.0",
  "description": "Deterministic Orchestration over Probabilistic Execution — production runtime",
  "private": true,
  "scripts": {
    "dev":        "next dev",
    "build":      "next build",
    "start":      "next start",
    "lint":       "next lint",
    "typecheck":  "tsc --noEmit",
    "db:migrate": "supabase db push",
    "db:reset":   "supabase db reset"
  },
  "dependencies": {
    "@anthropic-ai/sdk":   "^0.24.0",
    "@supabase/supabase-js": "^2.43.4",
    "next":  "14.2.3",
    "react": "^18.3.1",
    "react-dom": "^18.3.1"
  },
  "devDependencies": {
    "@types/node":    "^20.12.7",
    "@types/react":   "^18.3.1",
    "typescript":     "^5.4.5",
    "eslint":         "^8.57.0",
    "eslint-config-next": "14.2.3"
  }
}

DOPE_EOF_PACKAGE_JSON
cat > "$ROOT/next.config.js" << 'DOPE_EOF_NEXT_CONFIG_JS'
/** @type {import('next').NextConfig} */
const nextConfig = {
  // Allow longer serverless function timeout for multi-lens batch runs
  experimental: {
    serverComponentsExternalPackages: ["@anthropic-ai/sdk"],
  },
};

module.exports = nextConfig;

DOPE_EOF_NEXT_CONFIG_JS
cat > "$ROOT/tsconfig.json" << 'DOPE_EOF_TSCONFIG_JSON'
{
  "compilerOptions": {
    "target":           "ES2020",
    "lib":              ["dom", "dom.iterable", "esnext"],
    "allowJs":          true,
    "skipLibCheck":     true,
    "strict":           true,
    "noEmit":           true,
    "esModuleInterop":  true,
    "module":           "esnext",
    "moduleResolution": "bundler",
    "resolveJsonModule": true,
    "isolatedModules":  true,
    "jsx":              "preserve",
    "incremental":      true,
    "plugins":          [{ "name": "next" }],
    "paths": {
      "@/*": ["./*"]
    }
  },
  "include": ["next-env.d.ts", "**/*.ts", "**/*.tsx", ".next/types/**/*.ts"],
  "exclude": ["node_modules"]
}

DOPE_EOF_TSCONFIG_JSON
cat > "$ROOT/vercel.json" << 'DOPE_EOF_VERCEL_JSON'
{
  "crons": [
    {
      "path":     "/api/worker",
      "schedule": "*/10 * * * *"
    }
  ],
  "functions": {
    "app/api/worker/route.ts": {
      "maxDuration": 60
    },
    "app/api/workflow/route.ts": {
      "maxDuration": 10
    },
    "app/api/workflow/[id]/route.ts": {
      "maxDuration": 10
    },
    "app/api/workflow/[id]/drill/route.ts": {
      "maxDuration": 10
    },
    "app/api/workflow/[id]/simulate/route.ts": {
      "maxDuration": 30
    }
  }
}

DOPE_EOF_VERCEL_JSON
cat > "$ROOT/.env.local.example" << 'DOPE_EOF__ENV_LOCAL_EXAMPLE'
# ── Supabase ──────────────────────────────────────────────────
# Get these from: Supabase Dashboard → Project → Settings → API
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJ...          # safe to expose to browser
SUPABASE_SERVICE_ROLE_KEY=eyJ...              # server only — never expose

# ── Anthropic ─────────────────────────────────────────────────
# Get from: console.anthropic.com → API Keys
ANTHROPIC_API_KEY=sk-ant-...                  # server only — never expose

# ── App ───────────────────────────────────────────────────────
NEXT_PUBLIC_APP_URL=http://localhost:3000

# ── Worker cron secret (optional) ────────────────────────────
# Set this to prevent unauthorized cron triggers in production
WORKER_CRON_SECRET=change-me-in-production

DOPE_EOF__ENV_LOCAL_EXAMPLE
cat > "$ROOT/schema.sql" << 'DOPE_EOF_SCHEMA_SQL'
-- ============================================================
-- DOPE — Complete Schema v2
-- Includes: workflows, events, ideas, drill_reports,
--           snapshots, workflow_jobs + all indexes + RLS
-- Run in: Supabase Dashboard → SQL Editor
-- ============================================================

create extension if not exists "pgcrypto";


-- ── WORKFLOWS ─────────────────────────────────────────────────

create table workflows (
  id          uuid primary key default gen_random_uuid(),
  session_id  text,
  status      text not null default 'running'
              check (status in ('running','completed','failed','paused','aborted')),
  input       jsonb not null default '{}',
  config      jsonb not null default '{}',
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create or replace function touch_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end;
$$;

create trigger workflows_touch
  before update on workflows
  for each row execute procedure touch_updated_at();


-- ── WORKFLOW EVENTS (the core — append-only) ──────────────────

create table workflow_events (
  id          uuid primary key default gen_random_uuid(),
  workflow_id uuid not null references workflows(id) on delete cascade,
  seq         bigint not null,
  type        text   not null,
  payload     jsonb  not null default '{}',
  source      text   not null default 'system'
              check (source in ('system','llm','human')),
  created_at  timestamptz not null default now(),
  unique (workflow_id, seq)
);

create index workflow_events_workflow_seq on workflow_events (workflow_id, seq);
create index workflow_events_type         on workflow_events (workflow_id, type);

create or replace function assign_event_seq()
returns trigger language plpgsql as $$
begin
  select coalesce(max(seq), -1) + 1 into new.seq
  from workflow_events where workflow_id = new.workflow_id;
  return new;
end;
$$;

create trigger workflow_events_seq
  before insert on workflow_events
  for each row execute procedure assign_event_seq();


-- ── IDEAS ─────────────────────────────────────────────────────

create table ideas (
  id          uuid primary key default gen_random_uuid(),
  workflow_id uuid not null references workflows(id) on delete cascade,
  event_id    uuid not null references workflow_events(id),
  name        text not null,
  tagline     text,
  problem     text,
  target      text,
  gap         text,
  signals     jsonb default '[]',
  tags        jsonb default '[]',
  score       int,
  confidence  int,
  difficulty  text check (difficulty in ('low','medium','high')),
  market_size text check (market_size in ('small','medium','large')),
  lens        text,
  shortlisted boolean not null default false,
  skipped     boolean not null default false,
  decided     boolean not null default false,
  created_at  timestamptz not null default now()
);

create index ideas_workflow on ideas (workflow_id);
create index ideas_lens     on ideas (workflow_id, lens);
create index ideas_tags     on ideas using gin (tags);


-- ── DRILL REPORTS ─────────────────────────────────────────────

create table drill_reports (
  id              uuid primary key default gen_random_uuid(),
  workflow_id     uuid not null references workflows(id) on delete cascade,
  idea_id         uuid not null references ideas(id) on delete cascade,
  event_id        uuid not null references workflow_events(id),
  verdict         text check (verdict in ('GO','MAYBE','PASS')),
  verdict_reason  text,
  competitors     jsonb default '[]',
  gtm             text,
  tech_risk       text,
  market_risk     text,
  arr_12m         text,
  mvp_weeks       int,
  mvp_team        text,
  mvp_cost        text,
  summary         text,
  created_at      timestamptz not null default now(),
  unique (idea_id)
);


-- ── SNAPSHOTS (avoid full replay on long workflows) ───────────

create table workflow_snapshots (
  id           uuid primary key default gen_random_uuid(),
  workflow_id  uuid not null references workflows(id) on delete cascade,
  seq          bigint not null,
  state        jsonb  not null,
  event_count  int    not null,
  created_at   timestamptz default now(),
  unique (workflow_id, seq)
);

create index snapshots_workflow on workflow_snapshots (workflow_id, seq desc);


-- ── WORKFLOW JOBS (durable queue) ─────────────────────────────

create table workflow_jobs (
  id           uuid primary key default gen_random_uuid(),
  workflow_id  uuid not null references workflows(id),
  job_type     text not null
               check (job_type in ('run_workflow','run_lens','run_drill','run_opinion')),
  payload      jsonb not null default '{}',
  status       text not null default 'pending'
               check (status in ('pending','running','completed','failed','dead')),
  attempts     int  not null default 0,
  max_attempts int  not null default 3,
  run_at       timestamptz not null default now(),
  started_at   timestamptz,
  completed_at timestamptz,
  error        text,
  created_at   timestamptz default now()
);

create index jobs_pending on workflow_jobs (status, run_at)
  where status = 'pending';

-- Atomic job claim — prevents two workers processing same job
create or replace function claim_next_job()
returns workflow_jobs language plpgsql as $$
declare
  job workflow_jobs;
begin
  select * into job
  from workflow_jobs
  where status = 'pending'
    and run_at <= now()
  order by run_at asc
  limit 1
  for update skip locked;

  if not found then return null; end if;

  update workflow_jobs
  set status = 'running', started_at = now(), attempts = attempts + 1
  where id = job.id;

  return job;
end;
$$;


-- ── ROW LEVEL SECURITY ────────────────────────────────────────

alter table workflows          enable row level security;
alter table workflow_events    enable row level security;
alter table ideas              enable row level security;
alter table drill_reports      enable row level security;
alter table workflow_snapshots enable row level security;
alter table workflow_jobs      enable row level security;

-- Service role: full access (backend uses service key, never exposed to client)
create policy "svc_workflows"  on workflows          for all using (auth.role() = 'service_role');
create policy "svc_events"     on workflow_events    for all using (auth.role() = 'service_role');
create policy "svc_ideas"      on ideas              for all using (auth.role() = 'service_role');
create policy "svc_drills"     on drill_reports      for all using (auth.role() = 'service_role');
create policy "svc_snapshots"  on workflow_snapshots for all using (auth.role() = 'service_role');
create policy "svc_jobs"       on workflow_jobs      for all using (auth.role() = 'service_role');

-- Anon/authenticated users: read their own session data
create policy "users_read_workflows"
  on workflows for select
  using (session_id = current_setting('request.headers', true)::jsonb->>'x-session-id');

create policy "users_read_events"
  on workflow_events for select
  using (workflow_id in (
    select id from workflows
    where session_id = current_setting('request.headers', true)::jsonb->>'x-session-id'
  ));


-- ── REALTIME ──────────────────────────────────────────────────

alter publication supabase_realtime add table workflow_events;
alter publication supabase_realtime add table workflows;
alter publication supabase_realtime add table workflow_jobs;


-- ── VIEWS ─────────────────────────────────────────────────────

create or replace view workflow_summary as
select
  w.id, w.session_id, w.status, w.input, w.config, w.created_at,
  count(distinct i.id)                                        as idea_count,
  count(distinct i.id) filter (where i.shortlisted)          as shortlisted_count,
  count(distinct i.id) filter (where i.decided)              as decided_count,
  count(distinct dr.id)                                       as drill_count,
  count(distinct we.id)                                       as event_count,
  max(we.created_at)                                          as last_event_at
from workflows w
left join ideas i            on i.workflow_id  = w.id
left join drill_reports dr   on dr.workflow_id = w.id
left join workflow_events we on we.workflow_id = w.id
group by w.id;

create or replace view workflow_token_usage as
select
  workflow_id,
  sum((payload->>'tokens')::int)                                  as total_tokens,
  count(*) filter (where type = 'TOOL_INVOKED')                   as total_tool_calls,
  count(*) filter (where type = 'SANDBOX_VIOLATION')              as violations,
  count(*) filter (where type = 'TOOL_FAILED')                    as tool_failures
from workflow_events
where type in ('TOKEN_USAGE','TOOL_INVOKED','SANDBOX_VIOLATION','TOOL_FAILED')
group by workflow_id;

create or replace view queue_health as
select
  status, job_type,
  count(*)                                                        as count,
  avg(extract(epoch from (coalesce(completed_at, now()) - started_at)))
                                                                  as avg_duration_secs,
  max(attempts)                                                   as max_attempts_seen
from workflow_jobs
group by status, job_type
order by status, job_type;

DOPE_EOF_SCHEMA_SQL
cat > "$ROOT/app/layout.tsx" << 'DOPE_EOF_APP_LAYOUT_TSX'
// ============================================================
// app/layout.tsx
// ============================================================

import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title:       "DOPE — Deterministic Orchestration over Probabilistic Execution",
  description: "AI-powered SaaS idea research engine with durable workflow orchestration",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}


// ============================================================
// app/globals.css
// ============================================================

/*
* { box-sizing: border-box; margin: 0; padding: 0; }
body { background: #07070f; color: #e2e8f0; font-family: 'IBM Plex Mono', 'Courier New', monospace; }
::-webkit-scrollbar { width: 5px; height: 5px; }
::-webkit-scrollbar-track { background: #07070f; }
::-webkit-scrollbar-thumb { background: #252540; border-radius: 3px; }
select, input, textarea { font-family: inherit; }
*/


// ============================================================
// app/page.tsx
// The main research page — wraps the DOPE UI.
// Swap this for whatever UI you want (DOPE artifact, custom, etc.)
// ============================================================

"use client";

import { useWorkflow } from "@/hooks/useWorkflow";
import { getSessionId } from "@/lib/supabase";
import { useState } from "react";

export default function Home() {
  const {
    state, eventLog, drillData, opinions, isRunning,
    startWorkflow, sendAction, drillIdea, reset,
    workflowId,
  } = useWorkflow();

  const [context,   setContext]   = useState("");
  const [mode,      setMode]      = useState<"single" | "batch">("batch");
  const [lens,      setLens]      = useState("market_gap");
  const [count,     setCount]     = useState(5);

  const handleRun = () => startWorkflow({ context, mode, lens, count });

  // ── This page is intentionally minimal — swap with your full UI ──
  return (
    <main style={{ padding: 40, maxWidth: 800, margin: "0 auto" }}>
      <h1 style={{ letterSpacing: 4, marginBottom: 24 }}>DOPE</h1>
      <p style={{ color: "#64748b", marginBottom: 32 }}>
        Workflow: <code>{workflowId ?? "none"}</code> · Phase: <code>{state.phase}</code>
      </p>

      <div style={{ display: "flex", gap: 12, marginBottom: 24, flexWrap: "wrap" }}>
        <input
          value={context}
          onChange={e => setContext(e.target.value)}
          placeholder="Context (e.g. healthcare)"
          style={{ flex: 1, padding: "8px 12px", background: "#111122", border: "1px solid #252540", color: "#e2e8f0", borderRadius: 4 }}
        />
        <select value={mode} onChange={e => setMode(e.target.value as any)}
          style={{ padding: "8px 12px", background: "#111122", border: "1px solid #252540", color: "#e2e8f0", borderRadius: 4 }}>
          <option value="single">Single lens</option>
          <option value="batch">All lenses</option>
        </select>
        <button onClick={handleRun} disabled={isRunning}
          style={{ padding: "8px 24px", background: isRunning ? "#1f2937" : "#6366f1", color: isRunning ? "#4b5563" : "#fff", border: "none", borderRadius: 4, cursor: isRunning ? "not-allowed" : "pointer" }}>
          {isRunning ? "Running…" : "Run →"}
        </button>
        {workflowId && <button onClick={reset} style={{ padding: "8px 12px", background: "#1f2937", color: "#9ca3af", border: "none", borderRadius: 4, cursor: "pointer" }}>Reset</button>}
      </div>

      {state.ideas.length > 0 && (
        <div>
          <p style={{ color: "#64748b", marginBottom: 16 }}>{state.ideas.length} ideas found</p>
          {state.ideas.map(idea => (
            <div key={idea.id} style={{ border: "1px solid #1f2937", borderRadius: 6, padding: 16, marginBottom: 12 }}>
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
                <strong>{idea.name}</strong>
                <span style={{ color: "#6366f1" }}>{idea.score}/100</span>
              </div>
              <p style={{ color: "#94a3b8", fontSize: 14, marginBottom: 8 }}>{idea.tagline}</p>
              <div style={{ display: "flex", gap: 8 }}>
                <button onClick={() => sendAction("idea_shortlisted", { ideaId: idea.id })}
                  style={{ fontSize: 11, padding: "4px 10px", background: state.shortlist.includes(idea.id) ? "#1e1e3f" : "#111122", color: "#6366f1", border: "1px solid #6366f1", borderRadius: 4, cursor: "pointer" }}>
                  {state.shortlist.includes(idea.id) ? "★ Shortlisted" : "☆ Shortlist"}
                </button>
                <button onClick={() => drillIdea(idea)}
                  style={{ fontSize: 11, padding: "4px 10px", background: "#111122", color: "#d97706", border: "1px solid #d97706", borderRadius: 4, cursor: "pointer" }}>
                  ⚡ Drill
                </button>
                <button onClick={() => sendAction("human_decided", { ideaId: idea.id })}
                  style={{ fontSize: 11, padding: "4px 10px", background: state.decision === idea.id ? "#0a1a0a" : "#111122", color: "#059669", border: "1px solid #059669", borderRadius: 4, cursor: "pointer" }}>
                  {state.decision === idea.id ? "✓ Chosen" : "→ Build this"}
                </button>
              </div>
              {drillData[idea.id] && (
                <div style={{ marginTop: 10, padding: 10, background: "#0d0d17", borderRadius: 4, fontSize: 12, color: "#9ca3af" }}>
                  Verdict: <strong style={{ color: "#059669" }}>{(drillData[idea.id] as any).verdict}</strong> — {(drillData[idea.id] as any).verdictReason}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {eventLog.length > 0 && (
        <details style={{ marginTop: 24 }}>
          <summary style={{ color: "#4b5563", cursor: "pointer", fontSize: 12 }}>
            Event log ({eventLog.length} events)
          </summary>
          <div style={{ marginTop: 8, maxHeight: 300, overflow: "auto" }}>
            {eventLog.map(e => (
              <div key={e.id} style={{ fontSize: 10, color: "#374151", fontFamily: "monospace", marginBottom: 3 }}>
                [{e.seq}] {e.type} — {JSON.stringify(e.payload).slice(0, 60)}
              </div>
            ))}
          </div>
        </details>
      )}
    </main>
  );
}

DOPE_EOF_APP_LAYOUT_TSX
cat > "$ROOT/app/api/workflow/route.ts" << 'DOPE_EOF_APP_API_WORKFLOW_ROUTE_TS'
// ============================================================
// app/api/workflow/route.ts
// POST /api/workflow  — start a new workflow
// GET  /api/workflow  — list recent workflows for a session
// ============================================================

import { NextRequest, NextResponse } from "next/server";
import { getServerClient } from "@/lib/supabase";
import { WorkflowQueue } from "@/lib/queue";

// ── POST: Start a new workflow ────────────────────────────────

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));

  const {
    sessionId  = "anon",
    context    = "",
    count      = 5,
    mode       = "batch",       // "single" | "batch" | "multi-agent"
    lens       = "market_gap",  // used when mode = "single"
    weights    = { viability: 40, ease: 30, market: 20, confidence: 10 },
    rubric     = {},
  } = body;

  const db = getServerClient();

  // Create the workflow row
  const { data: workflow, error } = await db
    .from("workflows")
    .insert({
      session_id: sessionId,
      status:     "running",
      input:      { context, count, lens },
      config:     { mode, weights, rubric },
    })
    .select("id")
    .single();

  if (error || !workflow) {
    return NextResponse.json({ error: error?.message ?? "Failed to create workflow" }, { status: 500 });
  }

  const workflowId = workflow.id;

  // Emit WORKFLOW_STARTED event
  await db.from("workflow_events").insert({
    workflow_id: workflowId,
    type:        mode === "batch" ? "BATCH_STARTED" : "WORKFLOW_STARTED",
    payload:     { context, count, lens, mode, total: mode === "batch" ? 4 : 1 },
    source:      "system",
  });

  // Enqueue the job — worker picks it up, runs activities, emits events
  const queue = new WorkflowQueue(db);
  await queue.enqueue(workflowId, "run_workflow", { context, count, lens, mode, weights, rubric });

  return NextResponse.json({
    workflowId,
    status:  "running",
    message: "Workflow started. Subscribe to workflow_events for live updates.",
  });
}

// ── GET: List recent workflows for a session ──────────────────

export async function GET(req: NextRequest) {
  const sessionId = req.nextUrl.searchParams.get("sessionId") ?? "anon";
  const limit     = parseInt(req.nextUrl.searchParams.get("limit") ?? "10");

  const db = getServerClient();

  const { data, error } = await db
    .from("workflow_summary")
    .select("*")
    .eq("session_id", sessionId)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ workflows: data ?? [] });
}

DOPE_EOF_APP_API_WORKFLOW_ROUTE_TS
cat > "$ROOT/app/api/workflow/[id]/route.ts" << 'DOPE_EOF_APP_API_WORKFLOW_ID_ROUTE_TS'
// ============================================================
// app/api/workflow/[id]/route.ts
// GET    /api/workflow/:id          — replay state from event log
// DELETE /api/workflow/:id          — abort a running workflow
// ============================================================

import { NextRequest, NextResponse } from "next/server";
import { getServerClient } from "@/lib/supabase";

type Params = { params: { id: string } };

// ── GET: Replay state ─────────────────────────────────────────

export async function GET(req: NextRequest, { params }: Params) {
  const { id: workflowId } = params;
  const db  = getServerClient();
  const seq = req.nextUrl.searchParams.get("seq");   // optional: replay up to seq N

  // Load events
  let query = db
    .from("workflow_events")
    .select("*")
    .eq("workflow_id", workflowId)
    .order("seq", { ascending: true });

  if (seq) query = query.lte("seq", parseInt(seq));

  const { data: events, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Load workflow row
  const { data: workflow } = await db
    .from("workflows")
    .select("*")
    .eq("id", workflowId)
    .single();

  // Replay state from events (same reducer as frontend)
  const state = replayEvents(events ?? []);

  return NextResponse.json({
    workflowId,
    workflow,
    state,
    eventCount: events?.length ?? 0,
    latestSeq:  events?.at(-1)?.seq ?? 0,
  });
}

// ── DELETE: Abort workflow ────────────────────────────────────

export async function DELETE(req: NextRequest, { params }: Params) {
  const { id: workflowId } = params;
  const db = getServerClient();

  // Emit abort event
  await db.from("workflow_events").insert({
    workflow_id: workflowId,
    type:        "WORKFLOW_ABORTED",
    payload:     { reason: "user_cancelled" },
    source:      "human",
  });

  // Update workflow status
  await db.from("workflows").update({ status: "aborted" }).eq("id", workflowId);

  // Cancel any pending jobs
  await db
    .from("workflow_jobs")
    .update({ status: "dead", error: "workflow_aborted" })
    .eq("workflow_id", workflowId)
    .eq("status", "pending");

  return NextResponse.json({ workflowId, status: "aborted" });
}

// ── Reducer (server-side mirror of client reducer) ────────────

function replayEvents(events: any[]): Record<string, unknown> {
  const initial = {
    phase: "idle", ideas: [], shortlist: [], skipped: [],
    decision: null, compareIds: [], error: null, batchProgress: null,
  };

  return events
    .sort((a, b) => (a.seq ?? 0) - (b.seq ?? 0))
    .reduce((state: any, event: any) => {
      const p = event.payload ?? {};
      switch (event.type) {
        case "WORKFLOW_STARTED":
        case "BATCH_STARTED":
          return { ...state, phase: "researching", batchProgress: event.type === "BATCH_STARTED" ? { done: 0, total: p.total ?? 4, current: null } : null };
        case "LENS_COMPLETED":
          return { ...state, ideas: dedup([...state.ideas, ...(p.ideas ?? [])]) };
        case "IDEAS_MERGED":
          return { ...state, phase: "awaiting_decision", ideas: p.ideas ?? state.ideas, batchProgress: null };
        case "IDEA_SHORTLISTED":
          return { ...state, shortlist: state.shortlist.includes(p.ideaId) ? state.shortlist.filter((id: string) => id !== p.ideaId) : [...state.shortlist, p.ideaId] };
        case "IDEA_SKIPPED":
          return { ...state, skipped: state.skipped.includes(p.ideaId) ? state.skipped.filter((id: string) => id !== p.ideaId) : [...state.skipped, p.ideaId] };
        case "HUMAN_DECIDED":
          return { ...state, phase: "decided", decision: p.ideaId };
        case "WORKFLOW_COMPLETED":
          return { ...state, phase: "complete" };
        case "WORKFLOW_FAILED":
          return { ...state, phase: "error", error: p.message };
        case "WORKFLOW_ABORTED":
          return { ...state, phase: "aborted", error: p.reason };
        default:
          return state;
      }
    }, initial);
}

function dedup(ideas: any[]): any[] {
  return ideas.reduce((acc: any[], idea) => {
    const existing = acc.find(x => x.name?.toLowerCase().slice(0, 6) === idea.name?.toLowerCase().slice(0, 6));
    if (!existing || idea.score > existing.score) {
      return existing ? [...acc.filter(x => x !== existing), idea] : [...acc, idea];
    }
    return acc;
  }, []);
}

DOPE_EOF_APP_API_WORKFLOW_ID_ROUTE_TS
cat > "$ROOT/app/api/workflow/[id]/action/route.ts" << 'DOPE_EOF_APP_API_WORKFLOW_ID_ACTION_ROUTE_TS'
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

DOPE_EOF_APP_API_WORKFLOW_ID_ACTION_ROUTE_TS
cat > "$ROOT/app/api/workflow/[id]/drill/route.ts" << 'DOPE_EOF_APP_API_WORKFLOW_ID_DRILL_ROUTE_TS'
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

DOPE_EOF_APP_API_WORKFLOW_ID_DRILL_ROUTE_TS
cat > "$ROOT/app/api/workflow/[id]/simulate/route.ts" << 'DOPE_EOF_APP_API_WORKFLOW_ID_SIMULATE_ROUTE_TS'
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

DOPE_EOF_APP_API_WORKFLOW_ID_SIMULATE_ROUTE_TS
cat > "$ROOT/app/api/worker/route.ts" << 'DOPE_EOF_APP_API_WORKER_ROUTE_TS'
// ============================================================
// app/api/worker/route.ts
// GET /api/worker — claim and process one job from the queue.
//
// Trigger this endpoint every 5–10 seconds via:
//   - Supabase Edge Functions cron
//   - Vercel cron (vercel.json)
//   - External scheduler (cron-job.org, etc.)
//
// Each invocation processes ONE job and returns.
// Run multiple concurrent invocations for parallelism.
// ============================================================

import { NextRequest, NextResponse } from "next/server";
import { getServerClient } from "@/lib/supabase";
import { callLLMJSON, callLLM } from "@/lib/llm";

const CRON_SECRET = process.env.WORKER_CRON_SECRET ?? "";

// ── Lens prompts (self-contained — no external imports) ───────

const LENS_CONFIGS: Record<string, { system: string; userPrompt: (ctx: string, count: number) => string }> = {
  market_gap: {
    system: "You are a sharp SaaS market researcher. Find real market gaps where existing tools are weak.",
    userPrompt: (ctx, n) => `Research SaaS market gaps ${ctx ? "in: " + ctx : "across B2B software"}.\nReturn ONLY: {"ideas":[{"id":"idea_1","name":"Name","tagline":"Value prop","problem":"Pain","target":"Persona","gap":"Why solutions fail","signals":["s1","s2"],"difficulty":"low","marketSize":"medium","score":72,"confidence":80,"tags":["B2B"]}]}\nGenerate ${n} ideas. No markdown.`,
  },
  pain_driven: {
    system: "You are a SaaS researcher who mines reviews and Reddit for recurring complaints.",
    userPrompt: (ctx, n) => `Find SaaS ideas from documented pain points ${ctx ? "in " + ctx : "in B2B"}.\nReturn ONLY: {"ideas":[{"id":"idea_1","name":"Name","tagline":"Value prop","problem":"Complaint","target":"Who","gap":"Why no fix","signals":["s1","s2"],"difficulty":"low","marketSize":"medium","score":72,"confidence":80,"tags":["B2B"]}]}\nGenerate ${n} ideas. No markdown.`,
  },
  trend_riding: {
    system: "You are a SaaS trend analyst. Find structural shifts and the SaaS opportunities they create.",
    userPrompt: (ctx, n) => `Find SaaS ideas riding structural trends ${ctx ? "in " + ctx : ""}.\nReturn ONLY: {"ideas":[{"id":"idea_1","name":"Name","tagline":"Value prop","problem":"Trend need","target":"Who","gap":"Why solutions miss","signals":["s1","s2"],"difficulty":"low","marketSize":"medium","score":72,"confidence":80,"tags":["AI-native"]}]}\nGenerate ${n} ideas. No markdown.`,
  },
  niche_vertical: {
    system: "You are a vertical SaaS researcher. Find industries where generic tools fail.",
    userPrompt: (ctx, n) => `Find vertical SaaS opportunities ${ctx ? "in " + ctx : ""}.\nReturn ONLY: {"ideas":[{"id":"idea_1","name":"Name","tagline":"Value prop","problem":"Generic tool pain","target":"Role + industry","gap":"What generic tools miss","signals":["s1","s2"],"difficulty":"low","marketSize":"medium","score":72,"confidence":80,"tags":["vertical"]}]}\nGenerate ${n} ideas. No markdown.`,
  },
};

const ALL_LENSES = Object.keys(LENS_CONFIGS);

// ── Worker endpoint ───────────────────────────────────────────

export async function GET(req: NextRequest) {
  // Optional secret check in production
  const secret = req.headers.get("x-cron-secret") ?? req.nextUrl.searchParams.get("secret");
  if (CRON_SECRET && secret !== CRON_SECRET) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const db = getServerClient();

  // Claim one job atomically
  const { data: job, error } = await db.rpc("claim_next_job");
  if (error || !job) {
    return NextResponse.json({ processed: false, reason: "no_jobs" });
  }

  console.log(`[worker] processing job ${job.id} (${job.job_type}) for workflow ${job.workflow_id}`);
  const start = Date.now();

  try {
    await processJob(db, job);
    await db.from("workflow_jobs").update({ status: "completed", completed_at: new Date().toISOString() }).eq("id", job.id);
    console.log(`[worker] job ${job.id} completed in ${Date.now() - start}ms`);
    return NextResponse.json({ processed: true, jobId: job.id, durationMs: Date.now() - start });

  } catch (err) {
    const message = String(err);
    console.error(`[worker] job ${job.id} failed:`, message);

    const attempts    = (job.attempts ?? 1);
    const maxAttempts = job.max_attempts ?? 3;
    const isDead      = attempts >= maxAttempts;
    const retryAt     = new Date(Date.now() + Math.pow(2, attempts) * 1000).toISOString();

    await db.from("workflow_jobs").update({
      status:   isDead ? "dead" : "pending",
      error:    message,
      run_at:   isDead ? undefined : retryAt,
    }).eq("id", job.id);

    if (isDead) {
      await db.from("workflow_events").insert({
        workflow_id: job.workflow_id,
        type:        "WORKFLOW_FAILED",
        payload:     { message, jobId: job.id, jobType: job.job_type },
        source:      "system",
      });
    }

    return NextResponse.json({ processed: false, error: message }, { status: 500 });
  }
}

// ── Job processors ────────────────────────────────────────────

async function processJob(db: any, job: any): Promise<void> {
  const p = job.payload as Record<string, any>;

  switch (job.job_type) {

    case "run_workflow": {
      const { context = "", count = 5, lens, mode = "batch" } = p;
      const lenses = mode === "batch" ? ALL_LENSES : [lens ?? "market_gap"];

      for (const lensId of lenses) {
        await runLens(db, job.workflow_id, lensId, context, count);
      }

      // Emit IDEAS_MERGED after all lenses done
      const { data: ideaEvents } = await db
        .from("workflow_events")
        .select("payload")
        .eq("workflow_id", job.workflow_id)
        .eq("type", "LENS_COMPLETED");

      const allIdeas = (ideaEvents ?? []).flatMap((e: any) => e.payload?.ideas ?? []);
      const merged   = dedup(allIdeas);

      await db.from("workflow_events").insert({
        workflow_id: job.workflow_id,
        type:        "IDEAS_MERGED",
        payload:     { ideas: merged },
        source:      "system",
      });

      await db.from("workflow_events").insert({
        workflow_id: job.workflow_id,
        type:        "WORKFLOW_COMPLETED",
        payload:     { ideaCount: merged.length },
        source:      "system",
      });

      await db.from("workflows").update({ status: "completed" }).eq("id", job.workflow_id);
      break;
    }

    case "run_lens": {
      const { lensId, context = "", count = 5 } = p;
      await runLens(db, job.workflow_id, lensId, context, count);
      break;
    }

    case "run_drill": {
      const { idea } = p;
      if (!idea) throw new Error("run_drill: idea missing from payload");
      await runDrill(db, job.workflow_id, idea);
      break;
    }

    case "run_opinion": {
      const { idea, originalLens } = p;
      if (!idea) throw new Error("run_opinion: idea missing from payload");
      await runOpinion(db, job.workflow_id, idea, originalLens ?? "market_gap");
      break;
    }

    default:
      throw new Error(`Unknown job type: ${job.job_type}`);
  }
}

// ── Activity functions ────────────────────────────────────────

async function runLens(db: any, workflowId: string, lensId: string, context: string, count: number): Promise<void> {
  const cfg = LENS_CONFIGS[lensId];
  if (!cfg) throw new Error(`Unknown lens: ${lensId}`);

  await db.from("workflow_events").insert({ workflow_id: workflowId, type: "LENS_STARTED", payload: { lens: lensId }, source: "system" });

  const result = await callLLMJSON({ system: cfg.system, user: cfg.userPrompt(context, count), maxTokens: 2500 }, { ideas: [] });
  const ideas  = (result.ideas ?? []).map((idea: any, i: number) => ({ ...idea, id: `${lensId}_${i}_${Date.now()}`, _lens: lensId }));

  await db.from("workflow_events").insert({ workflow_id: workflowId, type: "LENS_COMPLETED", payload: { lens: lensId, ideas }, source: "llm" });
}

async function runDrill(db: any, workflowId: string, idea: any): Promise<void> {
  const system = "You are a SaaS due-diligence analyst. Rigorous, name real competitors, identify real risks. Return JSON only.";
  const user   = `Deep-dive and return ONLY:\n{"competitors":[{"name":"X","weakness":"Y"}],"gtm":"First 100 customers","techRisk":"Risk","marketRisk":"Risk","arr12m":"ARR","verdict":"GO","verdictReason":"One line","mvpWeeks":8,"mvpTeam":"solo","mvpCost":"$0-5k","summary":"200 word analysis"}\n\nName: ${idea.name}\nProblem: ${idea.problem}\nTarget: ${idea.target}\nGap: ${idea.gap}`;

  const report = await callLLMJSON({ system, user, maxTokens: 1500 }, { verdict: "MAYBE", verdictReason: "Parse error", competitors: [], gtm: "", techRisk: "", marketRisk: "", arr12m: "", mvpWeeks: null, mvpTeam: "", mvpCost: "", summary: "" });

  await db.from("workflow_events").insert({ workflow_id: workflowId, type: "DRILL_COMPLETED", payload: { ideaId: idea.id, report }, source: "llm" });
}

async function runOpinion(db: any, workflowId: string, idea: any, originalLens: string): Promise<void> {
  const others = ALL_LENSES.filter(l => l !== originalLens);
  const lens   = others[Math.floor(Math.random() * others.length)];

  const system = `You are a SaaS analyst giving a second opinion from a ${lens} perspective.`;
  const user   = `Second opinion on: ${idea.name} — ${idea.tagline}\nProblem: ${idea.problem}\n\nReturn ONLY: {"agreement":"agree|partial|disagree","newAngle":"What this adds","revisedScore":72,"revisedConfidence":65,"keyInsight":"Most important insight"}`;

  const opinion = await callLLMJSON({ system, user, maxTokens: 600 }, { agreement: "partial", newAngle: "", revisedScore: idea.score, revisedConfidence: 50, keyInsight: "" });

  await db.from("workflow_events").insert({ workflow_id: workflowId, type: "OPINION_COMPLETED", payload: { ideaId: idea.id, lens, opinion }, source: "llm" });
}

function dedup(ideas: any[]): any[] {
  return ideas.reduce((acc: any[], idea) => {
    const ex = acc.find(x => x.name?.toLowerCase().slice(0, 6) === idea.name?.toLowerCase().slice(0, 6));
    return (!ex || idea.score > ex.score) ? [...(ex ? acc.filter(x => x !== ex) : acc), idea] : acc;
  }, []);
}

DOPE_EOF_APP_API_WORKER_ROUTE_TS
cat > "$ROOT/hooks/useWorkflow.ts" << 'DOPE_EOF_HOOKS_USEWORKFLOW_TS'
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

DOPE_EOF_HOOKS_USEWORKFLOW_TS
cat > "$ROOT/lib/supabase.ts" << 'DOPE_EOF_LIB_SUPABASE_TS'
// ============================================================
// lib/supabase.ts
// Supabase client factory.
// Browser client: uses anon key (safe to expose)
// Server client: uses service role key (never expose)
// ============================================================

import { createClient, SupabaseClient } from "@supabase/supabase-js";

// ── Browser client (singleton) ────────────────────────────────
// Use in React components and hooks.

let _browser: SupabaseClient | null = null;

export function getBrowserClient(): SupabaseClient {
  if (!_browser) {
    _browser = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    );
  }
  return _browser;
}

// ── Server client ─────────────────────────────────────────────
// Use in API routes and server components.
// Bypasses RLS — only use server-side.

export function getServerClient(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !key) {
    throw new Error(
      "Missing Supabase env vars. Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY."
    );
  }

  return createClient(url, key, {
    auth: { persistSession: false },   // no cookie auth on server
  });
}

// ── Session ID helper ─────────────────────────────────────────
// Simple browser-persisted session ID (no auth required).
// Replace with real auth if you add user accounts.

export function getSessionId(): string {
  if (typeof window === "undefined") return "server";

  let id = localStorage.getItem("dope_session_id");
  if (!id) {
    id = `sess_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    localStorage.setItem("dope_session_id", id);
  }
  return id;
}

DOPE_EOF_LIB_SUPABASE_TS
cat > "$ROOT/lib/llm.ts" << 'DOPE_EOF_LIB_LLM_TS'
// ============================================================
// lib/llm.ts
// Anthropic SDK wrapper.
// Handles: retries, timeouts, token tracking, error normalisation.
// All LLM calls in the project go through here.
// ============================================================

import Anthropic from "@anthropic-ai/sdk";

const client = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

export interface LLMCallOptions {
  system:       string;
  user:         string;
  maxTokens?:   number;
  model?:       string;
  maxRetries?:  number;
  timeoutMs?:   number;
}

export interface LLMResult {
  text:         string;
  inputTokens:  number;
  outputTokens: number;
  totalTokens:  number;
  model:        string;
  durationMs:   number;
}

const DEFAULT_MODEL    = "claude-sonnet-4-20250514";
const DEFAULT_TOKENS   = 1500;
const DEFAULT_RETRIES  = 3;
const DEFAULT_TIMEOUT  = 45_000;

// ── Main call ─────────────────────────────────────────────────

export async function callLLM(opts: LLMCallOptions): Promise<LLMResult> {
  const {
    system, user,
    maxTokens  = DEFAULT_TOKENS,
    model      = DEFAULT_MODEL,
    maxRetries = DEFAULT_RETRIES,
    timeoutMs  = DEFAULT_TIMEOUT,
  } = opts;

  const start = Date.now();
  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const response = await withTimeout(
        client.messages.create({
          model,
          max_tokens: maxTokens,
          system,
          messages: [{ role: "user", content: user }],
        }),
        timeoutMs,
        `LLM call timed out after ${timeoutMs}ms`,
      );

      const text = response.content
        .filter(b => b.type === "text")
        .map(b => (b as Anthropic.TextBlock).text)
        .join("");

      return {
        text,
        inputTokens:  response.usage.input_tokens,
        outputTokens: response.usage.output_tokens,
        totalTokens:  response.usage.input_tokens + response.usage.output_tokens,
        model:        response.model,
        durationMs:   Date.now() - start,
      };

    } catch (err) {
      lastError = err as Error;
      const isRetryable = isRetryableError(err);

      if (!isRetryable || attempt === maxRetries) break;

      // Exponential backoff: 1s → 2s → 4s
      const delay = Math.pow(2, attempt - 1) * 1000;
      console.warn(`[llm] attempt ${attempt} failed (${lastError.message}), retrying in ${delay}ms`);
      await sleep(delay);
    }
  }

  throw new Error(`LLM call failed after ${maxRetries} attempts: ${lastError?.message}`);
}

// ── JSON call — parses response as JSON ───────────────────────

export async function callLLMJSON<T>(
  opts:     LLMCallOptions,
  fallback: T,
): Promise<T> {
  const result = await callLLM(opts);
  const clean  = result.text.replace(/```json|```/g, "").trim();
  try {
    return JSON.parse(clean) as T;
  } catch (e) {
    console.warn("[llm] JSON parse failed, returning fallback:", clean.slice(0, 100));
    return fallback;
  }
}

// ── Helpers ───────────────────────────────────────────────────

function isRetryableError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  const msg = err.message.toLowerCase();
  return (
    msg.includes("timeout") ||
    msg.includes("rate limit") ||
    msg.includes("overloaded") ||
    msg.includes("529") ||
    msg.includes("503") ||
    msg.includes("502")
  );
}

function sleep(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms));
}

function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error(message)), ms)),
  ]);
}

DOPE_EOF_LIB_LLM_TS
cat > "$ROOT/lib/queue.ts" << 'DOPE_EOF_LIB_QUEUE_TS'
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

DOPE_EOF_LIB_QUEUE_TS
chmod +x "$ROOT/deploy.sh"
echo ""
echo "✓ DOPE project created at ~/dope"
echo ""
echo "Next steps:"
echo "  cd ~/dope"
echo "  ./deploy.sh"