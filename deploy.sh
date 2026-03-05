#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════
# deploy.sh — EMBR3 Air Quality Monitoring  →  Hostinger KVM2
#
# Usage (from your LOCAL machine):
#   bash deploy.sh <VPS_IP> [deploy_user]
#
# Prerequisites on VPS (one-time — see VPS_DEPLOYMENT.md §2-3):
#   • Ubuntu 22/24 LTS with Node 20, Nginx, PM2, Certbot
#   • Non-root user (default: deploy) with sudo & SSH key
#   • .env files already configured on VPS
# ═══════════════════════════════════════════════════════════════
set -euo pipefail

# ── Args ──
VPS_IP="${1:?Usage: bash deploy.sh <VPS_IP> [deploy_user]}"
DEPLOY_USER="${2:-deploy}"
REMOTE="$DEPLOY_USER@$VPS_IP"
APP_DIR="/home/$DEPLOY_USER/air-quality-monitoring"

echo "╔════════════════════════════════════════════════════╗"
echo "║  EMBR3 AQM  →  Deploy to $VPS_IP                 ║"
echo "╚════════════════════════════════════════════════════╝"

# ── 1  Build the frontend locally ──
echo ""
echo "▸ [1/5] Building frontend …"
(cd front-end && npm ci && npm run build)
echo "  ✔ Frontend built → front-end/dist/"

# ── 2  Sync project to VPS (exclude heavy/unneeded dirs) ──
echo ""
echo "▸ [2/5] Syncing project to VPS …"
rsync -azP --delete \
  --exclude='node_modules' \
  --exclude='.git' \
  --exclude='.env' \
  --exclude='.env.*' \
  --exclude='!.env.example' \
  --exclude='server/data/.cache' \
  --exclude='*.stackdump' \
  --exclude='nul' \
  ./ "$REMOTE:$APP_DIR/"
echo "  ✔ Project synced"

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
ssh "$REMOTE" "curl -sf http://127.0.0.1:3001/health || echo '⚠ Health check failed — check pm2 logs aqm-api'"

echo ""
echo "════════════════════════════════════════════════════════"
echo "  ✔ Deployment complete!"
echo "  • Frontend:  https://your-domain.com  (Nginx → dist/)"
echo "  • API:       https://api.your-domain.com  (Nginx → :3001)"
echo "  • Logs:      ssh $REMOTE 'pm2 logs aqm-api'"
echo "════════════════════════════════════════════════════════"
