/* Simple Express server to expose viz_data from an Excel workbook.
 * Configure the Excel location via environment:
 *   - EXCEL_FILE_PATH=D:/path/to/CLARK AQMS AQI.xlsm
 *   - or place the file at ./data/aqi.xlsm relative to this server and omit the env var
 */
require("dotenv").config();
const express = require("express");
const cors = require("cors");
const path = require("path");
const fs = require("fs");
const XLSX = require("xlsx");
const cron = require("node-cron");
const { MongoClient } = require("mongodb");
const https = require("https");
const http = require("http");

const app = express();
app.use(cors());
app.use(express.json());

// Basic health & root info endpoints for deployment platforms (e.g., Render)
app.get("/", (req, res) => {
  res.status(200).json({ service: "aqm-server", status: "ok" });
});
app.get("/health", (req, res) => {
  res.status(200).json({ health: "ok", timestamp: Date.now() });
});

const PORT = process.env.PORT || 3001;
const DEFAULT_RELATIVE = path.join(__dirname, "data", "aqi.xlsm");

// --- Tabular (Google Sheets) configuration ---
const SHEET_CACHE_TTL_MS = Number(process.env.SHEET_CACHE_TTL_MS || 300000);
const TABULAR_SHEETS = {
  meycauayan: {
    pm10: process.env.SHEET_PM10_MEYCAUAYAN_URL || null,
  },
  zambales: {
    pm10: process.env.SHEET_PM10_ZAMBALES_URL || null,
    pm25: process.env.SHEET_PM25_ZAMBALES_URL || null,
  },
  clark: {
    pm10: process.env.SHEET_PM10_CLARK_URL || null,
  },
  "san-fernando": {
    pm10: process.env.SHEET_PM10_SAN_FERNANDO_URL || null,
  },
};

const _sheetCache = new Map(); // key -> { ts, payload }

function extractSpreadsheetId(url) {
  if (!url) return null;
  const s = String(url);
  const m = s.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
  return m ? m[1] : null;
}

/**
 * Download the spreadsheet as XLSX (gets ALL worksheet tabs at once),
 * merge rows from year-named data tabs (e.g. "2025", "2026"),
 * skip utility tabs like "CHARTS", "Live_Dashboard", etc.
 */
async function fetchAllSheetsAsTable(sheetUrl) {
  const id = extractSpreadsheetId(sheetUrl);
  if (!id) throw new Error("Cannot extract spreadsheet ID from URL");

  const xlsxUrl = `https://docs.google.com/spreadsheets/d/${id}/export?format=xlsx`;

  // Download as binary buffer with timeout guard
  let buf;
  const DOWNLOAD_TIMEOUT_MS = 60000;
  if (typeof fetch === "function") {
    const controller = new AbortController();
    const tId = setTimeout(() => controller.abort(), DOWNLOAD_TIMEOUT_MS);
    try {
      const res = await fetch(xlsxUrl, {
        method: "GET",
        redirect: "follow",
        headers: { "User-Agent": "aqm-server/1.0", Accept: "*/*" },
        signal: controller.signal,
      });
      clearTimeout(tId);
      if (!res.ok) throw new Error(`XLSX download HTTP ${res.status}`);
      buf = Buffer.from(await res.arrayBuffer());
    } catch (fetchErr) {
      clearTimeout(tId);
      throw new Error(`XLSX download failed: ${fetchErr.message}`);
    }
  } else {
    // Fallback: use fetchText-style redirect handling but collect binary
    buf = await new Promise((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error("XLSX download timeout")),
        DOWNLOAD_TIMEOUT_MS,
      );
      const u = new URL(xlsxUrl);
      const lib = u.protocol === "http:" ? http : https;
      const doReq = (reqUrl, left) => {
        const uu = new URL(reqUrl);
        lib
          .get(
            {
              hostname: uu.hostname,
              path: uu.pathname + uu.search,
              headers: { "User-Agent": "aqm-server/1.0" },
            },
            (res) => {
              if (
                [301, 302, 303, 307, 308].includes(res.statusCode) &&
                res.headers.location &&
                left > 0
              ) {
                doReq(new URL(res.headers.location, uu).toString(), left - 1);
                return;
              }
              const chunks = [];
              res.on("data", (d) => chunks.push(d));
              res.on("end", () => {
                clearTimeout(timer);
                resolve(Buffer.concat(chunks));
              });
            },
          )
          .on("error", (e) => {
            clearTimeout(timer);
            reject(e);
          });
      };
      doReq(xlsxUrl, 5);
    });
  }

  let wb;
  try {
    wb = XLSX.read(buf, { type: "buffer" });
  } catch (parseErr) {
    throw new Error(`XLSX parse failed: ${parseErr.message}`);
  }
  if (!wb || !wb.SheetNames || !wb.SheetNames.length) {
    throw new Error("XLSX workbook has no sheets");
  }

  // Identify data tabs: keep only tabs whose name looks like a year (e.g. "2025", "2026")
  const dataSheetNames = wb.SheetNames.filter((n) => /^\d{4}$/.test(n.trim()));
  if (!dataSheetNames.length) {
    // Fallback: if no year-named tabs, use the first tab
    dataSheetNames.push(wb.SheetNames[0]);
  }
  // Sort year tabs chronologically so oldest data is first (important for rolling avg)
  dataSheetNames.sort((a, b) => Number(a) - Number(b));

  let columns = null;
  let allRows = [];

  // We only keep raw data columns: Date/Time and Concentration.
  // Everything else (Rolling Average, AQI & Category, Status) is computed in-app.
  const RAW_COL_PATTERNS = [/date|time/i, /concentration/i];

  for (const name of dataSheetNames) {
    const ws = wb.Sheets[name];
    if (!ws) continue; // safety: skip if sheet object missing
    let matrix;
    try {
      matrix = XLSX.utils.sheet_to_json(ws, {
        header: 1,
        raw: false,
        defval: null,
      });
    } catch (sheetErr) {
      console.warn(`[tabular] Skipping sheet "${name}": ${sheetErr.message}`);
      continue;
    }
    if (!matrix || !matrix.length) continue;

    const headerRow = (matrix[0] || []).map((h, idx) => {
      const v = (h == null ? "" : String(h)).trim();
      return v || `Column ${idx + 1}`;
    });

    // On first sheet, determine which column indices contain raw data
    if (!columns) {
      columns = headerRow.filter((h) =>
        RAW_COL_PATTERNS.some((p) => p.test(h)),
      );
      // If none matched, fall back to all columns
      if (!columns.length) columns = headerRow;
    }

    // Build index map for raw columns within the full header
    const colIndices = columns.map((c) => headerRow.indexOf(c));

    const rows = matrix
      .slice(1)
      .filter(
        (r) =>
          Array.isArray(r) &&
          r.some((c) => c != null && String(c).trim() !== ""),
      )
      .map((r) => {
        const obj = {};
        for (let ci = 0; ci < columns.length; ci++) {
          const idx = colIndices[ci];
          obj[columns[ci]] = idx >= 0 ? (r[idx] ?? null) : null;
        }
        return obj;
      });

    allRows = allRows.concat(rows);
  }

  return { columns: columns || [], rows: allRows };
}

// --- Date utilities for Excel serial numbers & DD/MM/YYYY strings ---
function excelSerialToDate(serial) {
  // Excel epoch: 1900-01-01 = serial 1, with Lotus 1-2-3 leap year bug
  return new Date(Math.round((serial - 25569) * 86400000));
}

function parseDateValue(v) {
  try {
    if (v == null) return null;
    if (typeof v === "number" && isFinite(v) && v > 30000 && v < 100000) {
      return excelSerialToDate(v);
    }
    const s = String(v).trim();
    if (!s) return null;
    // DD/MM/YYYY H:MM or DD/MM/YYYY HH:MM
    const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})\s+(\d{1,2}):(\d{2})$/);
    if (m) {
      const d = new Date(
        Number(m[3]),
        Number(m[2]) - 1,
        Number(m[1]),
        Number(m[4]),
        Number(m[5]),
      );
      return isNaN(d.getTime()) ? null : d;
    }
    // MM/DD/YYYY H:MM AM/PM (already formatted, re-parse)
    const m2 = s.match(
      /^(\d{1,2})\/(\d{1,2})\/(\d{4})\s+(\d{1,2}):(\d{2})\s*(AM|PM)$/i,
    );
    if (m2) {
      let h = Number(m2[4]);
      const ampm = m2[6].toUpperCase();
      if (ampm === "PM" && h < 12) h += 12;
      if (ampm === "AM" && h === 12) h = 0;
      const d = new Date(
        Number(m2[3]),
        Number(m2[1]) - 1,
        Number(m2[2]),
        h,
        Number(m2[5]),
      );
      return isNaN(d.getTime()) ? null : d;
    }
    const d = new Date(s);
    return isNaN(d.getTime()) ? null : d;
  } catch {
    return null;
  }
}

const MONTH_ABBR = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

function formatDateAmPm(d) {
  if (!d || isNaN(d.getTime())) return "";
  const mon = MONTH_ABBR[d.getMonth()];
  const dd = String(d.getDate()).padStart(2, "0");
  const yyyy = d.getFullYear();
  let h = d.getHours();
  const min = String(d.getMinutes()).padStart(2, "0");
  const ampm = h >= 12 ? "PM" : "AM";
  h = h % 12 || 12;
  return `${mon} ${dd}, ${yyyy} ${h}:${min} ${ampm}`;
}

