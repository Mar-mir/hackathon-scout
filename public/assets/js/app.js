/* Public board: load events, split live/expired, render cards. */
(function () {
  "use strict";
  const $ = (s) => document.querySelector(s);
  let EVENTS = [];
  let filter = "all";

  async function load() {
    // In production this becomes /api/events (D1/KV). Falls back to static JSON.
    try {
      const r = await fetch("api/events", { headers: { accept: "application/json" } });
      if (r.ok) { const j = await r.json(); if (Array.isArray(j.events)) { EVENTS = j.events; return; } }
    } catch (e) { /* fall through */ }
    try {
      const r2 = await fetch("data/events.json");
      EVENTS = await r2.json();
    } catch (e) { EVENTS = []; }
  }

  function isExpired(e) {
    if (!e.deadline) return false;
    const today = new Date(); today.setHours(0, 0, 0, 0);
    return new Date(e.deadline + "T23:59:59") < today;
  }

  function daysLeft(e) {
    if (!e.deadline) return "date TBA";
    const ms = new Date(e.deadline + "T23:59:59") - Date.now();
    const d = Math.ceil(ms / 86400000);
    if (d < 0) return "closed";
    if (d === 0) return "closes TODAY";
    if (d === 1) return "1 day left";
    return d + " days left";
  }

  function fmtDate(iso) {
    if (!iso) return "TBA";
    const d = new Date(iso + "T12:00:00");
    return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  }

  function fmtPrize(n) {
    if (n == null) return "";
    if (n >= 1000) return "$" + (n / 1000).toFixed(n % 1000 ? 1 : 0).replace(/\.0$/, "") + "k";
    return "$" + n;
  }

  function card(e, expired) {
    const soon = !expired && e.deadline && (new Date(e.deadline + "T23:59:59") - Date.now()) < 7 * 86400000;
    const links = (e.links || []).map((l) => `<a href="${l.url}" target="_blank" rel="noopener">↗ ${escapeHtml(l.label)}</a>`).join("");
    return `<article class="card">
      <div class="main">
        ${expired ? '<span class="stamp">■ EXPIRED / CLOSED</span>' : ""}
        <div class="tagrow">
          <span class="pill ${expired ? "dead" : "live"}">${expired ? "CLOSED" : "● LIVE"}</span>
          ${soon ? '<span class="pill hot">ENDING SOON</span>' : ""}
          <span class="pill">${escapeHtml(e.type || "hackathon")}</span>
        </div>
        <h3>${(e.links && e.links[0]) ? `<a href="${e.links[0].url}" target="_blank" rel="noopener">${escapeHtml(e.title)}</a>` : escapeHtml(e.title)}</h3>
        <div class="meta">by <b>${escapeHtml(e.organizer || "—")}</b><br>
        📅 ${escapeHtml(e.buildWindow || fmtDate(e.deadline))}<br>
        ⏳ deadline <b>${fmtDate(e.deadline)}</b> · ${daysLeft(e)}</div>
        ${e.requirements ? `<p class="req">${escapeHtml(e.requirements)}</p>` : ""}
        <div class="links">${links}</div>
      </div>
      <div class="stub"><span class="p">${escapeHtml(e.prizeAmount != null ? fmtPrize(e.prizeAmount) : (e.prizeText || "TBA").split(" ")[0])}</span><span class="pl">PRIZE<br>${escapeHtml((e.prizeText || "").slice(0, 28))}</span></div>
    </article>`;
  }

  function escapeHtml(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }

  function render() {
    const q = ($("#q").value || "").toLowerCase();
    const sortBy = $("#sort").value;
    let list = EVENTS.filter((e) => {
      if (filter === "live" && isExpired(e)) return false;
      if (filter === "expired" && !isExpired(e)) return false;
      if (q && !(e.title + " " + e.organizer + " " + e.requirements + " " + e.type).toLowerCase().includes(q)) return false;
      return true;
    });
    list.sort((a, b) => sortBy === "prize"
      ? (b.prizeAmount || 0) - (a.prizeAmount || 0)
      : (a.deadline || "9999").localeCompare(b.deadline || "9999"));

    const live = list.filter((e) => !isExpired(e));
    const exp = list.filter((e) => isExpired(e));
    $("#liveGrid").innerHTML = live.map((e) => card(e, false)).join("") || '<p style="color:var(--mut)">No upcoming events match.</p>';
    $("#expGrid").innerHTML = exp.map((e) => card(e, true)).join("") || '<p style="color:var(--mut)">Nothing expired. Clean board.</p>';
    $("#liveN").textContent = `(${live.length})`;
    $("#expN").textContent = `(${exp.length})`;

    const allLive = EVENTS.filter((e) => !isExpired(e)).sort((a, b) => (a.deadline || "9999").localeCompare(b.deadline || "9999"));
    $("#statLive").textContent = allLive.length;
    $("#statExpired").textContent = EVENTS.filter(isExpired).length;
    const total = EVENTS.reduce((s, e) => s + (e.prizeAmount || 0), 0);
    $("#statPrize").textContent = total >= 1000 ? "$" + Math.round(total / 1000) + "k+" : "$" + total;
    if (allLive[0]) { $("#nextTitle").textContent = allLive[0].title; $("#nextCount").textContent = "⏳ " + fmtDate(allLive[0].deadline) + " · " + daysLeft(allLive[0]); }

    const showLive = filter !== "expired", showExp = filter !== "live";
    $("#liveSec").style.display = showLive ? "" : "none";
    $("#expSec").style.display = showExp ? "" : "none";
  }

  document.addEventListener("DOMContentLoaded", async () => {
    await load();
    render();
    document.querySelectorAll(".tab").forEach((t) => t.addEventListener("click", () => {
      document.querySelectorAll(".tab").forEach((x) => x.classList.remove("active"));
      t.classList.add("active"); filter = t.dataset.f; render();
    }));
    $("#q").addEventListener("input", render);
    $("#sort").addEventListener("change", render);
  });
})();
