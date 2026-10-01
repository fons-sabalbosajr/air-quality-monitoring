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

/* ── EMB Central Office payload shape ─────────────────────────────
 *
 * EMB-CO's ingester expects one flat object per station, with both
 * pollutants side by side and the values as strings:
 *
 *   {
 *     "status": "success",
 *     "station_name": "Meycauayan AQMS",
 *     "reading_value_type": "aqi",
 *     "data": { "TIMESTAMP": "2026-09-15 08:00:00", "PM10_AQI": "45", "PM25_AQI": "47" }
 *   }
 *
 * `reading_value_type` selects which number goes in the data block:
 *   aqi           → PM10_AQI / PM25_AQI     (the AQI the dashboard shows)
 *   concentration → PM10_CONC / PM25_CONC   (raw hourly µg/Ncm)
 */

const EMB_VALUE_TYPES = ["aqi", "concentration"];
const EMB_VALUE_SUFFIX = { aqi: "AQI", concentration: "CONC" };
const EMB_POLLUTANT_PREFIX = { pm10: "PM10", pm25: "PM25" };

/** Normalise a client-supplied reading_value_type, or throw. */
function normalizeValueType(v) {
  const t = String(v ?? "aqi").trim().toLowerCase();
  if (!EMB_VALUE_TYPES.includes(t)) {
    throw new Error(`reading_value_type must be one of: ${EMB_VALUE_TYPES.join(", ")}`);
  }
  return t;
}

function embFieldName(pollutant, valueType) {
  const prefix = EMB_POLLUTANT_PREFIX[pollutant] || String(pollutant).toUpperCase();
  return `${prefix}_${EMB_VALUE_SUFFIX[valueType]}`;
}

/**
 * "YYYY-MM-DD HH:mm:ss" in station-local time.
 *
 * The sheet stores wall-clock Manila time ("10/01/2026 2:00 PM") and
 * parseDateValue() builds the Date from those components in the server's
 * local zone, so reading them back with the local getters round-trips the
 * original reading hour exactly — no timezone conversion is applied.
 */
function formatEmbTimestamp(epochMs) {
  if (!epochMs) return null;
  const d = new Date(epochMs);
  if (isNaN(d.getTime())) return null;
  const p = (n) => String(n).padStart(2, "0");
  return (
    `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ` +
    `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
  );
}

/**
 * One EMB-CO station object. `readings` are this station's latest readings
 * (one per pollutant, as produced by loadLatest). Values are emitted as
 * strings; a pollutant with no usable number is emitted as null so the field
 * set stays stable. TIMESTAMP is the newest reading hour in the set — all
 * pollutants of a station share the same hourly slot.
 */
function toEmbStation(stationName, readings, valueType = "aqi") {
  const usable = (readings || []).filter((r) => r && !r.error);
  const data = {};
  let newest = 0;
  for (const r of usable) {
    const value = valueType === "aqi" ? r.aqi : r.concentration;
    data[embFieldName(r.pollutant, valueType)] = value != null ? String(value) : null;
    if (r.epochMs && r.epochMs > newest) newest = r.epochMs;
  }
  return {
    station_name: stationName,
    reading_value_type: valueType,
    data: { TIMESTAMP: formatEmbTimestamp(newest), ...data },
  };
}

/**
 * Group a latest payload (buildLatestPayload output) by station and reshape
 * it into the EMB-CO form. Returns an array of station objects in the same
 * order the stations are configured.
 */
function toEmbStations(payload, valueType = "aqi") {
  const byStation = new Map();
  for (const r of payload.readings || []) {
    if (!byStation.has(r.station)) {
      byStation.set(r.station, { name: r.stationName || r.station, readings: [] });
    }
    byStation.get(r.station).readings.push(r);
  }
  return [...byStation.values()].map((s) => toEmbStation(s.name, s.readings, valueType));
}

/**
 * EMB-CO response for a multi-station request (`/latest?format=emb` and the
 * `emb` push format). Single-station keys — which is how EMB-CO keys are
 * issued — get the bare station object; only a key approved for more than
 * one station gets the `stations` array, so the shape never changes under a
 * given key.
 */
function toEmbPayload(payload, valueType = "aqi") {
  const stations = toEmbStations(payload, valueType);
  if (stations.length === 1) return { status: "success", ...stations[0] };
  return {
    status: "success",
    reading_value_type: valueType,
    generated_at: formatEmbTimestamp(Date.parse(payload.generatedAt)),
    count: stations.length,
    stations,
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

/**
 * Latest reading for every configured station/pollutant — the /latest and
 * push payload. Pass `stationIds` to restrict it to a client's approved
 * stations (null = every configured station).
 */
async function buildLatestPayload(stationIds = null) {
  const results = [];
  const stations = stationIds
    ? getAvailableStations().filter((s) => stationIds.includes(s.id))
    : getAvailableStations();
  for (const s of stations) {
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
 * Narrow an already-built latest payload to a client's approved stations.
 * Lets the push job read the data once per cycle and still deliver each
 * client only the stations it was granted.
 */
function filterLatestPayload(payload, stationIds) {
  const readings = payload.readings.filter((r) => stationIds.includes(r.station));
  return { ...payload, count: readings.length, readings };
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
  EMB_VALUE_TYPES,
  toReading,
  stationSummary,
  loadDataset,
  loadLatest,
  buildLatestPayload,
  filterLatestPayload,
  toPowerBiRows,
  normalizeValueType,
  formatEmbTimestamp,
  toEmbStation,
  toEmbStations,
  toEmbPayload,
};
