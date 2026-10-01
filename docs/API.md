# API Reference

Base URL: `http://localhost:3001` (development) or the deployed server URL.

All endpoints return JSON unless otherwise noted. CORS is enabled globally.

> **External partners:** the endpoints below are internal to the kiosk/admin
> front-end. Third-party systems must use the API-key-protected, read-only
> **Partner API** under `/api/v1`. Its reference and integration guide live in
> `docs/external-api/` (confidential, git-ignored — obtain from EMB R3).

---

## Partner API (`/api/v1`) — API key required

Read-only, versioned, HTTPS-only. Authenticate with `Authorization: Bearer <key>`.
Partners receive **present and incoming data only** — the latest reading plus a
rolling 48-hour catch-up window (`EXTERNAL_API_RECENT_WINDOW_HOURS`). No
historical export exists. Full reference, integration guide, Power BI guide
and OpenAPI spec: `docs/external-api/` (not in repo).

**Keys are issued per station.** Every key carries an approved-station list
(`api_clients.stations`, required on create). `/stations`, `/latest` and the
hourly push are filtered to that list; calling a per-station endpoint for any
other station returns `403 station_not_allowed`. Issue one key per station
(or per approved set) so access can be granted and revoked station by
station. Keys created before this existed have no `stations` field and are
treated as unrestricted (legacy) — `apiKeys.js list` flags them; restrict
with `apiKeys.js stations <id> --stations …` or revoke and reissue.

| Endpoint | Scope | Description |
| --- | --- | --- |
| `GET /api/v1/ping` | any | Connection test, returns client info, approved `stations` + webhook status |
| `GET /api/v1/stations` | `read:stations` | Approved stations only + freshness |
| `GET /api/v1/latest` | `read:latest` | Latest reading for the key's approved stations (same payload as the hourly push). `?format=emb` returns the EMB-CO shape instead |
| `GET /api/v1/aqi` | `read:latest` | **EMB Central Office shape** (below) for the key's approved stations |
| `GET /api/v1/stations/:station/aqi` | `read:latest` | EMB-CO shape for one station — always a single bare object |
| `GET /api/v1/stations/:station/latest` | `read:latest` | Latest per pollutant at a station (`403 station_not_allowed` if not approved). `?format=emb` supported |
| `GET /api/v1/stations/:station/:pollutant/latest` | `read:latest` | Latest for one dataset |
| `GET /api/v1/stations/:station/:pollutant/recent` | `read:recent` | Rolling 48 h window (`from`, `to`, `limit`≤500, `order`, `validOnly`). `from` is clipped to the window start / key issue date |
| `GET /api/v1/stations/:station/:pollutant/readings` | — | Always `404 not_available` (historical data intentionally not exposed) |

### EMB Central Office payload shape

EMB-CO ingests one flat object per station with string values, so
`services/externalData.js` reshapes the latest payload into:

```json
{
  "status": "success",
  "station_name": "Meycauayan AQMS",
  "reading_value_type": "aqi",
  "data": { "TIMESTAMP": "2026-09-15 08:00:00", "PM10_AQI": "45", "PM25_AQI": "47" }
}
```

- `TIMESTAMP` is `YYYY-MM-DD HH:mm:ss` in **station-local (Asia/Manila) time**.
  It is formatted from `epochMs` with the local date getters, which round-trips
  the sheet's wall-clock value exactly — no timezone conversion is applied.
- `reading_value_type` = `aqi` (default → `PM10_AQI`/`PM25_AQI`) or
  `concentration` (→ `PM10_CONC`/`PM25_CONC`). Set it per request with
  `?reading_value_type=`, or per webhook with `webhook.readingValueType`.
- A measured pollutant with no usable value is `null`; a pollutant the station
  does not measure is absent (Clark and San Fernando have no PM2.5).
- `/aqi` and `?format=emb` emit `status: "error"` on every 4xx/5xx alongside
  the usual `error` / `message`, so one client code path handles both.
- A key approved for **one** station gets the bare object above; a
  multi-station key gets `{ status, reading_value_type, generated_at, count,
  stations: [ … ] }`. The shape is therefore stable per key.

