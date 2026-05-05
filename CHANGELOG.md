# Changelog

All notable changes to the EMBR3 Air Quality Monitoring app are documented here.

---

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
