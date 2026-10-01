# Changelog

All notable changes to the EMBR3 Air Quality Monitoring app are documented here.

---

## [October 1, 2026] — Cloudflare/Nginx caching for build assets

### 🐛 Fixed

#### Hashed build assets shipped with no browser cache policy
- Measured on production: **all 28** JS/CSS chunks returned **no `Cache-Control` header** (2.3 MB raw, ~750 KB Brotli, ~5 s to fetch cold). Earlier the same day they carried `Cache-Control: max-age=14400`, which Cloudflare's zone-wide Browser Cache TTL was injecting — that setting was lost while the shared zone was being reconfigured for `/ocsm`.
- Without it browsers fall back to heuristic freshness from `Last-Modified`, which collapses to near zero right after a deploy — exactly when load is heaviest — and is unreliable on the VNNOX signage browser driving the LED wall.
- `docs/VPS_DEPLOYMENT.md` §5 gained a `location ^~ /air-quality-monitoring/assets/` block sending `public, max-age=31536000, immutable`. Vite fingerprints every filename, so a changed file is a changed URL and this can never serve stale code. Setting it at the origin makes browser caching survive any Cloudflare dashboard change or cache purge.

### 📝 Documentation

#### New §8a — Cloudflare settings this app depends on
- The zone is shared with `/hrpms` and `/ocsm`, and Cloudflare caching settings and Cache Rules are **zone-wide**, so a change for one app silently applies to the others. Records each setting's **actual verified value** rather than a recommendation.
- Browser Cache TTL is pinned to "Respect Existing Headers" by `/ocsm` and cannot be changed, which is why the origin `/assets/` block is mandatory rather than a nice-to-have.
- Brotli has no toggle any more — Cloudflare made it always-on. Verified working (`Content-Encoding: br`), so its absence from the dashboard is expected, not a misconfiguration.
- Documents that the `www` → apex **edge redirect is load-bearing** under Full (Strict): the origin cert's SAN has no `www` entry, so removing the redirect would 526 every `www` request immediately.
- New "Certificate upkeep" subsection: Full (Strict) means the whole server 526s if the Let's Encrypt cert expires or loses its chain. Includes the four diagnostic commands, a `renewal-hooks/deploy` script to reload Nginx automatically, the `fullchain.pem` vs `cert.pem` trap (the most common sudden-526 cause), and Cloudflare Origin CA as a way off the 90-day renewal treadmill.
- States plainly that **a cache purge needs no follow-up action** — the edge repopulates per colo on the next request and a purge cannot cause a 526.
- Adds four terminal checks for asset caching, HTML bypass, API bypass and Brotli.

---

## [October 1, 2026] — Charts re-pointed at the live pipeline + monitoring health

### ✨ New Features

#### `/admin/charts` now reads the live tabular backup
- `/api/pm10-data` (hourly) and `/api/viz-data` (daily) are built by the new `services/chartSeries.js` from the **MongoDB tabular backup** — the same snapshot behind the kiosk, NLEX wall, Data Manager and partner API. The page previously read the Excel/SharePoint workbook series, which stopped updating on **2025-11-30**; it was showing 10-month-old numbers.
- Both endpoints accept `?station=&pollutant=&value=`. `value` is `concentration` (raw hourly µg/Ncm), `rolling` (24-hour rolling average — what the AQI bands classify) or `aqi`. Hourly defaults to `concentration`, daily to `rolling`. An unknown station, a pollutant the station does not measure, or a bad `value` answers `400` naming the valid options.
- Daily points are anchored at local midnight and carry `n`, the number of readings averaged, so a partial day is visible instead of silently equal-weighted. Hourly points carry `aqi` and `status`.
- New `GET /api/chart-targets` lists the selectable stations, pollutants and value types, so a station added to `config/stations.js` appears in the UI without a frontend change.
- The Charts page gained a station + pollutant selector, a manual Refresh, AQI and Status columns on the hourly table, and `n` on the daily table. Chart card titles now name the station and pollutant being plotted. **Charts was also added to the admin sidebar** — the route existed but nothing navigated to it.
- Everything on the page polls at **60 s**, matching the once-a-minute sheets sync (was a 5-minute chart refresh and a fetch-once table).
- The legacy workbook is still reachable with `?source=excel` for comparison, and is used automatically only when `MONGO_URI` is unset.

