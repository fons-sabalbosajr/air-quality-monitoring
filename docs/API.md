# API Reference

Base URL: `http://localhost:3001` (development) or the deployed server URL.

All endpoints return JSON unless otherwise noted. CORS is enabled globally.

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

## Workbook Data

### `GET /api/viz-data`

Returns viz-data time-series from the Excel workbook.

| Parameter | Type             | Description                |
| --------- | ---------------- | -------------------------- |
| `yKey`    | query (optional) | Override Y-axis column key |

**Strategy:** MongoDB (when no `yKey`) → Excel workbook.

### `GET /api/pm10-data`

Returns PM10 time-series data. Same strategy as viz-data.

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
