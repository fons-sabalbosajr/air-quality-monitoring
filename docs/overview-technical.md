# EMBR3 Air Quality Monitoring System
## Technical Overview — Developer & Operator Reference

---

## Background

The **EMBR3 Air Quality Monitoring System** is a full-stack web application built for **EMB Region 3 (Environmental Management Bureau – Central Luzon, Philippines)**. It ingests hourly particulate matter readings from four **Continuous Ambient Air Quality Monitoring Stations (AQMS)**, computes Philippine-standard AQI scores, and exposes that data through a REST API consumed by a React front-end.

The system serves three rendering contexts: a general-public interactive dashboard, a full-screen kiosk carousel, and a portrait-format LED wall display purpose-built for NLEX signage hardware. Each context is independently configurable via a PIN-gated admin panel with server-side settings persistence.

### Monitoring Stations

| Station | Province | Coordinates | Pollutants |
|---|---|---|---|
| Clark AQMS | Clark Freeport Zone, Pampanga | 15.177°N, 120.536°E | PM10 |
| San Fernando AQMS | San Fernando, Pampanga | 15.056°N, 120.644°E | PM10 |
| Meycauayan AQMS | Meycauayan, Bulacan | 14.728°N, 120.958°E | PM10, PM2.5 |
| Zambales AQMS | Santa Cruz, Zambales | 15.775°N, 119.915°E | PM10, PM2.5 |

### Tech Stack Summary

| Layer | Technologies |
|---|---|
| **Frontend** | React 19, Vite 7, Ant Design 5, Recharts 3, Tailwind CSS, globe.gl, Three.js |
| **Backend** | Node.js 18+, Express 5, MongoDB Atlas, ExcelJS, Nodemailer |
| **External APIs** | Open-Meteo, OpenWeatherMap (tile proxy), Nominatim, Google Sheets CSV, Windy.com, IQEarth |
| **Infrastructure** | Hostinger KVM2 VPS, Nginx, PM2, Cloudflare CDN |

---

## Features

### 1. Live AQI Dashboard (`/`)
- **AQI Hero Card** — animated sky background driven by real-time Open-Meteo weather code and cloud cover; day/night aware; supports 7+ weather scenarios (clear, clouds, rain, thunder, snow, fog, overcast).
- **Station selector** — dropdown persists station selection via AES/HMAC-encrypted `localStorage`.
- **Dual-pollutant rendering** — merged stations (Meycauayan, Zambales) render two side-by-side gauges and two `AqiHeroCard` instances from a single API response.
- **AqiCategoryMeter** — SVG arc gauge with gradient fill, animated on value change.
- **HistoricalAqiGraph** — Recharts line/bar chart showing 24-hour rolling averages and daily AQI trends.
- **AqiCalendar** — Day-level heatmap with click-through modal for hourly breakdown.
- **WindMapCard** — Windy.com iframe embed pinned to station coordinates.
- **Stale-data watermark** — Overlay rendered if latest reading timestamp is >7 days old.

### 2. Kiosk Mode (`/embr3-latestaqi`, `/`)
- **Auto-cycling carousel** — alphabetically sorted station list; configurable dwell time (default 25 sec).
- **Warmup prefetch** — sequential `useEffect` chain fetches all station data on mount to pre-warm caches; uses time-gated promises to prevent network flooding.
- **YouTube embed section** — agency messaging loop via `<iframe>` with `autoplay=1&mute=1&loop=1`.
- **Maintenance overlay** — `MaintenanceOverlay` component injected when `kioskSettings.maintenance.enabled` is `true`.

### 3. Kiosk + ARTA Variant (`/with-arta`)
- Same carousel logic as standard kiosk with an interstitial `ARTA` video loop injected every N station rotations.
- Route-gated — `App.jsx` uses `React.lazy()` for code splitting; ARTA variant is a separate lazy chunk.