### Hourly push (webhook)

`services/apiPush.js` POSTs the `/latest` payload — narrowed to each client's
approved stations — to every active client with an enabled webhook on
`EXTERNAL_API_PUSH_CRON` (default `15 * * * *`, `INGEST_TZ`).
Formats: `json` (signed envelope — `X-AQM-Signature: sha256=HMAC(secret, ts + "." + body)`),
`emb` (the bare EMB-CO payload above, signed with the same header)
or `powerbi` (bare row array for a Power BI streaming dataset push URL).
3 attempts with 5 s / 30 s backoff on timeout / 5xx / 429; every attempt is
logged to `api_push_logs` (30-day TTL) and the client's `webhook.lastStatus`
/ `consecutiveFailures` are updated.

### Key & webhook management (admin — `X-Admin-Token` required)

| Endpoint | Description |
| --- | --- |
| `GET /api/admin/api-keys` | List issued keys (never returns secrets), plus valid `stations` / scopes / formats / push schedule |
| `POST /api/admin/api-keys` | Issue a key. Body: `{ name, stations: ["clark"], organization?, contactEmail?, scopes?, rateLimitPerMin?, expiresAt?, webhook?: { url, secret?, format?, readingValueType? } }`. `stations` is required. Response includes the plaintext `key` **once**. |
| `DELETE /api/admin/api-keys/:id` | Revoke a key |
| `PUT /api/admin/api-keys/:id/stations` | Replace the approved-station list. Body: `{ stations: ["clark", "zambales"] }` |
| `PUT /api/admin/api-keys/:id/webhook` | Set/replace webhook. Body: `{ url, secret?, format?: "json"\|"emb"\|"powerbi", readingValueType?: "aqi"\|"concentration", enabled? }` |
| `DELETE /api/admin/api-keys/:id/webhook` | Remove webhook |
| `POST /api/admin/api-keys/:id/webhook/test` | Deliver the latest readings now; 502 if the partner endpoint fails |
| `GET /api/admin/api-keys/:id/deliveries?limit=` | Recent push attempts for a key |

CLI equivalent (run from `server/`):

```
node scripts/apiKeys.js create --name "Partner — Clark" --stations clark [--webhook-url … --webhook-secret … --webhook-format json|emb|powerbi] [--webhook-value-type aqi|concentration]
node scripts/apiKeys.js list
node scripts/apiKeys.js revoke <id>
node scripts/apiKeys.js stations <id> --stations clark,zambales   # replace approved stations
node scripts/apiKeys.js webhook <id> --url https://… [--secret …] [--format json|emb|powerbi] [--value-type aqi|concentration] [--disable] | --remove
node scripts/apiKeys.js push [<id>]          # manual / test delivery
node scripts/apiKeys.js deliveries <id>
```

---

## Admin authentication (`/api/admin/auth/*`)

PIN gate for the `/admin` front-end (`routes/admin-auth.js`). A successful
login returns an opaque token the UI stores in `sessionStorage` and sends as
`X-Admin-Token` on every protected call.

| Endpoint | Description |
| --- | --- |
| `GET /api/admin/auth/status` | `{ pinSet }` — whether a PIN has been configured yet |
| `GET /api/admin/auth/session` | Validate the caller's `X-Admin-Token`. `200 { ok: true, expiresAt }` or `401` |
| `POST /api/admin/auth/setup` | First-time PIN + optional recovery e-mail. Body `{ pin, recoveryEmail? }` → `{ token }` |
| `POST /api/admin/auth/verify` | Log in. Body `{ pin }` → `{ token }`, or `401 Incorrect PIN` |
| `POST /api/admin/auth/reset-request` | Mail a 6-digit OTP to the registered recovery address. Body `{ email }`. Always `200` (no e-mail enumeration) |
| `POST /api/admin/auth/reset-confirm` | Body `{ otp, newPin }` |
| `POST /api/admin/auth/logout` | Invalidate the caller's token |

