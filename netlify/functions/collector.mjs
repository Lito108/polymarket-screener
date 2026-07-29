// netlify/functions/collector.mjs
//
// The always-on collector. Netlify runs this on a schedule (every 1 minute,
// see `config` at the bottom) even when nobody has the screener open. Each run:
//   1. pulls the most recent trades from Polymarket's data-api,
//   2. keeps trades matching the screener's insider-relevant defaults:
//        politics/geo allowlist · cash ≥ STORE_MIN_CASH, with
//        BUYS capped at entry < 75% and SELLS kept at ANY price (an exit is
//        high-priced by definition — round-trips are how you see an insider
//        monetize and leave),
//   3. appends the new ones (de-duplicated) into a per-day bucket in
//      Netlify Blobs (the free key-value store acting as our database),
//   4. prunes buckets older than RETAIN_DAYS,
//   5. writes a small meta/status record the UI can display.
//
// The companion function trades-api.mjs serves this data back to the screener.

import { getStore } from "@netlify/blobs";
import { isRelevant } from "./filters.mjs";

const DA = "https://data-api.polymarket.com";
const STORE_MIN_CASH = 100; // dollars — low floor so split fills survive for aggregation
                            // (the UI sums fills per wallet×market, then applies YOUR $500+ gate)
const MAX_PRICE = 0.75;    // exclusive — entry odds must be BELOW 75%
const PAGE = 500;                        // data-api caps /trades at 500 per request
const OFFSETS = [0, 500, 1000, 1500];    // fetched IN PARALLEL — compute is billed on
                                         // run DURATION (GB-hours), so parallel pages
                                         // literally cost fewer credits than sequential
const RETAIN_DAYS = 30;    // history window kept in storage

// Allowlist + veto now live in ONE place: ./filters.mjs, which the UI also
// injects at build time. Never re-declare these rules here.

// UTC day key for a unix-seconds timestamp, e.g. "2026-06-19"
const dayKey = (tsSec) => new Date(tsSec * 1000).toISOString().slice(0, 10);