### 4. NLEX LED Wall (`/nlex`, `/nlex-preview`)
- **Native fallback** — `GET /nlex` serves a lightweight ES5 inline HTML response (`NlexLedWall` native route in Express) for VNNOX signage browser compatibility; no React bundle.
- **Browser preview** — `/nlex-preview` or `?mode=browser` loads the full React `NlexLedWall` component.
- **Dimensions** — 960×1536 px portrait viewport.
- **Grid mode** — 2×2 CSS Grid, all four stations simultaneously.
- **Carousel mode** — absolute-positioned fullscreen card per station, `z-index` cycling driven by `setInterval`.
- **SVG Gauge** — custom gauge: 270° arc, gradient stroke, animated pointer, configurable size (330 px dual / 560 px solo).
- **Spotlight mode** — featured station rendered with expanded description overlay and distinct background treatment.
- **BroadcastChannel sync** — `NlexLedWall` subscribes to `nlex-settings-update` channel; settings changes in `/admin/nlex-settings` propagate instantly via `postMessage` without page reload.
- **Clock granularity** — 1-sec interval in browser preview; 60-sec interval in native mode for VNNOX compat.

### 5. NLEX Admin Settings (`/admin/nlex-settings`)
- Tabs-based UI using Ant Design `<Tabs>` and `<Form>`.
- **Settings schema** — persisted to MongoDB `nlex_settings` collection; served via `GET /api/nlex-settings`.
- **Draft/save pattern** — local React state mirrors server state; mutations staged until user confirms with "Save Changes" (`PUT /api/nlex-settings`).
- **Cross-tab propagation** — on save, broadcasts `nlex-settings-update` event to all open tabs via `BroadcastChannel`.
- Configurable: station visibility, display mode, per-station carousel duration, gauge visibility, spotlight station, theme override (auto/light/dark), AQI description text per band, component visibility (header, subtitle, legend, footer).

### 6. Kiosk Settings (`/admin/kiosk-settings`)
- Same draft/save/broadcast pattern as NLEX settings.
- Persisted to MongoDB `kiosk_settings` collection.
- Configurable: per-station AQI value/timestamp visibility, section toggles (weather, hourly, wind map, carousel, YouTube, contact), cycle interval, maintenance mode (enabled + custom message).

### 7. Map Page (`/admin/map`)
- **globe.gl** 3D globe with `GlobeGL` component; basemap toggle (satellite/streets/dark) via tile URL swap.
- **Google Maps embed** flat map fallback.
- **Sequential weather fetch** — one station per tick (500 ms gap) using a recursive `setTimeout` chain; 5-min refresh interval.
- **Station detail modals** — photo, coordinates, current conditions from `useStationWeather` hook.

### 8. Charts & Tabular Data (`/admin/charts`, `/admin/tabular/:province`)
- **Recharts** bar and line charts rendered from `/api/viz-data` and `/api/pm10-data`.
- **Ant Design `<Table>`** with server-side filtered dataset from `/api/tabular/:province/:pollutant`.
- **CSV export** and **email share** (`POST /api/share-email`).
- **Export logging** — every download/email writes to MongoDB `export_logs` collection.

### 9. Admin Auth (`AdminPinGate`)
- Wraps all `/admin/*` routes in a PIN challenge component.
- On success, `POST /api/admin/verify-pin` returns a signed JWT; stored in AES-encrypted `sessionStorage`.
- Subsequent admin API calls include `Authorization: Bearer <token>` header.

---

## Functions

### AQI Calculation (`server/services/aqiCalculator.js`)
- Implements **DENR DAO 2000-81 / NAAQGV breakpoints** for PM10 and PM2.5.
- Uses linear interpolation: `AQI = ((AQIHigh - AQILow) / (BPHigh - BPLow)) * (Cp - BPLow) + AQILow`
- Separate breakpoint tables for PM10 (µg/m³ 24h avg) and PM2.5 (µg/m³ 24h avg).
- Returns `{ aqi, status, category, color }` per reading.
- **24-hour rolling average** — sliding window computed from hourly rows before calling the breakpoint function.