function coerceNumber(v) {
  if (v == null) return null;
  if (typeof v === "number" && isFinite(v)) return v;
  const s = String(v).trim();
  if (!s) return null;
  const cleaned = s.replace(/[, ]/g, "");
  const n = parseFloat(cleaned);
  return isFinite(n) ? n : null;
}

function meanLast(values, windowSize) {
  if (!Array.isArray(values) || values.length === 0) return 0;
  const slice = values.slice(Math.max(0, values.length - windowSize));
  const sum = slice.reduce((a, b) => a + b, 0);
  return slice.length ? sum / slice.length : 0;
}

function phPm10Status24hFromAvg(C) {
  // DENR DAO 2000-81 breakpoints (as provided by user)
  const bp = [
    { clo: 0, chi: 54, ilo: 0, ihi: 50, status: "Good" },
    { clo: 55, chi: 154, ilo: 51, ihi: 100, status: "Fair" },
    {
      clo: 155,
      chi: 254,
      ilo: 101,
      ihi: 150,
      status: "Unhealthy for Sensitive Groups",
    },
    { clo: 255, chi: 354, ilo: 151, ihi: 200, status: "Very Unhealthy" },
    { clo: 355, chi: 424, ilo: 201, ihi: 300, status: "Acutely Unhealthy" },
    { clo: 425, chi: 9999, ilo: 301, ihi: 500, status: "Emergency" },
  ];
  if (!isFinite(Number(C)) || Number(C) < 0) return { aqi: null, status: "" };
  const c = Number(C);
  for (const b of bp) {
    if (c <= b.chi) {
      const aqi = ((b.ihi - b.ilo) / (b.chi - b.clo)) * (c - b.clo) + b.ilo;
      return { aqi: Math.round(aqi), status: b.status };
    }
  }
  return { aqi: 500, status: "Emergency" };
}

function phPm25Status24hFromAvg(C) {
  // Philippine DENR breakpoints for PM2.5 (24-hour average)
  const bp = [
    { clo: 0, chi: 25, ilo: 0, ihi: 50, status: "Good" },
    { clo: 25.1, chi: 35, ilo: 51, ihi: 100, status: "Fair" },
    {
      clo: 35.1,
      chi: 45,
      ilo: 101,
      ihi: 150,
      status: "Unhealthy for Sensitive Groups",
    },
    { clo: 45.1, chi: 55, ilo: 151, ihi: 200, status: "Very Unhealthy" },
    { clo: 55.1, chi: 90, ilo: 201, ihi: 300, status: "Acutely Unhealthy" },
    { clo: 90.1, chi: 9999, ilo: 301, ihi: 500, status: "Emergency" },
  ];
  if (!isFinite(Number(C)) || Number(C) < 0) return { aqi: null, status: "" };
  const c = Number(C);
  for (const b of bp) {
    if (c <= b.chi) {
      const aqi = ((b.ihi - b.ilo) / (b.chi - b.clo)) * (c - b.clo) + b.ilo;
      return { aqi: Math.round(aqi), status: b.status };
    }
  }
  return { aqi: 500, status: "Emergency" };
}

/**
 * Multi-pass enhancement for tabular data:
 * 1. Parse ALL dates (Excel serial / DD-MM-YYYY strings) → epochs
 * 2. Sort chronologically (oldest-first) — CRITICAL because sheets mix
 *    string dates and serial numbers in non-chronological order
 * 3. Compute 24h rolling average + AQI + Status on properly ordered data
 * 4. Format dates → MM/DD/YYYY H:MM AM/PM
 * 5. Reverse to newest-first for display
 */
function enhanceTabularRows(table, pollutantKey, opts = {}) {
  try {
    return _enhanceTabularRowsImpl(table, pollutantKey, opts);
  } catch (err) {
    console.error(`[enhanceTabularRows] Unexpected error: ${err.message}`);
    // Return the raw table rather than crashing — data shows without AQI
    return table || { columns: [], rows: [] };
  }
}

function _enhanceTabularRowsImpl(table, pollutantKey, opts = {}) {
  const logsPerHour = Number(opts.logsPerHour || 1);
  const requiredLogs = 24 * logsPerHour;
  const statusFn =
    pollutantKey === "pm25" ? phPm25Status24hFromAvg : phPm10Status24hFromAvg;

  const columns = Array.isArray(table?.columns) ? [...table.columns] : [];
  const rows = Array.isArray(table?.rows) ? table.rows : [];
  if (!rows.length) return table || { columns: [], rows: [] };

  // Identify key columns once
  const dateKey =
    columns.find((c) => /date|time/i.test(c)) ||
    Object.keys(rows[0] || {}).find((k) => /date|time/i.test(k));
  const concKey =
    columns.find((c) => /concentration/i.test(c)) ||
    Object.keys(rows[0] || {}).find((k) => /concentration/i.test(k));
  const rollingKey =
    columns.find((c) => /rolling\s*average/i.test(c)) || "Rolling Average";
  // Identify (and later remove) the original "AQI & Category" column from the sheet
  const aqiCatKey =
    columns.find((c) => /aqi/i.test(c) && /category/i.test(c)) || null;

  // ── Pass 1: Parse all dates → epoch timestamps ──
  const epochs = new Array(rows.length);
  for (let i = 0; i < rows.length; i++) {
    if (dateKey) {
      const d = parseDateValue(rows[i][dateKey]);
      epochs[i] = d ? d.getTime() : 0;
    } else {
      epochs[i] = 0;
    }
  }

  // ── Pass 2: Sort CHRONOLOGICALLY (oldest-first) ──
  // Sheets mix string dates and serial numbers in non-chronological order,
  // so we MUST sort before computing rolling averages.
  const chronoIndices = Array.from({ length: rows.length }, (_, i) => i);
  chronoIndices.sort((a, b) => epochs[a] - epochs[b]);

  // ── Pass 2b: Remove future-dated rows ──
  // Google Sheets may have formula-generated rows extending far into the future.
  // Filter those out so only past/present data is processed.
  const nowMs = Date.now();
  const validIndices = chronoIndices.filter(
    (i) => epochs[i] === 0 || epochs[i] <= nowMs,
  );

  // ── Pass 3: Compute rolling avg + AQI + format dates on chrono-sorted data ──
  const numericSeen = [];
  const resultRows = new Array(validIndices.length);

  for (let pos = 0; pos < validIndices.length; pos++) {
    const origIdx = validIndices[pos];
    const r = rows[origIdx];

    // Format date
    if (dateKey) {
      const d = epochs[origIdx] ? new Date(epochs[origIdx]) : null;
      if (d) r[dateKey] = formatDateAmPm(d);
    }

    // Rolling avg + AQI + Status
    if (concKey) {
      const n = coerceNumber(r[concKey]);
      // Sensor sentinel values (>= 9999, e.g. 99999.9) are kept for display
      // but excluded from the rolling average so they don't skew AQI.
      const isSentinel = n != null && n >= 9999;
      if (n != null && !isSentinel) numericSeen.push(n);

      const avg24h = numericSeen.length
        ? meanLast(numericSeen, requiredLogs)
        : 0;
      r[rollingKey] = avg24h;

      if (numericSeen.length < requiredLogs) {
        r["AQI"] = null;
        r["Status"] = `Collecting (${numericSeen.length}/${requiredLogs})`;
      } else {
        const { aqi, status } = statusFn(avg24h);
        r["AQI"] = aqi;
        r["Status"] = status;
      }
      // Remove original AQI & Category value from row
      if (aqiCatKey) delete r[aqiCatKey];
    }

    // Store in reverse position (newest-first)
    resultRows[validIndices.length - 1 - pos] = r;
  }

  // Remove original AQI & Category column, add computed fields
  const filteredColumns = columns.filter((c) => c !== aqiCatKey);
  const ensureCol = (c) => {
    if (!filteredColumns.includes(c)) filteredColumns.push(c);
  };
  if (concKey) {
    ensureCol(rollingKey);
    ensureCol("AQI");
    ensureCol("Status");
  }

  return { ...table, columns: filteredColumns, rows: resultRows };
}

async function getTabularTable(provinceKey, pollutantKey) {
  const sheetUrl = TABULAR_SHEETS?.[provinceKey]?.[pollutantKey] || null;
  if (!sheetUrl) {
    const err = new Error("Sheet URL not configured");
    err.code = "NOT_CONFIGURED";
    throw err;
  }
  const cacheKey = `tabular:${provinceKey}:${pollutantKey}`;
  const cached = _sheetCache.get(cacheKey);
  if (cached && Date.now() - cached.ts < SHEET_CACHE_TTL_MS) {
    return { ...cached.payload, source: "cache" };
  }

  // Download XLSX (all worksheet tabs) and merge year-based data tabs.
  // On failure, fall back to stale cache if available so the app stays up.
  try {
    let table = await fetchAllSheetsAsTable(sheetUrl);
    table = enhanceTabularRows(table, pollutantKey, { logsPerHour: 1 });
    const payload = {
      province: provinceKey,
      pollutant: pollutantKey,
      columns: table.columns,
      rows: table.rows,
      totalRows: table.rows.length,
      fetchedAt: Date.now(),
      source: "sheet",
    };
    _sheetCache.set(cacheKey, { ts: Date.now(), payload });
    return payload;
  } catch (fetchErr) {
    console.error(
      `[tabular] Error fetching ${provinceKey}/${pollutantKey}: ${fetchErr.message}`,
    );
    // Serve stale cached data if we have any, rather than failing entirely
    if (cached) {
      console.warn(
        `[tabular] Serving stale cache for ${provinceKey}/${pollutantKey} ` +
          `(age ${Math.round((Date.now() - cached.ts) / 1000)}s)`,
      );
      return { ...cached.payload, source: "stale-cache" };
    }
    // No cache at all — re-throw
    throw fetchErr;
  }
}
// OpenWeatherMap API key (multiple possible env variable names including Vite prefix)
const OWM_API_KEY =
  process.env.OWM_API_KEY ||
  process.env.OPENWEATHERMAP_API_KEY ||
  process.env.VITE_OWM_API_KEY ||
  null;

