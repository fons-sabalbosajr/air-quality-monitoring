# CI/CD — GitHub Actions → Hostinger VPS

Workflow: [`.github/workflows/ci-cd.yml`](../.github/workflows/ci-cd.yml) · server step: [`scripts/deploy/remote-deploy.sh`](../scripts/deploy/remote-deploy.sh)

| Trigger | What runs |
|---|---|
| Push to any branch, pull request | **API**: `npm ci`, `node --check` on every file, boot test (`/api/health` with no `.env`), dependency audit (report-only for now). **Front-end**: `npm ci`, ESLint (report-only), build check. |
| Push to `main`, or **Actions → CI/CD → Run workflow** on `main` | Both checks above, then **deploy** that exact build to the VPS (after approval, if the `production` environment requires a reviewer). |

## What a deploy does

1. Builds the release front-end with the production secrets, then packages it with `server/` (no `node_modules`, `.env*`, `data/`) and the commit SHA.
2. On the VPS, `remote-deploy.sh`:
   - **pre-flight** checks (no changes yet): `server/.env` present, Node ≥ 20, PM2 process `aqm-api` exists. It also lists any server files the sync would delete.
   - **backs up** the current server code and web root to `/opt/embr3/air-quality-monitoring/deploy-backups/<timestamp>/` (last 5 kept).
   - syncs the API code, runs `npm ci --omit=dev`, and runs `pm2 restart aqm-api`. That restart touches **only** `aqm-api`; the other apps on the VPS are not touched.
   - **health gate**: `/api/health` must be OK **and** `/api/monitoring/health` must return data read from MongoDB. If either fails, the previous server code is restored and restarted, and the job fails.
   - only after the API is healthy, publishes the new front-end into `front-end/dist` (the Nginx root) and writes `DEPLOYED_REVISION`.
3. **Smoke test** through the production Nginx on the VPS: health, MongoDB read, partner API (`/api/v1/ping` → 401 without a key), and the page serving this run's bundle.

A deploy never touches `server/.env`, `server/data/`, MongoDB data, the Nginx config, or other PM2 apps.

## One-time setup

### 1. Deploy key

Use a dedicated key pair for this repo (it can be revoked on its own):

```bash
ssh-keygen -t ed25519 -N "" -C "github-actions-aqm-deploy" -f aqm_deploy_key
```

Add **`aqm_deploy_key.pub`** to the VPS (hPanel → VPS → Browser terminal). The leading `printf` guards against a last line with no trailing newline:

```bash
printf '\n%s\n' 'PASTE THE ONE-LINE CONTENT OF aqm_deploy_key.pub' >> ~/.ssh/authorized_keys && sed -i '/^$/d' ~/.ssh/authorized_keys && ssh-keygen -lf ~/.ssh/authorized_keys
```

The private key **`aqm_deploy_key`** goes into the `VPS_SSH_KEY` secret below. After that, delete both local files.

### 2. Secrets

Use either **repository secrets** (Settings → Secrets and variables → Actions) or **`production` environment secrets** (Settings → Environments → production). Environment secrets are preferred, because only the approved deploy job can read them, and that job is where the release bundle is built.

This repository is **public**. Credentials go only in Secrets, never in the workflow or the code.

| Secret | Value |
|---|---|
| `VPS_HOST` | `72.61.125.232` |
| `VPS_USER` | `root` |
| `VPS_SSH_KEY` | full content of `aqm_deploy_key`, including the `-----BEGIN/END…-----` lines |
| `VPS_KNOWN_HOSTS` | *(recommended)* output of `ssh-keyscan 72.61.125.232` |
| `VITE_SECURE_STORAGE_KEY` | **required**: a random value, e.g. `node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"`. It's built into the public JS bundle, so it only scrambles browser storage and is **not** a secret. Never reuse a real password for it. Changing it signs admins out once; the kiosk and NLEX screens reload their settings from the server. |
| `VITE_GOOGLE_WEATHER_API_KEY` | *(optional)* |

*Variables* (optional; the defaults match this VPS): `APP_DIR` (`/var/www/air-quality-monitoring`), `WEB_ROOT` (`$APP_DIR/front-end/dist`), `PM2_NAME` (`aqm-api`), `VPS_PORT` (`22`), `PUBLIC_URL` (`https://embr3-onlinesystems.cloud/air-quality-monitoring`).

The server's runtime configuration (Mongo URI, sheet URLs, email…) stays in the VPS `server/.env` and is **not** a GitHub secret.

### 3. Deploy on cue (recommended)

Do this **before the workflow first reaches `main`**: go to **Settings → Environments → New environment**, name it `production`, and add yourself under **Required reviewers**. If no environment exists yet, the first run creates one with no protection and deploys right away. Once it's set up, every push to `main` builds and tests automatically, then **waits for your approval** before it touches the live site. To deploy without a push, use **Actions → CI/CD → Run workflow** on `main`.

## Rollback

- **Re-deploy a known-good commit:** open its successful run in Actions → **Re-run all jobs**. If it has expired, revert the commit on `main`.
- **Restore by hand on the VPS:**
  ```bash
  B=/opt/embr3/air-quality-monitoring/deploy-backups/<timestamp>
  cd /var/www/air-quality-monitoring
  tar -xzf $B/server.tgz -C server && (cd server && npm ci --omit=dev) && pm2 restart aqm-api
  tar -xzf $B/web.tgz -C front-end/dist
  ```

## Notes

- Once CI/CD is in use, don't `git pull` or build on the VPS. The checkout in `/var/www/air-quality-monitoring` is no longer the source of truth; `DEPLOYED_REVISION` is.
- `deploy.sh` (rsync from a local machine) still works as an emergency path, but it skips CI and the health gate.
- Dependency audit: the API lockfile currently has high/critical advisories, so the audit only reports. After `npm audit fix` cleans it, make it blocking by removing `continue-on-error` in the workflow.
