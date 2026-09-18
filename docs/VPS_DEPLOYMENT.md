# Hostinger VPS KVM2 — Deployment Guide

Deploy the EMBR3 Air Quality Monitoring app alongside existing apps (HRPMS, OCSM) on your **Hostinger KVM2 VPS** at `embr3-onlinesystems.cloud`.

---

## Target URLs

| URL | What it serves |
|-----|----------------|
| `https://embr3-onlinesystems.cloud/air-quality-monitoring` | **Kiosk** — public AQI display |
| `https://embr3-onlinesystems.cloud/air-quality-monitoring/with-arta` | **Kiosk + ARTA** — kiosk with ARTA commercial break |
| `https://embr3-onlinesystems.cloud/air-quality-monitoring/admin` | **Admin Dashboard** — station selector, charts, map, tabular |
| `https://embr3-onlinesystems.cloud/air-quality-monitoring/api/*` | **REST API** — Node/Express on port 3001 |

> Existing apps (`/hrpms`, `/ocsm`) remain untouched.

---

## Table of Contents

1. [Prerequisites](#1-prerequisites)
2. [Install MongoDB (Self-Hosted)](#2-install-mongodb-self-hosted)
3. [Clone & Configure the Project](#3-clone--configure-the-project)
4. [Build the Frontend](#4-build-the-frontend)
5. [Add Nginx Location Blocks](#5-add-nginx-location-blocks)
6. [Start the API with PM2](#6-start-the-api-with-pm2)
7. [Verify Deployment](#7-verify-deployment)
8. [Maintenance & Updates](#8-maintenance--updates)
9. [Troubleshooting](#9-troubleshooting)

---

## 1. Prerequisites

Your VPS already has a working stack serving HRPMS and OCSM. Verify the tools are installed:

```bash
ssh root@72.61.125.232

node -v     # v20.x (or v18+ minimum)
npm -v      # 10.x
nginx -v    # nginx/1.x
pm2 -v      # 5.x+
```

If any of these are missing:

```bash
# Node 20 LTS (skip if already installed)
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt install -y nodejs

# PM2 (skip if already installed)
npm install -g pm2

# Nginx (likely already installed)
apt install -y nginx

# Build tools (if not present)
apt install -y build-essential git
```

---

## 2. Install MongoDB (Self-Hosted)

> Skip this section entirely if MongoDB is already running on your VPS.

```bash
# Import MongoDB 7.0 key & repo (Ubuntu 22.04)
curl -fsSL https://www.mongodb.org/static/pgp/server-7.0.asc | \
  gpg -o /usr/share/keyrings/mongodb-server-7.0.gpg --dearmor

echo "deb [ signed-by=/usr/share/keyrings/mongodb-server-7.0.gpg ] \
  https://repo.mongodb.org/apt/ubuntu jammy/mongodb-org/7.0 multiverse" | \
  tee /etc/apt/sources.list.d/mongodb-org-7.0.list

apt update && apt install -y mongodb-org

# Start & enable on boot
systemctl start mongod
systemctl enable mongod
```

### Create the app database user

```bash
mongosh --eval '
  use("db-air_quality_monitoring");
  db.createUser({
    user: "aqm_app",
    pwd: "CHANGE_THIS_TO_A_STRONG_PASSWORD",
    roles: [{ role: "readWrite", db: "db-air_quality_monitoring" }]
  });
'
```

### Enable authentication

```bash
nano /etc/mongod.conf
```

Find the `#security:` section and change it to:

```yaml
security:
  authorization: enabled
```

```bash
systemctl restart mongod
```

---

## 3. Clone & Configure the Project

```bash
cd /var/www
git clone https://github.com/fons-sabalbosajr/air-quality-monitoring.git
cd air-quality-monitoring
```

### Server `.env`

```bash
cd server
cp .env.example .env
nano .env
```

Fill in these values:

```env
PORT=3001
NODE_ENV=production

# CORS — your domain
CORS_ORIGIN=https://embr3-onlinesystems.cloud

# Rate limiting
RATE_WINDOW_MS=60000
RATE_MAX=120

# MongoDB (use the password you set in Step 2)
MONGO_URI=mongodb://aqm_app:YOUR_STRONG_PASSWORD@127.0.0.1:27017/db-air_quality_monitoring?authSource=db-air_quality_monitoring
MONGO_DB_NAME=db-air_quality_monitoring
MONGO_COLLECTION_SERIES=air_data
MONGO_COLLECTION_META=air_data_meta
MONGO_COLLECTION_STATION=station_meta

# Ingestion
INGEST_CRON=*/15 * * * *
INGEST_TZ=Asia/Manila
INGEST_ON_START=1

# Google Sheets CSV URLs (paste your actual URLs)
SHEET_PM10_MEYCAUAYAN_URL=
SHEET_PM25_MEYCAUAYAN_URL=
SHEET_PM10_ZAMBALES_URL=
SHEET_PM25_ZAMBALES_URL=
SHEET_PM10_CLARK_URL=
SHEET_PM10_SAN_FERNANDO_URL=

# Weather API
OWM_API_KEY=

# Email (optional)
EMAIL_USER=
EMAIL_PASS=
```

```bash
chmod 600 .env
```

### Install server dependencies

```bash
npm ci --production
```

### Frontend `.env`

```bash
cd ../front-end
cp .env.example .env
nano .env
```

Fill in:

```env
VITE_API_BASE=https://embr3-onlinesystems.cloud/air-quality-monitoring

# Generate a key:  openssl rand -base64 32
VITE_SECURE_STORAGE_KEY=PASTE_GENERATED_KEY_HERE
```

```bash
chmod 600 .env
```

### Install frontend dependencies

```bash
npm ci
```

---

## 4. Build the Frontend

```bash
cd /var/www/air-quality-monitoring/front-end
npm run build
# Output → front-end/dist/
```

> The Vite config has `base: '/air-quality-monitoring/'` — all built assets are prefixed for the subpath automatically.

---

## 5. Add Nginx Location Blocks

Your VPS uses `/etc/nginx/sites-available/embr3-hr-pms` (symlinked from `sites-enabled/`) to serve HRPMS and OCSM. We add AQM blocks to the **same file**.

```bash
nano /etc/nginx/sites-available/embr3-hr-pms
```

**Add the following blocks** inside the main `server { ... }` block, right after the OCSM Socket.IO section and **before** the `listen 443 ssl;` line:

```nginx
    # ══════════════════════════════════════════════════════════════════
    # AQM – Air Quality Monitoring (port 3001)
    # ══════════════════════════════════════════════════════════════════

    # ── Bare /air-quality-monitoring → trailing slash ────────────────
    location = /air-quality-monitoring {
        return 301 /air-quality-monitoring/;
    }

    # ── AQM Front-end (static SPA) ──────────────────────────────────
    # -- AQM NLEX / VNNOX display (iframe-friendly) -----------------
    # Put this BEFORE the generic /air-quality-monitoring/ SPA block.
    location = /air-quality-monitoring/nlex {
        alias /var/www/air-quality-monitoring/front-end/dist/index.html;
        default_type text/html;

        add_header X-Content-Type-Options "nosniff" always;
        add_header Referrer-Policy "strict-origin-when-cross-origin" always;
        add_header Permissions-Policy "camera=(), microphone=(), geolocation=(self)" always;
        add_header Content-Security-Policy "frame-ancestors 'self' https: http:" always;
        add_header Cross-Origin-Resource-Policy "cross-origin" always;
      add_header Cache-Control "no-cache, no-store, must-revalidate" always;
      add_header Pragma "no-cache" always;
      add_header Expires "0" always;
    }

    # Optional but useful for VNNOX players that normalize URLs with a
    # trailing slash before loading the web-display iframe. Redirect it to the
    # canonical /nlex URL so the request inherits the exact LED-wall headers
    # from the block above and avoids duplicate-location drift.
    location = /air-quality-monitoring/nlex/ {
      return 301 /air-quality-monitoring/nlex;
    }

    # Keep SPA index.html fresh so newly deployed bundles are not pinned by
    # intermediate caches while the LED-wall route stays on its own headers.
    location = /air-quality-monitoring/index.html {
      alias /var/www/air-quality-monitoring/front-end/dist/index.html;
      default_type text/html;

      add_header Cache-Control "no-cache, no-store, must-revalidate" always;
      add_header Pragma "no-cache" always;
      add_header Expires "0" always;
    }

    location /air-quality-monitoring/ {
        alias /var/www/air-quality-monitoring/front-end/dist/;
        index index.html;
        try_files $uri $uri/ /air-quality-monitoring/index.html;

        add_header X-Content-Type-Options "nosniff" always;
        add_header Referrer-Policy "strict-origin-when-cross-origin" always;
        add_header Permissions-Policy "camera=(), microphone=(), geolocation=(self)" always;
        add_header X-Frame-Options "SAMEORIGIN" always;
        add_header Content-Security-Policy "frame-ancestors 'self'" always;
    }

    # ── Admin shortcut redirect ──────────────────────────────────────
    location = /air-quality-monitoring-admin {
        return 301 /air-quality-monitoring/admin/overview;
    }
    location /air-quality-monitoring-admin/ {
        return 301 /air-quality-monitoring/admin/overview;
    }

    # ── AQM API reverse proxy ───────────────────────────────────────
    location /air-quality-monitoring/api/ {
        rewrite ^/air-quality-monitoring/api/(.*) /api/$1 break;
        proxy_pass         http://127.0.0.1:3001;
        proxy_http_version 1.1;
        proxy_set_header   Host              $host;
        proxy_set_header   X-Real-IP         $remote_addr;
        proxy_set_header   X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header   X-Forwarded-Proto $scheme;
        proxy_connect_timeout 10s;
        proxy_read_timeout 30s;
    }
```

### VNNOX / iframe header audit

After deployment and CDN purge, test the exact display URL:

```bash
curl -I https://embr3-onlinesystems.cloud/air-quality-monitoring/nlex
curl -I https://embr3-onlinesystems.cloud/air-quality-monitoring/nlex/
curl -L -I https://embr3-onlinesystems.cloud/air-quality-monitoring/nlex/
```

Expected results:

- `/air-quality-monitoring/nlex` returns `HTTP/2 200`
- `/air-quality-monitoring/nlex/` returns `HTTP/2 301` pointing to `/air-quality-monitoring/nlex`
- `curl -L -I` for `/nlex/` ends at `HTTP/2 200`
- the final `/nlex` response has no `X-Frame-Options` header
- the final `/nlex` response includes `Content-Security-Policy: frame-ancestors 'self' https: http:`
- the final `/nlex` response includes `Cache-Control: no-cache, no-store, must-revalidate`

If a CDN is in front of NGINX, make sure it does not inject `X-Frame-Options`
or replace `Content-Security-Policy` for `/air-quality-monitoring/nlex*`.
Bypass or revalidate CDN cache for `/air-quality-monitoring/nlex*` and
`/air-quality-monitoring/api/*`; the AQI APIs already send no-cache headers and
ETags, so browser/CDN revalidation stays accurate without serving stale LED data.

### Verified production result

The June 3, 2026 production rollout on `embr3-onlinesystems.cloud` was verified
with the sequence above and produced the expected behavior behind Cloudflare:

- `/air-quality-monitoring/nlex` returned `200` with `server: cloudflare`
- `/air-quality-monitoring/nlex/` returned `301` to the canonical `/nlex`
- `curl -L -I /air-quality-monitoring/nlex/` resolved to the fresh HTML response
- the final `/nlex` response carried `cf-cache-status: DYNAMIC`
- the final `/nlex` response included `last-modified` from the new build

### Browser preview for NLEX LED wall

For checking improvements in a normal browser, use:

```text
https://embr3-onlinesystems.cloud/air-quality-monitoring/nlex?fallback=1
https://embr3-onlinesystems.cloud/air-quality-monitoring/nlex?mode=native
https://embr3-onlinesystems.cloud/air-quality-monitoring/nlex?mode=browser
https://embr3-onlinesystems.cloud/air-quality-monitoring/nlex-preview
```

Use `fallback=1` or `mode=native` to inspect the same native HTML fallback that
appears if the React NLEX display cannot boot.
Use `mode=browser` or `/nlex-preview` for the full React/browser preview with
animations and the richer weather background. Keep the plain `/nlex` URL for the
actual VNNOX/LED wall player because it stays on the React compatibility profile.

> **Where exactly?** After the `location /ocsm/socket.io/ { ... }` block and its blank line, before the line `listen 443 ssl; # managed by Certbot`.

### Enable geolocation (important!)

The existing Nginx config contains a `Permissions-Policy` header that blocks geolocation:

```
add_header Permissions-Policy "camera=(), microphone=(), geolocation=()";
```

AQM uses geolocation for station detection. Change `geolocation=()` to `geolocation=(self)`:

```nginx
add_header Permissions-Policy "camera=(), microphone=(), geolocation=(self)";
```

### Test & reload Nginx

```bash
nginx -t
systemctl reload nginx
```

If `nginx -t` fails, check for syntax errors (missing semicolons, unclosed braces) near the blocks you added.

---

## 6. Start the API with PM2

```bash
cd /var/www/air-quality-monitoring/server
pm2 start server.js --name aqm-api --node-args="--max-old-space-size=512"
pm2 save
```

If you haven't set up PM2 startup on this VPS yet:

```bash
pm2 startup
# Run the command PM2 prints (starts with: sudo env PATH=... pm2 startup ...)
```

---

## 7. Verify Deployment

### From the VPS terminal

```bash
# 1. Health check (direct)
curl -s http://127.0.0.1:3001/health
# Expected: {"health":"ok","timestamp":...}

# 2. API via Nginx
curl -s https://embr3-onlinesystems.cloud/air-quality-monitoring/api/health
# Expected: {"health":"ok",...}

# 3. Frontend
curl -sI https://embr3-onlinesystems.cloud/air-quality-monitoring/
# Expected: HTTP/2 200

# 4. Admin redirect
curl -sI https://embr3-onlinesystems.cloud/air-quality-monitoring-admin
# Expected: 301 → /air-quality-monitoring/admin/overview
```

### From your browser

| URL | Expected |
|-----|----------|
| `https://embr3-onlinesystems.cloud/air-quality-monitoring` | Kiosk — auto-cycling AQI display |
| `https://embr3-onlinesystems.cloud/air-quality-monitoring-admin` | Admin — dashboard with sidebar nav |
| `https://embr3-onlinesystems.cloud/hrpms` | Still works (untouched) |
| `https://embr3-onlinesystems.cloud/ocsm/` | Still works (untouched) |

---

## 8. Maintenance & Updates

### Deploy a new version

```bash
cd /var/www/air-quality-monitoring
git pull origin main

# Rebuild frontendcd
cd front-end && npm ci && npm run build

# Restart API
cd ../server && npm ci --production
pm2 restart aqm-api
```

### Quick deploy from your local machine

```bash
# From your local project root:
bash deploy.sh 72.61.125.232 root
```

### PM2 commands

```bash
pm2 status           # Check all processes
pm2 logs aqm-api     # Tail AQM logs
pm2 restart aqm-api  # Restart after changes
pm2 monit            # Real-time CPU/memory monitor
```

### Log rotation

```bash
pm2 install pm2-logrotate
pm2 set pm2-logrotate:max_size 10M
pm2 set pm2-logrotate:retain 7
```

---

## 9. Troubleshooting

| Symptom | Likely Cause | Fix |
|---------|-------------|-----|
| `502 Bad Gateway` on `/air-quality-monitoring/api/` | Node API not running | `pm2 status` → `pm2 restart aqm-api` |
| Blank page at `/air-quality-monitoring/` | `dist/` not found or wrong alias path | Verify `alias /var/www/air-quality-monitoring/front-end/dist/;` |
| CORS errors in browser | `CORS_ORIGIN` mismatch | Set `CORS_ORIGIN=https://embr3-onlinesystems.cloud` in `server/.env`, restart |
| `/air-quality-monitoring-admin` shows 404 | Nginx missing redirect block | Add the `location = /air-quality-monitoring-admin` block |
| SPA sub-routes 404 on page refresh | Missing `try_files` fallback | Ensure `try_files $uri $uri/ /air-quality-monitoring/index.html;` |
| API returns `Cannot GET /api/...` | Rewrite rule wrong | Check `rewrite ^/air-quality-monitoring/api/(.*) /api/$1 break;` |
| Assets not loading (404) | Base path mismatch | Verify `vite.config.js` has `base: '/air-quality-monitoring/'`, rebuild |
| Existing apps (`/hrpms`, `/ocsm`) broken | Location block conflict | Ensure AQM blocks are separate, not overriding existing ones |
| MongoDB auth error | Wrong password in `.env` | Check `MONGO_URI` matches the user/password from Step 2 |
| Build fails (OOM) on VPS | Low memory | Add swap: `fallocate -l 2G /swapfile && mkswap /swapfile && swapon /swapfile` |

---

## File Locations on VPS

```
/var/www/air-quality-monitoring/
├── server/
│   ├── .env              ← API secrets (chmod 600)
│   ├── server.js         ← Entry point (PM2: aqm-api)
│   └── data/             ← Runtime cache
├── front-end/
│   ├── .env              ← Build-time vars (chmod 600)
│   └── dist/             ← Built SPA (Nginx serves)
├── deploy.sh             ← Automated deploy script
└── VPS_DEPLOYMENT.md     ← This file
```
