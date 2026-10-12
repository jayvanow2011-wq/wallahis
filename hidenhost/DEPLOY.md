# HidenHost — deploy on `umad.servemc.net`

The relay is a plain Node process on port **24578**. A reverse proxy
(Caddy or Nginx) owns 80/443 on that box and forwards both HTTP and
WebSocket traffic to it.

Right now `https://umad.servemc.net` returns an OpenResty 302 redirect to
`www.hidencloud.com` — that means **the relay is not running** (or the
reverse proxy is not pointed at it). Follow the steps below.

---

## 1. Copy the folder to the server

```bash
scp -r hidenhost/ youruser@umad.servemc.net:/opt/
ssh youruser@umad.servemc.net
sudo mv /opt/hidenhost /opt/hidenhost   # already there if you scp'd as root
cd /opt/hidenhost
```

## 2. Install Node deps and set the auth key

```bash
cp .env.example .env
nano .env         # set HIDEN_AUTH_KEY=<same value you set in Lovable secrets>
npm install
```

The server now runs 24/7 by default (idle shutdown disabled). To re-enable
auto-shutdown after N seconds of silence, set `IDLE_SHUTDOWN_SEC=100`.

## 3. Install the systemd service

```bash
sudo useradd -r -s /bin/false hiden || true
sudo chown -R hiden:hiden /opt/hidenhost
sudo cp hidenhost.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now hidenhost
sudo systemctl status hidenhost
sudo journalctl -fu hidenhost
```

`Restart=always` keeps it alive forever. Verify locally:

```bash
curl http://localhost:24578/health
# → {"ok":true,"server":"online","proxy":"working","ts":...}
```

## 4. Reverse-proxy 80/443 → 24578

### Option A — Caddy (recommended, auto-HTTPS)

```bash
sudo cp Caddyfile /etc/caddy/Caddyfile
sudo systemctl restart caddy
```

### Option B — Nginx + certbot

```bash
sudo cp nginx.conf /etc/nginx/sites-available/hidenhost
sudo ln -sf /etc/nginx/sites-available/hidenhost /etc/nginx/sites-enabled/
sudo certbot --nginx -d umad.servemc.net
sudo systemctl reload nginx
```

## 5. Verify from the outside

```bash
curl -I https://umad.servemc.net/health
# → HTTP/2 200
curl    https://umad.servemc.net/
# → HTML "HidenHost relay is online" dashboard
```

Open `https://umad.servemc.net/` in a browser — you'll see a dark card:

> ● HidenHost relay is online
> Server: online · Proxy: working · HTTP: ready · WSS: ready

And the frontend's **/status** page shows **Backend: Online — \<ms\>**.

## 6. WebSocket test

```bash
npx wscat -c "wss://umad.servemc.net/?key=$HIDEN_AUTH_KEY&role=viewer&device=test"
> {"type":"hello","role":"viewer","deviceId":"test"}
< {"type":"welcome", ...}
```

## Troubleshooting

| Symptom | Cause | Fix |
|---------|-------|-----|
| 302 to www.hidencloud.com | reverse proxy not configured for this vhost | step 4 |
| 502 Bad Gateway | Node process not running | `systemctl status hidenhost` |
| 401 on WS upgrade | wrong `HIDEN_AUTH_KEY` | `.env` on server must match the Lovable secret |
| `/status` says Offline | both direct + proxy down | check CF Worker + origin |
