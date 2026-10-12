// ─────────────────────────────────────────────────────────────────────────────
// HidenHost WebSocket relay — pure forwarder, no database, no build worker.
//
//   Internet (TLS via Caddy)
//        │
//        ▼
//   umad.servemc.net  (Caddy reverse proxy)
//        │
//        ▼
//   rosa.hidencloud.com:24578   (this Node process)
//        │
//        ▼
//   Rust agents  ←→  Lovable frontend (via Cloudflare Worker)
//
// The relay routes JSON/binary frames between an `agent` socket and N
// `viewer` sockets sharing the same `deviceId`. No DB, no auth state.
// ─────────────────────────────────────────────────────────────────────────────

'use strict';

require('dotenv').config();
const http = require('http');
const express = require('express');
const cors = require('cors');
const { WebSocketServer } = require('ws');
const { randomUUID } = require('crypto');

const HOST = process.env.HOST || '0.0.0.0';
const PORT = parseInt(process.env.PORT || '24578', 10);
const AUTH_KEY = process.env.HIDEN_AUTH_KEY || '';
const PING_INTERVAL_MS = parseInt(process.env.PING_INTERVAL_MS || '25000', 10);
const MAX_PAYLOAD = parseInt(process.env.MAX_PAYLOAD || String(16 * 1024 * 1024), 10);
const CORS_ORIGINS = (process.env.CORS_ORIGINS || '*')
  .split(',').map(s => s.trim()).filter(Boolean);

// ── Inactivity auto-shutdown ────────────────────────────────────────────────
// Opt-in only. Set IDLE_SHUTDOWN_SEC=<n> to re-enable. Default: stay alive
// forever so the relay is a true 24/7 server (systemd + Restart=always).
const IDLE_SHUTDOWN_SEC = parseInt(process.env.IDLE_SHUTDOWN_SEC || '0', 10);
let lastActivity = Date.now();
function touch() { lastActivity = Date.now(); }

if (IDLE_SHUTDOWN_SEC > 0) {
  setInterval(() => {
    if (Date.now() - lastActivity > IDLE_SHUTDOWN_SEC * 1000) {
      console.log(`[idle] no activity for ${IDLE_SHUTDOWN_SEC}s — shutting down`);
      shutdown();
    }
  }, 10000);
}

// ── HTTP side ───────────────────────────────────────────────────────────────
const app = express();
app.use(express.json({ limit: '1mb' }));
app.use(cors({ origin: CORS_ORIGINS.includes('*') ? true : CORS_ORIGINS, credentials: false }));

const startedAt = Date.now();

// Root — human-friendly HTML status (JSON when ?format=json or Accept: json).
app.get('/', (req, res) => {
  touch();
  const wantsJson = req.query.format === 'json'
    || (req.headers.accept || '').includes('application/json');
  const uptimeSec = Math.floor((Date.now() - startedAt) / 1000);
  const payload = {
    status: 'ok',
    name: 'hidenhost-relay',
    server: 'online',
    proxy: 'working',
    wss: 'ready',
    http: 'ready',
    uptimeSec,
    agents: agents.size,
    viewers: [...viewers.values()].reduce((n, s) => n + s.size, 0),
    devices: viewers.size,
    ts: Date.now(),
  };
  if (wantsJson) return res.json(payload);
  const uptimeStr = formatUptime(uptimeSec);
  res.set('content-type', 'text/html; charset=utf-8');
  res.send(`<!doctype html><html><head><meta charset="utf-8"><title>HidenHost Relay — online</title>
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>
  body{margin:0;font:14px/1.5 ui-sans-serif,system-ui,sans-serif;background:#0b0f17;color:#e5e7eb;min-height:100vh;display:grid;place-items:center;padding:24px}
  .card{max-width:560px;width:100%;background:#111827;border:1px solid #1f2937;border-radius:16px;padding:28px;box-shadow:0 20px 60px rgba(0,0,0,.5)}
  h1{margin:0 0 4px;font-size:20px;font-weight:600}
  .sub{color:#9ca3af;font-size:13px;margin-bottom:20px}
  .dot{display:inline-block;width:10px;height:10px;border-radius:50%;background:#22c55e;box-shadow:0 0 12px #22c55e;margin-right:8px;vertical-align:middle;animation:pulse 2s infinite}
  @keyframes pulse{0%,100%{opacity:1}50%{opacity:.5}}
  .row{display:flex;justify-content:space-between;padding:10px 0;border-top:1px solid #1f2937;font-size:13px}
  .row:first-of-type{border-top:0}
  .k{color:#9ca3af}
  .v{color:#f3f4f6;font-variant-numeric:tabular-nums}
  .ok{color:#22c55e;font-weight:600}
  code{background:#0b0f17;padding:2px 6px;border-radius:4px;font-size:12px;color:#60a5fa}
</style></head><body>
<div class="card">
  <h1><span class="dot"></span>HidenHost relay is online</h1>
  <div class="sub">WebSocket + HTTP proxy forwarding <code>umad.servemc.net</code> → <code>localhost:${PORT}</code></div>
  <div class="row"><span class="k">Server</span><span class="v ok">online</span></div>
  <div class="row"><span class="k">Proxy</span><span class="v ok">working</span></div>
  <div class="row"><span class="k">HTTP</span><span class="v ok">ready</span></div>
  <div class="row"><span class="k">WSS</span><span class="v ok">ready</span></div>
  <div class="row"><span class="k">Uptime</span><span class="v">${uptimeStr}</span></div>
  <div class="row"><span class="k">Connected agents</span><span class="v">${payload.agents}</span></div>
  <div class="row"><span class="k">Connected viewers</span><span class="v">${payload.viewers}</span></div>
  <div class="row"><span class="k">Devices routed</span><span class="v">${payload.devices}</span></div>
  <div class="row"><span class="k">Endpoints</span><span class="v"><code>/health</code> <code>/stats</code> <code>/?format=json</code></span></div>
</div></body></html>`);
});

