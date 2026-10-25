/* Hackathon Scout — smart markdown parser.
   Paste a scout report (like hackathon-scout-EN) → clean JSON events.
   Extracts: title, organizer, status, type, buildWindow,
   startDate, endDate/deadline, prizeText, prizeAmount, requirements, links.
*/
(function (global) {
  "use strict";

  const MONTHS = { january: 0, february: 1, march: 2, april: 3, may: 4, june: 5,
    july: 6, august: 7, september: 8, october: 9, november: 10, december: 11,
    jan: 0, feb: 1, mar: 2, apr: 3, jun: 5, jul: 6, aug: 7, sep: 8, sept: 8, oct: 9, nov: 10, dec: 11 };
  const MONTH_PAT = "(January|February|March|April|May|June|July|August|September|October|November|December|Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)";

  function monthIdx(name) {
    return MONTHS[name.toLowerCase()];
  }

  function slugify(s) {
  return ((s || "untitled").toLowerCase()
      .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80)) || "event";
  }

  function toISO(y, m, d) {
    const dt = new Date(Date.UTC(y, m, d));
    return isNaN(dt) ? null : dt.toISOString().slice(0, 10);
  }

  function parseMDDate(str, defaultYear) {
    if (!str) return null;
    const m = str.match(new RegExp(MONTH_PAT + "\\s+(\\d{1,2})(?:\\s*,?\\s*(\\d{4}))?", "i"));
    if (!m) return null;
    const year = m[3] ? parseInt(m[3], 10) : (defaultYear || 2026);
    return toISO(year, MONTHS[m[1].toLowerCase()], parseInt(m[2], 10));
  }

  function extractLinks(line) {
    const out = [];
    const md = /\[([^\]]+)\]\((https?:[^)]+)\)/g;
    let m;
    while ((m = md.exec(line))) out.push({ label: m[1].trim(), url: m[2].trim() });
    // bare urls not already captured
    const bare = line.match(/https?:\/\/[^\s)]+/g) || [];
    bare.forEach((u) => { if (!out.some((l) => l.url === u)) out.push({ label: u.replace(/^https?:\/\//, "").slice(0, 40), url: u }); });
    return out;
  }

  function parsePrize(text) {
    if (!text) return { prizeText: "Prize TBA", prizeAmount: null };
    const t = text.trim();
    if (/not yet|tba|not confirmed|unclear/i.test(t)) return { prizeText: "Prize TBA", prizeAmount: null };
    const nums = [...t.matchAll(/\$([\d,]+(?:\.\d+)?)\s*(k|K|m|M|\+)?/g)].map((m) => {
      let v = parseFloat(m[1].replace(/,/g, ""));
      const suf = (m[2] || "").toLowerCase();
      if (suf === "k") v *= 1000;
      if (suf === "m") v *= 1000000;
      return v;
    });
    const amount = nums.length ? Math.max(...nums) : null;
    return { prizeText: t.slice(0, 120), prizeAmount: amount };
  }

  function fieldAfter(line, keys) {
    const low = line.toLowerCase();
    for (const k of keys) {
      const i = low.indexOf(k);
      if (i !== -1) return line.slice(i + k.length).replace(/^[\s:\-–—]+/, "").trim();
    }
    return "";
  }

  function parseMarkdown(md, opts) {
    opts = opts || {};
    const defaultYear = opts.defaultYear || 2026;
    const reportDate = (md.match(/report date:\s*([^\n]+)/i) || [])[1] || "";
    const lines = md.split(/\r?\n/);
    const events = [];
    let cur = null;

    function push() {
      if (cur && cur.title) {
        cur.id = cur.id || slugify(cur.title);
        events.push(cur);
      }
      cur = null;
    }

    for (const raw of lines) {
      const line = raw.trim();
      if (!line || /^#\s*HACKATHON/i.test(line) || /^report date/i.test(line) ||
          /^##\s*(NEW TODAY|OPPORTUNITY_DELTA|ATTACK|WATCH|DROP|SUMMARY)/i.test(line)) continue;
      // section headers like "### OPPORTUNITY_DELTA" or "### DROP (for now)" — never events
      if (/^#{1,3}\s*(OPPORTUNITY_DELTA|ATTACK(\s+NOW)?|WATCH|DROP|SUMMARY|NEW TODAY)/i.test(line)) continue;
      let h = line.match(/^###?\s*\d+\.\s*(.+)/); // "### 1. Title"
      if (!h) h = line.match(/^#{1,3}\s+(.+)/); // "## Title" / "# Title"
      if (!h) h = line.match(/^\d+[.)]\s*\*\*(.+?)\*\*\s*$/); // "1. **Title**"
      if (!h) h = line.match(/^\d+[.)]\s*(.+?)\s*$/); // "1. Title" numbered only
      // bold-only line as title (not a field): "**PayPal AI Hackathon**"
      if (!h && /^\*{1,2}(.+?)\*{1,2}$/.test(line) && !/:|https?:|\$|deadline|prize|status|organizer/i.test(line)) {
        h = line.match(/^\*{1,2}(.+?)\*{1,2}$/);
      }
      // only accept heading if it looks like an event (has date/prize/org context nearby handled below:
      // require it to NOT be a field line and to look title-ish)
      if (h) {
        const candidate = h[1].trim().replace(/\*\*/g, "");
        if (!candidate || candidate.length < 4 || candidate.length > 140) { /* not a heading, fall through */ }
        else if (/^(status|type|organizer|prize|prizes|link|links|deadline|requirements|build window|start|announced|discovered|discover|key requirements)\s*:/i.test(candidate)) { /* field, fall through */ }
        else if (/^https?:\/\//i.test(candidate) || /^\$[\d,]/.test(candidate) || /\[.*?\]\(https?:/.test(line)) { /* link/prize line, fall through to link/prize handling */ }
        else {
          push();
          const rawTitle = candidate;
        // organizer fallback: "Title (Org + Org)" → organizer
        let orgFromTitle = "";
        const pm = rawTitle.match(/\(([^)]+)\)\s*$/);
        if (pm && /\+|,|labs|club|noon|mexc|arweave|nosana/i.test(pm[1])) orgFromTitle = pm[1].trim();
        cur = { title: rawTitle, links: [], organizer: orgFromTitle, status: "",
          type: "", buildWindow: "", startDate: null, deadline: null,
          prizeText: "Prize TBA", prizeAmount: null, requirements: "" };
        continue;
        }
      }
      if (!cur) continue;
      if (/^(?:[-*]\s*)?(status|type|organizer|organiser)\s*:/i.test(line)) {
        const v = fieldAfter(line, ["status:", "type:", "organizer:", "organiser:"]);
        if (/^(?:[-*]\s*)?status/i.test(line)) cur.status = v;
        else if (/^(?:[-*]\s*)?type/i.test(line)) cur.type = v;
        else cur.organizer = v.replace(/\s*\(on Devpost\)/i, "").trim();
      } else if (/discovered via/i.test(line)) {
        // skip
      } else if (/announced/i.test(line)) {
        // skip
      } else if (/build window/i.test(line)) {
        cur.buildWindow = fieldAfter(line, ["build window:"]);
        // range like "October 22–27, 2026" → end = Oct 27
        const range = cur.buildWindow.match(new RegExp(MONTH_PAT + "\\s+(\\d{1,2})\\s*[–—-]\\s*(\\d{1,2}),?\\s*(\\d{4})?", "i"));
        if (range) {
          const year = range[4] ? parseInt(range[4], 10) : defaultYear;
          cur.startDate = toISO(year, MONTHS[range[1].toLowerCase()], parseInt(range[2], 10));
          const dend = toISO(year, MONTHS[range[1].toLowerCase()], parseInt(range[3], 10));
          if (dend && (!cur.deadline || dend >= cur.deadline)) cur.deadline = dend;
          continue;
        }
        const dates = [...cur.buildWindow.matchAll(new RegExp(MONTH_PAT + "\\s+\\d{1,2}(?:\\s*,?\\s*\\d{4})?", "gi"))].map((x) => x[0]);
        if (dates.length) {
          cur.startDate = parseMDDate(dates[0], defaultYear);
          const last = dates[dates.length - 1];
          const d = parseMDDate(last, defaultYear);
          // build end wins over registration deadline (later date), submission wins over all (handled below)
          if (d && (!cur.deadline || d >= cur.deadline)) cur.deadline = d;
        }
      } else if (/submission deadline|registration deadline|round \d+ deadline|deadline\s*:|^[-*]\s*start\s*:/i.test(line)) {
        const v = fieldAfter(line, ["submission deadline:", "registration deadline:", "deadline:", "start:"]);
        const d = parseMDDate(v, defaultYear);
        const isSubmission = /submission/i.test(line);
        if (d && (isSubmission || !cur.deadline)) cur.deadline = d;
        if (/^(?:[-*]\s*)?start/i.test(line) && !cur.buildWindow) cur.buildWindow = v;
        if (!cur.buildWindow && /deadline/i.test(line)) {
          const bw = cur.buildWindow;
          cur.buildWindow = bw || "";
        }
      } else if (/^(?:[-*]\s*)?prize\s*:/i.test(line)) {
        const v = fieldAfter(line, ["prize:"]);
        const p = parsePrize(v);
        cur.prizeText = p.prizeText; cur.prizeAmount = p.prizeAmount;
      } else if (/key requirements/i.test(line)) {
        cur.requirements = fieldAfter(line, ["key requirements:"]);
      } else if (/^[-*]\s*link/i.test(line) || /\[.*?\]\(https?:/.test(line) || /https?:\/\//.test(line)) {
        // bullet ACTION lines reference prior events ("Next action: Register on Luma…")
        // — attach as requirement note, don't treat the line as content worth linking alone.
        // (links are still extracted if the line carries one)
        extractLinks(line).forEach((l) => {
          if (!cur.links.some((x) => x.url === l.url)) cur.links.push(l);
        });
        const lv = fieldAfter(line, ["link:", "links:"]);
        if (lv && !cur.links.length) {
          // handled by extractLinks already
        }
      }
    }
    push();

    // sweep: drop section-header junk that slipped through as events
    // (no deadline + no links + no prize = not a hackathon).
    const real = events.filter((e) =>
      e.deadline || (e.links && e.links.length) || e.prizeAmount != null || (e.requirements && e.requirements.length > 20)
    );
    const droppedJunk = events.length - real.length;
    events.length = 0; real.forEach((e) => events.push(e));

    // fallback: deadline from buildWindow tail
    events.forEach((e) => {
      if (!e.deadline && e.buildWindow) {
        const tail = e.buildWindow.match(new RegExp(MONTH_PAT + "\\s+\\d{1,2},?\\s*\\d{4}", "i"));
        if (tail) e.deadline = parseMDDate(tail[0], defaultYear);
      }
      e.requirements = (e.requirements || "").slice(0, 500);
    });

    // dedupe: same markdown may repeat earlier events (recaps, DELTA sections).
    const dd = dedupeEvents(events);
    const totalRemoved = (droppedJunk || 0) + dd.removed;
    return { reportDate: reportDate.trim(), count: dd.events.length, duplicatesRemoved: totalRemoved, events: dd.events };
  }

  function normTitle(s) {
    return (s || "").toLowerCase().replace(/\(.*?\)/g, " ")
      .replace(/[^a-z0-9]+/g, " ").trim().replace(/\s+/g, " ");
  }

  function normUrl(u) {
    return (u || "").toLowerCase().replace(/\/$/, "").trim();
  }

  function dateDiffDays(a, b) {
    if (!a || !b) return 0;
    const d = Math.abs(new Date(a + "T12:00:00") - new Date(b + "T12:00:00")) / 86400000;
    return isNaN(d) ? 0 : d;
  }

  // Two events are "the same" when they share a link URL, have the same
  // normalized title, or one title contains the other — AND their deadlines
  // are close (<60 days apart, so yearly editions stay separate).
  // Merge: keep first, fill empty fields + missing links from the duplicate.
  function dedupeEvents(list) {
    const out = [];
    let removed = 0;
    function findDup(e) {
      const nt = normTitle(e.title);
      const urls = new Set((e.links || []).map((l) => normUrl(l.url)).filter(Boolean));
      for (const k of out) {
        const knt = normTitle(k.title);
        const kurls = new Set((k.links || []).map((l) => normUrl(l.url)).filter(Boolean));
        const sharedUrl = [...urls].some((u) => kurls.has(u));
        const sameTitle = nt.length > 3 && nt === knt;
        const fuzzy = nt.length > 15 && knt.length > 15 && (nt.includes(knt) || knt.includes(nt));
        if ((sharedUrl || sameTitle || fuzzy) && dateDiffDays(k.deadline, e.deadline) < 60) return k;
      }
      return null;
    }
    for (const e of list) {
      e.id = e.id || slugify(e.title);
      const d = findDup(e);
      if (d) {
        removed++;
        for (const f of ["organizer", "status", "type", "buildWindow", "startDate", "deadline", "requirements"]) {
          if (!d[f] && e[f]) d[f] = e[f];
        }
        if (d.prizeAmount == null && e.prizeAmount != null) { d.prizeAmount = e.prizeAmount; d.prizeText = e.prizeText; }
        (e.links || []).forEach((l) => { if (!d.links.some((x) => x.url === l.url)) d.links.push(l); });
        continue;
      }
      out.push(e);
    }
    return { events: out, removed };
  }

  global.ScoutParser = { parseMarkdown, slugify };
})(typeof window !== "undefined" ? window : globalThis);
