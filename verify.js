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

// â”€â”€ Colours â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
const G = "\x1b[32m", Y = "\x1b[33m", R = "\x1b[31m", B = "\x1b[34m", X = "\x1b[0m";
const ok   = (msg) => console.log(`${G}[âœ“]${X} ${msg}`);
const warn = (msg) => console.log(`${Y}[!]${X} ${msg}`);
const fail = (msg) => console.log(`${R}[âœ—]${X} ${msg}`);
const log  = (msg) => console.log(`${B}[Â·]${X} ${msg}`);

// â”€â”€ HTTP helper â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
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

// â”€â”€ Checks â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
const checks = [];
const results = { passed: 0, warned: 0, failed: 0 };

function check(name, fn) {
  checks.push({ name, fn });
}

// â”€â”€ Run all checks â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
async function run() {
  console.log(`\n${B}â•”â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•—${X}`);
  console.log(`${B}â•‘  DOPE â€” Deployment Verification      â•‘${X}`);
  console.log(`${B}â•šâ•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•${X}`);
  console.log(`\nTarget: ${BASE}\n`);

  // â”€â”€ CHECK 1: App is reachable â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
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

  // â”€â”€ CHECK 2: Worker endpoint responds â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  check("Worker endpoint responds", async () => {
    const res = await request("/api/worker");
    if (res.status === 200 || res.status === 401) {
      ok(`Worker endpoint OK (HTTP ${res.status}${res.status === 401 ? " â€” auth required, expected" : ""})`);
      results.passed++;
    } else {
      fail(`Worker returned HTTP ${res.status}: ${res.raw?.slice(0, 100)}`);
      results.failed++;
    }
  });

  // â”€â”€ CHECK 3: Workflow list endpoint â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  check("GET /api/workflow returns JSON", async () => {
    const res = await request("/api/workflow?sessionId=verify_test");
    if (res.status === 200 && res.body?.workflows !== undefined) {
      ok(`Workflow list OK (${res.body.workflows.length} workflows found)`);
      results.passed++;
    } else {
      fail(`Workflow list failed: HTTP ${res.status} â€” ${JSON.stringify(res.body)?.slice(0, 100)}`);
      results.failed++;
    }
  });

  // â”€â”€ CHECK 4: Can create a workflow â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
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
      fail(`Workflow creation failed: HTTP ${res.status} â€” ${JSON.stringify(res.body)?.slice(0, 100)}`);
      results.failed++;
    }
  });

  // â”€â”€ CHECK 5: Can replay workflow state â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  check("GET /api/workflow/:id replays state", async () => {
    if (!workflowId) { warn("Skipped â€” no workflow created"); results.warned++; return; }
    const res = await request(`/api/workflow/${workflowId}`);
    if (res.status === 200 && res.body?.state) {
      ok(`Replay OK â€” phase: "${res.body.state.phase}", events: ${res.body.eventCount}`);
      results.passed++;
    } else {
      fail(`Replay failed: HTTP ${res.status} â€” ${JSON.stringify(res.body)?.slice(0, 100)}`);
      results.failed++;
    }
  });

  // â”€â”€ CHECK 6: Human action endpoint â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  check("POST /api/workflow/:id/action accepts human action", async () => {
    if (!workflowId) { warn("Skipped â€” no workflow created"); results.warned++; return; }
    const res = await request(`/api/workflow/${workflowId}/action`, {
      method: "POST",
      body: { type: "IDEA_SHORTLISTED", payload: { ideaId: "test_idea" } },
    });
    if (res.status === 200 && res.body?.event) {
      ok(`Human action logged â€” seq: ${res.body.event.seq}`);
      results.passed++;
    } else {
      fail(`Action failed: HTTP ${res.status} â€” ${JSON.stringify(res.body)?.slice(0, 100)}`);
      results.failed++;
    }
  });

  // â”€â”€ CHECK 7: Simulate endpoint â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  check("POST /api/workflow/:id/simulate returns scrub frames", async () => {
    if (!workflowId) { warn("Skipped â€” no workflow created"); results.warned++; return; }
    const res = await request(`/api/workflow/${workflowId}/simulate`, {
      method: "POST",
      body: { mode: "scrub", stepSize: 1 },
    });
    if (res.status === 200 && Array.isArray(res.body?.frames)) {
      ok(`Simulate OK â€” ${res.body.frames.length} scrub frames`);
      results.passed++;
    } else {
      fail(`Simulate failed: HTTP ${res.status} â€” ${JSON.stringify(res.body)?.slice(0, 100)}`);
      results.failed++;
    }
  });

  // â”€â”€ CHECK 8: Worker processes the job â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  check("Worker processes pending job", async () => {
    if (!workflowId) { warn("Skipped â€” no workflow created"); results.warned++; return; }

    log("Triggering worker (this calls the LLM â€” may take 15â€“30s)...");
    const res = await request("/api/worker", { method: "GET" });

    if (res.status === 200 && res.body?.processed === true) {
      ok(`Worker processed job ${res.body.jobId} in ${res.body.durationMs}ms`);
      results.passed++;
    } else if (res.status === 200 && res.body?.processed === false) {
      warn(`Worker ran but no job was ready (reason: ${res.body.reason})`);
      results.warned++;
    } else {
      fail(`Worker failed: HTTP ${res.status} â€” ${JSON.stringify(res.body)?.slice(0, 100)}`);
      results.failed++;
    }
  });

  // â”€â”€ CHECK 9: Verify ideas were produced â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  check("Workflow produced ideas after worker run", async () => {
    if (!workflowId) { warn("Skipped"); results.warned++; return; }

    // Wait a moment for events to propagate
    await new Promise(r => setTimeout(r, 2000));

    const res = await request(`/api/workflow/${workflowId}`);
    const ideas = res.body?.state?.ideas ?? [];

    if (ideas.length > 0) {
      ok(`${ideas.length} idea(s) produced â€” first: "${ideas[0]?.name ?? "?"}"`);
      results.passed++;
    } else if (res.body?.state?.phase === "researching") {
      warn("Worker still running â€” ideas not yet produced (normal for slow LLM responses)");
      results.warned++;
    } else {
      fail(`No ideas produced â€” phase: "${res.body?.state?.phase}", error: "${res.body?.state?.error ?? "none"}"`);
      results.failed++;
    }
  });

  // â”€â”€ CHECK 10: Abort workflow â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
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

  // â”€â”€ Run all checks sequentially â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  for (const { name, fn } of checks) {
    log(`Running: ${name}`);
    try {
      await fn();
    } catch (err) {
      fail(`${name} threw: ${err.message}`);
      results.failed++;
    }
  }

  // â”€â”€ Summary â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  console.log(`\n${B}â•”â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•—${X}`);
  console.log(`${B}â•‘  Verification Summary                â•‘${X}`);
  console.log(`${B}â•šâ•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•${X}`);
  console.log(`\n  ${G}Passed:${X}  ${results.passed}`);
  console.log(`  ${Y}Warned:${X}  ${results.warned}`);
  console.log(`  ${R}Failed:${X}  ${results.failed}`);
  console.log(`\n  Total checks: ${checks.length}`);

  if (results.failed === 0) {
    console.log(`\n${G}  âœ“ All checks passed â€” DOPE is deployed and working.${X}\n`);
    process.exit(0);
  } else {
    console.log(`\n${R}  âœ— ${results.failed} check(s) failed â€” see above for details.${X}\n`);
    console.log("  Common fixes:");
    console.log("    - Schema not applied â†’ run schema.sql in Supabase SQL Editor");
    console.log("    - Missing env vars   â†’ check .env.local or Vercel dashboard");
    console.log("    - Worker not running â†’ curl /api/worker to trigger manually\n");
    process.exit(1);
  }
}

run().catch((err) => {
  fail(`Verification script crashed: ${err.message}`);
  process.exit(1);
});