### Data Ingestion Pipeline
1. **Google Sheets CSV** — `server/services/googleSheets.js` fetches CSV exports from published Google Sheets (one URL per station/pollutant, configured in `server/config/sheets.js`).
2. **CSV Parsing** — auto-detects date, concentration, and pollutant columns; maps to normalized row schema.
3. **AQI Enrichment** — parsed rows passed through `aqiCalculator`; rolling averages attached.
4. **MongoDB Upsert** — enriched rows upserted into per-collection documents keyed by `province + pollutant`.
5. **Scheduled refresh** — `setInterval` at 15-min cadence; startup sync on server boot forces full refresh.
6. **Fallback chain** — MongoDB cache → Google Sheets live fetch → Excel workbook (ExcelJS).

### Weather Integration (`server/routes/station.js`, `front-end/src/hooks/useStationWeather.js`)
- **Open-Meteo API** (free, no auth) — `GET https://api.open-meteo.com/v1/forecast?latitude=X&longitude=Y&...`
- Fetches: `temperature_2m`, `relative_humidity_2m`, `surface_pressure`, `wind_speed_10m`, `wind_direction_10m`, `weathercode`, `uv_index`, `cloudcover`, `apparent_temperature`, plus 24h hourly forecast.
- Weather codes mapped to human-readable labels and background gradient keys.
- **Reverse geocoding** — Nominatim `GET https://nominatim.openstreetmap.org/reverse?lat=X&lon=Y` for place name display.

### Encrypted Storage (`front-end/src/util/secureStorage.js`)
- All `localStorage` / `sessionStorage` writes pass through AES-256-CBC encryption.
- **HMAC-SHA256** integrity tag appended; read operations verify tag before decrypting.
- Encryption key derived from a deployment-time secret (`VITE_STORAGE_SECRET`); fallback to a deterministic app-scoped key.
- Used for: admin token, station selection, NLEX settings cache, kiosk settings cache, NLEX bundle cache.

### Email Service (`server/services/emailService.js`, `server/routes/email.js`)
- **Nodemailer + Gmail SMTP** — transporter configured via `GMAIL_USER` / `GMAIL_APP_PASSWORD` env vars.
- `POST /api/share-email` accepts: `{ to, province, pollutant, data[], filters }`.
- Builds HTML table from filtered dataset rows; sends via `transporter.sendMail()`.
- Export event logged to MongoDB after successful send.

### Excel Workbook Fallback (`server/services/workbook.js`)
- **ExcelJS** reads `.xlsm` workbook from local path or SharePoint URL.
- Provides `GET /api/viz-data` and `GET /api/pm10-data` endpoints as offline data sources.
- `GET /api/viz-data/diagnostics` returns row count, column headers, and sheet names for debugging.

### Proxy & Caching (`server/routes/proxy.js`)
- **OWM tile proxy** — `GET /api/tiles/owm/:layer/:z/:x/:y.png` fetches OpenWeatherMap tile, buffers response, returns with `Cache-Control: max-age=300`.
- Shields the client-side map from direct API key exposure; key stored server-side in `OWM_API_KEY` env var.

---

## Advantages

### Multi-Tier Data Resilience
- Three-layer fallback (MongoDB → Google Sheets → Excel) ensures the API never returns empty-handed; each layer is independently refreshable.
- Startup sync guarantees post-deploy freshness without manual cache invalidation.

### Encrypted Browser Storage
- AES/HMAC-hardened `localStorage` prevents client-side tampering with admin tokens and display configuration.
- Automatic transparent encryption/decryption means no component code needs to handle raw keys.

### Independent Display Mode Architecture
- Dashboard, Kiosk, and NLEX LED wall share a single REST API but maintain completely independent settings schemas, persistence keys, and rendering logic.
- New display modes can be added as new React page components and a new MongoDB settings collection without modifying existing modes.

### Real-Time Admin-to-Display Sync
- `BroadcastChannel` pattern propagates settings changes to all open display tabs/windows in the same browser session instantaneously — no polling required.
- MongoDB persistence ensures changes survive across sessions and devices.

