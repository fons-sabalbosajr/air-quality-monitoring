/**
 * Server-side station registry for the external (partner) API.
 *
 * Mirrors front-end/src/config/stations.js. Coordinates can be overridden
 * per deployment with STATION_<PROVINCE>_LAT / _LON env vars (same values
 * the front-end reads as VITE_STATION_<PROVINCE>_LAT / _LON).
 *
 * Only stations that also have a Google Sheet configured in config/sheets.js
 * are exposed by the API (see getAvailableStations()).
 */
const { TABULAR_SHEETS } = require("./sheets");

function coord(envKey, fallback, min, max) {
  const raw = String(process.env[envKey] || process.env[`VITE_${envKey}`] || "").trim();
  if (!raw) return Number(fallback);
  const n = Number(raw);
  return Number.isFinite(n) && n >= min && n <= max ? n : Number(fallback);
}
const lat = (k, f) => coord(k, f, -90, 90);
const lon = (k, f) => coord(k, f, -180, 180);

const POLLUTANT_LABEL = { pm10: "PM10", pm25: "PM2.5" };
const POLLUTANT_UNIT = "µg/Ncm";

const STATIONS = [
  {
    id: "meycauayan",
    name: "Meycauayan AQMS",
    address: "Meycauayan, Bulacan",
    latitude: lat("STATION_MEYCAUAYAN_LAT", "14.727555"),
    longitude: lon("STATION_MEYCAUAYAN_LON", "120.958200"),
  },
  {
    id: "zambales",
    name: "Zambales AQMS",
    address: "Santa Cruz, Zambales",
    latitude: lat("STATION_ZAMBALES_LAT", "15.775290"),
    longitude: lon("STATION_ZAMBALES_LON", "119.915489"),
  },
  {
    id: "clark",
    name: "Clark AQMS",
    address: "Clark Freeport Zone, Pampanga",
    latitude: lat("STATION_CLARK_LAT", "15.177166"),
    longitude: lon("STATION_CLARK_LON", "120.536421"),
  },
  {
    id: "san-fernando",
    name: "San Fernando AQMS",
    address: "San Fernando, Pampanga",
    latitude: lat("STATION_SAN_FERNANDO_LAT", "15.056462"),
    longitude: lon("STATION_SAN_FERNANDO_LON", "120.643932"),
  },
];

/** Pollutants configured (i.e. have a sheet URL) for a station id. */
function configuredPollutants(stationId) {
  const entry = TABULAR_SHEETS[stationId] || {};
  return Object.keys(entry).filter((p) => {
    const v = entry[p];
    return typeof v === "string" ? !!v : !!(v && v.url);
  });
}

/** Stations with at least one configured pollutant, with pollutant list attached. */
function getAvailableStations() {
  return STATIONS.map((s) => ({ ...s, pollutants: configuredPollutants(s.id) })).filter(
    (s) => s.pollutants.length > 0,
  );
}

function getStation(stationId) {
  const id = String(stationId || "").toLowerCase();
  const s = STATIONS.find((x) => x.id === id);
  if (!s) return null;
  return { ...s, pollutants: configuredPollutants(id) };
}

function isPollutantAvailable(stationId, pollutant) {
  const s = getStation(stationId);
  return !!s && s.pollutants.includes(String(pollutant || "").toLowerCase());
}

/** Key used for this station/pollutant in the air_data time-series collection. */
function seriesKey(stationId, pollutant) {
  return `${stationId}_${pollutant}`;
}

module.exports = {
  STATIONS,
  POLLUTANT_LABEL,
  POLLUTANT_UNIT,
  getAvailableStations,
  getStation,
  isPollutantAvailable,
  seriesKey,
};