#### Freshness indicators and a monitoring health endpoint
- New `GET /api/monitoring/health`: one row per dataset with the newest reading's hour, its age, and when the sheets sync last looked and last saw a change. States are `ok` (< 2 h), `late` (2–6 h), `stale` (> 6 h) and `no_data`, tunable with `MONITOR_LATE_AFTER_MS` / `MONITOR_STALE_AFTER_MS`. Returns `200` when every dataset is `ok` and `207` otherwise, so an uptime check that only accepts `200` alerts on a degraded station.
- `upstreamGap: true` distinguishes "this app stopped polling" from "the station's sheet stopped receiving rows" — without it a stalled analyser looks like an app bug.
- New `components/Freshness.jsx` puts a Live / Behind / Stale badge on each chart card and table, showing the newest reading hour, its age, and when the browser last refreshed, with the sync timestamps in a tooltip.

### 🐛 Fixed

#### A cold chart build could still hit the Nginx 504
- Re-pointing introduced a new way to exceed Nginx's 30 s `proxy_read_timeout`: a cold read of 8–10k backup rows. Built series are now cached for `CHARTS_SERIES_TTL_MS` (30 s) with stale-while-revalidate, so a poll never blocks on MongoDB, and a genuinely cold build is bounded by `CHARTS_COLD_BUILD_TIMEOUT_MS` (20 s) — the build continues and populates the cache while the request answers `503 { source: "warming" }` with `Retry-After`. `server.js` pre-builds the default station's series at startup.
- The startup warm-up explicitly bypasses that deadline (`wait: true`): it has no proxy timeout to respect, and aborting a slow first read would leave the cache cold and log a spurious failure. Measured: enrichment is ~27 ms; the cost is entirely the MongoDB read.

#### Chart errors showed a bare status code
- `util/apiClient.js` reported `HTTP 503` for any failure. It now reads the server's own `error`/`message` via `responseToError`, so the card shows the real reason ("still being built", an invalid station) instead of a number.

---

## [October 1, 2026] — EMB-CO payload, admin session validation, Charts 504 fix

### ✨ New Features

#### Partner API: EMB Central Office payload shape
- New `GET /api/v1/aqi` and `GET /api/v1/stations/:station/aqi` return the flat shape EMB Central Office ingests — one object per station with `status`, `station_name`, `reading_value_type` and a `data` block holding `TIMESTAMP`, `PM10_AQI` and `PM25_AQI` as strings.
- `TIMESTAMP` is `YYYY-MM-DD HH:mm:ss` in station-local (Asia/Manila) time, formatted from the reading's epoch with the local date getters so it round-trips the sheet's wall-clock hour without any timezone conversion.
- `?reading_value_type=concentration` swaps the AQI values for the raw hourly µg/Ncm figures (`PM10_CONC` / `PM25_CONC`); `aqi` is the default. An unrecognised value answers `400` listing the allowed ones.
- The same payload is available on the existing endpoints with `?format=emb` (`GET /latest`, `GET /stations/:station/latest`), and as a new `emb` webhook push format — the delivery body is byte-for-byte what `GET /aqi` returns, signed with the usual `X-AQM-Signature`.
- `webhook.readingValueType` (CLI: `--value-type` / `--webhook-value-type`) picks which value an `emb` push carries. `GET /api/v1/ping` now advertises `readingValueTypes`.
- Errors from the EMB-shaped endpoints carry `"status": "error"` alongside the usual `error` / `message`, so a client can branch on `status` for every outcome.
- A pollutant the station measures but has no usable value for is sent as `null` rather than omitted, keeping the field set stable; stations without PM2.5 (Clark, San Fernando) omit `PM25_*` entirely.
- Per-station keys — how EMB-CO keys are issued — always receive the bare station object; a multi-station key receives `{ status, reading_value_type, generated_at, count, stations: [...] }`. The shape never changes for a given key.
- **Nothing existing changed.** Every v1 endpoint, field and push format documented in the 21 September package responds exactly as before.

### 🐛 Fixed

