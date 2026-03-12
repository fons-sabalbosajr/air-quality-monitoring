# Station Configuration

Stations are configured in `front-end/src/config/stations.js`. This is the **single source of truth** for all AQMS station metadata used across the frontend.

## Station Registry

| Key | Province | Pollutant | Name | Coordinates |
|-----|----------|-----------|------|-------------|
| `meycauayan-pm10` | meycauayan | PM10 | Meycauayan AQMS (PM10) | 14.7276°N, 120.9582°E |
| `meycauayan-pm25` | meycauayan | PM2.5 | Meycauayan AQMS (PM2.5) | 14.7276°N, 120.9582°E |
| `zambales-pm10` | zambales | PM10 | Zambales AQMS (PM10) | 15.7753°N, 119.9155°E |
| `zambales-pm25` | zambales | PM2.5 | Zambales AQMS (PM2.5) | 15.7753°N, 119.9155°E |
| `clark-pm10` | clark | PM10 | Clark AQMS | 15.1772°N, 120.5364°E |
| `san-fernando-pm10` | san-fernando | PM10 | San Fernando AQMS | 15.0565°N, 120.6439°E |

## Adding a New Station

### 1. Backend: Add Google Sheet URL

In `server/.env`, add the published CSV URL:

```env
SHEET_PM10_NEWSTATION=https://docs.google.com/spreadsheets/d/.../export?format=csv
```

In `server/config/sheets.js`, register the mapping:

```js
"newstation": {
  pm10: process.env.SHEET_PM10_NEWSTATION,
},
```

### 2. Frontend: Register Station

In `front-end/src/config/stations.js`, add a new entry to the `STATIONS` array:

```js
{
  key: "newstation-pm10",
  province: "newstation",
  pollutant: "pm10",
  pollutantLabel: "PM10",
  name: "New Station AQMS",
  address: "City, Province",
  lat: Number(env("VITE_STATION_NEWSTATION_LAT", "14.000000")),
  lon: Number(env("VITE_STATION_NEWSTATION_LON", "121.000000")),
},
```

### 3. Frontend: Set Coordinates (Optional Override)

In `front-end/.env`:

```env
VITE_STATION_NEWSTATION_LAT=14.000000
VITE_STATION_NEWSTATION_LON=121.000000
```

## Multi-Pollutant Stations

Stations measuring multiple pollutants (e.g., PM10 + PM2.5) are registered as **separate entries** with the same `province` and location coordinates. The frontend automatically merges them:

- **`getMergedStations()`** — Groups same-province stations into a single entry with combined pollutant labels (e.g., "PM10 & PM2.5"). Used in Dashboard.
- **`getUniqueLocations()`** — Deduplicates by lat/lon for map markers.

### Example: Multi-Pollutant Station

```js
// Two entries with same province + coordinates = merged automatically
{
  key: "meycauayan-pm10",
  province: "meycauayan",
  pollutant: "pm10",
  // ... same lat/lon
},
{
  key: "meycauayan-pm25",
  province: "meycauayan",
  pollutant: "pm25",
  // ... same lat/lon
},
```

In the Dashboard, these appear as a single station "Meycauayan AQMS" with dual gauges showing both PM10 and PM2.5.

## Station Properties

| Property | Type | Description |
|----------|------|-------------|
| `key` | string | Unique identifier (`province-pollutant`) |
| `province` | string | Province slug (matches API path parameter) |
| `pollutant` | string | `pm10` or `pm25` |
| `pollutantLabel` | string | Display label (`PM10` or `PM2.5`) |
| `name` | string | Full station display name |
| `address` | string | Station address/location |
| `lat` | number | Latitude (WGS84) |
| `lon` | number | Longitude (WGS84) |

## Kiosk Station Order

Kiosk stations are automatically **sorted alphabetically by name**. Adding a new station will slot it into the correct position in the auto-rotation sequence without manual ordering.

## ARTA Commercial Break

The ARTA interstitial video is enabled by visiting the `/with-arta` route instead of `/`. This is route-gated, not resolution-gated — use it on the kiosk deployment URL to include branded ARTA content between station rotations.

## API Path Convention

Station data is accessed via:

```
GET /api/tabular/:province/:pollutant
```

Where `:province` and `:pollutant` match the station entry values. Examples:

```
/api/tabular/meycauayan/pm10
/api/tabular/zambales/pm25
/api/tabular/clark/pm10
/api/tabular/san-fernando/pm10
```

## Kiosk Station Cycling

The Kiosk page (`/embr3-latestaqi`) automatically cycles through all stations. Multi-pollutant stations at the same province are merged into a single kiosk slide, just like the Dashboard.
