# Hostinger VPS KVM2 — Deployment Guide

Complete setup guide for deploying the EMBR3 Air Quality Monitoring application on a **Hostinger VPS KVM2** (2 vCPU, 8 GB RAM, 100 GB NVMe, Ubuntu 22.04/24.04).

---

## Table of Contents

1. [Prerequisites](#1-prerequisites)
2. [Initial VPS Setup & Hardening](#2-initial-vps-setup--hardening)
3. [Install Runtime Dependencies](#3-install-runtime-dependencies)
4. [Clone & Configure the Project](#4-clone--configure-the-project)
5. [Set Up MongoDB](#5-set-up-mongodb)
6. [Build the Frontend](#6-build-the-frontend)
7. [Configure Nginx (Reverse Proxy + Static Files)](#7-configure-nginx)
8. [SSL with Let's Encrypt](#8-ssl-with-lets-encrypt)
9. [PM2 Process Manager (Node API)](#9-pm2-process-manager)
10. [Firewall Rules](#10-firewall-rules)
11. [Verify Deployment](#11-verify-deployment)
12. [Maintenance & Updates](#12-maintenance--updates)
13. [Security Checklist](#13-security-checklist)
14. [Troubleshooting](#14-troubleshooting)

---

## 1. Prerequisites

| Item | Details |
|------|---------|
| **VPS Plan** | Hostinger KVM2 (2 vCPU / 8 GB RAM / 100 GB NVMe) |
| **OS** | Ubuntu 22.04 LTS or 24.04 LTS (select during VPS setup) |
| **Domain** | Point your domain's A record to the VPS public IP |
| **SSH Key** | Add your public key via Hostinger's panel *or* `ssh-copy-id` |
| **MongoDB Atlas** | Free M0 cluster (or self-hosted — see Section 5) |
| **Google Sheets** | Published CSV URLs for each station/pollutant |

### DNS Records (example)

```
A    aqm.yourdomain.com      → <VPS_IP>
A    api.aqm.yourdomain.com  → <VPS_IP>
```

---

## 2. Initial VPS Setup & Hardening

SSH into your VPS as root, then:

```bash
# ── Update system ──
apt update && apt upgrade -y

# ── Create a deploy user (never run the app as root) ──
adduser deploy
usermod -aG sudo deploy

# ── Copy SSH keys to deploy user ──
rsync --archive --chown=deploy:deploy ~/.ssh /home/deploy

# ── Disable root login & password auth ──
sed -i 's/^PermitRootLogin.*/PermitRootLogin no/' /etc/ssh/sshd_config
sed -i 's/^#\?PasswordAuthentication.*/PasswordAuthentication no/' /etc/ssh/sshd_config
systemctl restart sshd

# ── Set timezone ──
timedatectl set-timezone Asia/Manila
```

> From this point, log in as `deploy`:
> ```bash
> ssh deploy@<VPS_IP>
> ```

---

## 3. Install Runtime Dependencies

```bash
# ── Node.js 20 LTS via NodeSource ──
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs

# Verify
node -v   # v20.x
npm -v    # 10.x

# ── Nginx ──
sudo apt install -y nginx

# ── PM2 (process manager) ──
sudo npm install -g pm2

# ── Certbot (SSL) ──
sudo apt install -y certbot python3-certbot-nginx

# ── Build tools (for native npm modules if needed) ──
sudo apt install -y build-essential git
```

---

## 4. Clone & Configure the Project

```bash
# ── Clone repository ──
cd /home/deploy
git clone <YOUR_REPO_URL> air-quality-monitoring
cd air-quality-monitoring

# ── Server setup ──
cd server
cp .env.example .env
nano .env          # Fill in all real values (see below)
npm ci --production

# ── Frontend setup ──
cd ../front-end
cp .env.example .env
nano .env          # Fill in VITE_API_BASE and VITE_SECURE_STORAGE_KEY
npm ci
```

### Server `.env` — Critical Values

```env
PORT=3001
NODE_ENV=production

# Lock CORS to your frontend domain only
CORS_ORIGIN=https://aqm.yourdomain.com

# Rate limiting
RATE_WINDOW_MS=60000
RATE_MAX=120

# MongoDB Atlas connection string
MONGO_URI=mongodb+srv://user:password@cluster.mongodb.net/db-air_quality_monitoring

# Google Sheets CSV URLs
SHEET_PM10_MEYCAUAYAN_URL=https://docs.google.com/spreadsheets/d/.../export?format=csv
# ... (all station URLs)

# Weather API
OWM_API_KEY=your_openweathermap_key

# Email (optional)
EMAIL_USER=your@gmail.com
EMAIL_PASS=your_gmail_app_password
```

### Frontend `.env` — Critical Values

```env
VITE_API_BASE=https://api.aqm.yourdomain.com

# Generate a strong encryption key:
#   openssl rand -base64 32
VITE_SECURE_STORAGE_KEY=YourBase64RandomKeyHere
```

### Secure file permissions

```bash
# Only the deploy user can read .env files
chmod 600 /home/deploy/air-quality-monitoring/server/.env
chmod 600 /home/deploy/air-quality-monitoring/front-end/.env
```

---

## 5. Set Up MongoDB

### Option A: MongoDB Atlas (Recommended)

1. Create a free M0 cluster at [mongodb.com/atlas](https://www.mongodb.com/atlas).
2. Create a database user with a strong password.
3. **Network Access** → Add your VPS IP (or `0.0.0.0/0` for Atlas free tier).
4. Copy the SRV connection string into `MONGO_URI` in `server/.env`.

### Option B: Self-hosted MongoDB on VPS

```bash
# Import MongoDB 7.0 key & repo
curl -fsSL https://pgp.mongodb.com/server-7.0.asc | \
  sudo gpg -o /usr/share/keyrings/mongodb-server-7.0.gpg --dearmor
echo "deb [ signed-by=/usr/share/keyrings/mongodb-server-7.0.gpg ] \
  https://repo.mongodb.org/apt/ubuntu jammy/mongodb-org/7.0 multiverse" | \
  sudo tee /etc/apt/sources.list.d/mongodb-org-7.0.list
sudo apt update && sudo apt install -y mongodb-org

# Start & enable
sudo systemctl start mongod
sudo systemctl enable mongod

# Create app user
mongosh --eval '
  use("db-air_quality_monitoring");
  db.createUser({
    user: "aqm_app",
    pwd: "STRONG_PASSWORD_HERE",
    roles: [{ role: "readWrite", db: "db-air_quality_monitoring" }]
  });
'

# Enable auth in /etc/mongod.conf:
#   security:
#     authorization: enabled
sudo systemctl restart mongod
```

Then set in `server/.env`:
```env
MONGO_URI=mongodb://aqm_app:STRONG_PASSWORD_HERE@127.0.0.1:27017/db-air_quality_monitoring?authSource=db-air_quality_monitoring
```

---

## 6. Build the Frontend

```bash
cd /home/deploy/air-quality-monitoring/front-end
npm run build
# Output: front-end/dist/
```

---

## 7. Configure Nginx

Nginx serves the static frontend and reverse-proxies API requests to the Node server.

```bash
sudo nano /etc/nginx/sites-available/aqm
```

Paste:

```nginx
# ── Frontend (static SPA) ──
server {
    listen 80;
    server_name aqm.yourdomain.com;

    root /home/deploy/air-quality-monitoring/front-end/dist;
    index index.html;

    # Security headers
    add_header X-Content-Type-Options "nosniff" always;
    add_header X-Frame-Options "DENY" always;
    add_header X-XSS-Protection "1; mode=block" always;
    add_header Referrer-Policy "strict-origin-when-cross-origin" always;

    # SPA fallback — all routes serve index.html
    location / {
        try_files $uri $uri/ /index.html;
    }

    # Cache static assets aggressively
    location ~* \.(js|css|png|jpg|jpeg|gif|ico|svg|woff2?)$ {
        expires 30d;
        add_header Cache-Control "public, immutable";
    }

    # Block dotfiles
    location ~ /\. {
        deny all;
    }
}

# ── API reverse proxy ──
server {
    listen 80;
    server_name api.aqm.yourdomain.com;

    # Security headers
    add_header X-Content-Type-Options "nosniff" always;
    add_header X-Frame-Options "DENY" always;

    # Request size limit (matches Express body limit)
    client_max_body_size 1m;

    location / {
        proxy_pass http://127.0.0.1:3001;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        # Timeouts
        proxy_connect_timeout 10s;
        proxy_read_timeout 30s;
        proxy_send_timeout 30s;
    }

    # Block dotfiles
    location ~ /\. {
        deny all;
    }
}
```

Enable and test:

```bash
sudo ln -s /etc/nginx/sites-available/aqm /etc/nginx/sites-enabled/
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t
sudo systemctl reload nginx
```

---

## 8. SSL with Let's Encrypt

```bash
sudo certbot --nginx \
  -d aqm.yourdomain.com \
  -d api.aqm.yourdomain.com \
  --non-interactive \
  --agree-tos \
  -m your@email.com

# Auto-renewal is configured automatically. Verify:
sudo certbot renew --dry-run
```

Certbot automatically updates the Nginx config to redirect HTTP → HTTPS.

---

## 9. PM2 Process Manager

```bash
cd /home/deploy/air-quality-monitoring/server

# Start the API with PM2
pm2 start server.js --name aqm-api --node-args="--max-old-space-size=512"

# Save process list & enable startup on reboot
pm2 save
pm2 startup
# Run the command PM2 prints (sudo env PATH=... pm2 startup ...)
```

### Useful PM2 commands

```bash
pm2 status           # Check running processes
pm2 logs aqm-api     # Tail logs
pm2 restart aqm-api  # Restart after code changes
pm2 monit            # Real-time CPU/memory monitor
```

---

## 10. Firewall Rules

```bash
# Enable UFW
sudo ufw default deny incoming
sudo ufw default allow outgoing
sudo ufw allow ssh
sudo ufw allow 'Nginx Full'    # ports 80 + 443
sudo ufw enable
sudo ufw status verbose

# NOTE: Port 3001 is NOT exposed publicly — Nginx proxies to it internally.
```

---

## 11. Verify Deployment

```bash
# 1. Health check
curl -s https://api.aqm.yourdomain.com/health
# Expected: {"health":"ok","timestamp":...}

# 2. AQI endpoint
curl -s https://api.aqm.yourdomain.com/api/aqi | head -c 200

# 3. Frontend
curl -sI https://aqm.yourdomain.com
# Expected: HTTP/2 200, security headers present

# 4. SSL grade
# Visit: https://www.ssllabs.com/ssltest/analyze.html?d=aqm.yourdomain.com
```

---

## 12. Maintenance & Updates

### Deploy a new version

```bash
cd /home/deploy/air-quality-monitoring
git pull origin main

# Rebuild frontend
cd front-end && npm ci && npm run build

# Restart API
cd ../server && npm ci --production
pm2 restart aqm-api
```

### Log rotation

```bash
pm2 install pm2-logrotate
pm2 set pm2-logrotate:max_size 10M
pm2 set pm2-logrotate:retain 7
```

### Automated backups (MongoDB Atlas)

Atlas handles automated daily backups on paid tiers. For self-hosted:

```bash
# Add to crontab: daily dump at 2 AM
crontab -e
# 0 2 * * * mongodump --uri="mongodb://..." --gzip --out=/home/deploy/backups/$(date +\%F)
```

### OS updates

```bash
sudo apt update && sudo apt upgrade -y
# Reboot if kernel was updated
sudo reboot
```

---

## 13. Security Checklist

| # | Item | Status |
|---|------|--------|
| 1 | SSH key-only login (password auth disabled) | ☐ |
| 2 | Root login disabled | ☐ |
| 3 | App runs as non-root `deploy` user | ☐ |
| 4 | UFW firewall enabled (only 22, 80, 443 open) | ☐ |
| 5 | Port 3001 NOT publicly exposed | ☐ |
| 6 | `.env` files have `chmod 600` permissions | ☐ |
| 7 | `.env` files excluded from Git (`.gitignore`) | ☐ |
| 8 | `CORS_ORIGIN` restricted to frontend domain | ☐ |
| 9 | Rate limiting enabled on API | ☐ |
| 10 | Security headers set (HSTS, X-Frame, nosniff) | ☐ |
| 11 | SSL/TLS via Let's Encrypt (A+ grade) | ☐ |
| 12 | MongoDB uses auth + strong password | ☐ |
| 13 | `VITE_SECURE_STORAGE_KEY` set (not fallback) | ☐ |
| 14 | `NODE_ENV=production` set | ☐ |
| 15 | Gmail uses App Password (not account password) | ☐ |
| 16 | No debug/temp files in repo | ☐ |

---

## 14. Troubleshooting

| Symptom | Likely Cause | Fix |
|---------|-------------|-----|
| `502 Bad Gateway` | Node API not running | `pm2 status` → `pm2 restart aqm-api` |
| `CORS error` in browser | `CORS_ORIGIN` mismatch | Update `server/.env` CORS_ORIGIN to match frontend URL |
| Frontend shows blank page | SPA rewrite missing | Check Nginx `try_files $uri $uri/ /index.html;` |
| `ECONNREFUSED` on :3001 | PM2 not started | `pm2 start server.js --name aqm-api` |
| SSL cert expired | Certbot renewal failed | `sudo certbot renew --force-renewal` |
| MongoDB auth error | Wrong credentials | Check `MONGO_URI` in `.env` vs MongoDB user/pass |
| Rate limit `429` errors | Legitimate traffic spike | Increase `RATE_MAX` in `.env`, `pm2 restart aqm-api` |
| High memory usage | Node memory leak | `pm2 restart aqm-api` (PM2 auto-restarts at limit) |
| Build fails on VPS | Low memory during build | Add swap: `sudo fallocate -l 2G /swapfile && sudo mkswap /swapfile && sudo swapon /swapfile` |
| `permission denied` on .env | File ownership wrong | `chown deploy:deploy .env && chmod 600 .env` |

---

## Quick Reference — File Locations on VPS

```
/home/deploy/air-quality-monitoring/
├── server/
│   ├── .env              ← API secrets (chmod 600)
│   ├── server.js          ← Entry point (PM2 manages)
│   └── data/              ← Workbook + cache
├── front-end/
│   ├── .env              ← Build-time vars (chmod 600)
│   └── dist/             ← Built SPA (Nginx serves)
├── .gitignore
└── VPS_DEPLOYMENT.md     ← This file
```
