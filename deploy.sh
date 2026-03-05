#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════
# deploy.sh — EMBR3 Air Quality Monitoring → embr3-onlinesystems.cloud
#
# Usage (from your LOCAL machine, inside the project root):
#   bash deploy.sh <VPS_IP> [ssh_user]
#
# Example:
#   bash deploy.sh 72.61.125.232 root
#
# Prerequisites on VPS:
#   • Node 20+, Nginx, PM2 already installed
#   • .env files configured in /var/www/air-quality-monitoring/
#   • Nginx location blocks added (see VPS_DEPLOYMENT.md §5)
# ═══════════════════════════════════════════════════════════════
set -euo pipefail

# ── Args ──
VPS_IP="${1:?Usage: bash deploy.sh <VPS_IP> [ssh_user]}"
SSH_USER="${2:-root}"
REMOTE="$SSH_USER@$VPS_IP"
APP_DIR="/var/www/air-quality-monitoring"

echo "╔════════════════════════════════════════════════════╗"
echo "║  EMBR3 AQM  →  Deploy to $VPS_IP                 ║"
echo "╚════════════════════════════════════════════════════╝"

# ── 1  Build the frontend locally ──
echo ""
echo "▸ [1/5] Building frontend …"
(cd front-end && npm ci && npm run build)
echo "  ✔ Frontend built → front-end/dist/"

# ── 2  Sync project to VPS ──
echo ""
echo "▸ [2/5] Syncing project to VPS …"
rsync -azP --delete \
  --exclude='node_modules' \
  --exclude='.git' \
  --exclude='.env' \
  --exclude='.env.*' \
  --include='.env.example' \
  --exclude='server/data/.cache' \
  --exclude='*.stackdump' \
  --exclude='nul' \
  ./ "$REMOTE:$APP_DIR/"
echo "  ✔ Project synced to $APP_DIR/"

# ── 3  Install server production deps on VPS ──
echo ""
echo "▸ [3/5] Installing server dependencies …"
ssh "$REMOTE" "cd $APP_DIR/server && npm ci --production"
echo "  ✔ Server deps installed"

# ── 4  Restart PM2 process ──
echo ""
echo "▸ [4/5] Restarting PM2 process …"
ssh "$REMOTE" "cd $APP_DIR/server && pm2 restart aqm-api 2>/dev/null || pm2 start server.js --name aqm-api --node-args='--max-old-space-size=512' && pm2 save"
echo "  ✔ API restarted"

# ── 5  Health check ──
echo ""
echo "▸ [5/5] Health check …"
sleep 3
ssh "$REMOTE" "curl -sf http://127.0.0.1:3001/health || echo '⚠ Health check failed — check: pm2 logs aqm-api'"

echo ""
echo "════════════════════════════════════════════════════════"
echo "  ✔ Deployment complete!"
echo ""
echo "  Kiosk:  https://embr3-onlinesystems.cloud/air-quality-monitoring"
echo "  Admin:  https://embr3-onlinesystems.cloud/air-quality-monitoring-admin"
echo "  API:    https://embr3-onlinesystems.cloud/air-quality-monitoring/api/health"
echo "  Logs:   ssh $REMOTE 'pm2 logs aqm-api'"
echo "════════════════════════════════════════════════════════"
