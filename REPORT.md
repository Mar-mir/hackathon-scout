# Hackathon Scout — Live ✅

**Date:** Oct 25, 2026 · **Site folder:** `/root/hackathon-scout-site/`

## 🌐 Site addresses

- **Board (public):** https://hackathon-scout.samimirn20.workers.dev/
- **Admin + smart parser:** https://hackathon-scout.samimirn20.workers.dev/admin (🔒 user `admin` + random password)
- **API (JSON):** https://hackathon-scout.samimirn20.workers.dev/api/events (GET public, POST 🔒)

## What is live

- 7 events from your Oct-16 sample, served from D1 (fallback KV → static).
- Board: upcoming on top, expired sinks with ■ EXPIRED stamp. Search + sort by deadline/prize.
- Admin: paste scout markdown → auto-extract (title, organizer, status, type, build window, start date, deadline, prize + numeric $, requirements, links) → edit inline → download JSON.
- Cron: daily 06:00 UTC refresh tick.
- Parser verified 7/7 against your sample (3 bugs fixed: organizer-from-title, submission-beats-registration, date-range end).

## Design (frontend-design skill)

Dark mission-board: phosphor-green live pills, ticket-stub prize column, Space Grotesk display + JetBrains Mono data labels. Responsive, keyboard focus visible, reduced-motion respected.

## Redeploy (one key)

```bash
cp .env.example .env   # paste token once
bash deploy.sh
```

Token you sent was used only for this deploy, never stored in any file. Lock `/admin` + `POST /api/events` behind Cloudflare Access (your email only) when ready.

## Local preview

```bash
cd /root/hackathon-scout-site && python3 -m http.server 8080
# open http://localhost:8080/  and  http://localhost:8080/admin.html
```