// Mongo + ingestion configuration
const DEFAULT_DB_NAME = "db-air_quality_monitoring";
const MONGO_URI = process.env.MONGO_URI || null;
const MONGO_DB_NAME = (process.env.MONGO_DB_NAME || "").trim() || null;
const SERIES_COLLECTION_NAME =
  process.env.MONGO_COLLECTION_SERIES || "air_data";
const META_COLLECTION_NAME =
  process.env.MONGO_COLLECTION_META || `${SERIES_COLLECTION_NAME}_meta`;
const STATION_COLLECTION_NAME =
  process.env.MONGO_COLLECTION_STATION || "station_meta";
const INGEST_CRON = process.env.INGEST_CRON || "*/15 * * * *"; // default every 15 minutes
const INGEST_TZ = process.env.INGEST_TZ || undefined;
const INGEST_ON_START = process.env.INGEST_ON_START === "0" ? false : true;

let _mongoClient = null;
let _mongoDb = null;
let _seriesCollection = null;
let _metaCollection = null;
let _ingestScheduled = false;
let _ingestRunning = false;
let _stationCollection = null;

function inferDbName(uri) {
  if (!uri) return DEFAULT_DB_NAME;
  const noQuery = uri.split("?")[0];
  const parts = noQuery.split("/");
  const last = parts[parts.length - 1];
  return last && !last.includes("@") ? last : DEFAULT_DB_NAME;
}

async function ensureMongo() {
  if (_mongoDb) return _mongoDb;
  if (!MONGO_URI) {
    throw new Error("MONGO_URI is not configured");
  }
  _mongoClient = new MongoClient(MONGO_URI, {
    maxPoolSize: Number(process.env.MONGO_MAX_POOL || 5),
    serverSelectionTimeoutMS: 8000,
  });
  await _mongoClient.connect();
  const dbName = MONGO_DB_NAME || inferDbName(MONGO_URI) || DEFAULT_DB_NAME;
  _mongoDb = _mongoClient.db(dbName);
  _seriesCollection = _mongoDb.collection(SERIES_COLLECTION_NAME);
  _metaCollection = _mongoDb.collection(META_COLLECTION_NAME);
  _stationCollection = _mongoDb.collection(STATION_COLLECTION_NAME);
  try {
    await Promise.all([
      _seriesCollection.createIndex({ sheet: 1, epochMs: 1 }, { unique: true }),
      _seriesCollection.createIndex({ sheet: 1, timestamp: -1 }),
      _metaCollection.createIndex({ sheet: 1 }, { unique: true }),
      _stationCollection.createIndex({ key: 1 }, { unique: true }),
    ]);
  } catch (e) {
    console.warn(`[mongo] index creation warning: ${e && e.message}`);
  }
  console.log(
    `[mongo] connected to ${dbName}.${SERIES_COLLECTION_NAME} (ingestion enabled)`,
  );
  return _mongoDb;
}

async function getSeriesCollection() {
  await ensureMongo();
  return _seriesCollection;
}

async function getMetaCollection() {
  await ensureMongo();
  return _metaCollection;
}

async function getStationCollection() {
  await ensureMongo();
  return _stationCollection;
}

async function persistStationMeta() {
  if (!MONGO_URI) return;
  try {
    const col = await getStationCollection();
    const name = process.env.STATION_NAME || null;
    const address = process.env.STATION_ADDRESS || null;
    const lat = process.env.STATION_LAT
      ? Number(process.env.STATION_LAT)
      : null;
    const lon = process.env.STATION_LON
      ? Number(process.env.STATION_LON)
      : null;
    const doc = {
      key: "default",
      name,
      address,
      latitude: lat,
      longitude: lon,
      updatedAt: new Date(),
      source: "env",
    };
    await col.updateOne({ key: "default" }, { $set: doc }, { upsert: true });
  } catch (e) {
    console.warn(`[mongo] persistStationMeta failed: ${e.message}`);
  }
}

async function persistSeriesToMongo(sheetKey, data) {
  if (!data || !Array.isArray(data.series) || !data.series.length) {
    return { upserted: 0 };
  }
  const seriesCol = await getSeriesCollection();
  const metaCol = await getMetaCollection();
  const now = new Date();
  const ingestionId = `${sheetKey}:${now.toISOString()}`;
  const ops = data.series.map((pt) => ({
    updateOne: {
      filter: { sheet: sheetKey, epochMs: pt.t },
      update: {
        $set: {
          sheet: sheetKey,
          epochMs: pt.t,
          timestamp: new Date(pt.t),
          value: pt.y,
          metaSnapshot: {
            sheet: data.meta?.sheet || sheetKey,
            yKey: data.meta?.yKey || null,
            yLabel: data.meta?.yLabel || null,
          },
          updatedAt: now,
          ingestionId,
        },
      },
      upsert: true,
    },
  }));
  const chunk = Number(process.env.MONGO_BULK_BATCH || 500);
  for (let i = 0; i < ops.length; i += chunk) {
    const slice = ops.slice(i, i + chunk);
    await seriesCol.bulkWrite(slice, { ordered: false });
  }
  const metaPayload = {
    sheet: sheetKey,
    meta: {
      ...data.meta,
      sheet: data.meta?.sheet || sheetKey,
      yKey: data.meta?.yKey || null,
      yLabel: data.meta?.yLabel || null,
      points: data.series.length,
    },
    updatedAt: now,
    ingestionId,
  };
  await metaCol.updateOne(
    { sheet: sheetKey },
    { $set: metaPayload },
    { upsert: true },
  );
  return { upserted: data.series.length };
}

async function fetchSeriesFromMongo(sheetKey) {
  if (!MONGO_URI) return null;
  try {
    const seriesCol = await getSeriesCollection();
    const metaCol = await getMetaCollection();
    const docs = await seriesCol
      .find({ sheet: sheetKey })
      .sort({ epochMs: 1 })
      .toArray();
    if (!docs.length) return null;
    const metaDoc = await metaCol.findOne({ sheet: sheetKey });
    const meta = {
      sheet: sheetKey,
      ...(metaDoc?.meta || {}),
      points: docs.length,
    };
    return {
      series: docs.map((d) => ({ t: d.epochMs, y: d.value })),
      meta,
    };
  } catch (err) {
    console.warn(`[mongo] fetchSeries failed (${sheetKey}): ${err.message}`);
    return null;
  }
}

async function fetchLatestFromMongo(sheetKey) {
  if (!MONGO_URI) return null;
  try {
    const seriesCol = await getSeriesCollection();
    const metaCol = await getMetaCollection();
    const doc = await seriesCol
      .find({ sheet: sheetKey })
      .sort({ epochMs: -1 })
      .limit(1)
      .next();
    if (!doc) return null;
    const metaDoc = await metaCol.findOne({ sheet: sheetKey });
    return { doc, meta: metaDoc?.meta || null };
  } catch (err) {
    console.warn(`[mongo] fetchLatest failed (${sheetKey}): ${err.message}`);
    return null;
  }
}

async function runIngestion(reason = "scheduled") {
  if (!MONGO_URI) {
    console.warn("[ingest] skipped (MONGO_URI missing)");
    return;
  }
  if (_ingestRunning) {
    console.log(`[ingest] overlapping run skipped (${reason})`);
    return;
  }
  _ingestRunning = true;
  const started = Date.now();
  try {
    const viz = await readVizData();
    const pm10 = await readSheetSeries("PM10");
    await persistSeriesToMongo("viz_data", viz);
    await persistSeriesToMongo("PM10", pm10);
    console.log(
      `[ingest] run ${reason} ok in ${Date.now() - started}ms (viz:${
        viz.meta?.points || viz.series.length
      } pts, pm10:${pm10.meta?.points || pm10.series.length} pts)`,
    );
  } catch (err) {
    console.error(`[ingest] run ${reason} failed: ${err.message}`);
  } finally {
    _ingestRunning = false;
  }
}

function scheduleIngestion() {
  if (_ingestScheduled || !MONGO_URI) return;
  try {
    cron.schedule(
      INGEST_CRON,
      () => {
        runIngestion("cron");
      },
      { timezone: INGEST_TZ },
    );
    console.log(
      `[ingest] cron scheduled (${INGEST_CRON}${INGEST_TZ ? ` ${INGEST_TZ}` : ""})`,
    );
    if (INGEST_ON_START) {
      runIngestion("startup").catch((err) =>
        console.error(`[ingest] startup run failed: ${err.message}`),
      );
    }
    _ingestScheduled = true;
  } catch (err) {
    console.error(`[ingest] failed to schedule cron: ${err.message}`);
  }
}

