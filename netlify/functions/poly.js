// netlify/functions/poly.js
//
// Server-side relay for Polymarket's public APIs.
//
// WHY THIS EXISTS
// The browser can't call data-api / gamma-api.polymarket.com directly from your
// own site: Polymarket's CORS policy only permits requests from their own
// frontend, so the browser blocks the call before it ever leaves the page.
// This function runs server-side (Netlify infra — no browser CORS applies),
// fetches the Polymarket URL you ask for, and re-serves the response with
// permissive CORS headers. Your screener then reads it with no CORS error.
//
// INTERFACE (mirrors a generic CORS proxy, so it drops into the screener's
// existing PROXIES array as a single entry):
//   GET /api/poly?url=<fully URL-encoded Polymarket URL>
//   example:
//   /api/poly?url=https%3A%2F%2Fdata-api.polymarket.com%2Ftrades%3Flimit%3D200%26side%3DBUY
//
// SECURITY
// Only whitelisted Polymarket hosts over HTTPS are allowed, so this can't be
// abused as an open proxy / SSRF vector pointed at arbitrary internal hosts.

const ALLOWED_HOSTS = new Set([
  "data-api.polymarket.com",
  "gamma-api.polymarket.com",
  "clob.polymarket.com",
]);

// To lock this relay to your own site only, replace "*" with your deployed
// origin, e.g. "https://your-screener.netlify.app".
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Accept, Content-Type",
};

const jsonError = (message, status) =>
  new Response(JSON.stringify({ error: message }), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });

export default async (req) => {
  // CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS });
  }
  if (req.method !== "GET") {
    return jsonError("Only GET is supported", 405);
  }

  const target = new URL(req.url).searchParams.get("url");
  if (!target) return jsonError("Missing ?url= parameter", 400);

  let dest;
  try {
    dest = new URL(target);
  } catch {
    return jsonError("Malformed url parameter", 400);
  }

  if (dest.protocol !== "https:" || !ALLOWED_HOSTS.has(dest.hostname)) {
    return jsonError(`Host not allowed: ${dest.hostname}`, 403);
  }

  try {
    const upstream = await fetch(dest.toString(), {
      headers: { Accept: "application/json" },
    });
    const body = await upstream.text(); // pass through as-is (text preserves JSON)
    return new Response(body, {
      status: upstream.status,
      headers: {
        ...CORS,
        "Content-Type": upstream.headers.get("content-type") || "application/json",
        // Short edge cache smooths Polymarket rate limits and de-dupes bursts
        // from multiple viewers. Tune or remove to taste.
        "Cache-Control": "public, max-age=10",
      },
    });
  } catch (err) {
    return jsonError(`Upstream fetch failed: ${String(err)}`, 502);
  }
};
