# EMBR3 Air Quality Monitoring Deployment

This project uses a two-service architecture on Render:

1. **aqm-server (Node Web Service)** – Serves API endpoints, reads AQI workbook, provides data.
2. **aqm-frontend (Static Site)** – React + Vite build served as static assets, consuming the server API via `VITE_API_BASE`.

The `render.yaml` blueprint already defines both services.

## 1. Prerequisites
- A GitHub repository containing this code (already present if you are viewing it there).
- (Optional) Excel AQI workbook accessible either:
  - By putting the file at `server/data/aqi.xlsm` and committing.
  - Or by setting `EXCEL_FILE_PATH` to an absolute path on a Render disk or to a public direct-download URL.
- Node 18+ (Render default) is fine for Express 5 and Vite.

## 2. Server Environment Variables
In `render.yaml` we list optional vars. Set as needed in Render dashboard after first deploy:
- `EXCEL_FILE_PATH` – Path or URL to the workbook (leave blank to use `server/data/aqi.xlsm`).
- `STATION_NAME`, `STATION_ADDRESS`, `STATION_LAT`, `STATION_LON` – Used for metadata and weather widgets if consumed.
- `OWM_API_KEY` or `OPENWEATHERMAP_API_KEY` – Needed if you proxy or enrich OpenWeatherMap data.
- `GRAPH_TENANT_ID`, `GRAPH_CLIENT_ID`, `GRAPH_CLIENT_SECRET` – Only if fetching from private SharePoint/OneDrive links.

### Mongo-backed ingestion (new)
To avoid repeatedly downloading the Excel workbook at request time, the server can now persist parsed readings into MongoDB and serve API responses from there.

Required env vars:

| Variable | Description |
| --- | --- |
| `MONGO_URI` | Connection string (SRV works). If you point it at the cluster root, we default to `db-air_quality_monitoring`. |
| `MONGO_DB_NAME` (optional) | Override the database name; default is `db-air_quality_monitoring`. |
| `MONGO_COLLECTION_SERIES` (optional) | Collection for time-series rows. Default: `air_data`. |
| `MONGO_COLLECTION_META` (optional) | Collection storing sheet metadata. Default: `<series>_meta` (so `air_data_meta`). |
| `MONGO_COLLECTION_STATION` (optional) | Collection for station coordinates/address/name. Default: `station_meta`. |
| `INGEST_CRON` (optional) | Cron expression controlling how often the workbook is pulled (default every 15 minutes). |
| `INGEST_TZ` (optional) | Timezone identifier for the cron scheduler (e.g., `Asia/Manila`). |
| `INGEST_ON_START` (optional) | Set to `0` to skip the immediate ingestion run on boot. |

How it works:
1. A background cron task downloads the Excel workbook via OneDrive/Graph using the existing env credentials.
2. The `viz_data` and `PM10` sheets are parsed using the same heuristics as before.
3. Rows are upserted into MongoDB (`sheet + epochMs` unique index) and the sheet metadata (path, yKey, labels) is recorded.
4. Station details (`/api/station/meta`) are persisted once on startup into the station meta collection and served from Mongo when available.
5. The API endpoints (`/api/viz-data`, `/api/pm10-data`, `/api/aqi/latest`, `/api/aqi/last-days`, `/api/station/meta`) pull from MongoDB first and fall back to the workbook/env only if the database is empty or a `yKey` override is requested.

Manual verification steps:

```bash
cd server
npm run dev # starts the API + ingestion cron
```

Watch the console for `[ingest] run startup ok ...` and `[mongo] connected ...`. You can also inspect Mongo directly to confirm the `aq_series` collection is filling up. If you need to disable the cron temporarily, set `INGEST_CRON=0 0 1 1 *` (never) or unset `MONGO_URI`.

The frontend automatically receives `VITE_API_BASE` sourced from the server service URL, so no manual configuration is needed for the API base.

## 3. Deploy via Blueprint (Recommended)
1. Log in to Render and click **New → Blueprint**.
2. Select the repository then choose the root `render.yaml`.
3. Review both services:
   - `aqm-server`: build command `npm ci`, start command `npm start`.
   - `aqm-frontend`: build command `npm ci && npm run build`, publish directory `dist`.
4. Click **Apply**.
5. Once deployed, the frontend will call the server at the injected `VITE_API_BASE`.

## 4. Manual Service Creation (Alternative)
If not using blueprint:
- Create a **Web Service** pointing to rootDir `server`.
  - Build Command: `npm ci`
  - Start Command: `npm start`
- Create a **Static Site** pointing to rootDir `front-end`.
  - Build Command: `npm ci && npm run build`
  - Publish Directory: `front-end/dist` (Render will automatically use rootDir, so just `dist` in the UI).
- Add environment variable `VITE_API_BASE` with the server's URL (e.g., `https://aqm-server.onrender.com`).

## 5. Health & Monitoring
The server now exposes:
- `GET /` → `{ service: 'aqm-server', status: 'ok' }`
- `GET /health` → `{ health: 'ok', timestamp: <ms> }`
Use one of these for Render's optional health check configuration if desired.

## 6. Local Development
Front-end:
```bash
cd front-end
npm install
npm run dev
```
Server:
```bash
cd server
npm install
npm run dev
```
If you disable HTTPS locally (for broader LAN device access), remember geolocation requires secure contexts.

## 7. CORS
`cors()` is enabled with default permissive settings. If you want to restrict origins after deployment, set:
```js
app.use(cors({ origin: process.env.CORS_ORIGIN?.split(',') }))
```
and provide `CORS_ORIGIN` env variable with a comma-separated list of allowed origins.

## 8. Updating
Push changes to `main`; Render auto-deploys (autoDeploy true). To trigger a manual redeploy, use the Render dashboard or push a commit.

## 9. Troubleshooting
| Issue | Cause | Fix |
|-------|-------|-----|
| Frontend 404 on refresh | SPA routes not rewritten | Rewrite rule present in `render.yaml` (/* → /index.html); ensure blueprint used |
| Frontend cannot reach API | Wrong `VITE_API_BASE` or server failed | Check server logs; confirm env var injection; verify server healthy routes |
| Excel file not found | Missing `EXCEL_FILE_PATH` and no file in `data/` | Upload or set variable to a reachable path/URL |
| SharePoint link fails | Not public and no Graph creds | Provide public direct download or configure Graph credentials |

## 10. Next Steps
- Add logging/metrics (e.g., pino or winston) if production.
- Add authentication before exposing sensitive data.
- Configure a custom domain for the static site and adjust CORS origin accordingly.

---
Deployment configuration is centralized in `render.yaml`; adjust there and push for repeatable infra provisioning.
