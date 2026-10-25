#!/usr/bin/env bash
# Hackathon Scout — one-key deploy.
# Usage:  cp .env.example .env   # put your token inside
#         bash deploy.sh
set -euo pipefail
cd "$(dirname "$0")"

if [ -f .env ]; then set -a; source .env; set +a; fi

if [ -z "${CLOUDFLARE_API_TOKEN:-}" ] || [[ "$CLOUDFLARE_API_TOKEN" == *"PASTE"* ]]; then
  echo "❌ CLOUDFLARE_API_TOKEN is missing."
  echo "   1) Cloudflare Dashboard → My Profile → API Tokens → Create Token"
  echo "   2) Use the «Edit Cloudflare Workers» template."
  echo "   3) cp .env.example .env  → paste the token → bash deploy.sh"
  exit 1
fi
export CLOUDFLARE_API_TOKEN

# ---- Git repo (create once, push every deploy) ----
REPO_NAME="${REPO_NAME:-hackathon-scout}"
if [ ! -d .git ]; then
  echo "📦 Initializing git repo…"
  git init -b main
  git add -A
  git commit -m "Hackathon Scout — initial" || true
fi
if ! git remote get-url origin >/dev/null 2>&1; then
  if command -v gh >/dev/null 2>&1; then
    echo "📦 Creating GitHub repo $REPO_NAME…"
    gh repo create "$REPO_NAME" --public --source=. --push || {
      echo "⚠️  gh repo create failed — continuing deploy, push manually later."
    }
  else
    echo "⚠️  No 'gh' CLI and no git remote — skipping repo push."
  fi
else
  git add -A
  git commit -m "Hackathon Scout — update $(date -u +%F)" || true
  git push origin HEAD 2>&1 | tail -2 || true
fi

if ! command -v wrangler >/dev/null 2>&1; then
  echo "📦 Installing wrangler…"
  npm i -g wrangler
fi
if ! command -v python3 >/dev/null 2>&1; then
  echo "❌ python3 is required."; exit 1
fi

# ---- D1 ----
if grep -q '^database_id' wrangler.toml; then
  echo "✅ D1 already linked."
else
  echo "🗄️  Creating D1 database…"
  OUT=$(wrangler d1 create hackathon-scout 2>&1) || { echo "$OUT"; exit 1; }
  echo "$OUT"
  D1_ID=$(echo "$OUT" | grep -oE '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}' | head -1)
  if [ -z "${D1_ID:-}" ]; then echo "❌ Could not parse D1 id."; exit 1; fi
  python3 - "$D1_ID" <<'EOF'
import sys, re
p = "wrangler.toml"
s = open(p).read()
s = s.replace('# database_id = "PASTE_D1_ID_AFTER_CREATE"',
              f'database_id = "{sys.argv[1]}"')
open(p, "w").write(s)
EOF
  echo "✅ D1 id saved to wrangler.toml"
fi

echo "📐 Applying schema…"
wrangler d1 execute hackathon-scout --file=db/schema.sql

# ---- KV ----
if grep -q '^id' wrangler.toml; then
  echo "✅ KV already linked."
else
  echo "🗝️  Creating KV namespace…"
  OUT=$(wrangler kv namespace create SCOUT_KV 2>&1) || { echo "$OUT"; exit 1; }
  echo "$OUT"
  KV_ID=$(echo "$OUT" | grep -oE '"[0-9a-f]{32}"' | tr -d '"' | head -1)
  if [ -z "${KV_ID:-}" ]; then KV_ID=$(echo "$OUT" | grep -oE '[0-9a-f]{32}' | head -1); fi
  if [ -z "${KV_ID:-}" ]; then echo "❌ Could not parse KV id."; exit 1; fi
  python3 - "$KV_ID" <<'EOF'
import sys
p = "wrangler.toml"
s = open(p).read()
s = s.replace('# id = "PASTE_KV_NAMESPACE_ID_AFTER_CREATE"',
              f'id = "{sys.argv[1]}"')
open(p, "w").write(s)
EOF
  echo "✅ KV id saved to wrangler.toml"
fi

# ---- Rebuild public/ from source ----
echo "📁 Syncing public/…"
mkdir -p public
cp index.html admin.html public/
rm -rf public/assets public/data
cp -r assets data public/
echo "🌱 Seeding data…"
python3 <<'EOF'
import json
ev = json.load(open("data/events.json"))
def q(v):
    if v is None: return "NULL"
    return "'" + str(v).replace("'", "''") + "'"
stmts = []
for e in ev:
    links = json.dumps(e.get("links", []))
    stmts.append(
        "INSERT INTO events (id,title,organizer,status,type,build_window,start_date,deadline,prize_text,prize_amount,requirements,links) VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,'%s') ON CONFLICT(id) DO UPDATE SET title=excluded.title,deadline=excluded.deadline,prize_text=excluded.prize_text,prize_amount=excluded.prize_amount,updated_at=datetime('now');"
        % (q(e.get("id")), q(e.get("title")), q(e.get("organizer","")), q(e.get("status","")), q(e.get("type","")), q(e.get("buildWindow","")), q(e.get("startDate")), q(e.get("deadline")), q(e.get("prizeText","Prize TBA")), e.get("prizeAmount") if e.get("prizeAmount") is not None else "NULL", q(e.get("requirements","")), links.replace("'", "''"))
    )
open("/tmp/scout-seed.sql", "w").write("\n".join(stmts))
wrapped = json.dumps({"events": ev, "source": "seed"})
open("/tmp/scout-kv.json", "w").write(wrapped)
print(f"prepared {len(stmts)} rows")
EOF
wrangler d1 execute hackathon-scout --file=/tmp/scout-seed.sql
KV_ID=$(grep -E '^id' wrangler.toml | head -1 | grep -oE '[0-9a-f]{32}' || true)
if [ -n "${KV_ID:-}" ]; then
  wrangler kv key put events --namespace-id="$KV_ID" --path=/tmp/scout-kv.json || true
fi

# ---- Deploy worker ----
echo "🚀 Deploying worker…"
wrangler deploy

echo ""
echo "🎉 Done! Next steps:"
echo "   1) Push this folder to GitHub → Cloudflare Pages → Connect → output dir = /"
echo "   2) Open /admin.html on your Pages URL for the parser (paste markdown → download JSON)."
echo "   3) Board auto-sorts: upcoming on top, expired sinks with a stamp."
echo ""
WORKER_URL=$(wrangler deployments list 2>/dev/null | grep -oE 'https://[a-z0-9.-]+\.workers\.dev' | head -1 || true)
WORKER_URL="${WORKER_URL:-https://hackathon-scout.samimirn20.workers.dev}"
REPO_URL=$(git remote get-url origin 2>/dev/null | sed -e 's/\.git$//' -e 's|git@github.com:|https://github.com/|' || true)
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "🌐 Board:  $WORKER_URL/"
echo "🛠️  Admin:  ${WORKER_URL%/}/admin"
echo "📡 API:    ${WORKER_URL%/}/api/events"
if [ -n "${REPO_URL:-}" ]; then
echo "📦 Repo:   $REPO_URL"
fi
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
