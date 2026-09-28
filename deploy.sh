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
ok()     { echo -e "${GREEN}[âœ“]${NC} $1"; }
warn()   { echo -e "${YELLOW}[!]${NC} $1"; }
fail()   { echo -e "${RED}[âœ—]${NC} $1"; exit 1; }

echo ""
echo -e "${BLUE}â•”â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•—${NC}"
echo -e "${BLUE}â•‘  DOPE â€” Deployment Script            â•‘${NC}"
echo -e "${BLUE}â•šâ•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•${NC}"
echo ""

# â”€â”€ Step 1: Check prerequisites â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
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
    echo "  NEXT_PUBLIC_SUPABASE_URL=     (from Supabase Dashboard â†’ Settings â†’ API)"
    echo "  NEXT_PUBLIC_SUPABASE_ANON_KEY= (from Supabase Dashboard â†’ Settings â†’ API)"
    echo "  SUPABASE_SERVICE_ROLE_KEY=    (from Supabase Dashboard â†’ Settings â†’ API)"
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

# â”€â”€ Step 2: Install dependencies â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
log "Installing dependencies..."
npm install --silent
ok "Dependencies installed"

# â”€â”€ Step 3: Type check â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
log "Running type check..."
npx tsc --noEmit && ok "TypeScript OK" || warn "TypeScript errors found (continuing anyway)"

# â”€â”€ Step 4: Run schema against Supabase â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
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

# â”€â”€ Step 5: Verify DB connection â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
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
" && ok "Supabase connection verified" || fail "Could not connect to Supabase â€” check your env vars and schema"

# â”€â”€ Step 6: Test LLM connection â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
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
" && ok "Anthropic API verified" || fail "Anthropic API check failed â€” verify your ANTHROPIC_API_KEY"

# â”€â”€ Step 7: Build â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
log "Building Next.js app..."
npm run build && ok "Build successful" || fail "Build failed"

# â”€â”€ Step 8: Deploy or run locally â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
echo ""
echo -e "${BLUE}â•”â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•—${NC}"
echo -e "${BLUE}â•‘  Choose deployment target            â•‘${NC}"
echo -e "${BLUE}â•šâ•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•${NC}"
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
    echo "The CLI will prompt you â€” or set them at vercel.com/dashboard."
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
echo -e "${GREEN}â•”â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•—${NC}"
echo -e "${GREEN}â•‘  DOPE deployment complete            â•‘${NC}"
echo -e "${GREEN}â•šâ•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•${NC}"
echo ""