#### Admin login survived a dead session token
- `AdminPinGate` trusted any token it found in `sessionStorage` and rendered the admin shell without checking it. Admin sessions live in memory, so every deploy or `pm2 restart` invalidated them — the UI still looked logged in while every `X-Admin-Token` call answered `401`, with no route back to the login form short of clearing storage.
- Added `GET /api/admin/auth/session`, which validates the caller's token. The gate now revalidates a stored token on load and falls through to the login screen when it is rejected. A network error leaves the token in place so a brief blip does not force a re-login.
- New `front-end/src/util/adminSession.js` centralises the admin token and the `401` path. `AdminTabularManage` uses its `adminFetch` (clears the session and reloads to the gate); the kiosk and NLEX settings contexts clear the dead token without reloading, so a failed background settings save never discards in-progress edits.

#### `/api/pm10-data` returned 504 on the live site
- With no ingested `PM10` series, the route fell through to reading the Excel workbook from SharePoint — several Graph round-trips at 25 s each, which outlives Nginx's 30 s `proxy_read_timeout`. The browser got a `504` after 30 s of hanging and `/admin/charts` never finished loading its Hourly Readings table.
- The workbook fallback is now opt-in: with `MONGO_URI` set and no ingested series, `/api/pm10-data` and `/api/viz-data` answer `503 { error, hint, series: [], source: "unavailable" }` immediately, and `?source=excel` (or `?yKey=`) forces the slow read. Without `MONGO_URI` the workbook is still read directly, as before.

### 🔄 Updated

#### Removed an unreachable route chunk
- `App.jsx` lazy-imported `pages/NlexAdmin` but never routed it — the page is superseded by `NlexSettingsPage` at `/admin/nlex-settings`. The import (and the chunk it shipped) is gone.

#### Documentation
- `docs/external-api/EXTERNAL_API.md`, `INTEGRATION_GUIDE.md` and `openapi.yaml` document the EMB-CO payload, the `emb` push format and `reading_value_type`, with a new endpoint overview table and an EMB-CO integration walkthrough.
- `docs/API.md` gained an **Admin authentication** section (including the new `/session` endpoint and why a stored token must be revalidated) and records the opt-in workbook fallback.

---

## [September 21, 2026] — Partner API: station-scoped keys

### 🔄 Updated

#### Partner API keys are now issued per station
- Every partner API key carries an approved-station list (`api_clients.stations`), required when the key is created (`--stations clark` on the CLI, `stations: [...]` on `POST /api/admin/api-keys`).
- `GET /api/v1/stations` and `GET /api/v1/latest` return only the key's approved stations; `GET /api/v1/stations/:station/...` for any other station answers `403 station_not_allowed`. `GET /api/v1/ping` now reports `client.stations`.
- The hourly push reads the data once per cycle and delivers each webhook client only its approved stations; `api_push_logs` entries record the `stations` delivered.
- New management: `PUT /api/admin/api-keys/:id/stations` and `node scripts/apiKeys.js stations <id> --stations …` replace a key's approved list without reissuing it.
- Keys issued before this change have no station list and remain unrestricted (legacy); `apiKeys.js list` flags them so they can be restricted or revoked and reissued per station.
- Partner docs (`docs/external-api/`, handover zip and messages) updated to describe per-station access.

---

## [June 3, 2026] — NLEX Fallback Rollout, Storage Encryption, and VPS Verification

### ✨ New Features

#### NLEX native fallback rollout
- Plain `/nlex` now serves the lightweight native fallback as the primary LED-wall experience for VNNOX and other older signage browsers.
- The inline fallback in `front-end/index.html` was upgraded to the newer `nf-` visual design so the LED wall and browser fallback preview show the same UI language.
- Added `front-end/public/bplogo.svg` so the inline `/nlex` fallback can load the Bases and Posts logo from a stable public asset path.

#### Browser storage hardening
- Direct browser settings/session values that previously used raw `localStorage` or `sessionStorage` now flow through the AES/HMAC secure storage layer.
- NLEX settings, kiosk settings, admin token persistence, dashboard station selection, and NLEX bundle caching now use the secure store explicitly.

### 🔄 Updated

#### NLEX route boot behavior
- `front-end/src/main.jsx` now leaves plain `/nlex` to the inline ES5 fallback and only loads the heavier React wall for browser preview routes such as `/nlex-preview` or `?mode=browser`.
- The emergency native fallback path in `main.jsx` was aligned with the inline fallback so it no longer creates plaintext local storage entries.

#### Lazy-loading for admin and kiosk data
- `Kiosk.jsx` now warms station data sequentially instead of prefetching all stations in parallel at mount.
- `Map.jsx` now loads multi-station weather progressively rather than issuing one large parallel weather burst.