// Caching to avoid repeated remote downloads/parsing
const CACHE_TTL_MS = Number(process.env.CACHE_TTL_MS || 60_000);
const DISK_CACHE_ENABLED =
  process.env.DISABLE_DISK_CACHE === "1" ? false : true;
const CACHE_DIR =
  process.env.CACHE_DIR || path.join(__dirname, "data", ".cache");
if (DISK_CACHE_ENABLED) {
  try {
    fs.mkdirSync(CACHE_DIR, { recursive: true });
  } catch {}
}
const _wbCache = new Map(); // key -> { ts, buf }
const _vizCache = new Map(); // key -> { ts, result }

if (MONGO_URI) {
  scheduleIngestion();
  // Persist station meta once after connection
  persistStationMeta();
} else {
  console.warn(
    "[ingest] MONGO_URI missing. Falling back to direct workbook reads only.",
  );
}

// Generic resilient upstream fetch with timeout + limited retries
async function fetchWithRetry(
  url,
  {
    retries = 2,
    timeoutMs = 15000,
    backoffBase = 700,
    backoffFactor = 1.9,
    init,
  } = {},
) {
  let attempt = 0;
  let lastErr;
  while (attempt <= retries) {
    const ac = new AbortController();
    const tid = setTimeout(() => ac.abort(), timeoutMs);
    try {
      const res = await fetch(url, { signal: ac.signal, ...(init || {}) });
      clearTimeout(tid);
      if (!res.ok) {
        // retry on 5xx / network only
        if (res.status >= 500 && attempt < retries)
          throw new Error(`HTTP ${res.status}`);
        return {
          ok: res.ok,
          status: res.status,
          data: await res.json().catch(() => null),
        };
      }
      const data = await res.json();
      return { ok: true, status: res.status, data };
    } catch (e) {
      clearTimeout(tid);
      lastErr = e;
      if (attempt >= retries) break;
      const backoff =
        backoffBase * Math.pow(backoffFactor, attempt) + Math.random() * 150;
      await new Promise((r) => setTimeout(r, backoff));
    }
    attempt += 1;
  }
  return { ok: false, status: 0, error: lastErr?.message || "upstream failed" };
}

// Buffer (binary) fetch with retry and timeout
async function fetchBufferWithRetry(
  url,
  {
    retries = 2,
    timeoutMs = 60000,
    backoffBase = 800,
    backoffFactor = 1.9,
    headers,
    method,
    body,
  } = {},
) {
  let attempt = 0;
  let lastErr;
  while (attempt <= retries) {
    const ac = new AbortController();
    const tid = setTimeout(() => ac.abort(), timeoutMs);
    try {
      const res = await fetch(url, {
        signal: ac.signal,
        headers,
        method,
        body,
      });
      clearTimeout(tid);
      if (!res.ok) {
        if (res.status >= 500 && attempt < retries)
          throw new Error(`HTTP ${res.status}`);
        const txt = await res.text().catch(() => "");
        throw new Error(`HTTP ${res.status} ${txt}`);
      }
      const ab = await res.arrayBuffer();
      return Buffer.from(ab);
    } catch (e) {
      clearTimeout(tid);
      lastErr = e;
      if (attempt >= retries) break;
      const backoff =
        backoffBase * Math.pow(backoffFactor, attempt) + Math.random() * 200;
      await new Promise((r) => setTimeout(r, backoff));
    }
    attempt += 1;
  }
  throw new Error(lastErr?.message || "buffer fetch failed");
}

function resolveWorkbookPath() {
  const p = process.env.EXCEL_FILE_PATH || DEFAULT_RELATIVE;
  return p;
}

function parseExcelDate(n) {
  // Excel serial date to JS Date (assuming 1900 date system)
  try {
    const d = XLSX.SSF.parse_date_code(n);
    if (!d) return null;
    const js = new Date(
      Date.UTC(
        d.y,
        (d.m || 1) - 1,
        d.d || 1,
        d.H || 0,
        d.M || 0,
        Math.floor(d.S || 0),
      ),
    );
    return js;
  } catch {
    return null;
  }
}

function coerceDate(val) {
  if (val == null) return null;
  if (val instanceof Date) return val;
  if (typeof val === "number") {
    // try excel serial
    const d = parseExcelDate(val);
    if (d) return d;
    // maybe ms since epoch
    const d2 = new Date(val);
    if (!isNaN(d2)) return d2;
  }
  const d3 = new Date(String(val));
  if (!isNaN(d3)) return d3;
  return null;
}

function pickKeys(row) {
  // Backward-compatible simple heuristic based on header names
  const keys = Object.keys(row);
  const dateCandidates = [
    "Date",
    "Datetime",
    "DateTime",
    "Timestamp",
    "Time",
    "DATE",
    "DATETIME",
    "Data Visualization Process", // observed in provided workbook
  ];
  const valueCandidates = [
    "AQI",
    "Value",
    "PM2.5",
    "PM10",
    "NO2",
    "O3",
    "SO2",
    "CO",
    "Index",
    "Reading",
  ];
  let xKey =
    keys.find((k) => dateCandidates.includes(k)) ||
    keys.find((k) => /date|time/i.test(k));
  let yKey =
    keys.find((k) => valueCandidates.includes(k)) ||
    keys.find((k) => k !== xKey && /aqi|value|pm|index|reading/i.test(k));
  return { xKey, yKey };
}

function pickKeysFromRows(rows) {
  if (!rows || rows.length === 0) return { xKey: null, yKey: null };
  const keys = Object.keys(rows[0] || {});

  // Heuristic 1: If there is a synthetic header row (row 0) with textual labels like
  // "DATE & TIME", "HOURLY CONC (µg/Ncm)", "24 HR ROLLING AQI VALUE" etc.,
  // use those to map the date and preferred value columns.
  const headerRow = rows[0] || {};
  const headerValues = Object.fromEntries(
    keys.map((k) => [k, (headerRow[k] || "").toString().trim()]),
  );
  const labels = Object.values(headerValues).filter((v) => v.length > 0);
  const headerLooksLikeLabels =
    labels.length >= 3 && labels.every((v) => /[A-Za-z]/.test(v));
  if (headerLooksLikeLabels) {
    // xKey: look for label containing DATE or TIME
    const xKeyFromHeader = keys.find((k) =>
      /date|time/i.test(headerValues[k] || ""),
    );
    // yKey preference order: 24 HR ROLLING AQI VALUE > AQI (generic) > HOURLY CONC > TRUNCATED VALUE > first numeric
    const yPrefOrder = [
      /24\s*HR\s*ROLLING\s*AQI\s*VALUE/i,
      /\bAQI\b/i,
      /HOURLY\s*CONC/i,
      /TRUNCATED\s*VALUE/i,
    ];
    let yKeyFromHeader = null;
    for (const rx of yPrefOrder) {
      const found = keys.find((k) => rx.test(headerValues[k] || ""));
      if (found) {
        yKeyFromHeader = found;
        break;
      }
    }
    // If not found by regex, fall back to numeric scoring from data rows (skip header row)
    if (!yKeyFromHeader) {
      const candidates = keys.filter((k) => k !== xKeyFromHeader);
      const scores = candidates.map((k) => {
        let numericHits = 0;
        for (let i = 1; i < Math.min(rows.length, 20); i++) {
          let v = rows[i]?.[k];
          if (typeof v === "string") v = v.replace(/[, ]/g, "");
          if (v !== null && v !== undefined && v !== "") {
            const n = Number(v);
            if (isFinite(n)) numericHits++;
          }
        }
        return { k, score: numericHits };
      });
      scores.sort((a, b) => b.score - a.score);
      yKeyFromHeader = scores[0]?.score > 0 ? scores[0].k : null;
    }
    const xKey =
      xKeyFromHeader ||
      (keys.includes("Data Visualization Process")
        ? "Data Visualization Process"
        : null);
    const yKey = yKeyFromHeader || null;
    if (xKey && yKey) return { xKey, yKey };
  }

  // Generic scoring for date and numeric columns
  const sampleN = Math.min(rows.length, 20);
  const keyScores = keys.reduce(
    (acc, k) => {
      let dateHits = 0,
        numHits = 0;
      for (let i = 0; i < sampleN; i++) {
        const v = rows[i]?.[k];
        const d = coerceDate(v);
        if (d) dateHits++;
        let vv = v;
        if (typeof vv === "string") vv = vv.replace(/[, ]/g, "");
        const n = Number(vv);
        if (vv !== null && vv !== undefined && vv !== "" && isFinite(n))
          numHits++;
      }
      acc.date[k] = dateHits;
      acc.num[k] = numHits;
      return acc;
    },
    { date: {}, num: {} },
  );
  const bestDate = Object.entries(keyScores.date).sort(
    (a, b) => b[1] - a[1],
  )[0]?.[0];
  const bestNum = Object.entries(keyScores.num)
    .filter(([k]) => k !== bestDate)
    .sort((a, b) => b[1] - a[1])[0]?.[0];
  return { xKey: bestDate || null, yKey: bestNum || null };
}