export default async () => {
  const store = getStore("trades");
  const startedAt = new Date().toISOString();
  let fetched = 0, kept = 0, added = 0, error = null;
  let spanSec = 0, oldestTs = 0, newestTs = 0;   // coverage telemetry (function-scoped: used in status write below)

  try {
    // 1) Pull recent trades (paginated, de-duped, stop at API ceiling)
    // All page offsets fired at once; the API ceiling just yields empty or
    // duplicate pages past ~1.5k, which the id-dedup below absorbs harmlessly.
    const results = await Promise.allSettled(OFFSETS.map(o =>
      fetch(`${DA}/trades?limit=${PAGE}&offset=${o}&takerOnly=true`,
        { headers: { Accept: "application/json" } }).then(r => (r.ok ? r.json() : []))
    ));
    const raw = [];
    const seen = new Set();
    for (const res of results) {
      const page = res.status === "fulfilled" && Array.isArray(res.value) ? res.value : [];
      for (const t of page) {
        const k = t.transactionHash || `${t.proxyWallet}-${t.conditionId}-${t.timestamp}`;
        if (!seen.has(k)) { seen.add(k); raw.push(t); }
      }
    }
    if (!raw.length) throw new Error("data-api returned no trades on any page");
    fetched = raw.length;
    // Coverage telemetry: how many seconds of trading did this fetch actually
    // span? If spanSec < the run interval (60s), the net has no gaps. If it is
    // much larger, we saw further back than one interval (fine). If a run ever
    // fetches a window SHORTER than the gap between runs, trades were missed.
    if (raw.length) {
      const times = raw.map(r => Number(r.timestamp) || 0).filter(Boolean);
      if (times.length) { oldestTs = Math.min(...times); newestTs = Math.max(...times); spanSec = newestTs - oldestTs; }
    }

    // 2) Filter to qualifying insider-relevant trades
    const qual = [];
    for (const r of raw) {
      const price = parseFloat(r.price || 0);
      const shares = parseFloat(r.size || 0);
      const cash = price * shares;
      const side = (r.side || "").toUpperCase();
      if (side !== "BUY" && side !== "SELL") continue;
      if (!r.proxyWallet || !r.conditionId) continue;
      if (cash < STORE_MIN_CASH) continue;
      if (!(price > 0)) continue;
      // Entry ceiling applies to BUYS only. A SELL at 80c is exactly the exit
      // we want to see; filtering it out would hide every profitable round-trip.
      if (side === "BUY" && price >= MAX_PRICE) continue;
      if (!isRelevant(r.title || "")) continue;
      qual.push({
        id: r.transactionHash || `${r.proxyWallet}-${r.conditionId}-${r.timestamp}-${side}`,
        side,
        addr: r.proxyWallet,
        conditionId: r.conditionId,
        ts: Number(r.timestamp) || 0,   // unix seconds
        price,
        shares,
        cash: Math.round(cash * 100) / 100,
        outcome: r.outcome || "",
        title: r.title || "",
        slug: r.slug || r.eventSlug || "",
      });
    }
    kept = qual.length;

    // 3) Append into per-day buckets, de-duplicated by trade id
    const byDay = new Map();
    for (const q of qual) {
      const key = `day/${dayKey(q.ts)}`;
      if (!byDay.has(key)) byDay.set(key, []);
      byDay.get(key).push(q);
    }
    for (const [key, list] of byDay) {
      const existing = (await store.get(key, { type: "json" })) || [];
      const have = new Set(existing.map((t) => t.id));
      const fresh = list.filter((t) => !have.has(t.id));
      if (fresh.length) {
        existing.push(...fresh);
        await store.setJSON(key, existing);
        added += fresh.length;
      }
    }

    // 4) Prune buckets older than the retention window
    const cutoff = dayKey(Date.now() / 1000 - RETAIN_DAYS * 86400);
    const { blobs } = await store.list({ prefix: "day/" });
    for (const b of blobs || []) {
      const d = b.key.slice(4);
      if (d < cutoff) await store.delete(b.key);
    }
  } catch (e) {
    error = String((e && e.message) || e);
  }

  // 5) Status record for the UI ("DB updated Xm ago")
  try {
    const prev = (await store.get("meta/status", { type: "json" })) || {};
    // TRUE gap detection: if this fetch's OLDEST trade overlaps the PREVIOUS
    // run's NEWEST trade, coverage is provably continuous. If it starts later,
    // the difference is a real, measured hole in the net — not a guess.
    const prevNewest = Number(prev.newestTs) || 0;
    let gapSec = 0;
    if (fetched > 0 && oldestTs > 0 && prevNewest > 0 && oldestTs > prevNewest) {
      gapSec = oldestTs - prevNewest;
    }
    await store.setJSON("meta/status", {
      lastRun: startedAt,
      fetched,
      kept,
      added,
      error,
      spanSec,                               // seconds of trading this fetch spanned
      oldestTs,
      newestTs: newestTs || prevNewest,      // carry forward on empty fetches
      intervalSec: 60,
      gapSec,                                // seconds provably missed this run
      coverageOk: gapSec <= 2,               // <=2s tolerance for timestamp granularity
      gapCount: (prev.gapCount || 0) + (gapSec > 2 ? 1 : 0),
      gapSecTotal: (prev.gapSecTotal || 0) + gapSec,
      totalRuns: (prev.totalRuns || 0) + 1,
    });
  } catch (e) { console.error("meta/status write failed:", e); }

  return new Response(JSON.stringify({ ok: !error, fetched, kept, added, error }), {
    headers: { "Content-Type": "application/json" },
  });
};

// Netlify reads this and runs the function on the cron schedule below —
// every 5 minutes, around the clock, with no browser involved.
// COST NOTE (measured, Jul 2026): a full billing period of compute — this
// collector included — totaled 1.4 credits. Deploys (15 credits each) are the
// only meaningful cost on Netlify's credit plans. So the 1-minute cadence
// stays: it is what closes peak-hour coverage gaps, and it is nearly free.
export const config = { schedule: "* * * * *" };
