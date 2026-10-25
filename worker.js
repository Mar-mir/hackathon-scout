/* Cloudflare Worker — Hackathon Scout API + cron refresh.
   Routes:
     GET  /api/events  → public (from D1, fallback KV, fallback static)
     POST /api/events  → 🔒 admin only (HTTP Basic, user "admin")
     /admin, /admin.html → 🔒 admin only (HTTP Basic, user "admin")
   Password comes from the ADMIN_PASSWORD worker secret (set by deploy.sh,
   random per deployer). If the secret is missing, admin routes return 401.
   Cron: refresh timestamps / re-sort daily (wire your scout fetch here).
*/
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;

    // 🔒 Admin surface: /admin, /admin.html, POST /api/events
    const isAdminPage = path === "/admin" || path === "/admin.html";
    const isWriteAPI = path === "/api/events" && request.method === "POST";
    if (isAdminPage || isWriteAPI) {
      const deny = checkAdmin(request, env);
      if (deny) return deny;
    }

    if (path === "/api/events" && request.method === "GET") {
      try {
        if (env.DB) {
          const { results } = await env.DB.prepare("SELECT * FROM events ORDER BY deadline ASC").all();
          if (results && results.length) {
            return json({ events: results.map(rowToEvent), source: "d1", updatedAt: new Date().toISOString() });
          }
        }
        if (env.SCOUT_KV) {
          const kv = await env.SCOUT_KV.get("events", "json");
          if (kv && kv.events) return json({ ...kv, source: "kv" });
        }
      } catch (e) { /* fall through to static */ }
      return Response.redirect(new URL("/data/events.json", url.origin), 307);
    }
    if (url.pathname === "/api/events" && request.method === "POST") {
      // Admin already verified above by checkAdmin.
      let body;
      try { body = await request.json(); } catch { return json({ error: "invalid JSON" }, 400); }
      const events = Array.isArray(body) ? body : body.events;
      if (!Array.isArray(events)) return json({ error: "expected array or {events}" }, 400);
      const stamped = { events, updatedAt: new Date().toISOString() };
      try {
        if (env.DB) {
          for (const e of events) {
            await env.DB.prepare(
              `INSERT INTO events (id,title,organizer,status,type,build_window,start_date,deadline,prize_text,prize_amount,requirements,links)
               VALUES (?,?,?,?,?,?,?,?,?,?,?,?)
               ON CONFLICT(id) DO UPDATE SET title=excluded.title,organizer=excluded.organizer,status=excluded.status,type=excluded.type,build_window=excluded.build_window,start_date=excluded.start_date,deadline=excluded.deadline,prize_text=excluded.prize_text,prize_amount=excluded.prize_amount,requirements=excluded.requirements,links=excluded.links,updated_at=datetime('now')`
            ).bind(e.id, e.title, e.organizer || "", e.status || "", e.type || "", e.buildWindow || "", e.startDate || null, e.deadline || null, e.prizeText || "Prize TBA", e.prizeAmount ?? null, e.requirements || "", JSON.stringify(e.links || [])).run();
          }
        }
        if (env.SCOUT_KV) await env.SCOUT_KV.put("events", JSON.stringify(stamped));
        return json({ ok: true, count: events.length });
      } catch (e) { return json({ error: String(e) }, 500); }
    }
    // Static frontend (Pages-style, served from ./public via [assets]).
    if (env.ASSETS) {
      return env.ASSETS.fetch(request);
    }
    return new Response("Not found", { status: 404 });
  },

  // Cron Trigger: runs on schedule from wrangler.toml.
  // Wire your scout-source fetch here (Devpost/HackList/RSS) → parse → store.
  async scheduled(event, env, ctx) {
    if (env.SCOUT_KV) {
      const cur = await env.SCOUT_KV.get("events", "json");
      if (cur) await env.SCOUT_KV.put("events", JSON.stringify({ ...cur, updatedAt: new Date().toISOString(), cronTick: event.cron }));
    }
    console.log("scout cron tick:", event.cron);
  },
};

function rowToEvent(r) {
  let links = [];
  try { links = JSON.parse(r.links || "[]"); } catch { links = []; }
  return { id: r.id, title: r.title, organizer: r.organizer, status: r.status, type: r.type,
    buildWindow: r.build_window, startDate: r.start_date, deadline: r.deadline,
    prizeText: r.prize_text, prizeAmount: r.prize_amount, requirements: r.requirements, links };
}
function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), { status, headers: { "content-type": "application/json", "access-control-allow-origin": "*" } });
}

/* 🔒 HTTP Basic gate for the admin surface. User is always "admin",
   password is the ADMIN_PASSWORD worker secret (random per deploy). */
function checkAdmin(request, env) {
  const secret = (env.ADMIN_PASSWORD || "").trim();
  if (!secret) {
    return new Response("Admin locked: set ADMIN_PASSWORD secret (see README).", {
      status: 401,
      headers: { "WWW-Authenticate": 'Basic realm="Hackathon Scout Admin"' },
    });
  }
  const hdr = request.headers.get("Authorization") || "";
  const m = hdr.match(/^Basic\s+(.+)$/i);
  if (m) {
    try {
      const decoded = atob(m[1]);
      const idx = decoded.indexOf(":");
      const user = idx === -1 ? decoded : decoded.slice(0, idx);
      const pass = idx === -1 ? "" : decoded.slice(idx + 1);
      if (user === "admin" && timingSafeEqual(pass, secret)) return null;
    } catch { /* fall through to 401 */ }
  }
  return new Response("Admin only.", {
    status: 401,
    headers: { "WWW-Authenticate": 'Basic realm="Hackathon Scout Admin"' },
  });
}

function timingSafeEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