#### VPS / Nginx deployment path
- Production Nginx guidance now treats `/air-quality-monitoring/nlex` as the canonical LED-wall URL.
- `/air-quality-monitoring/nlex/` now redirects to `/air-quality-monitoring/nlex` instead of duplicating the alias block.
- `/air-quality-monitoring/index.html` now has explicit no-store headers to keep SPA HTML fresh after deploys.

### ✅ Verified

- Front-end production build completed successfully on the VPS on June 3, 2026.
- PM2 restart for `aqm-api` completed successfully after deployment.
- `nginx -t` passed and Nginx reloaded successfully.
- `curl -I https://embr3-onlinesystems.cloud/air-quality-monitoring/nlex` returned `200` with the expected frame/CSP/no-cache headers.
- `curl -I https://embr3-onlinesystems.cloud/air-quality-monitoring/nlex/` returned `301` to the canonical `/nlex` URL.
- `curl -L -I https://embr3-onlinesystems.cloud/air-quality-monitoring/nlex/` resolved to the updated `/nlex` HTML with `cf-cache-status: DYNAMIC`.

## [May 5, 2026] — NLEX LED Wall & Kiosk Settings System

### ✨ New Features

#### NLEX LED Wall Display (`/nlex`)
- **New page** — `NlexLedWall.jsx` / `NlexLedWall.css`  
  960×1536 portrait LED wall display purpose-built for NLEX station screens.
- **Grid mode** — Shows all four stations (Clark, San Fernando, Meycauayan, Zambales) in a 2×2 card layout.
- **Carousel mode** — Fullscreen single-station rotation with per-station duration control.
  - Dual stations (Meycauayan / Zambales) use a side-by-side PM10 + PM2.5 card layout.
  - Solo stations (Clark / San Fernando) use a single centered full-width layout.
  - Carousel content is vertically centered within the tile; AQI scale reference and description are anchored to the bottom.
  - Station labels reduced to a single non-wrapping line.
- **Gauge chart toggle** — `showGaugeChart` setting shows/hides the SVG gauge inside each tile.
  - Dual tiles: gauge at 330 px; solo tiles: gauge at 560 px. AQI value displayed inside gauge.
- **Spotlight mode** — Highlights a featured station with an expanded description overlay.
- **Weather background system** — Animated sky backgrounds driven by real-time weather code and cloud cover:
  - Clear/sunny days: emphasized sun (190 px, strong radial glow, pulsing animation) + soft fair-weather clouds always present.
  - Clouds, rain, thunderstorm, fog, night, and overcast variants.
- **NLEX Settings page** (`/admin/nlex-settings`) — Full Tabs-based admin UI to control:
  - Card display mode (grid / carousel)
  - Stations visible in grid and carousel
  - Carousel rotation duration (per station)
  - Gauge chart visibility
  - Spotlight mode on/off and featured station selection
- **NLEX Settings Context** — `NlexSettingsContext.jsx` persists settings to localStorage and syncs across tabs via `BroadcastChannel`. Changes propagate to the LED wall without a page reload.
- **Server-side NLEX settings persistence** — `server/routes/nlexSettings.js`  
  `GET /api/nlex-settings` (public) / `PUT /api/nlex-settings` (admin-only). Settings stored in MongoDB so LED wall picks up the latest config on any device.

#### Kiosk Settings System (`/admin/kiosk-settings`)
- **New admin page** — `KioskSettingsPage.jsx`  
  Tabs-based settings UI for the public kiosk display at `/` and `/with-arta`.
- **Per-station, per-pollutant toggles:**
  - Show/hide the AQI numeric value for each station's gauge and meter.
  - Show/hide the AQI last-updated timestamp for each station.
- **Section visibility toggles:** Weather card, Hourly forecast, Wind map, Station carousel, YouTube videos, Contact card.
- **Auto-cycle interval** — Controls how long each station is shown in the kiosk carousel (seconds).
- **Maintenance mode** — Enable kiosk maintenance overlay with a custom message.
- **Draft/save workflow** — All edits are staged locally; clicking **Save Changes** commits to localStorage, broadcasts via `BroadcastChannel` to any open kiosk tabs, and persists to MongoDB via the API.
- **Kiosk Settings Context** — `KioskSettingsContext.jsx` with `saveKioskSettings()` helper that writes to localStorage, broadcasts change, and calls `PUT /api/kiosk-settings` if an admin token is present.
- **Server-side kiosk settings persistence** — `server/routes/kioskSettings.js`  
  `GET /api/kiosk-settings` (public) / `PUT /api/kiosk-settings` (admin-only). Stored in MongoDB under `kiosk_settings` collection.

