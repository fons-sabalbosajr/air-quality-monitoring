/**
 * Data shaping for the external (partner) API — shared by the /api/v1
 * routes and the hourly push (webhook) job.
 *
 * Everything here reads from the MongoDB backup snapshot (air_data_backup*)
 * and enriches it with the same AQI / rolling-average logic the dashboard
 * uses, so partners receive exactly what the kiosk and admin pages show.
 */
const { enrichWithAqi } = require("./googleSheets");
const { getBackupData, getLatestAqiSnapshot } = require("./tabularBackup");
const { parseDateValue } = require("../utils/dateUtils");
const { coerceNumber } = require("../utils/mathUtils");
const { POLLUTANT_LABEL, POLLUTANT_UNIT, getAvailableStations } = require("../config/stations");

const API_VERSION = "1";

/* ── Row normalisation ─────────────────────────────────────────── */

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

/* ── Enriched dataset cache (datasets are 6–11k rows each) ─────── */

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
      lastReadingAt: readings.length ? readings[readings.length - 1].time : null,
    },
  };
  _datasetCache.set(key, entry);
  return entry;
}

/** Latest reading for one station/pollutant (snapshot first, dataset fallback). */
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
  const ds = await loadDataset(station, pollutant);
  if (!ds) return null;
  const latest = [...ds.readings].reverse().find((r) => r.valid) || ds.readings[ds.readings.length - 1];
  return latest ? { station, ...latest, verified: false, updatedAt: ds.meta.lastBackupAt, source: "dataset" } : null;
}

/** Latest reading for every configured station/pollutant — the /latest and push payload. */
async function buildLatestPayload() {
  const results = [];
  for (const s of getAvailableStations()) {
    for (const p of s.pollutants) {
      const latest = await loadLatest(s.id, p).catch(() => null);
      results.push(
        latest
          ? { ...latest, stationName: s.name }
          : { station: s.id, stationName: s.name, pollutant: p, error: "no_data" },
      );
    }
  }
  return {
    apiVersion: API_VERSION,
    generatedAt: new Date().toISOString(),
    count: results.length,
    readings: results,
  };
}

/**
 * Flatten the latest payload into plain rows for Power BI streaming datasets.
 * Power BI push datasets accept only Text / Number / DateTime columns, so
 * booleans are sent as 1 / 0 and nulls are avoided where a Number is expected.
 * The column list here must match the dataset schema in POWERBI_GUIDE.md.
 */
function toPowerBiRows(payload) {
  return payload.readings
    .filter((r) => !r.error)
    .map((r) => ({
      station: r.station,
      stationName: r.stationName || r.station,
      pollutant: r.pollutantLabel || r.pollutant,
      time: r.time,
      localTime: r.localTime || "",
      concentration: r.concentration ?? 0,
      rollingAverage24h: r.rollingAverage24h ?? 0,
      aqi: r.aqi ?? 0,
      category: r.category || "Pending",
      valid: r.valid ? 1 : 0,
      verified: r.verified ? 1 : 0,
      generatedAt: payload.generatedAt,
    }));
}

module.exports = {
  API_VERSION,
  toReading,
  stationSummary,
  loadDataset,
  loadLatest,
  buildLatestPayload,
  toPowerBiRows,
};
