// netlify/functions/trades-api.mjs
//
// Read side of the history database. The screener calls:
//     GET /api/trades?days=N        (N = 1..30, default 3)
// and receives every stored trade from the last N UTC day-buckets, newest
// first, plus the collector's meta/status so the UI can show freshness.

import { getStore } from "@netlify/blobs";

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
  const days = Math.min(30, Math.max(1, parseInt(url.searchParams.get("days") || "3", 10) || 3));

  const store = getStore("trades");
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