#### Admin Authentication
- **PIN-gated admin access** — `AdminPinGate.jsx`  
  Challenges the user for the admin PIN before granting access to protected admin routes. Issues a short-lived session token stored in `sessionStorage`.
- **Server-side admin auth** — `server/routes/admin-auth.js`  
  `POST /api/admin/verify-pin` validates the PIN and returns a signed token.  
  `requireAdminToken` middleware used by `PUT /api/nlex-settings` and `PUT /api/kiosk-settings`.

#### Admin Pages
- **Admin Logs** (`/admin/logs`) — `AdminLogsPage.jsx`  
  Displays server-side application logs with filtering and auto-refresh.
- **Tabular Data Manager** (`/admin/tabular`) — `AdminTabularManage.jsx`  
  Admin interface for managing tabular/export data backups.
- **NLEX Admin** (`/admin/nlex`) — `NlexAdmin.jsx`  
  Admin dashboard specifically for NLEX operations.

#### Backend Routes
- `server/routes/email.js` — `POST /api/email` for sending notification emails.
- `server/routes/tabular.js` — Tabular data CRUD endpoints.

---

### 🔄 Updated

#### NLEX LED Wall (second pass — "update NLEX view")
- **Weather backgrounds refined:** clear-sky sun pulsing animation (`nlex-sun-pulse-strong`); cloud layer always rendered on clear days with a softer white tint.
- **Carousel layout polish:**
  - Dual-station content fully vertically centered using `margin: auto` on the params block.
  - AQI scale reference and AQI description pinned to the bottom of dual carousel tiles.
  - Station name capped at 34 px / single line (`white-space: nowrap`).
  - Status badge sizes restored to pre-experiment values (34 px dual / 42 px solo).
- **Dead code removed:** `HalfCircleGauge` component (~135 lines) and its helpers (`halfArcPath`, `HALF_ARC`, `HALF_START`) stripped out — the component was replaced entirely by `SvgGauge` in carousel mode.
- **NlexSettingsPage:** merged duplicate `@ant-design/icons` import into a single statement.

#### Kiosk Page (`Kiosk.jsx`)
- Integrated `KioskSettingsContext` so the kiosk display reacts in real time to admin setting changes.
- Per-pollutant AQI value and timestamp visibility now controlled by settings rather than hardcoded.

#### AQI Hero Card (`AqiHeroCard.jsx` / `AqiHeroCard.css`)
- Visual refresh of the AQI hero card displayed in the kiosk and dashboard.
- Improved layout responsiveness and typography sizing.

#### AQI Category Meter (`AqiCategoryMeter.jsx` / `AqiCategoryMeter.css`)
- UI polish pass: updated color band styles, label sizing, and spacing.

#### App Router (`App.jsx`)
- Added lazy-loaded routes:
  - `/admin/kiosk-settings` → `KioskSettingsPage`
  - `/admin/nlex-settings` → `NlexSettingsPage`
  - `/admin/logs` → `AdminLogsPage`
  - `/admin/tabular` → `AdminTabularManage`
  - `/admin/nlex` → `NlexAdmin`
  - `/nlex` → `NlexLedWall`
- Wrapped protected admin routes with `AdminPinGate`.
- `KioskSettingsProvider` wraps kiosk-facing routes.

#### Dashboard (`Dashboard.css`)
- Added supplementary styles to support new card layouts.

#### Server (`server.js`)
- Registered new routes: `/api/kiosk-settings`, `/api/email`, `/api/tabular`.

#### Assets
- Added `front-end/src/assets/bplogo.svg` — Bases and Posts logo used in the NLEX LED wall header.

---

### 🗑 Removed / Cleaned Up
- Removed stale commented-out JSX (`nlex-tile-asof-poll`) from `NlexLedWall.jsx`.
- Removed `HalfCircleGauge` dead component and all related helpers from `NlexLedWall.jsx`.
- Merged duplicate antd icon imports in `NlexSettingsPage.jsx`.

---

_Commits: `4a8796d` (May 5 10:01 +0800) · `347dd3e` (May 5 13:16 +0800)_