> **Sessions are in-memory** (`_sessions` in `routes/admin-auth.js`), so every
> token dies on process restart — including each deploy. The front-end must
> therefore **revalidate a stored token against `/session` on load** rather
> than trusting it: `AdminPinGate` does this, and `util/adminSession.js`
> centralises the 401 path for the admin pages so a dead token drops the user
> back at the login form instead of rendering an admin shell where every call
> silently 401s.

---

## Health

### `GET /`

Service status check.

**Response:**

```json
{ "service": "aqm-server", "status": "ok" }
```

### `GET /health`

Health check with timestamp.

**Response:**

```json
{ "health": "ok", "timestamp": 1719000000000 }
```

---

## AQI Data

### `GET /api/aqi/latest`

Returns the most recent AQI reading.

**Strategy:** MongoDB → Excel workbook fallback.

**Response:**

```json
{
  "parameter": "PM10",
  "value": 45,
  "category": "Good",
  "time": "2024-06-20T08:00:00.000Z",
  "path": "viz_data",
  "source": "mongo"
}
```

### `GET /api/aqi/last-days`

Returns previous N calendar-day AQI values (excludes today).

| Parameter | Type  | Default | Description           |
| --------- | ----- | ------- | --------------------- |
| `days`    | query | `3`     | Number of days (1–14) |

**Response:**

```json
{
  "days": 3,
  "source": "mongo",
  "data": [
    { "date": "2024-06-19", "value": 52, "category": "Fair" },
    { "date": "2024-06-18", "value": 38, "category": "Good" }
  ]
}
```

---

## Tabular Data

### `GET /api/tabular/:province/:pollutant`

Returns tabular AQI data with computed rolling averages.

| Parameter   | Type | Description                                                                |
| ----------- | ---- | -------------------------------------------------------------------------- |
| `province`  | path | Station province (e.g., `meycauayan`, `zambales`, `clark`, `san-fernando`) |
| `pollutant` | path | Pollutant type (`pm10` or `pm25`)                                          |

**Strategy:** MongoDB backup → Google Sheets fallback.

**Response:**

```json
{
  "province": "meycauayan",
  "pollutant": "pm10",
  "columns": ["Date/Time", "PM10 (µg/m³)", "24h Avg", "AQI", "Category"],
  "rows": [...],
  "totalRows": 720,
  "fetchedAt": "2024-06-20T08:00:00.000Z",
  "source": "backup"
}
```

### `GET /api/backup/status`

Returns freshness info for all backed-up datasets.

**Response:**

```json
{
  "ok": true,
  "datasets": [
    {
      "province": "meycauayan",
      "pollutant": "pm10",
      "rowCount": 720,
      "lastUpdated": "2024-06-20T08:00:00.000Z"
    }
  ]
}
```

### `GET /api/monitoring/health`

Is every station actually updating in real time? One row per configured
dataset, with the newest reading's hour, how far behind now it is, and when the
sheets sync last looked and last saw a change.

Stations report hourly, so one missed hour is normal jitter. State thresholds
(overridable with `MONITOR_LATE_AFTER_MS` / `MONITOR_STALE_AFTER_MS`):

| `state` | Reading age | Meaning |
| --- | --- | --- |
| `ok` | < 2 h | Reporting normally |
| `late` | 2–6 h | A station or its sheet has missed several hours |
| `stale` | > 6 h | Stopped reporting |
| `no_data` | — | Nothing backed up for this dataset |

Status code is **`200`** when every dataset is `ok` and **`207`** otherwise, so
an uptime check that only accepts `200` alerts on a degraded station.

`upstreamGap: true` is the important field: it means this app polled the sheet
within the last 10 minutes but the newest reading is still old — so the sync is
healthy and the gap is **upstream** (the analyser, or whoever writes that
Google Sheet). Without it, a stale station looks like an app bug.