function formatUptime(sec) {
  const d = Math.floor(sec / 86400); sec %= 86400;
  const h = Math.floor(sec / 3600); sec %= 3600;
  const m = Math.floor(sec / 60); const s = sec % 60;
  const parts = [];
  if (d) parts.push(`${d}d`);
  if (h || d) parts.push(`${h}h`);
  if (m || h || d) parts.push(`${m}m`);
  parts.push(`${s}s`);
  return parts.join(' ');
}

app.get('/health', (_req, res) => {
  touch();
  res.json({ ok: true, server: 'online', proxy: 'working', ts: Date.now() });
});

app.get('/stats', (_req, res) => {
  touch();
  res.json({
    agents: [...agents.keys()],
    viewers: [...viewers.entries()].map(([dev, set]) => ({ deviceId: dev, count: set.size })),
  });
});

const server = http.createServer(app);
server.on('connection', sock => {
  try { sock.setNoDelay(true); sock.setKeepAlive(true, 15000); } catch (_) {}
});

// ── WebSocket side ──────────────────────────────────────────────────────────
const wss = new WebSocketServer({
  noServer: true,
  perMessageDeflate: false,
  maxPayload: MAX_PAYLOAD,
  skipUTF8Validation: true,
});

/** deviceId -> ws  (one agent per device) */
const agents = new Map();
/** deviceId -> Set<ws>  (many viewers per device) */
const viewers = new Map();
/** `${deviceId}|${clientId}` -> ws */
const viewerByClient = new Map();

function checkKey(provided) {
  if (!AUTH_KEY) return true;
  return provided === AUTH_KEY;
}

server.on('upgrade', (req, socket, head) => {
  touch();
  const url = new URL(req.url, `http://${req.headers.host}`);
  const key = req.headers['x-hiden-key'] || url.searchParams.get('key');
  if (!checkKey(key)) {
    socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
    socket.destroy();
    return;
  }
  wss.handleUpgrade(req, socket, head, ws => {
    ws._url = url;
    wss.emit('connection', ws, req);
  });
});

wss.on('connection', ws => {
  ws.id = randomUUID();
  ws.role = null;
  ws.deviceId = null;
  ws.clientId = null;
  ws.isAlive = true;
  ws.connectedAt = Date.now();
  touch();

  const qRole = ws._url?.searchParams.get('role');
  const qDevice = ws._url?.searchParams.get('device');
  const qClient = ws._url?.searchParams.get('clientId');
  if (qRole && qDevice) attach(ws, qRole, qDevice, qClient);

  ws.on('pong', () => { ws.isAlive = true; });

  ws.on('message', (raw, isBinary) => {
    touch();

    if (isBinary) {
      if (!ws.role || !ws.deviceId) return;
      if (ws.role === 'agent') {
        const set = viewers.get(ws.deviceId);
        if (!set) return;
        for (const v of set) if (v.readyState === ws.OPEN) v.send(raw, { binary: true });
      } else {
        const target = agents.get(ws.deviceId);
        if (target && target.readyState === ws.OPEN) target.send(raw, { binary: true });
      }
      return;
    }

    let msg;
    try { msg = JSON.parse(raw.toString()); }
    catch { return safeSend(ws, { type: 'error', error: 'invalid json' }); }

    // Keepalive ping from browser relay.ts — reply with pong.
    if (msg.type === 'ping') {
      safeSend(ws, { type: 'pong', t: msg.t });
      return;
    }

    if (msg.type === 'hello') {
      attach(ws, msg.role, msg.deviceId, msg.clientId);
      safeSend(ws, { type: 'welcome', id: ws.id, role: ws.role, deviceId: ws.deviceId });
      return;
    }

    if (!ws.role || !ws.deviceId) {
      return safeSend(ws, { type: 'error', error: 'not identified — send {type:"hello",role,deviceId}' });
    }

    if (ws.role === 'viewer') {
      const target = agents.get(ws.deviceId);
      if (target && target.readyState === ws.OPEN) {
        msg.from = 'viewer';
        msg.viewerId = ws.id;
        target.send(JSON.stringify(msg));
      } else {
        safeSend(ws, { type: 'error', error: 'agent offline' });
      }
    } else if (ws.role === 'agent') {
      const set = viewers.get(ws.deviceId);
      if (!set || set.size === 0) return;
      msg.from = 'agent';
      const wire = JSON.stringify(msg);
      const targetViewer = msg.to;
      for (const v of set) {
        if (v.readyState !== ws.OPEN) continue;
        if (targetViewer && targetViewer !== v.id) continue;
        v.send(wire);
      }
    }
  });

  ws.on('close', () => detach(ws));
  ws.on('error', () => detach(ws));
});