### Dual-Pollutant Abstraction
- Meycauayan and Zambales stations report both PM10 and PM2.5. The API serves these as separate records; the front-end `stations.js` config defines a `merged` flag that triggers dual-gauge rendering in all display modes transparently.
- Existing single-pollutant display components require zero modification.

### Security Posture
- **JWT admin auth** — short-lived tokens; no persistent session cookies.
- **CORS whitelist** — origins restricted per environment via `CORS_ORIGIN` env var.
- **Rate limiting** — per-IP in-memory rate limiter (default 600 req / 60 sec) on all API routes.
- **Security headers** — `helmet`-equivalent headers: CSP, X-Frame-Options (with NLEX iframe carve-out), HSTS, X-Content-Type-Options, Referrer-Policy.
- **No API key exposure** — OWM tiles proxied server-side; Google Sheets accessed via published CSV (no OAuth token in client).

### Lazy Loading & Code Splitting
- `React.lazy()` + `Suspense` for all route-level components; Vite generates per-route chunks.
- Admin routes, NLEX LED wall, and ARTA variant are separate bundles not loaded on initial dashboard paint.

---

## NLEX Featured Overview

### Purpose
The NLEX integration delivers live air quality data from EMB Region 3 onto large-format LED signage boards operated by NLEX along the North Luzon Expressway. The goal is to give motorists ambient awareness of regional air quality without requiring them to interact with a device.

### Architecture

```
Admin Panel (/admin/nlex-settings)
       │
       │  PUT /api/nlex-settings  ──────────►  MongoDB nlex_settings
       │                                              │
       │  BroadcastChannel "nlex-settings-update"     │
       ▼                                              │
/nlex-preview (React NlexLedWall)          GET /api/nlex-settings
       │                                              │
       │  (same React component)                      ▼
/nlex  │  (VNNOX: served as ES5 inline HTML)   /nlex auto-reload
```

### Native Fallback (`/nlex` route)
The VNNOX LED wall browser is a Chromium-based embedded browser with limited ES6+ support. The Express server's `/nlex` route handler detects the native request and responds with a hand-crafted ES5 HTML string (`NlexLedWall` in `server/routes/station.js` or dedicated route) that:
- Embeds all CSS inline (no external stylesheets)
- Uses `XMLHttpRequest` instead of `fetch`
- Avoids ES6 modules, arrow functions in outer scope, and `const`/`let` block declarations where not supported
- Polls `/api/aqi/latest` and `/api/nlex-settings` on a 60-second interval
- Renders station cards with inline SVG gauges

### React Component (`NlexLedWall.jsx`)
Used on `/nlex-preview` and for desktop testing:
- Reads settings from `NlexSettingsContext` (hydrated from `GET /api/nlex-settings` on mount)
- Subscribes to `BroadcastChannel` for real-time config updates
- Manages carousel `activeIndex` state via `useRef`-tracked `setInterval`
- Per-station duration from `settings.carousel.durations[stationKey]` (seconds → ms)
- Animated weather backgrounds resolved from Open-Meteo `weathercode` + `is_day` flag

### Settings Schema (MongoDB `nlex_settings`)
```json
{
  "displayMode": "grid | carousel",
  "stations": {
    "clark":       { "visible": true },
    "sanFernando": { "visible": true },
    "meycauayan":  { "visible": true },
    "zambales":    { "visible": true }
  },
  "carousel": {
    "durations": {
      "clark": 10,
      "sanFernando": 10,
      "meycauayan": 10,
      "zambales": 10
    }
  },
  "gauge": { "visible": true },
  "spotlight": { "enabled": false, "station": "clark" },
  "theme": "auto | light | dark",
  "aqiDescriptions": {
    "good":                   "...",
    "fair":                   "...",
    "unhealthySensitive":     "...",
    "veryUnhealthy":          "...",
    "acutelyUnhealthy":       "...",
    "emergency":              "..."
  },
  "components": {
    "header":    true,
    "datetime":  true,
    "subtitle":  true,
    "legend":    true,
    "footer":    true
  }
}
```

