/**
 * External (partner) API — versioned, read-only, API-key protected.
 *
 * Public (key required):
 *   GET /api/v1/ping                                   — connection test / key info
 *   GET /api/v1/stations                               — station registry + data freshness
 *   GET /api/v1/latest                                 — latest reading for every station/pollutant
 *   GET /api/v1/stations/:station/latest               — latest reading(s) for one station
 *   GET /api/v1/stations/:station/:pollutant/latest    — latest reading for one dataset
 *   GET /api/v1/stations/:station/:pollutant/readings  — historical hourly readings (paginated)
 *
 * Admin (X-Admin-Token required — issue/list/revoke partner keys):
 *   GET    /api/admin/api-keys
 *   POST   /api/admin/api-keys
 *   DELETE /api/admin/api-keys/:id
 *
 * Data comes from the MongoDB backup snapshot (air_data_backup*), enriched
 * with the same AQI / rolling-average logic the dashboard uses, so partners
 * see exactly what the kiosk and admin pages show.
 */
const { Router } = require("express");
const { enrichWithAqi } = require("../services/googleSheets");
const { getBackupData, getLatestAqiSnapshot } = require("../services/tabularBackup");
const { parseDateValue } = require("../utils/dateUtils");
const { coerceNumber } = require("../utils/mathUtils");
const { isMaintenanceMode } = require("../config/env");
const {
  POLLUTANT_LABEL,
  POLLUTANT_UNIT,
  getAvailableStations,
  getStation,
  isPollutantAvailable,
} = require("../config/stations");
const { requireApiKey, createApiKey, listApiClients, revokeApiKey, SCOPES } = require("../services/apiKeys");
const { requireAdminToken } = require("./admin-auth");

const router = Router();
const API_VERSION = "1";

/* ── Helpers ───────────────────────────────────────────────────── */

function rowEpochMs(row, dateKey) {
  if (!row || !dateKey || row[dateKey] == null) return 0;
  const parsed = parseDateValue(row[dateKey], "MDY") || parseDateValue(row[dateKey], "DMY");
  return parsed && parsed.getFullYear() >= 2015 ? parsed.getTime() : 0;
}

/** Normalize one enriched sheet row into the stable external schema. */
function toReading(row, { dateKey, concKey, pollutant }) {
  const epochMs = rowEpochMs(row, dateKey);
  const aqi = coerceNumber(row["AQI"]);
  const status = row["Status"] != null ? String(row["Status"]).trim() : null;
  return {
    time: epochMs ? new Date(epochMs).toISOString() : null,
    localTime: dateKey ? row[dateKey] ?? null : null,
    epochMs: epochMs || null,
    pollutant,
    pollutantLabel: POLLUTANT_LABEL[pollutant] || pollutant.toUpperCase(),
    unit: POLLUTANT_UNIT,
    concentration: concKey ? coerceNumber(row[concKey]) : null,
    rollingAverage24h: coerceNumber(row["Rolling Average"]),
    aqi: aqi != null && aqi > 0 && aqi <= 500 ? aqi : null,
    category: status && !/^(loading)$/i.test(status) ? status : null,
    valid: aqi != null && aqi > 0 && aqi <= 500 && !!status && !/^(invalid|loading|for\s*validation)$/i.test(status),
  };
}

function parseTimeParam(v) {
  if (v == null || v === "") return null;
  const s = String(v).trim();
  if (/^\d{10,13}$/.test(s)) {
    const n = Number(s);
    return s.length <= 10 ? n * 1000 : n;
  }
  const d = new Date(s);
  return isNaN(d.getTime()) ? NaN : d.getTime();
}

function clampInt(v, { def, min, max }) {
  const n = parseInt(v, 10);
  if (!Number.isFinite(n)) return def;
  return Math.min(max, Math.max(min, n));
}

function stationSummary(s) {
  return {
    id: s.id,
    name: s.name,
    address: s.address,
    latitude: s.latitude,
    longitude: s.longitude,
    pollutants: s.pollutants.map((p) => ({ id: p, label: POLLUTANT_LABEL[p] || p.toUpperCase(), unit: POLLUTANT_UNIT })),
  };
}

function maintenanceGuard(req, res, next) {
  if (isMaintenanceMode()) {
    res.setHeader("Retry-After", "300");
    return res.status(503).json({ error: "maintenance", message: "System is under maintenance. Please try again later." });
  }
  next();
}

/* ── Enriched dataset cache (readings are 6–11k rows each) ─────── */

const _datasetCache = new Map(); // "station:pollutant" -> { ts, readings, meta }
const DATASET_CACHE_TTL_MS = Number(process.env.EXTERNAL_API_CACHE_TTL_MS || 60_000);