function attach(ws, role, deviceId, clientId) {
  if (!deviceId || !['agent', 'viewer'].includes(role)) return;
  ws.role = role;
  ws.deviceId = deviceId;
  if (role === 'agent') {
    const prev = agents.get(deviceId);
    if (prev && prev !== ws) try { prev.close(4000, 'replaced'); } catch (_) {}
    agents.set(deviceId, ws);
    broadcastToViewers(deviceId, { type: 'agent-online', deviceId });
  } else {
    if (clientId) {
      ws.clientId = clientId;
      const key = `${deviceId}|${clientId}`;
      const prev = viewerByClient.get(key);
      if (prev && prev !== ws) try { prev.close(4000, 'replaced-by-newer-client'); } catch (_) {}
      viewerByClient.set(key, ws);
    }
    if (!viewers.has(deviceId)) viewers.set(deviceId, new Set());
    viewers.get(deviceId).add(ws);
    const a = agents.get(deviceId);
    if (a && a.readyState === ws.OPEN) {
      safeSend(a, { type: 'viewer-joined', deviceId, viewerId: ws.id });
    }
  }
  console.log(`[+] ${role} ${deviceId} (${ws.id.slice(0, 8)})`);
}

function detach(ws) {
  if (!ws.deviceId) return;
  if (ws.role === 'agent' && agents.get(ws.deviceId) === ws) {
    agents.delete(ws.deviceId);
    broadcastToViewers(ws.deviceId, { type: 'agent-offline', deviceId: ws.deviceId });
  } else if (ws.role === 'viewer') {
    const set = viewers.get(ws.deviceId);
    if (set) {
      set.delete(ws);
      if (set.size === 0) viewers.delete(ws.deviceId);
      const a = agents.get(ws.deviceId);
      if (a && a.readyState === ws.OPEN) {
        safeSend(a, { type: 'viewer-left', deviceId: ws.deviceId, viewerId: ws.id });
      }
    }
    if (ws.clientId) {
      const key = `${ws.deviceId}|${ws.clientId}`;
      if (viewerByClient.get(key) === ws) viewerByClient.delete(key);
    }
  }
  console.log(`[-] ${ws.role} ${ws.deviceId} (${ws.id.slice(0, 8)})`);
}

function broadcastToViewers(deviceId, msg) {
  const set = viewers.get(deviceId);
  if (!set) return;
  for (const v of set) if (v.readyState === v.OPEN) safeSend(v, msg);
}

function safeSend(ws, obj) {
  try { ws.send(JSON.stringify(obj)); } catch (_) {}
}

// Drop dead sockets
setInterval(() => {
  wss.clients.forEach(ws => {
    if (ws.isAlive === false) { try { ws.terminate(); } catch (_) {} return; }
    ws.isAlive = false;
    try { ws.ping(); } catch (_) {}
  });
}, PING_INTERVAL_MS);

// ── Boot ────────────────────────────────────────────────────────────────────
server.listen(PORT, HOST, () => {
  console.log(`╔═══════════════════════════════════════════════╗`);
  console.log(`║  HidenHost WS relay`);
  console.log(`║  Listening   ${HOST}:${PORT}`);
  console.log(`║  Public      ${process.env.PUBLIC_WS_URL || 'wss://umad.servemc.net'}`);
  console.log(`║  Auth        ${AUTH_KEY ? 'ENABLED' : 'DISABLED (dev)'}`);
  console.log(`║  Idle stop   ${IDLE_SHUTDOWN_SEC > 0 ? IDLE_SHUTDOWN_SEC + 's' : 'DISABLED (24/7)'}`);
  console.log(`╚═══════════════════════════════════════════════╝`);
});

function shutdown() {
  console.log('\nshutting down…');
  server.close(() => process.exit(0));
  // Force exit after 3s if connections linger.
  setTimeout(() => process.exit(0), 3000);
}
process.on('SIGINT',  shutdown);
process.on('SIGTERM', shutdown);