```json
{
  "ok": false,
  "overall": "stale",
  "checkedAt": "2026-10-01T07:45:00.000Z",
  "thresholds": { "lateAfterMinutes": 120, "staleAfterMinutes": 360 },
  "counts": { "ok": 5, "stale": 1 },
  "datasets": [
    {
      "station": "clark", "pollutant": "pm10", "state": "stale",
      "lastReadingAt": "2026-10-01T00:00:00.000Z",
      "lastReadingLocal": "10/01/2026 8:00 AM",
      "readingAgeMinutes": 460, "aqi": 25, "status": "Good", "verified": true,
      "lastCheckedAt": "2026-10-01T07:44:00.889Z", "checkedAgoMinutes": 0,
      "lastBackupAt": "2026-10-01T00:09:05.398Z", "backupAgoMinutes": 451,
      "upstreamGap": true
    }
  ]
}
```

### `GET /api/backup/check/:province/:pollutant`

Checks whether a specific dataset has updates available.

### `POST /api/backup/sync`

Force-triggers a manual backup cycle for all datasets.

**Response:**

```json
{ "ok": true, "results": [...] }
```

### `POST /api/export-log`

Logs a data export event.

| Field             | Type   | Required | Description           |
| ----------------- | ------ | -------- | --------------------- |
| `province`        | string | yes      | Station province      |
| `pollutant`       | string | no       | Pollutant type        |
| `filters`         | object | no       | Applied filters       |
| `totalRecords`    | number | no       | Total rows in dataset |
| `exportedRecords` | number | no       | Rows exported         |
| `filename`        | string | no       | Export filename       |

### `GET /api/export-logs`

Returns recent export log entries.

| Parameter | Type  | Default | Description             |
| --------- | ----- | ------- | ----------------------- |
| `limit`   | query | `100`   | Max entries (up to 500) |

---

## Station

### `GET /api/station/meta`

Returns station metadata.

**Strategy:** MongoDB → environment variables fallback.

**Response:**

```json
{
  "name": "Clark AQMS",
  "address": "Clark Freeport Zone, Pampanga",
  "latitude": 15.177166,
  "longitude": 120.536421,
  "source": "mongo"
}
```

### `GET /api/station/current`

Returns current weather conditions at the station.

**Strategy:** Open-Meteo → OpenWeatherMap fallback.

**Response:**

```json
{
  "latitude": 15.177166,
  "longitude": 120.536421,
  "temperature_2m": 32.4,
  "relative_humidity_2m": 78,
  "pressure_msl": 1010.2,
  "time": "2024-06-20T08:00",
  "units": { "temperature_2m": "°C", "pressure_msl": "hPa" },
  "upstream": "open-meteo"
}
```

### `GET /api/station/forecast`

Returns N-day daily weather forecast.

| Parameter | Type  | Default | Description         |
| --------- | ----- | ------- | ------------------- |
| `days`    | query | `3`     | Forecast days (1–7) |

**Response:**

```json
{
  "latitude": 15.177166,
  "longitude": 120.536421,
  "days": 3,
  "forecast": [
    {
      "date": "2024-06-21",
      "tempMax": 34,
      "tempMin": 26,
      "humidity": 75,
      "pressure": 1009
    }
  ],
  "units": { "temperature": "°C", "pressure": "hPa" }
}
```

---

## Chart Series (`/admin/charts`)

Both series are built from the **MongoDB tabular backup** — the same live
snapshot behind the kiosk, NLEX wall, Data Manager and partner API — by
`services/chartSeries.js`. They follow the once-a-minute Google Sheets sync, so
`/admin/charts` is as current as every other surface.

Shared query parameters:

| Parameter | Default | Description |
| --- | --- | --- |
| `station` | `meycauayan` (`CHARTS_DEFAULT_STATION`) | `meycauayan`, `zambales`, `clark`, `san-fernando` |
| `pollutant` | `pm10` (`CHARTS_DEFAULT_POLLUTANT`) | `pm10`, `pm25` (Clark and San Fernando are PM10-only) |
| `value` | per endpoint | `concentration` (raw hourly µg/Ncm), `rolling` (24-hour rolling average), `aqi` |
| `source` | — | `excel` forces the legacy workbook read instead |
| `yKey` | — | Legacy workbook Y-column override; also forces the workbook read |

An unknown station, a pollutant the station does not measure, or a bad `value`
answers `400` naming the valid options.