async function loadDataset(station, pollutant) {
  const key = `${station}:${pollutant}`;
  const hit = _datasetCache.get(key);
  if (hit && Date.now() - hit.ts < DATASET_CACHE_TTL_MS) return hit;

  const backup = await getBackupData(station, pollutant);
  if (!backup || !backup.rows?.length) return null;

  const enriched = enrichWithAqi(
    { columns: backup.columns, rows: backup.rows, dateKey: backup.dateKey, concKey: backup.concKey },
    pollutant,
    { logsPerHour: 1 },
  );
  const ctx = { dateKey: enriched.dateKey, concKey: enriched.concKey, pollutant };
  // enrichWithAqi returns newest-first; keep ascending for range queries
  const readings = enriched.rows
    .map((r) => toReading(r, ctx))
    .filter((r) => r.epochMs)
    .sort((a, b) => a.epochMs - b.epochMs);

  const entry = {
    ts: Date.now(),
    readings,
    meta: {
      lastBackupAt: backup.backupMeta?.lastBackupAt || null,
      lastCheckedAt: backup.backupMeta?.lastCheckedAt || null,
      totalReadings: readings.length,
      firstReadingAt: readings.length ? readings[0].time : null,
      lastReadingAt: readings.length ? readings[readings.length - 1].time : null,
    },
  };
  _datasetCache.set(key, entry);
  return entry;
}

async function loadLatest(station, pollutant) {
  const snap = await getLatestAqiSnapshot(station, pollutant);
  if (snap?.row) {
    return {
      station,
      ...toReading(snap.row, { dateKey: snap.dateKey, concKey: snap.concKey, pollutant }),
      verified: !!snap.latestAqiVerified,
      updatedAt: snap.backupMeta?.lastBackupAt || null,
      source: "snapshot",
    };
  }
  // Fallback: newest valid row from the full dataset
  const ds = await loadDataset(station, pollutant);
  if (!ds) return null;
  const latest = [...ds.readings].reverse().find((r) => r.valid) || ds.readings[ds.readings.length - 1];
  return latest ? { station, ...latest, verified: false, updatedAt: ds.meta.lastBackupAt, source: "dataset" } : null;
}

/* ── Public v1 routes ──────────────────────────────────────────── */

const v1 = Router();
v1.use(maintenanceGuard);

v1.get("/ping", requireApiKey(), (req, res) => {
  res.json({
    ok: true,
    apiVersion: API_VERSION,
    serverTime: new Date().toISOString(),
    client: { name: req.apiClient.name, organization: req.apiClient.organization, scopes: req.apiClient.scopes },
  });
});

v1.get("/stations", requireApiKey(["read:stations"]), async (req, res) => {
  try {
    const stations = getAvailableStations();
    const data = await Promise.all(
      stations.map(async (s) => {
        const freshness = {};
        for (const p of s.pollutants) {
          const latest = await loadLatest(s.id, p).catch(() => null);
          freshness[p] = latest ? { lastReadingAt: latest.time, updatedAt: latest.updatedAt } : null;
        }
        return { ...stationSummary(s), freshness };
      }),
    );
    res.json({ apiVersion: API_VERSION, count: data.length, stations: data });
  } catch (e) {
    console.error(`[external-api] /stations failed: ${e.message}`);
    res.status(500).json({ error: "server_error", message: "Failed to load stations." });
  }
});

v1.get("/latest", requireApiKey(["read:latest"]), async (req, res) => {
  try {
    const stations = getAvailableStations();
    const results = [];
    for (const s of stations) {
      for (const p of s.pollutants) {
        const latest = await loadLatest(s.id, p).catch(() => null);
        results.push(latest || { station: s.id, pollutant: p, error: "no_data" });
      }
    }
    res.json({ apiVersion: API_VERSION, generatedAt: new Date().toISOString(), count: results.length, readings: results });
  } catch (e) {
    console.error(`[external-api] /latest failed: ${e.message}`);
    res.status(500).json({ error: "server_error", message: "Failed to load latest readings." });
  }
});

v1.get("/stations/:station/latest", requireApiKey(["read:latest"]), async (req, res) => {
  const station = getStation(req.params.station);
  if (!station || !station.pollutants.length) {
    return res.status(404).json({ error: "unknown_station", message: `Unknown station '${req.params.station}'.` });
  }
  try {
    const readings = [];
    for (const p of station.pollutants) {
      const latest = await loadLatest(station.id, p).catch(() => null);
      readings.push(latest || { station: station.id, pollutant: p, error: "no_data" });
    }
    res.json({ apiVersion: API_VERSION, station: stationSummary(station), readings });
  } catch (e) {
    console.error(`[external-api] /stations/${station.id}/latest failed: ${e.message}`);
    res.status(500).json({ error: "server_error", message: "Failed to load latest reading." });
  }
});

