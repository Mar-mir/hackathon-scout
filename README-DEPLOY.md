# Hackathon Scout — Deploy Guide (Cloudflare, free tier)

Built English-first per your call. Board: upcoming on top, expired sinks + stamped.

## What you got

| File | What it is |
|---|---|
| `index.html` | Public board (upcoming ↑ / expired ↓ + EXPIRED stamp, search, sort by deadline/prize, next-deadline hero) |
| `admin.html` | Admin smart-parser: paste scout markdown → auto-extract (title, organizer, status, type, build window, start date, deadline, prize + numeric $, requirements, links) → edit inline → download/copy `events.json` |
| `assets/js/parser.js` | The parser (shared by admin; unit-testable) |
| `assets/js/app.js` | Board logic (fetch `/api/events`, fallback `data/events.json`) |
| `data/seed-events.json` | 7 events pre-parsed from your Oct-16 sample |
| `data/events.json` | Same seed, served statically until the Worker/DB is live |
| `data/sample-report.md` | Your sample report (for parser testing) |
| `worker.js` | Cloudflare Worker: `GET/POST /api/events` + cron tick |
| `wrangler.toml` | Worker config (KV + D1 bindings, daily cron) |
| `db/schema.sql` | D1 table |

## Deploy (free)

### A. Frontend on Cloudflare Pages
1. Push this folder to a GitHub repo.
2. Cloudflare dashboard → Pages → Create → Connect to Git → pick repo.
3. Build settings: framework = None, build command empty, output dir = `/` (repo root).
4. Deploy. You get `https://hackathon-scout.pages.dev`.

### B. Data: D1 + KV
```bash
npm i -g wrangler
wrangler login
wrangler d1 create hackathon-scout
# put database_id into wrangler.toml
wrangler d1 execute hackathon-scout --file=db/schema.sql
wrangler kv namespace create SCOUT_KV
# put id into wrangler.toml
wrangler deploy
```

### C. Seed the DB (from admin page)
1. Open `https://<your-pages>/admin.html` → Parse → Download `events.json`.
2. Push it live:
```bash
curl -X POST https://<your-worker>/api/events \
  -H 'Content-Type: application/json' \
  --data @data/events.json
```

### D. Lock the admin (Cloudflare Access, free ≤50 users)
1. Zero Trust → Access → Applications → Add self-hosted app → `…/admin.html*` + `/api/events` POST.
2. Policy: allow only your email (one-time PIN). Public keeps reading the board; only you can POST.

### E. Auto-refresh (Cron Triggers)
- `wrangler.toml` already schedules daily 06:00 UTC. Weekly? → `"0 6 * * 1"`.
- Extend `scheduled()` in `worker.js` to fetch your scout sources, run the parser server-side, and write D1/KV. Until then the cron stamps `updatedAt` and the board re-sorts (expired sinks automatically by date — no code change needed).

## Your token
You sent a `cfat_…` token. I did **not** store it in any file. To deploy from your machine:
`wrangler login` (browser) or `export CLOUDFLARE_API_TOKEN=<token>` then the commands above. Rotate the token after deploy if you pasted it anywhere shared.

## Design notes (per brief + frontend-design skill)
Distinctive direction: dark "mission-board" with phosphor-green live pills, ticket-stub prize column, mono data labels (JetBrains Mono) vs grotesk display (Space Grotesk). Signature element: the perforated prize stub on every card. Upcoming = full color; expired = dimmed + ■ EXPIRED stamp, pushed below. Responsive, keyboard focus visible, reduced-motion respected.