**Caching.** Built series are cached for `CHARTS_SERIES_TTL_MS` (default 30 s).
Once cached, a stale hit is returned immediately and the refresh runs in the
background, so polling never blocks on MongoDB. A genuinely cold build is
bounded by `CHARTS_COLD_BUILD_TIMEOUT_MS` (default 20 s — must stay under
Nginx's 30 s `proxy_read_timeout`): the build keeps running and populates the
cache, but the request answers `503 { source: "warming" }` with `Retry-After`
rather than hanging until the proxy returns `504`. `server.js` pre-builds the
default station's series at startup, so the first admin visit is already warm.

### `GET /api/pm10-data`

Hourly series — one point per reading, oldest first. Default `value`:
`concentration`.

```json
{
  "series": [{ "t": 1790834400000, "y": 35, "aqi": 65, "status": "Fair" }],
  "meta": {
    "station": "meycauayan", "stationName": "Meycauayan AQMS",
    "pollutant": "pm10", "pollutantLabel": "PM10", "unit": "µg/Ncm",
    "value": "concentration", "granularity": "hourly", "yLabel": "Hourly Reading",
    "points": 8410,
    "lastReadingAt": "2026-10-01T07:00:00.000Z",
    "updatedAt": "2026-10-01T07:07:01.920Z",
    "lastCheckedAt": "2026-10-01T07:40:00.889Z"
  },
  "source": "tabular-backup"
}
```

### `GET /api/viz-data`

Daily series — one point per calendar day, oldest first, anchored at local
midnight. `y` is the mean of that day's readings and `n` is how many it
averaged, so a partial day is visible rather than silently equal-weighted.
Default `value`: `rolling`.

### `GET /api/chart-targets`

The stations, pollutants and value types the Charts page can select, plus the
configured defaults. The page reads this so a station added to
`config/stations.js` appears without a frontend change.

### `GET /api/viz-data/diagnostics`

Workbook diagnostics: sheet names, row count, detected keys, 3-row sample.

> **Legacy workbook.** `?source=excel` still reads the Excel/SharePoint
> workbook for comparison, and it is used automatically only when `MONGO_URI`
> is unset. It is deliberately not the automatic fallback: that read takes
> several Microsoft Graph round-trips at 25 s each, which outlived Nginx's
> `proxy_read_timeout` and surfaced as a `504`. Its ingested series also
> stopped updating on **2025-11-30**, which is why these endpoints were
> re-pointed at the tabular backup.

### `GET /api/viz-data/diagnostics`

Returns workbook diagnostic info: sheet names, row count, detected keys, and 3-row sample.

---

## Email

### `POST /api/share-email`

Sends an HTML air quality report email via Gmail SMTP.

| Field       | Type   | Required | Description             |
| ----------- | ------ | -------- | ----------------------- |
| `to`        | string | yes      | Recipient email address |
| `province`  | string | yes      | Station province        |
| `pollutant` | string | no       | Pollutant type          |
| `columns`   | array  | no       | Column headers          |
| `rows`      | array  | no       | Data rows               |
| `totalRows` | number | no       | Total row count         |
| `filters`   | object | no       | Applied filters         |

**Response:**

```json
{ "ok": true, "message": "Email sent successfully" }
```

---

## Proxy

### `GET /api/tiles/owm/:layer/:z/:x/:y.png`

Proxied OpenWeatherMap tile. Cached for 5 minutes.

| Parameter     | Values                                                                                |
| ------------- | ------------------------------------------------------------------------------------- |
| `layer`       | `clouds_new`, `precipitation_new`, `rain_new`, `wind_new`, `temp_new`, `pressure_new` |
| `z`, `x`, `y` | Standard map tile coordinates                                                         |

**Returns:** `image/png`

### `GET /api/reverse-geocode`

Reverse-geocodes coordinates to a location name.

| Parameter | Type  | Required |
| --------- | ----- | -------- |
| `lat`     | query | yes      |
| `lon`     | query | yes      |

**Response:**

```json
{
  "name": "Clark",
  "region": "Pampanga",
  "display": "Clark, Pampanga"
}
```