function inferAqiCategory(v) {
  const val = Number(v);
  if (!isFinite(val)) return null;
  if (val <= 50) return "GOOD";
  if (val <= 100) return "MODERATE";
  if (val <= 150) return "UNHEALTHY FOR SENSITIVE GROUPS";
  if (val <= 200) return "UNHEALTHY";
  if (val <= 300) return "VERY UNHEALTHY";
  if (val <= 500) return "HAZARDOUS";
  return "EMERGENCY";
}

async function loadWorkbook(p) {
  // Support local filesystem path or http(s) URL (best-effort).
  // For http(s): try anonymous download first (works for public/share links). If it fails or isn't a file download and the host is SharePoint with Graph creds, fall back to Graph.
  if (/^https?:\/\//i.test(p)) {
    const url = new URL(p);
    const isSP = /\.sharepoint\.com$/i.test(url.hostname);
    const hasGraph = !!(
      process.env.GRAPH_TENANT_ID &&
      process.env.GRAPH_CLIENT_ID &&
      process.env.GRAPH_CLIENT_SECRET
    );

    // Cache by URL (memory + disk)
    const cached = _wbCache.get(p);
    const diskKey =
      Buffer.from(p, "utf8").toString("base64").replace(/\W/g, "_") + ".xlsm";
    const diskPath = path.join(CACHE_DIR, diskKey);
    if (cached && Date.now() - cached.ts < CACHE_TTL_MS) {
      return XLSX.read(cached.buf, {
        type: "buffer",
        cellDates: true,
        cellNF: false,
        cellText: false,
      });
    }
    // Try fresh-enough disk cache
    if (DISK_CACHE_ENABLED) {
      try {
        const st = fs.statSync(diskPath);
        if (st && Date.now() - st.mtimeMs < CACHE_TTL_MS) {
          const buf = fs.readFileSync(diskPath);
          _wbCache.set(p, { ts: Date.now(), buf });
          return XLSX.read(buf, {
            type: "buffer",
            cellDates: true,
            cellNF: false,
            cellText: false,
          });
        }
      } catch {}
    }

    // 1) Attempt anonymous fetch (works if link is "anyone with the link" and points to direct download)
    try {
      // Attempt anonymous direct bytes with retry
      const buf = await fetchBufferWithRetry(p, {
        retries: 1,
        timeoutMs: 25000,
      });
      _wbCache.set(p, { ts: Date.now(), buf });
      if (DISK_CACHE_ENABLED) {
        try {
          fs.writeFileSync(diskPath, buf);
        } catch {}
      }
      // If it's an Excel/zip/octet-stream it's likely the file. Try to parse regardless; if it fails, we'll fall back to Graph below.
      try {
        return XLSX.read(buf, {
          type: "buffer",
          cellDates: true,
          cellNF: false,
          cellText: false,
        });
      } catch (e) {
        // continue to fallback
      }
    } catch (_) {
      // ignore and try fallback when applicable
    }

    // 2) If SharePoint share link (/:x:/g/...) try canonical download.aspx?share=<id>
    if (isSP && /\/:.?:\/g\//i.test(url.pathname)) {
      // extract share id (last non-empty path segment)
      const parts = url.pathname.split("/").filter(Boolean);
      const shareId = parts[parts.length - 1];
      // try to reconstruct personal path segment to build _layouts download URL
      const personalIdx = parts.indexOf("personal");
      if (shareId && personalIdx !== -1 && parts.length > personalIdx + 1) {
        const userSegment = parts[personalIdx + 1];
        const dlUrl1 = `https://${
          url.hostname
        }/personal/${userSegment}/_layouts/15/download.aspx?share=${encodeURIComponent(
          shareId,
        )}`;
        const dlUrl2 = `https://${
          url.hostname
        }/_layouts/15/download.aspx?share=${encodeURIComponent(shareId)}`;
        try {
          const buf2 = await fetchBufferWithRetry(dlUrl1, {
            retries: 1,
            timeoutMs: 25000,
          }).catch(async () => {
            return await fetchBufferWithRetry(dlUrl2, {
              retries: 1,
              timeoutMs: 25000,
            });
          });
          if (DISK_CACHE_ENABLED) {
            try {
              fs.writeFileSync(diskPath, buf2);
            } catch {}
          }
          return XLSX.read(buf2, {
            type: "buffer",
            cellDates: true,
            cellNF: false,
            cellText: false,
          });
        } catch (_) {
          // continue to next fallback
        }
      }
    }

    // 3) Fallback to Graph for SharePoint hosts when credentials are present
    if (isSP && hasGraph) {
      // If this is a share link (/:x:/g/...), use Graph shares API; else use site/drive path
      let buf;
      if (/\/:[a-z]:\/g\//i.test(url.pathname)) {
        buf = await downloadFromShareLinkViaGraph(url.href);
      } else {
        buf = await downloadFromSharePointViaGraph(url.href);
      }
      _wbCache.set(p, { ts: Date.now(), buf });
      if (DISK_CACHE_ENABLED) {
        try {
          fs.writeFileSync(diskPath, buf);
        } catch {}
      }
      return XLSX.read(buf, {
        type: "buffer",
        cellDates: true,
        cellNF: false,
        cellText: false,
      });
    }

    // 4) If we got here, anonymous failed and no Graph path available
    const reason = isSP
      ? "If this is a SharePoint/OneDrive link that is not public, either provide an 'anyone with the link' direct download URL or configure Microsoft Graph credentials and admin consent."
      : "Verify the URL is reachable and returns the file bytes.";
    throw new Error(`Failed to download Excel from URL. ${reason}`);
  }
  if (!fs.existsSync(p)) {
    throw new Error(
      `Excel file not found at ${p}. Set EXCEL_FILE_PATH or place file at ${DEFAULT_RELATIVE}`,
    );
  }
  return XLSX.readFile(p, { cellDates: true, cellNF: false, cellText: false });
}

async function graphClientCredentialsToken() {
  const tenant = process.env.GRAPH_TENANT_ID;
  const clientId = process.env.GRAPH_CLIENT_ID;
  const clientSecret = process.env.GRAPH_CLIENT_SECRET;
  const authority = `https://login.microsoftonline.com/${tenant}/oauth2/v2.0/token`;
  const body = new URLSearchParams();
  body.set("grant_type", "client_credentials");
  body.set("client_id", clientId);
  body.set("client_secret", clientSecret);
  body.set("scope", "https://graph.microsoft.com/.default");
  const resp = await fetchWithRetry(authority, {
    timeoutMs: 12000,
    retries: 2,
    init: {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
    },
  });
  if (!resp.ok || !resp.data?.access_token) {
    throw new Error(`Failed to acquire Graph token (${resp.status || "n/a"})`);
  }
  const json = resp.data;
  return json.access_token;
}

function splitSharePointUrl(spUrl) {
  // Expect: https://{host}/personal/{user}/Documents/.../file.xlsm
  const url = new URL(spUrl);
  const host = url.hostname;
  const parts = url.pathname.split("/").filter(Boolean);
  const idx = parts.indexOf("personal");
  if (idx === -1) return null;
  const sitePath = "/" + parts.slice(0, idx + 2).join("/"); // /personal/{user}
  const filePath = "/" + parts.slice(idx + 2).join("/"); // /Documents/.../file.xlsm
  return { host, sitePath, filePath };
}

async function downloadFromSharePointViaGraph(spUrl) {
  const token = await graphClientCredentialsToken();
  const parsed = splitSharePointUrl(spUrl);
  if (!parsed) throw new Error("Unable to parse SharePoint personal URL");
  const { host, sitePath, filePath } = parsed;
  const envHost = process.env.SHAREPOINT_HOST || host;
  const envSitePath = process.env.SHAREPOINT_SITE_PATH || sitePath;
  const envFilePath = process.env.SHAREPOINT_FILE_PATH || filePath;

  // Resolve site id
  const siteResp = await fetchWithRetry(
    `https://graph.microsoft.com/v1.0/sites/${encodeURIComponent(envHost)}:${encodeURI(envSitePath)}`,
    {
      retries: 2,
      timeoutMs: 15000,
      init: { headers: { Authorization: `Bearer ${token}` } },
    },
  );
  if (!siteResp.ok) {
    throw new Error(`Failed to resolve SharePoint site (${siteResp.status})`);
  }
  const siteJson = siteResp.data;
  const siteId = siteJson.id;
  if (!siteId) throw new Error("SharePoint site id not found");

  // Download file content
  const buf = await fetchBufferWithRetry(
    `https://graph.microsoft.com/v1.0/sites/${encodeURIComponent(siteId)}/drive/root:${encodeURI(envFilePath)}:/content`,
    {
      retries: 2,
      timeoutMs: 30000,
      headers: { Authorization: `Bearer ${token}` },
    },
  );
  return buf;
}

// Download using Graph from a SharePoint/OneDrive share link (/:x:/g/...)
function encodeShareUrlForGraph(url) {
  // base64url of the full URL, prefixed by 'u!'
  const b64 = Buffer.from(url, "utf8")
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
  return "u!" + b64;
}
async function downloadFromShareLinkViaGraph(shareUrl) {
  const token = await graphClientCredentialsToken();
  const encoded = encodeShareUrlForGraph(shareUrl);
  const buf = await fetchBufferWithRetry(
    `https://graph.microsoft.com/v1.0/shares/${encoded}/driveItem/content`,
    {
      retries: 2,
      timeoutMs: 30000,
      headers: { Authorization: `Bearer ${token}` },
    },
  );
  return buf;
}

