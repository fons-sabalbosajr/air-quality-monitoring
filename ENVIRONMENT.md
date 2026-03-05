# Environment Variables

## Server (`server/.env`)

### Core

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `PORT` | No | `3001` | HTTP server port |
| `EXCEL_FILE_PATH` | No | `server/data/aqi.xlsm` | Path or URL to the AQI Excel workbook |

### Google Sheets (AQI Data Source)

| Variable | Yes | — | Description |
|----------|-----|---|-------------|
| `SHEET_PM10_MEYCAUAYAN` | Yes | — | Published Google Sheets CSV URL for Meycauayan PM10 |
| `SHEET_PM25_MEYCAUAYAN` | Yes | — | Published Google Sheets CSV URL for Meycauayan PM2.5 |
| `SHEET_PM10_ZAMBALES` | Yes | — | Published Google Sheets CSV URL for Zambales PM10 |
| `SHEET_PM25_ZAMBALES` | Yes | — | Published Google Sheets CSV URL for Zambales PM2.5 |
| `SHEET_PM10_CLARK` | Yes | — | Published Google Sheets CSV URL for Clark PM10 |
| `SHEET_PM10_SAN_FERNANDO` | Yes | — | Published Google Sheets CSV URL for San Fernando PM10 |

### MongoDB

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `MONGO_URI` | No | — | MongoDB Atlas connection string (SRV format). Enables data caching. |
| `MONGO_DB_NAME` | No | `db-air_quality_monitoring` | Database name |
| `MONGO_COLLECTION_SERIES` | No | `air_data` | Time-series data collection |
| `MONGO_COLLECTION_META` | No | `air_data_meta` | Sheet metadata collection |
| `MONGO_COLLECTION_STATION` | No | `station_meta` | Station metadata collection |

### Ingestion Schedule

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `INGEST_CRON` | No | `*/15 * * * *` | Cron expression for workbook ingestion (every 15 min) |
| `INGEST_TZ` | No | system TZ | Timezone for cron (e.g., `Asia/Manila`) |
| `INGEST_ON_START` | No | `1` | Set `0` to skip immediate ingestion on boot |

### Cache

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `CACHE_TTL_MS` | No | `60000` | Workbook cache TTL in milliseconds |
| `SHEET_CACHE_TTL_MS` | No | `300000` | Google Sheets cache TTL (5 min) |
| `DISABLE_DISK_CACHE` | No | `0` | Set `1` to disable on-disk caching |
| `CACHE_DIR` | No | `server/data/.cache` | Directory for disk cache files |

### Station Metadata

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `STATION_NAME` | No | — | Default station display name |
| `STATION_ADDRESS` | No | — | Default station address |
| `STATION_LAT` | No | — | Default station latitude |
| `STATION_LON` | No | — | Default station longitude |

### Microsoft Graph API (SharePoint/OneDrive)

Required only if fetching private SharePoint workbooks.

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `GRAPH_TENANT_ID` | No | — | Azure AD tenant ID |
| `GRAPH_CLIENT_ID` | No | — | Azure AD application (client) ID |
| `GRAPH_CLIENT_SECRET` | No | — | Azure AD client secret |

### Weather API

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `OWM_API_KEY` | No | — | OpenWeatherMap API key (for tile proxy) |
| `OPENWEATHERMAP_API_KEY` | No | — | Alias for `OWM_API_KEY` |

### Email (Gmail SMTP)

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `EMAIL_USER` | No | — | Gmail address for sending reports |
| `EMAIL_PASS` | No | — | Gmail App Password (not regular password) |

---

## Frontend (`front-end/.env`)

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `VITE_API_BASE` | Yes | — | Server API URL (e.g., `http://localhost:3001` or deployed URL) |

### Station Coordinate Overrides

Override default station coordinates per deployment:

| Variable | Default |
|----------|---------|
| `VITE_STATION_MEYCAUAYAN_LAT` | `14.727555` |
| `VITE_STATION_MEYCAUAYAN_LON` | `120.958200` |
| `VITE_STATION_ZAMBALES_LAT` | `15.775290` |
| `VITE_STATION_ZAMBALES_LON` | `119.915489` |
| `VITE_STATION_CLARK_LAT` | `15.177166` |
| `VITE_STATION_CLARK_LON` | `120.536421` |
| `VITE_STATION_SAN_FERNANDO_LAT` | `15.056462` |
| `VITE_STATION_SAN_FERNANDO_LON` | `120.643932` |

---

## Example `.env` Files

### `server/.env`

```env
PORT=3001

# Google Sheets published CSV URLs
SHEET_PM10_MEYCAUAYAN=https://docs.google.com/spreadsheets/d/.../export?format=csv
SHEET_PM25_MEYCAUAYAN=https://docs.google.com/spreadsheets/d/.../export?format=csv
SHEET_PM10_ZAMBALES=https://docs.google.com/spreadsheets/d/.../export?format=csv
SHEET_PM25_ZAMBALES=https://docs.google.com/spreadsheets/d/.../export?format=csv
SHEET_PM10_CLARK=https://docs.google.com/spreadsheets/d/.../export?format=csv
SHEET_PM10_SAN_FERNANDO=https://docs.google.com/spreadsheets/d/.../export?format=csv

# MongoDB Atlas
MONGO_URI=mongodb+srv://user:pass@cluster.mongodb.net/db-air_quality_monitoring

# Station metadata
STATION_NAME=Clark AQMS
STATION_ADDRESS=Clark Freeport Zone, Pampanga
STATION_LAT=15.177166
STATION_LON=120.536421
```

### `front-end/.env`

```env
VITE_API_BASE=http://localhost:3001
```
