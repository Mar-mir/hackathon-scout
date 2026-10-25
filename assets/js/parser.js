/* Hackathon Scout — smart markdown parser.
   Paste a scout report (like hackathon-scout-EN) → clean JSON events.
   Extracts: title, organizer, status, type, buildWindow,
   startDate, endDate/deadline, prizeText, prizeAmount, requirements, links.
*/
(function (global) {
  "use strict";

  const MONTHS = { january: 0, february: 1, march: 2, april: 3, may: 4, june: 5,
    july: 6, august: 7, september: 8, october: 9, november: 10, december: 11 };

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
    const m = str.match(/(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{1,2})(?:\s*,?\s*(\d{4}))?/i);
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
      const h = line.match(/^###?\s*\d+\.\s*(.+)/); // "### 1. Title"
      if (h) {
        push();
        const rawTitle = h[1].trim();
        // organizer fallback: "Title (Org + Org)" → organizer
        let orgFromTitle = "";
        const pm = rawTitle.match(/\(([^)]+)\)\s*$/);
        if (pm && /\+|,|labs|club|noon|mexc|arweave|nosana/i.test(pm[1])) orgFromTitle = pm[1].trim();
        cur = { title: rawTitle, links: [], organizer: orgFromTitle, status: "",
          type: "", buildWindow: "", startDate: null, deadline: null,
          prizeText: "Prize TBA", prizeAmount: null, requirements: "" };
        continue;
      }
      if (!cur) continue;
      if (/^[-*]\s*(status|type|organizer|organiser)\s*:/i.test(line)) {
        const v = fieldAfter(line, ["status:", "type:", "organizer:", "organiser:"]);
        if (/^status/i.test(line.replace(/^[-*]\s*/, ""))) cur.status = v;
        else if (/^type/i.test(line.replace(/^[-*]\s*/, ""))) cur.type = v;
        else cur.organizer = v.replace(/\s*\(on Devpost\)/i, "").trim();
      } else if (/discovered via/i.test(line)) {
        // skip
      } else if (/announced/i.test(line)) {
        // skip
      } else if (/build window/i.test(line)) {
        cur.buildWindow = fieldAfter(line, ["build window:"]);
        // range like "October 22–27, 2026" → end = Oct 27
        const range = cur.buildWindow.match(/(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{1,2})\s*[–—-]\s*(\d{1,2}),?\s*(\d{4})?/i);
        if (range) {
          const year = range[4] ? parseInt(range[4], 10) : defaultYear;
          cur.startDate = toISO(year, MONTHS[range[1].toLowerCase()], parseInt(range[2], 10));
          const dend = toISO(year, MONTHS[range[1].toLowerCase()], parseInt(range[3], 10));
          if (dend && (!cur.deadline || dend >= cur.deadline)) cur.deadline = dend;
          continue;
        }
        const dates = [...cur.buildWindow.matchAll(/(January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2}(?:\s*,?\s*\d{4})?/gi)].map((x) => x[0]);
        if (dates.length) {
          cur.startDate = parseMDDate(dates[0], defaultYear);
          const last = dates[dates.length - 1];
          const d = parseMDDate(last, defaultYear);
          // build end wins over registration deadline (later date), submission wins over all (handled below)
          if (d && (!cur.deadline || d >= cur.deadline)) cur.deadline = d;
        }
      } else if (/submission deadline|registration deadline|round \d+ deadline|^[-*]\s*start\s*:/i.test(line)) {
        const v = fieldAfter(line, ["submission deadline:", "registration deadline:", "deadline:", "start:"]);
        const d = parseMDDate(v, defaultYear);
        const isSubmission = /submission/i.test(line);
        if (d && (isSubmission || !cur.deadline)) cur.deadline = d;
        if (/^start/i.test(line.replace(/^[-*]\s*/, "")) && !cur.buildWindow) cur.buildWindow = v;
        if (!cur.buildWindow && /deadline/i.test(line)) {
          const bw = cur.buildWindow;
          cur.buildWindow = bw || "";
        }
      } else if (/^[-*]\s*prize\s*:/i.test(line)) {
        const v = fieldAfter(line, ["prize:"]);
        const p = parsePrize(v);
        cur.prizeText = p.prizeText; cur.prizeAmount = p.prizeAmount;
      } else if (/key requirements/i.test(line)) {
        cur.requirements = fieldAfter(line, ["key requirements:"]);
      } else if (/^[-*]\s*link/i.test(line) || /\[.*\]\(https?:/.test(line) || /https?:\/\//.test(line)) {
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

    // fallback: deadline from buildWindow tail
    events.forEach((e) => {
      if (!e.deadline && e.buildWindow) {
        const tail = e.buildWindow.match(/(January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2},?\s*\d{4}/i);
        if (tail) e.deadline = parseMDDate(tail[0], defaultYear);
      }
      e.requirements = (e.requirements || "").slice(0, 500);
    });

    return { reportDate: reportDate.trim(), count: events.length, events };
  }

  global.ScoutParser = { parseMarkdown, slugify };
})(typeof window !== "undefined" ? window : globalThis);