async function readVizData(yKeyOverride) {
  const wbPath = resolveWorkbookPath();
  const cacheKey = `${wbPath}|viz|${yKeyOverride || ""}`;
  const cached = _vizCache.get(cacheKey);
  if (cached && Date.now() - cached.ts < CACHE_TTL_MS) {
    return cached.result;
  }
  const wb = await loadWorkbook(wbPath);
  const sheetName =
    wb.SheetNames.find((n) => n.toLowerCase() === "viz_data") ||
    wb.SheetNames[0];
  const ws = wb.Sheets[sheetName];
  if (!ws) throw new Error(`Sheet 'viz_data' not found in workbook.`);
  const rows = XLSX.utils.sheet_to_json(ws, { raw: true, defval: null });
  if (!Array.isArray(rows))
    return {
      series: [],
      meta: {
        sheet: sheetName,
        xKey: null,
        yKey: null,
        yLabel: null,
        points: 0,
      },
    };

  const keysPicked = rows.length
    ? pickKeysFromRows(rows)
    : { xKey: null, yKey: null };
  const xKey = keysPicked.xKey;
  let yKey = yKeyOverride || keysPicked.yKey;
  // If override not provided and not found, attempt to pick the first numeric-looking column
  if (!yKey && rows.length) {
    const sample = rows[0];
    yKey = Object.keys(sample).find(
      (k) =>
        k !== xKey && !isNaN(Number(String(sample[k]).replace(/[, ]/g, ""))),
    );
  }

  // Friendly labels from the first data row (often contains readable headers)
  const headerRow = rows[0] || {};
  const headerValues = Object.fromEntries(
    Object.keys(headerRow).map((k) => [
      k,
      (headerRow[k] || "").toString().trim(),
    ]),
  );
  const yLabel = (yKey && headerValues[yKey]) || yKey || null;

  const series = rows
    .map((r) => {
      const t = coerceDate(r[xKey]);
      let yStr = r[yKey];
      if (typeof yStr === "string") yStr = yStr.replace(/[, ]/g, "");
      const y = Number(yStr);
      if (!t || !isFinite(y)) return null;
      // Use epoch milliseconds to preserve local wall-clock times in the client
      return { t: t.getTime(), y };
    })
    .filter(Boolean)
    .sort((a, b) =>
      typeof a.t === "string" ? a.t.localeCompare(b.t) : a.t - b.t,
    );

  return {
    series,
    meta: {
      sheet: sheetName,
      xKey,
      yKey,
      yLabel,
      points: series.length,
      path: wbPath,
    },
  };
}

async function readSheetSeries(sheetName, yKeyOverride) {
  const wbPath = resolveWorkbookPath();
  const wb = await loadWorkbook(wbPath);
  const sheet =
    wb.SheetNames.find(
      (n) => n.toLowerCase() === String(sheetName).toLowerCase(),
    ) || null;
  if (!sheet) throw new Error(`Sheet '${sheetName}' not found in workbook.`);
  const ws = wb.Sheets[sheet];
  const rows = XLSX.utils.sheet_to_json(ws, { raw: true, defval: null });
  if (!Array.isArray(rows))
    return {
      series: [],
      meta: {
        sheet,
        xKey: null,
        yKey: null,
        yLabel: null,
        points: 0,
        path: wbPath,
      },
    };

  const keysPicked = rows.length
    ? pickKeysFromRows(rows)
    : { xKey: null, yKey: null };
  const xKey = keysPicked.xKey;
  let yKey = yKeyOverride || keysPicked.yKey;
  if (!yKey && rows.length) {
    const sample = rows[0];
    yKey = Object.keys(sample).find(
      (k) =>
        k !== xKey && !isNaN(Number(String(sample[k]).replace(/[, ]/g, ""))),
    );
  }

  const headerRow = rows[0] || {};
  const headerValues = Object.fromEntries(
    Object.keys(headerRow).map((k) => [
      k,
      (headerRow[k] || "").toString().trim(),
    ]),
  );
  const yLabel = (yKey && headerValues[yKey]) || yKey || null;

  const series = rows
    .map((r) => {
      const t = coerceDate(r[xKey]);
      let yStr = r[yKey];
      if (typeof yStr === "string") yStr = yStr.replace(/[, ]/g, "");
      const y = Number(yStr);
      if (!t || !isFinite(y)) return null;
      return { t: t.getTime(), y };
    })
    .filter(Boolean)
    .sort((a, b) =>
      typeof a.t === "string" ? a.t.localeCompare(b.t) : a.t - b.t,
    );

  return {
    series,
    meta: { sheet, xKey, yKey, yLabel, points: series.length, path: wbPath },
  };
}

// PM10 worksheet series
app.get("/api/pm10-data", async (req, res) => {
  try {
    const { yKey } = req.query;
    if (!yKey) {
      const stored = await fetchSeriesFromMongo("PM10");
      if (stored) {
        return res.json({ ...stored, source: "mongo" });
      }
    }
    const data = await readSheetSeries("PM10", yKey);
    res.json({ ...data, source: yKey ? "excel" : "excel-fallback" });
  } catch (e) {
    res.status(500).json({ error: e.message || "Failed to read PM10 sheet" });
  }
});

app.get("/api/viz-data", async (req, res) => {
  try {
    const { yKey } = req.query;
    if (!yKey) {
      const stored = await fetchSeriesFromMongo("viz_data");
      if (stored) {
        return res.json({ ...stored, source: "mongo" });
      }
    }
    const data = await readVizData(yKey);
    res.json({ ...data, source: yKey ? "excel" : "excel-fallback" });
  } catch (e) {
    res.status(500).json({ error: e.message || "Failed to read viz_data" });
  }
});

// Tabular Results (Google Sheets)
app.get("/api/tabular/:province/:pollutant", async (req, res) => {
  try {
    const province = String(req.params.province || "").toLowerCase();
    const pollutant = String(req.params.pollutant || "").toLowerCase();
    if (!province || !pollutant) {
      return res.status(400).json({ error: "Missing province or pollutant" });
    }
    if (!TABULAR_SHEETS[province] || !TABULAR_SHEETS[province][pollutant]) {
      return res.status(404).json({ error: "Unknown province or pollutant" });
    }
    const payload = await getTabularTable(province, pollutant);
    res.json(payload);
  } catch (e) {
    const msg = e?.message || "Failed to read tabular sheet";
    const status = e?.code === "NOT_CONFIGURED" ? 400 : 500;
    res.status(status).json({ error: msg });
  }
});

// Export log (save to MongoDB)
app.post("/api/export-log", async (req, res) => {
  try {
    const db = await ensureMongo();
    const col = db.collection("export_logs");
    const entry = {
      province: req.body.province || null,
      pollutant: req.body.pollutant || null,
      filters: req.body.filters || {},
      totalRecords: req.body.totalRecords || 0,
      exportedRecords: req.body.exportedRecords || 0,
      filename: req.body.filename || null,
      exportedAt: new Date(),
      userAgent: req.headers["user-agent"] || null,
      ip: req.ip || null,
    };
    const result = await col.insertOne(entry);
    res.json({ ok: true, id: result.insertedId });
  } catch (e) {
    console.error("[export-log] error:", e.message);
    res.status(500).json({ error: "Failed to save export log" });
  }
});

// Get export logs
app.get("/api/export-logs", async (req, res) => {
  try {
    const db = await ensureMongo();
    const col = db.collection("export_logs");
    const limit = Math.min(Number(req.query.limit) || 100, 500);
    const logs = await col
      .find({})
      .sort({ exportedAt: -1 })
      .limit(limit)
      .toArray();
    res.json({ logs, total: logs.length });
  } catch (e) {
    console.error("[export-logs] error:", e.message);
    res.status(500).json({ error: "Failed to read export logs" });
  }
});

