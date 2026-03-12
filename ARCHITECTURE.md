# System Architecture

## High-Level Overview

The application follows a **two-service architecture**:

```
                    ┌──────────────────────────────────┐
                    │          External APIs            │
                    │  ┌──────────┐  ┌──────────────┐  │
                    │  │Open-Meteo│  │ Google Sheets │  │
                    │  └────┬─────┘  └──────┬───────┘  │
                    │  ┌────┴─────┐  ┌──────┴───────┐  │
                    │  │   OWM    │  │  MS Graph API │  │
                    │  └────┬─────┘  └──────┬───────┘  │
                    └───────┼───────────────┼──────────┘
                            │               │
                    ┌───────▼───────────────▼──────────┐
                    │      Express API Server           │
                    │      (Node.js, port 3001)          │
                    │                                    │
                    │   routes/ ──▶ services/ ──▶ utils/ │
                    │       │                            │
                    │       ▼                            │
                    │   MongoDB Atlas                    │
                    │   (data persistence + backup)      │
                    └──────────────┬─────────────────────┘
                                  │ REST API
                    ┌─────────────▼─────────────────────┐
                    │      React Frontend (SPA)          │
                    │      Vite + Ant Design              │
                    │                                     │
                    │   pages/ ──▶ components/ ──▶ hooks/ │
                    │       │                             │
                    │       ▼                             │
                    │   context/ ──▶ config/               │
                    └─────────────────────────────────────┘
```

## Data Flow

### AQI Data Pipeline

```
Google Sheets (AQMS hourly readings)
        │
        ▼
server/services/googleSheets.js  ──  Fetches CSV from published sheet URLs
        │
        ▼
server/services/aqiCalculator.js  ── Computes AQI from raw concentrations
        │
        ├──▶ MongoDB Atlas (tabularBackup.js)  ── Cached for fast reads
        │
        ▼
server/routes/tabular.js  ──  Serves /api/tabular/:province/:pollutant
        │
        ▼
front-end/hooks/useTabularData.js  ──  Fetches & processes for UI
        │
        ▼
Dashboard / Kiosk / Charts / TabularResults pages
```

### Weather Data Flow

```
Open-Meteo API (free, no key)
        │
        ▼
front-end/hooks/useStationWeather.js
        │
        ├──▶ AqiHeroCard (temperature, humidity, conditions)
        ├──▶ HourlyWeatherCard (24h forecast tiles)
        └──▶ WindMapCard (wind speed, direction overlay)
```

## Frontend Architecture

### Component Hierarchy

```
App.jsx
├── AqiProvider (context)
├── Layout (Ant Design Sider + Header)
│   ├── WeatherBadge (header weather display)
│   └── Navigation Menu
│
├── Dashboard (/)
│   ├── AqiHeroCard
│   │   └── AqiCategoryMeter
│   ├── HourlyWeatherCard
│   ├── HistoricalAqiGraph + WindMapCard (side-by-side)
│   ├── PollutantsCard + IqEarthMapCard (side-by-side)
│   └── AqiCalendar
│
├── Kiosk (/)
│   ├── AqiHeroCard (auto-cycling stations, alphabetically sorted)
│   ├── AqiCategoryMeter
│   ├── HourlyWeatherCard
│   ├── WindMapCard
│   ├── YouTube Embeds
│   └── Agency CTA + Contact Card
│
├── Kiosk + ARTA (/with-arta)
│   ├── (all Kiosk components above)
│   └── ARTA Commercial Break (video + bulletin, route-gated)
│
├── Map (/admin/map)
│   ├── 3D Globe (globe.gl + Three.js)
│   ├── Flat Map (Google Maps embed)
│   ├── Station Detail Modals
│   └── Contact + CTA Section
│
├── Charts (/admin/charts)
│   └── Pm10Chart / VizChart (Recharts)
│
└── TabularResults (/admin/tabular/:province)
    └── Ant Design Table + Export
```

### CSS Architecture

Styles are split into per-component/page CSS files imported directly by each component:

```
src/
├── App.css                          # Global styles, responsive framework, dark mode
├── components/
│   ├── AqiHeroCard.css              # Hero card, sky animation, gauges, weather glass
│   ├── AqiCalendar.css              # Calendar heatmap, day detail modal
│   ├── AqiCategoryMeter.css         # Horizontal segmented AQI meter
│   ├── HourlyWeatherCard.css        # 24h forecast tiles, day separators
│   ├── WindMapCard.css              # Windy.com embed, floating station overlay
│   ├── PollutantsCard.css           # Pollutant grid cards
│   ├── IqEarthMapCard.css           # IQEarth air quality map embed
│   ├── HistoricalAqiGraph.css       # Bar chart legend, tooltip
│   ├── ConnectionErrorCard.css      # Error state display
│   ├── PageLoadingSkeleton.css      # Shimmer loading placeholders
│   └── WeatherBadge.css             # Weather detail modal
├── pages/
│   ├── Dashboard.css                # Dashboard layout, station selector
│   ├── Kiosk.css                    # Full-screen kiosk, carousel, HD display
│   ├── Map.css                      # Globe, flat map, station modals, CTA
│   └── TabularResults.css           # Export modal, tabular overrides
```

### Hooks

| Hook | Purpose |
|------|---------|
| `useStationWeather` | Fetches current weather from Open-Meteo for a lat/lon |
| `useTabularData` | Fetches and processes tabular AQI data from the server |

### Context

| Context | Purpose |
|---------|---------|
| `AqiContext` | Shares AQI category state across components for theming |

## Server Architecture

### Module Structure

```
server/
├── server.js              # Entry point: Express setup, MongoDB init, route registration
├── config/
│   ├── env.js             # Centralised environment variable loading
│   └── sheets.js          # Google Sheets URL mapping per station/pollutant
├── routes/
│   ├── health.js          # Health check endpoints
│   ├── aqi.js             # AQI latest/historical endpoints
│   ├── tabular.js         # Tabular data, backup management, export logging
│   ├── station.js         # Station metadata, weather, forecast
│   ├── email.js           # Email report sending
│   ├── proxy.js           # OWM tile proxy, reverse geocoding
│   └── workbookRoutes.js  # Excel workbook data endpoints
├── services/
│   ├── aqiCalculator.js   # AQI computation from concentrations
│   ├── googleSheets.js    # Google Sheets CSV fetch & parse
│   ├── mongo.js           # MongoDB connection, ingestion, station meta
│   ├── tabularBackup.js   # Scheduled Google Sheets → MongoDB backup
│   ├── workbook.js        # Excel workbook read & cache (ExcelJS)
│   └── emailService.js    # Nodemailer Gmail SMTP sending
└── utils/
    ├── dateUtils.js       # Date parsing & formatting helpers
    ├── fetchUtils.js      # HTTP fetch with timeout & retry
    └── mathUtils.js       # Statistical/math utilities
```

### Data Persistence Strategy

```
Priority 1: MongoDB Atlas (fast, cached)
        │
        │  miss / empty?
        ▼
Priority 2: Google Sheets (authoritative, slower)
        │
        │  unavailable?
        ▼
Priority 3: Excel Workbook (offline fallback)
```

The server uses a tiered approach:
1. **MongoDB** — Pre-cached data from scheduled ingestion (every 15 min)
2. **Google Sheets** — Live data pulled via published CSV URLs
3. **Excel Workbook** — Local or SharePoint-hosted `.xlsm` file as final fallback
