// netlify/functions/trades-api.mjs
//
// Read side of the history database. The screener calls:
//     GET /api/trades?days=N        (N = 1..30, default 3)
// and receives every stored trade from the last N UTC day-buckets, newest
// first, plus the collector's meta/status so the UI can show freshness.

import { getStore } from "@netlify/blobs";
import { familyOf } from "./filters.mjs";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Accept, Content-Type",
};

export default async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  if (req.method !== "GET") {
    return new Response(JSON.stringify({ error: "Only GET" }), {
      status: 405, headers: { ...CORS, "Content-Type": "application/json" },
    });
  }

  const url = new URL(req.url);
  const store = getStore("trades");

  // ── Counts mode: wallet -> how many DISTINCT markets it has qualifying
  // positions in, across the retention window. A wallet that shows up in 30
  // different markets a month is running a strategy; a wallet that shows up
  // once, near expiry, on a geopolitical longshot is the anomaly. Returns a
  // tiny map, so the UI can cheaply demote systematic traders.
  if (url.searchParams.get("counts")) {
    const cdays = Math.min(30, Math.max(1, parseInt(url.searchParams.get("days") || "30", 10) || 30));
    const seen = new Map();
    for (let i = 0; i < cdays; i++) {
      const d = new Date(Date.now() - i * 86_400_000).toISOString().slice(0, 10);
      try {
        const bucket = await store.get(`day/${d}`, { type: "json" });
        if (!Array.isArray(bucket)) continue;
        for (const t of bucket) {
          if ((t.side || "BUY") !== "BUY" || !t.addr || !t.conditionId) continue;
          let set = seen.get(t.addr);
          if (!set) { set = new Set(); seen.set(t.addr, set); }
          // Family, not conditionId: a wallet trading one rolling series 23x is a
          // single-thesis trader, not a serial flag-generator. Falls back to the
          // conditionId when a stored row has no title.
          const fam = familyOf(t.title || "") || t.conditionId;
          set.add(`${fam}|${(t.outcome || "").toLowerCase()}`);
        }
      } catch { /* missing day = fine */ }
    }
    const counts = {};
    for (const [addr, set] of seen) counts[addr] = set.size;
    return new Response(JSON.stringify({ days: cdays, wallets: Object.keys(counts).length, counts }), {
      headers: { ...CORS, "Content-Type": "application/json", "Cache-Control": "no-store" },
    });
  }

  // ── Minutes window (LIVE mode): trades from the last N minutes only. ──
  const minutesParam = url.searchParams.get("minutes");
  if (minutesParam) {
    const minutes = Math.min(1440, Math.max(1, parseInt(minutesParam, 10) || 15));
    const cutoff = Math.floor(Date.now() / 1000) - minutes * 60;
    const recent = [];
    // The window can straddle midnight UTC, so read today + yesterday.
    for (let i = 0; i < 2; i++) {
      const d = new Date(Date.now() - i * 86_400_000).toISOString().slice(0, 10);
      try {
        const bucket = await store.get(`day/${d}`, { type: "json" });
        if (Array.isArray(bucket)) {
          for (const t of bucket) if ((t.ts || 0) >= cutoff) recent.push(t);
        }
      } catch { /* missing day = fine */ }
    }
    recent.sort((a, b) => (b.ts || 0) - (a.ts || 0));
    let meta = null;
    try { meta = await store.get("meta/status", { type: "json" }); } catch { /* fine */ }
    return new Response(JSON.stringify({ meta, minutes, count: recent.length, trades: recent }), {
      headers: { ...CORS, "Content-Type": "application/json", "Cache-Control": "no-store" },
    });
  }

  // ── Day window (HISTORY mode): last N UTC day-buckets. ──
  const days = Math.min(30, Math.max(1, parseInt(url.searchParams.get("days") || "3", 10) || 3));
  const out = [];
  const now = Date.now();
  for (let i = 0; i < days; i++) {
    const d = new Date(now - i * 86_400_000).toISOString().slice(0, 10);
    try {
      const bucket = await store.get(`day/${d}`, { type: "json" });
      if (Array.isArray(bucket)) out.push(...bucket);
    } catch { /* missing day = fine */ }
  }
  out.sort((a, b) => (b.ts || 0) - (a.ts || 0));

  let meta = null;
  try { meta = await store.get("meta/status", { type: "json" }); } catch { /* fine */ }

  return new Response(JSON.stringify({ meta, days, count: out.length, trades: out }), {
    headers: { ...CORS, "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
};
