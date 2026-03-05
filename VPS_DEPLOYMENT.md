# Hostinger VPS KVM2 — Deployment Guide

Deploy the EMBR3 Air Quality Monitoring app alongside existing apps (HRPMS, OCSM) on your **Hostinger KVM2 VPS** at `embr3-onlinesystems.cloud`.

---

## Target URLs

| URL | What it serves |
|-----|----------------|
| `https://embr3-onlinesystems.cloud/air-quality-monitoring` | **Kiosk** — public AQI display |
| `https://embr3-onlinesystems.cloud/air-quality-monitoring-admin` | **Admin Dashboard** — station selector, charts, map, tabular |
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
VITE_API_BASE=https://embr3-onlinesystems.cloud/air-quality-monitoring/api

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

Your existing Nginx config already has a `server { ... }` block for `embr3-onlinesystems.cloud`. We add location blocks **inside** that same server block.

```bash
nano /etc/nginx/sites-available/default
```

> Or wherever your main server block lives (check with `grep -r "server_name" /etc/nginx/sites-enabled/`).

**Add these location blocks** inside the existing `server { ... }` block. Do **NOT** remove the existing `/hrpms` or `/ocsm` blocks:

```nginx
    # ═══════════════════════════════════════════════════════════
    # EMBR3 Air Quality Monitoring
    # ═══════════════════════════════════════════════════════════

    # ── Frontend SPA (subpath) ──
    location /air-quality-monitoring/ {
        alias /var/www/air-quality-monitoring/front-end/dist/;
        index index.html;
        try_files $uri $uri/ /air-quality-monitoring/index.html;
    }

    # ── Admin shortcut redirect ──
    location = /air-quality-monitoring-admin {
        return 301 /air-quality-monitoring/admin/overview;
    }
    location /air-quality-monitoring-admin/ {
        return 301 /air-quality-monitoring/admin/overview;
    }

    # ── API reverse proxy (Node :3001) ──
    location /air-quality-monitoring/api/ {
        rewrite ^/air-quality-monitoring/api/(.*) /$1 break;
        proxy_pass http://127.0.0.1:3001;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_connect_timeout 10s;
        proxy_read_timeout 30s;
    }
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

# Rebuild frontend
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
| API returns `Cannot GET /api/...` | Rewrite rule wrong | Check `rewrite ^/air-quality-monitoring/api/(.*) /$1 break;` |
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
