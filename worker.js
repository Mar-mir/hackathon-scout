/* Cloudflare Worker — Hackathon Scout API + cron refresh.
   Routes:
     GET  /api/events  → all events (from D1, fallback KV, fallback static)
     POST /api/events  → replace events (protect with Cloudflare Access in production)
   Cron: refresh timestamps / re-sort daily (wire your scout fetch here).
*/
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === "/api/events" && request.method === "GET") {
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
      // NOTE: put this route behind Cloudflare Access (see README-DEPLOY.md).
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