v1.get("/stations/:station/:pollutant/latest", requireApiKey(["read:latest"]), async (req, res) => {
  const station = getStation(req.params.station);
  const pollutant = String(req.params.pollutant || "").toLowerCase();
  if (!station || !isPollutantAvailable(station.id, pollutant)) {
    return res.status(404).json({ error: "unknown_dataset", message: `No dataset for '${req.params.station}/${req.params.pollutant}'.` });
  }
  try {
    const latest = await loadLatest(station.id, pollutant);
    if (!latest) return res.status(404).json({ error: "no_data", message: "No readings available yet." });
    res.json({ apiVersion: API_VERSION, station: stationSummary(station), reading: latest });
  } catch (e) {
    console.error(`[external-api] latest ${station.id}/${pollutant} failed: ${e.message}`);
    res.status(500).json({ error: "server_error", message: "Failed to load latest reading." });
  }
});

v1.get("/stations/:station/:pollutant/readings", requireApiKey(["read:readings"]), async (req, res) => {
  const station = getStation(req.params.station);
  const pollutant = String(req.params.pollutant || "").toLowerCase();
  if (!station || !isPollutantAvailable(station.id, pollutant)) {
    return res.status(404).json({ error: "unknown_dataset", message: `No dataset for '${req.params.station}/${req.params.pollutant}'.` });
  }

  const from = parseTimeParam(req.query.from);
  const to = parseTimeParam(req.query.to);
  if (Number.isNaN(from) || Number.isNaN(to)) {
    return res.status(400).json({ error: "bad_request", message: "'from'/'to' must be ISO-8601 dates or epoch timestamps." });
  }
  if (from != null && to != null && from > to) {
    return res.status(400).json({ error: "bad_request", message: "'from' must be earlier than 'to'." });
  }
  const limit = clampInt(req.query.limit, { def: 100, min: 1, max: 1000 });
  const page = clampInt(req.query.page, { def: 1, min: 1, max: 100_000 });
  const order = String(req.query.order || "desc").toLowerCase() === "asc" ? "asc" : "desc";
  const validOnly = req.query.validOnly === "1" || req.query.validOnly === "true";

  try {
    const ds = await loadDataset(station.id, pollutant);
    if (!ds) return res.status(404).json({ error: "no_data", message: "No readings available yet." });

    let rows = ds.readings;
    if (from != null) rows = rows.filter((r) => r.epochMs >= from);
    if (to != null) rows = rows.filter((r) => r.epochMs <= to);
    if (validOnly) rows = rows.filter((r) => r.valid);
    if (order === "desc") rows = [...rows].reverse();

    const total = rows.length;
    const start = (page - 1) * limit;
    const pageRows = rows.slice(start, start + limit);
    const totalPages = Math.max(1, Math.ceil(total / limit));

    res.json({
      apiVersion: API_VERSION,
      station: stationSummary(station),
      pollutant,
      pollutantLabel: POLLUTANT_LABEL[pollutant] || pollutant.toUpperCase(),
      unit: POLLUTANT_UNIT,
      query: { from: from != null ? new Date(from).toISOString() : null, to: to != null ? new Date(to).toISOString() : null, order, validOnly },
      pagination: { page, limit, total, totalPages, hasMore: page < totalPages },
      dataset: ds.meta,
      readings: pageRows,
    });
  } catch (e) {
    console.error(`[external-api] readings ${station.id}/${pollutant} failed: ${e.message}`);
    res.status(500).json({ error: "server_error", message: "Failed to load readings." });
  }
});

// Anything else under /api/v1 → JSON 404 (not the default HTML one)
v1.use((req, res) => {
  res.status(404).json({ error: "not_found", message: `No route for ${req.method} ${req.originalUrl}` });
});

router.use("/api/v1", v1);

/* ── Admin: partner key management ─────────────────────────────── */

router.get("/api/admin/api-keys", requireAdminToken, async (req, res) => {
  try {
    res.json({ ok: true, scopes: SCOPES, clients: await listApiClients() });
  } catch (e) {
    res.status(500).json({ error: "Server error" });
  }
});

router.post("/api/admin/api-keys", requireAdminToken, async (req, res) => {
  try {
    const { name, organization, contactEmail, scopes, rateLimitPerMin, expiresAt } = req.body || {};
    const { key, client } = await createApiKey({
      name,
      organization,
      contactEmail,
      scopes,
      rateLimitPerMin,
      expiresAt,
      createdBy: "admin-ui",
    });
    // The plaintext key is returned exactly once.
    res.status(201).json({ ok: true, key, client });
  } catch (e) {
    const status = /required|must be|scope/i.test(e.message) ? 400 : 500;
    res.status(status).json({ error: status === 400 ? e.message : "Server error" });
  }
});

router.delete("/api/admin/api-keys/:id", requireAdminToken, async (req, res) => {
  try {
    const client = await revokeApiKey(req.params.id);
    if (!client) return res.status(404).json({ error: "Key not found or already revoked" });
    res.json({ ok: true, client });
  } catch (e) {
    res.status(500).json({ error: "Server error" });
  }
});

module.exports = router;
