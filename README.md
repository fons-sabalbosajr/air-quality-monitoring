# EMBR3 Air Quality Monitoring System

Real-time air quality monitoring dashboard for **EMB Region 3** (Central Luzon, Philippines). Tracks PM10 and PM2.5 concentrations from continuous Ambient Air Quality Monitoring Stations (AQMS) across the region.

## Overview

| Feature | Description |
|---------|-------------|
| **Live AQI Dashboard** | Real-time Air Quality Index with animated sky, weather data, and dual-pollutant gauges |
| **Kiosk Mode** | Full-screen auto-cycling display with station carousel (alphabetically sorted) |
| **Kiosk + ARTA** | Kiosk with ARTA commercial break interstitial via `/with-arta` route |
| **NLEX LED-wall Fallback** | Lightweight `/nlex` fallback for VNNOX/older signage browsers, with `/nlex-preview` and `?mode=browser` for full browser preview |
| **Encrypted Storage** | Browser localStorage/sessionStorage are AES-encrypted and HMAC-hashed automatically |
| **3D Globe + Flat Map** | Interactive station visualisation with globe.gl and Google Maps |
| **Historical Data** | Calendar heatmap, bar charts, and tabular results with CSV/email export |
| **Weather Integration** | 24-hour forecast tiles, Windy.com wind maps, real-time temperature/humidity |

## Quick Start

### Prerequisites

- Node.js 18+
- npm
- MongoDB Atlas cluster (optional, for data persistence)

### 1. Clone & Install

```bash
git clone <repo-url>
cd air-quality-monitoring

# Server
cd server
cp .env.example .env   # configure environment variables
npm install

# Frontend
cd ../front-end
npm install
```

### 2. Configure Environment

See [ENVIRONMENT.md](ENVIRONMENT.md) for all environment variables.

### 3. Run Development

```bash
# Terminal 1 — API server
cd server && npm run dev

# Terminal 2 — Frontend dev server
cd front-end && npm run dev
```

Frontend: `http://localhost:5173` | Server: `http://localhost:3001`

### 4. Production Build

```bash
cd front-end && npm run build   # outputs to dist/
cd server && npm start           # production server
```

## Architecture

See [ARCHITECTURE.md](ARCHITECTURE.md) for full system architecture and data flow.

```
┌─────────────────────┐        ┌──────────────────────────────┐
│   React Frontend    │───────▶│      Express API Server       │
│  (Vite + Ant Design)│        │  (Node.js, port 3001)         │
│  Static SPA         │        │                                │
└─────────────────────┘        │  ┌─── Google Sheets API       │
                               │  ├─── MongoDB Atlas            │
                               │  ├─── Microsoft Graph API      │
                               │  ├─── Open-Meteo (weather)     │
                               │  └─── OpenWeatherMap (tiles)   │
                               └──────────────────────────────┘
```

## Documentation

| Document | Description |
|----------|-------------|
| [ARCHITECTURE.md](ARCHITECTURE.md) | System architecture, data flow, component hierarchy |
| [API.md](API.md) | API endpoint reference (18 endpoints) |
| [ENVIRONMENT.md](ENVIRONMENT.md) | Environment variable reference |
| [STATIONS.md](STATIONS.md) | Station configuration and management |
| [VPS_DEPLOYMENT.md](VPS_DEPLOYMENT.md) | Hostinger KVM2 VPS deployment guide |

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | React 19, Vite 7, Ant Design 5, Recharts 3, globe.gl, Three.js |
| Backend | Express 5, ExcelJS, MongoDB driver, Nodemailer |
| Data Sources | Google Sheets, Excel workbooks, Open-Meteo API |
| Deployment | Hostinger KVM2 VPS, Nginx, PM2 |

## Deployment Note

The production `/nlex` route is deployed as a lightweight LED-wall endpoint behind Nginx and Cloudflare. The canonical player URL is `https://embr3-onlinesystems.cloud/air-quality-monitoring/nlex`; `/nlex/` should redirect to it, and fresh deploys should be followed by CDN revalidation for `/air-quality-monitoring/nlex*` and `/air-quality-monitoring/api/*`.

## Philippine AQI Standard (NAAQGV)

| Category | AQI Range | Color |
|----------|-----------|-------|
| Good | 0 – 50 | Green |
| Fair | 51 – 100 | Yellow |
| Unhealthy for Sensitive Groups | 101 – 150 | Orange |
| Very Unhealthy | 151 – 200 | Red |
| Acutely Unhealthy | 201 – 300 | Purple |
| Emergency | 301+ | Maroon |

## License

Internal use — EMB Region 3, DENR Philippines.