// Latest AQI category (from viz_data sheet)
app.get("/api/aqi/latest", async (req, res) => {
  try {
    const stored = await fetchLatestFromMongo("viz_data");
    if (stored?.doc) {
      const value = stored.doc.value;
      res.json({
        parameter: "PM10",
        value,
        category: inferAqiCategory(value),
        time: stored.doc.epochMs,
        path: stored.meta?.path || resolveWorkbookPath(),
        source: "mongo",
      });
      return;
    }

    const wbPath = resolveWorkbookPath();
    const wb = await loadWorkbook(wbPath);
    const sheetName =
      wb.SheetNames.find((n) => n.toLowerCase() === "viz_data") ||
      wb.SheetNames[0];
    const ws = wb.Sheets[sheetName];
    if (!ws) return res.status(404).json({ error: "viz_data sheet not found" });
    const rows = XLSX.utils.sheet_to_json(ws, { raw: true, defval: null });
    if (!Array.isArray(rows) || rows.length < 2)
      return res.status(404).json({ error: "No rows in viz_data" });

    const headerRow = rows[0] || {};
    const headerValues = Object.fromEntries(
      Object.keys(headerRow).map((k) => [
        k,
        (headerRow[k] || "").toString().trim(),
      ]),
    );
    const xKey =
      Object.keys(headerValues).find((k) =>
        /date|time/i.test(headerValues[k] || ""),
      ) ||
      (Object.keys(headerValues).includes("Data Visualization Process")
        ? "Data Visualization Process"
        : null);
    const yPrefOrder = [
      /24\s*HR\s*ROLLING\s*AQI\s*VALUE/i,
      /^\s*AQI\s*$/i,
      /HOURLY\s*CONC/i,
      /TRUNCATED\s*VALUE/i,
    ];
    let valueKey = null;
    for (const rx of yPrefOrder) {
      const found = Object.keys(headerValues).find((k) =>
        rx.test(headerValues[k] || ""),
      );
      if (found) {
        valueKey = found;
        break;
      }
    }
    let categoryKey =
      Object.keys(headerValues).find((k) =>
        /AQI\s*CATEG(ORY)?/i.test(headerValues[k] || ""),
      ) || null;

    if (!valueKey || !xKey) {
      const picked = pickKeysFromRows(rows);
      const fallbackX = picked.xKey;
      const fallbackY = picked.yKey;
      const xUse = xKey || fallbackX;
      const yUse = valueKey || fallbackY;
      valueKey = yUse;
      if (!categoryKey && rows.length > 1) {
        const keys = Object.keys(rows[1] || {});
        categoryKey =
          keys.find((k) => {
            if (k === xUse || k === yUse) return false;
            const v = rows[1]?.[k];
            if (v == null) return false;
            const n = Number(String(v).replace(/[, ]/g, ""));
            return !isFinite(n) && /category|aqi/i.test(String(v))
              ? true
              : /category|aqi/i.test(k);
          }) || null;
      }
    }

    let last = null;
    for (let i = rows.length - 1; i >= 1; i--) {
      const r = rows[i];
      const t = coerceDate(xKey ? r[xKey] : r["Data Visualization Process"]);
      let valRaw = valueKey ? r[valueKey] : null;
      if (typeof valRaw === "string") valRaw = valRaw.replace(/[, ]/g, "");
      const aqiVal = Number(valRaw);
      const cat = categoryKey
        ? r[categoryKey] != null
          ? String(r[categoryKey]).trim()
          : null
        : null;
      if (t && isFinite(aqiVal)) {
        last = { t: t.getTime(), value: aqiVal, category: cat || null };
        break;
      }
    }
    if (!last) return res.status(404).json({ error: "No valid AQI row" });

    const category = last.category || inferAqiCategory(last.value);
    res.json({
      parameter: "PM10",
      value: last.value,
      category,
      time: last.t,
      path: wbPath,
      source: "excel",
    });
  } catch (e) {
    res.status(500).json({ error: e.message || "Failed to read latest AQI" });
  }
});

// Station current weather (temperature, humidity, pressure) from Open-Meteo
app.get("/api/station/current", async (req, res) => {
  try {
    const lat = process.env.STATION_LAT;
    const lon = process.env.STATION_LON;
    if (!lat || !lon) {
      return res
        .status(400)
        .json({ error: "STATION_LAT and STATION_LON must be set in .env" });
    }
    // Primary: Open-Meteo
    const om = new URL("https://api.open-meteo.com/v1/forecast");
    om.searchParams.set("latitude", lat);
    om.searchParams.set("longitude", lon);
    om.searchParams.set(
      "current",
      "temperature_2m,relative_humidity_2m,pressure_msl",
    );
    om.searchParams.set("timezone", "auto");
    const omResp = await fetchWithRetry(om.toString(), {
      retries: 2,
      timeoutMs: 7000,
    });

    let temperature = null,
      humidity = null,
      pressure = null,
      time = null,
      units = null;
    if (omResp.ok && omResp.data?.current) {
      temperature = omResp.data.current.temperature_2m ?? null;
      humidity = omResp.data.current.relative_humidity_2m ?? null;
      pressure = omResp.data.current.pressure_msl ?? null;
      time = omResp.data.current.time ?? null;
      units = omResp.data.current_units ?? null;
    }

    // Fallback: OpenWeatherMap (needs API key) if any of primary metrics missing
    if ((!temperature || !humidity || !pressure) && OWM_API_KEY) {
      const owmUrl = `https://api.openweathermap.org/data/2.5/weather?lat=${encodeURIComponent(lat)}&lon=${encodeURIComponent(lon)}&units=metric&appid=${encodeURIComponent(OWM_API_KEY)}`;
      const owResp = await fetchWithRetry(owmUrl, {
        retries: 2,
        timeoutMs: 7000,
      });
      if (owResp.ok && owResp.data) {
        const main = owResp.data.main || {};
        temperature =
          temperature ??
          (main.temp != null ? Math.round(main.temp * 10) / 10 : null);
        humidity = humidity ?? main.humidity ?? null;
        pressure = pressure ?? main.pressure ?? null;
        time =
          time ??
          (owResp.data.dt
            ? new Date(owResp.data.dt * 1000).toISOString()
            : null);
        units = units || {
          temperature_2m: "°C",
          relative_humidity_2m: "%",
          pressure_msl: "hPa",
        };
      }
    }

    if (temperature == null && humidity == null && pressure == null) {
      return res
        .status(502)
        .json({ error: omResp.error || `All upstream sources failed` });
    }
    res.json({
      latitude: Number(lat),
      longitude: Number(lon),
      temperature_2m: temperature,
      relative_humidity_2m: humidity,
      pressure_msl: pressure,
      time,
      units,
      upstream: {
        openMeteoStatus: omResp.status,
        openWeatherUsed:
          !!OWM_API_KEY &&
          (temperature == null || humidity == null || pressure == null
            ? true
            : false),
      },
    });
  } catch (e) {
    res
      .status(500)
      .json({ error: e.message || "Failed to fetch station weather" });
  }
});

// Station 3-day forecast (temperature max/min from daily, humidity & pressure daily means from hourly)
app.get("/api/station/forecast", async (req, res) => {
  try {
    const lat = process.env.STATION_LAT;
    const lon = process.env.STATION_LON;
    let days = Number(req.query.days || 3);
    if (!isFinite(days) || days <= 0) days = 3;
    days = Math.min(Math.max(Math.floor(days), 1), 7); // clamp 1..7
    if (!lat || !lon) {
      return res
        .status(400)
        .json({ error: "STATION_LAT and STATION_LON must be set in .env" });
    }
    const url = new URL("https://api.open-meteo.com/v1/forecast");
    url.searchParams.set("latitude", lat);
    url.searchParams.set("longitude", lon);
    url.searchParams.set("daily", "temperature_2m_max,temperature_2m_min");
    url.searchParams.set("hourly", "relative_humidity_2m,pressure_msl");
    url.searchParams.set("timezone", "auto");
    url.searchParams.set("forecast_days", String(days));
    const r = await fetch(url.toString());
    if (!r.ok)
      return res.status(502).json({ error: `Weather upstream ${r.status}` });
    const j = await r.json();

    const daily = j?.daily || {};
    const dtime = daily.time || [];
    const tmax = daily.temperature_2m_max || [];
    const tmin = daily.temperature_2m_min || [];

    const hourly = j?.hourly || {};
    const htime = hourly.time || [];
    const rh = hourly.relative_humidity_2m || [];
    const p = hourly.pressure_msl || [];

    // Group hourly values by date (YYYY-MM-DD) from the provided local timezone timestamps
    const groups = new Map();
    for (let i = 0; i < htime.length; i++) {
      const ts = htime[i];
      const dateKey = typeof ts === "string" ? ts.slice(0, 10) : null; // 'YYYY-MM-DDTHH:MM' -> date
      if (!dateKey) continue;
      if (!groups.has(dateKey)) groups.set(dateKey, { rh: [], p: [] });
      const g = groups.get(dateKey);
      const rv = rh[i];
      const pv = p[i];
      if (rv != null && isFinite(Number(rv))) g.rh.push(Number(rv));
      if (pv != null && isFinite(Number(pv))) g.p.push(Number(pv));
    }

    const out = [];
    for (let i = 0; i < dtime.length && i < days; i++) {
      const date = dtime[i]; // 'YYYY-MM-DD'
      const g = groups.get(date) || { rh: [], p: [] };
      const humidity_mean = g.rh.length
        ? g.rh.reduce((a, b) => a + b, 0) / g.rh.length
        : null;
      const pressure_mean = g.p.length
        ? g.p.reduce((a, b) => a + b, 0) / g.p.length
        : null;
      out.push({
        date,
        temp_max: tmax[i] ?? null,
        temp_min: tmin[i] ?? null,
        humidity_mean: humidity_mean != null ? Math.round(humidity_mean) : null,
        pressure_mean: pressure_mean != null ? Math.round(pressure_mean) : null,
      });
    }

    res.json({
      latitude: Number(lat),
      longitude: Number(lon),
      days,
      forecast: out,
      units: {
        temp: j?.daily_units?.temperature_2m_max || "°C",
        humidity: j?.hourly_units?.relative_humidity_2m || "%",
        pressure: j?.hourly_units?.pressure_msl || "hPa",
      },
    });
  } catch (e) {
    res
      .status(500)
      .json({ error: e.message || "Failed to fetch station forecast" });
  }
});