### LED Wall Rendering Specifics
- **Viewport** — forced to 960×1536 px via CSS `width`/`height` on root container; no viewport meta scaling.
- **Font sizes** — station name: 34 px; AQI value: 96 px; category label: 28 px; all sizes set in `px` (not `rem`) for predictable LED rendering.
- **Gauge dimensions** — 330 px (dual-pollutant layout) / 560 px (single-pollutant layout).
- **Dual-pollutant layout** — Meycauayan and Zambales render a two-column flex row with PM10 on the left and PM2.5 on the right inside a single station card.
- **AQI scale legend** — horizontal color bar pinned to card bottom showing all 6 categories with current value indicator.
- **Clock update** — 60-second `setInterval` in native mode (VNNOX compat); 1-second in React preview.

### API Endpoints Used by NLEX Display
| Method | Endpoint | Purpose |
|---|---|---|
| `GET` | `/api/aqi/latest` | Fetch latest readings for all stations |
| `GET` | `/api/nlex-settings` | Fetch current display configuration |
| `PUT` | `/api/nlex-settings` | Update configuration (admin, JWT-protected) |
| `GET` | `/api/station/current` | Fetch current weather (for background) |

---

## API Reference (All Endpoints)

| Method | Path | Auth | Description |
|---|---|---|---|
| `GET` | `/` | — | Service status |
| `GET` | `/health` | — | Health check + timestamp |
| `GET` | `/api/aqi/latest` | — | Latest AQI for all stations |
| `GET` | `/api/aqi/last-days` | — | Rolling N-day AQI history |
| `GET` | `/api/tabular/:province/:pollutant` | — | Full tabular dataset with rolling averages |
| `GET` | `/api/backup/status` | — | Dataset freshness info |
| `GET` | `/api/backup/check/:province/:pollutant` | — | Check if updates available |
| `POST` | `/api/backup/sync` | JWT | Force manual backup cycle |
| `POST` | `/api/export-log` | — | Log export event |
| `GET` | `/api/export-logs` | JWT | Recent export log entries |
| `GET` | `/api/station/meta` | — | Station metadata (name, coords) |
| `GET` | `/api/station/current` | — | Current weather conditions |
| `GET` | `/api/station/forecast` | — | N-day daily forecast |
| `GET` | `/api/viz-data` | — | Viz time-series from workbook |
| `GET` | `/api/pm10-data` | — | PM10 time-series from workbook |
| `GET` | `/api/viz-data/diagnostics` | — | Workbook diagnostics |
| `POST` | `/api/share-email` | — | Send HTML report by email |
| `GET` | `/api/tiles/owm/:layer/:z/:x/:y.png` | — | Proxied OWM map tile |
| `GET` | `/api/reverse-geocode` | — | Nominatim reverse geocode |
| `POST` | `/api/admin/verify-pin` | — | Verify PIN, return JWT |
| `GET` | `/api/nlex-settings` | — | Public NLEX settings |
| `PUT` | `/api/nlex-settings` | JWT | Update NLEX settings |
| `GET` | `/api/kiosk-settings` | — | Public kiosk settings |
| `PUT` | `/api/kiosk-settings` | JWT | Update kiosk settings |

---

## Environment Variables

| Variable | Location | Purpose |
|---|---|---|
| `MONGO_URI` | server | MongoDB Atlas connection string |
| `GMAIL_USER` | server | Gmail account for email sending |
| `GMAIL_APP_PASSWORD` | server | Gmail app password |
| `ADMIN_PIN` | server | Hashed admin PIN for JWT issuance |
| `JWT_SECRET` | server | Secret for signing admin JWTs |
| `OWM_API_KEY` | server | OpenWeatherMap API key (tile proxy) |
| `CORS_ORIGIN` | server | Allowed CORS origin(s) |
| `PORT` | server | Express server port (default 3000) |
| `VITE_API_BASE_URL` | front-end | Backend API base URL |
| `VITE_STORAGE_SECRET` | front-end | Key for AES-encrypted localStorage |
| `VITE_STATION_*_LAT/LON` | front-end | Per-station coordinate overrides |
