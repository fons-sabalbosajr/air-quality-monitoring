/**
 * Central environment-variable loading and constant definitions.
 * All env-derived config is exported from here so other modules
 * never read process.env directly.
 */
require("dotenv").config();
const path = require("path");

const PORT = process.env.PORT || 3001;
const DEFAULT_RELATIVE = path.join(__dirname, "..", "data", "aqi.xlsm");

// ── Cache tuning ──
const CACHE_TTL_MS = Number(process.env.CACHE_TTL_MS || 60_000);
const SHEET_CACHE_TTL_MS = Number(process.env.SHEET_CACHE_TTL_MS || 20_000);
const DISK_CACHE_ENABLED = process.env.DISABLE_DISK_CACHE === "1" ? false : true;
const CACHE_DIR = process.env.CACHE_DIR || path.join(__dirname, "..", "data", ".cache");

// ── OpenWeatherMap ──
const OWM_API_KEY =
  process.env.OWM_API_KEY ||
  process.env.OPENWEATHERMAP_API_KEY ||
  process.env.VITE_OWM_API_KEY ||
  null;

// ── MongoDB ──
const DEFAULT_DB_NAME = "db-air_quality_monitoring";
const MONGO_URI = process.env.MONGO_URI || null;
const MONGO_DB_NAME = (process.env.MONGO_DB_NAME || "").trim() || null;
const SERIES_COLLECTION_NAME = process.env.MONGO_COLLECTION_SERIES || "air_data";
const META_COLLECTION_NAME = process.env.MONGO_COLLECTION_META || `${SERIES_COLLECTION_NAME}_meta`;
const STATION_COLLECTION_NAME = process.env.MONGO_COLLECTION_STATION || "station_meta";

// ── Ingestion schedule ──
const INGEST_CRON = process.env.INGEST_CRON || "*/15 * * * *";
const INGEST_TZ = process.env.INGEST_TZ || undefined;
const INGEST_ON_START = process.env.INGEST_ON_START === "0" ? false : true;

// ── Microsoft Graph / SharePoint ──
const GRAPH_TENANT_ID = process.env.GRAPH_TENANT_ID || null;
const GRAPH_CLIENT_ID = process.env.GRAPH_CLIENT_ID || null;
const GRAPH_CLIENT_SECRET = process.env.GRAPH_CLIENT_SECRET || null;

// ── Station metadata ──
const STATION_LAT = process.env.STATION_LAT || null;
const STATION_LON = process.env.STATION_LON || null;
const STATION_NAME = process.env.STATION_NAME || null;
const STATION_ADDRESS = process.env.STATION_ADDRESS || null;

// ── Email (Gmail SMTP) ──
const EMAIL_USER = process.env.EMAIL_USER || null;
const EMAIL_PASS = process.env.EMAIL_PASS || null;

// ── Maintenance mode ──
/**
 * Returns true when the server is in maintenance mode.
 * Reads process.env at call-time so toggling the env var (via PM2 restart)
 * is reflected immediately without needing a module cache bust.
 */
function isMaintenanceMode() {
  return process.env.MAINTENANCE_MODE === "true";
}

module.exports = {
  PORT,
  DEFAULT_RELATIVE,
  CACHE_TTL_MS,
  SHEET_CACHE_TTL_MS,
  DISK_CACHE_ENABLED,
  CACHE_DIR,
  OWM_API_KEY,
  DEFAULT_DB_NAME,
  MONGO_URI,
  MONGO_DB_NAME,
  SERIES_COLLECTION_NAME,
  META_COLLECTION_NAME,
  STATION_COLLECTION_NAME,
  INGEST_CRON,
  INGEST_TZ,
  INGEST_ON_START,
  GRAPH_TENANT_ID,
  GRAPH_CLIENT_ID,
  GRAPH_CLIENT_SECRET,
  STATION_LAT,
  STATION_LON,
  STATION_NAME,
  STATION_ADDRESS,
  EMAIL_USER,
  EMAIL_PASS,
  isMaintenanceMode,
};