// Previous N calendar days AQI values (from viz_data y series), excluding today
app.get("/api/aqi/last-days", async (req, res) => {
  try {
    let days = Number(req.query.days || 3);
    if (!isFinite(days) || days <= 0) days = 3;
    days = Math.min(Math.max(Math.floor(days), 1), 14);
    let seriesPayload = null;
    const stored = await fetchSeriesFromMongo("viz_data");
    if (stored?.series?.length) {
      seriesPayload = stored.series;
    } else {
      const { series } = await readVizData();
      seriesPayload = series;
    }
    if (!Array.isArray(seriesPayload) || seriesPayload.length === 0) {
      return res.status(404).json({ error: "No viz_data series" });
    }
    // map dateKey -> last value for that date (local time). Exclude today.
    const todayKey = new Date().toISOString().slice(0, 10);
    const lastByDate = new Map();
    for (const pt of seriesPayload) {
      const d = new Date(pt.t);
      const key = new Date(d.getFullYear(), d.getMonth(), d.getDate())
        .toISOString()
        .slice(0, 10);
      if (key === todayKey) continue; // exclude today
      // overwrite to keep last value of the day as we traverse ascending
      lastByDate.set(key, pt.y);
    }
    // Get most recent N dates
    const dates = Array.from(lastByDate.keys())
      .sort((a, b) => (a < b ? 1 : -1))
      .slice(0, days)
      .sort();
    const items = dates.map((date) => {
      const val = lastByDate.get(date);
      return { date, value: val, category: inferAqiCategory(Number(val)) };
    });
    res.json({
      days: items.length,
      items,
      source: stored?.series ? "mongo" : "excel",
    });
  } catch (e) {
    res
      .status(500)
      .json({ error: e.message || "Failed to compute AQI last days" });
  }
});

// Station metadata served from Mongo when available (fallback to env)
app.get("/api/station/meta", async (req, res) => {
  try {
    let record = null;
    if (MONGO_URI) {
      try {
        const col = await getStationCollection();
        record = await col.findOne({ key: "default" });
      } catch (err) {
        console.warn(`[station-meta] mongo fetch failed: ${err.message}`);
      }
    }
    if (record) {
      return res.json({
        name: record.name || null,
        address: record.address || null,
        latitude: record.latitude ?? null,
        longitude: record.longitude ?? null,
        updatedAt: record.updatedAt || null,
        source: "mongo",
      });
    }
    const name = process.env.STATION_NAME || null;
    const address = process.env.STATION_ADDRESS || null;
    const lat = process.env.STATION_LAT
      ? Number(process.env.STATION_LAT)
      : null;
    const lon = process.env.STATION_LON
      ? Number(process.env.STATION_LON)
      : null;
    res.json({ name, address, latitude: lat, longitude: lon, source: "env" });
  } catch (e) {
    res.status(500).json({ error: e.message || "Failed to read station meta" });
  }
});

// Proxy OpenWeatherMap tile layers so the frontend doesn't expose the API key
// Usage: /api/tiles/owm/:layer/:z/:x/:y.png
// Allowed layers example: clouds_new, precipitation_new, rain_new, wind_new, temp_new, pressure_new
app.get("/api/tiles/owm/:layer/:z/:x/:y.png", async (req, res) => {
  try {
    if (!OWM_API_KEY) {
      return res
        .status(501)
        .json({ error: "OWM_API_KEY is not configured on the server" });
    }
    const { layer, z, x, y } = req.params;
    const allowed = new Set([
      "clouds_new",
      "precipitation_new",
      "rain_new",
      "wind_new",
      "temp_new",
      "pressure_new",
    ]);
    if (!allowed.has(layer)) {
      return res.status(400).json({ error: "Unsupported layer" });
    }
    const url = `https://tile.openweathermap.org/map/${encodeURIComponent(
      layer,
    )}/${encodeURIComponent(z)}/${encodeURIComponent(x)}/${encodeURIComponent(
      y,
    )}.png?appid=${encodeURIComponent(OWM_API_KEY)}`;
    const upstream = await fetch(url);
    if (!upstream.ok) {
      return res.status(upstream.status).end();
      console.log(`[owm-tiles] request ${layer}/${z}/${x}/${y}`);
    }
    const buf = Buffer.from(await upstream.arrayBuffer());
    res.setHeader("Content-Type", "image/png");
    // Cache for 5 minutes at clients and allow CDN/proxy caching
    res.setHeader("Cache-Control", "public, max-age=300, s-maxage=300");
    console.warn(
      `[owm-tiles] upstream ${upstream.status} ${layer}/${z}/${x}/${y}`,
    );
    return res.status(200).send(buf);
  } catch (e) {
    return res.status(502).json({ error: "Tile proxy failed" });
  }
});

// Diagnostics endpoint to help troubleshoot workbook loading and sheet/key detection
app.get("/api/viz-data/diagnostics", async (req, res) => {
  console.error(`[owm-tiles] error: ${e && e.message}`);
  try {
    const wbPath = resolveWorkbookPath();
    const wb = await loadWorkbook(wbPath);
    const sheetNames = wb.SheetNames;
    const sheetName =
      sheetNames.find((n) => n.toLowerCase() === "viz_data") || sheetNames[0];
    const ws = wb.Sheets[sheetName];
    let rows = [];
    let head = null;
    if (ws) {
      rows = XLSX.utils.sheet_to_json(ws, { raw: true, defval: null });
      head = rows[0] || null;
    }
    const keysPicked =
      Array.isArray(rows) && rows.length
        ? pickKeysFromRows(rows)
        : { xKey: null, yKey: null };
    const headerValues = head
      ? Object.fromEntries(
          Object.keys(head).map((k) => [k, (head[k] || "").toString().trim()]),
        )
      : {};
    const xLabel = keysPicked.xKey
      ? headerValues[keysPicked.xKey] || keysPicked.xKey
      : null;
    const yLabel = keysPicked.yKey
      ? headerValues[keysPicked.yKey] || keysPicked.yKey
      : null;
    res.json({
      path: wbPath,
      sheetNames,
      chosenSheet: sheetName,
      rowsCount: Array.isArray(rows) ? rows.length : 0,
      keysPicked,
      labels: { xLabel, yLabel },
      sample: Array.isArray(rows) ? rows.slice(0, 3) : [],
    });
  } catch (e) {
    res.status(500).json({ error: e.message || "Diagnostics failed" });
  }
});

// Reverse geocoding proxy with fallback to avoid browser CORS and centralize provider logic
app.get("/api/reverse-geocode", async (req, res) => {
  try {
    const { lat, lon } = req.query;
    if (!lat || !lon)
      return res.status(400).json({ error: "lat and lon are required" });

    // First try Open-Meteo reverse geocoding
    const omUrl = `https://geocoding-api.open-meteo.com/v1/reverse?latitude=${encodeURIComponent(
      lat,
    )}&longitude=${encodeURIComponent(lon)}&language=en&format=json`;
    let name = null,
      region = null;
    try {
      const r = await fetch(omUrl);
      if (r.ok) {
        const j = await r.json();
        const rec = j?.results?.[0] || {};
        name =
          rec.name ||
          rec.city ||
          rec.locality ||
          rec.town ||
          rec.village ||
          null;
        region = rec.admin2 || rec.admin1 || rec.country || null;
      }
    } catch {}

    // Fallback to BigDataCloud if needed
    if (!name) {
      try {
        const bdcUrl = `https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=${encodeURIComponent(
          lat,
        )}&longitude=${encodeURIComponent(lon)}&localityLanguage=en`;
        const r2 = await fetch(bdcUrl);
        if (r2.ok) {
          const b = await r2.json();
          name = b.locality || b.city || null;
          region = b.principalSubdivision || b.countryName || region || null;
        }
      } catch {}
    }

    if (!name && !region)
      return res.status(404).json({ error: "No location found" });
    const display = name
      ? region && region !== name
        ? `${name}, ${region}`
        : name
      : region || "";
    res.json({ name, region, display });
  } catch (e) {
    res.status(500).json({ error: e.message || "Reverse geocoding failed" });
  }
});

// ── Global crash guards: log and keep running ──
process.on("uncaughtException", (err) => {
  console.error("[UNCAUGHT EXCEPTION]", err?.stack || err);
  // Do NOT process.exit — keep the server alive
});
process.on("unhandledRejection", (reason) => {
  console.error("[UNHANDLED REJECTION]", reason);
});

app.listen(PORT, () => {
  const external =
    process.env.RENDER_EXTERNAL_URL || process.env.VITE_API_BASE || "";
  if (external) {
    console.log(`Server ready on port ${PORT} (${external})`);
  } else {
    console.log(`Server ready on port ${PORT}`);
  }
  // Pre-warm workbook cache asynchronously to reduce first-request latency
  try {
    const wbPath = resolveWorkbookPath();
    setTimeout(() => {
      loadWorkbook(wbPath).catch(() => {});
    }, 10);
    // Periodically refresh caches in background so requests serve hot data
    let warming = false;
    const intervalMs = Math.max(60000, Number(CACHE_TTL_MS) || 60000);
    setInterval(async () => {
      if (warming) return;
      warming = true;
      try {
        await loadWorkbook(wbPath);
        // Prime computed series caches
        await Promise.allSettled([readVizData(), readSheetSeries("PM10")]);
      } catch {}
      warming = false;
    }, intervalMs);
  } catch {}
});
