// ─────────────────────────────────────────────────────────────────────────────
// HidenHost Cloudflare Worker — anti-block relay.
//
//   Browser / Agent  ──wss──▶  cold-pond-1f9d.jay-068.workers.dev
//                                │
//                                │  fetch() upgrade (https://)
//                                ▼
//                        umad.servemc.net   (Caddy reverse proxy → server.js)
//
// Deploy: paste into the Worker editor at cold-pond-1f9d.jay-068.workers.dev
// (dashboard → Workers → Edit code), then Save & Deploy.
//
// The Worker proxies both HTTP and WebSocket traffic. Cloudflare Workers use
// fetch() with https:// for WebSocket upgrades — NOT ws:// or wss://.
// ─────────────────────────────────────────────────────────────────────────────

const ORIGIN = "https://umad.servemc.net";

export default {
  async fetch(request) {
    const url = new URL(request.url);
    const upgrade = (request.headers.get("Upgrade") || "").toLowerCase();

    // ── WebSocket upgrade ──────────────────────────────────────────────
    if (upgrade === "websocket") {
      // Build the target URL using https:// (NOT wss://).
      // Cloudflare's fetch() handles the 101 upgrade internally.
      const target = ORIGIN + url.pathname + url.search;

      // Copy relevant headers; Cloudflare adds Upgrade automatically.
      const headers = new Headers();
      for (const [k, v] of request.headers) {
        // Forward everything except host (Cloudflare sets it).
        if (k.toLowerCase() !== "host") headers.set(k, v);
      }

      const resp = await fetch(target, {
        headers,
      });

      // Return the upgraded response (101 Switching Protocols).
      return resp;
    }

    // ── OPTIONS (CORS preflight) ───────────────────────────────────────
    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
          "Access-Control-Allow-Headers": "*",
          "Access-Control-Max-Age": "86400",
        },
      });
    }

    // ── Plain HTTP (health, stats, root) ───────────────────────────────
    const target = ORIGIN + url.pathname + url.search;
    const resp = await fetch(target, {
      method: request.method,
      headers: request.headers,
      body: ["GET", "HEAD"].includes(request.method) ? undefined : request.body,
      redirect: "manual",
    });

    const h = new Headers(resp.headers);
    h.set("Access-Control-Allow-Origin", "*");
    return new Response(resp.body, { status: resp.status, headers: h });
  },
};
