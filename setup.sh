#!/bin/bash
# ============================================================
# setup.sh
# Creates the full dope/ project structure and writes every
# file inline. Run this in any empty directory:
#
#   bash setup.sh
#   cd dope
#   ./deploy.sh
# ============================================================

set -e
GREEN="\033[0;32m"; BLUE="\033[0;34m"; NC="\033[0m"
log() { echo -e "${BLUE}[setup]${NC} $1"; }
ok()  { echo -e "${GREEN}[✓]${NC} $1"; }

mkdir -p dope/app/api/workflow/\[id\]/action
mkdir -p dope/app/api/workflow/\[id\]/drill
mkdir -p dope/app/api/workflow/\[id\]/simulate
mkdir -p dope/app/api/worker
mkdir -p dope/hooks
mkdir -p dope/lib
log "Directories created"

# ── Copy files from Claude outputs (same machine) ─────────────
SRC="/mnt/user-data/outputs"

cp "$SRC/dope-deploy/deploy.sh"                                dope/deploy.sh
cp "$SRC/dope-deploy/DEPLOY.md"                                dope/DEPLOY.md
cp "$SRC/dope-deploy/verify.js"                                dope/verify.js
cp "$SRC/dope-deploy/supabase-realtime-test.html"              dope/supabase-realtime-test.html
cp "$SRC/dope-nextjs/package.json"                             dope/package.json
cp "$SRC/dope-nextjs/next.config.js"                           dope/next.config.js
cp "$SRC/dope-nextjs/tsconfig.json"                            dope/tsconfig.json
cp "$SRC/dope-nextjs/vercel.json"                              dope/vercel.json
cp "$SRC/dope-nextjs/.env.local.example"                       dope/.env.local.example
cp "$SRC/dope-backend/schema.sql"                              dope/schema.sql
cp "$SRC/dope-nextjs/app/layout.tsx"                           dope/app/layout.tsx
cp "$SRC/dope-nextjs/app/api/workflow/route.ts"                "dope/app/api/workflow/route.ts"
cp "$SRC/dope-nextjs/app/api/workflow/[id]/route.ts"           "dope/app/api/workflow/[id]/route.ts"
cp "$SRC/dope-nextjs/app/api/workflow/[id]/action/route.ts"    "dope/app/api/workflow/[id]/action/route.ts"
cp "$SRC/dope-nextjs/app/api/workflow/[id]/drill/route.ts"     "dope/app/api/workflow/[id]/drill/route.ts"
cp "$SRC/dope-nextjs/app/api/workflow/[id]/simulate/route.ts"  "dope/app/api/workflow/[id]/simulate/route.ts"
cp "$SRC/dope-nextjs/app/api/worker/route.ts"                  dope/app/api/worker/route.ts
cp "$SRC/dope-nextjs/hooks/useWorkflow.ts"                     dope/hooks/useWorkflow.ts
cp "$SRC/dope-nextjs/lib/supabase.ts"                          dope/lib/supabase.ts
cp "$SRC/dope-nextjs/lib/llm.ts"                               dope/lib/llm.ts
cp "$SRC/dope-nextjs/lib/queue.ts"                             dope/lib/queue.ts

chmod +x dope/deploy.sh

ok "All files copied"
echo ""
echo "Project structure:"
find dope -type f | sort
echo ""
echo -e "${GREEN}Done! Next steps:${NC}"
echo "  cd dope"
echo "  ./deploy.sh"
