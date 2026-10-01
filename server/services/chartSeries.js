/**
 * Time-series shaping for the admin Charts page (/admin/charts).
 *
 * Both series are built from the MongoDB tabular backup — the same snapshot
 * that feeds the kiosk, the NLEX wall, the Data Manager and the partner API —
 * so the charts move with the live Google Sheets pipeline instead of the
 * retired Excel/SharePoint workbook, whose ingested series stopped updating in
 * November 2025.
 *
 *   hourly — one point per hourly reading
 *   daily  — one point per calendar day, aggregated from that day's readings
 *
 * `value` picks what `y` carries:
 *   concentration — the raw hourly reading (µg/Ncm)
 *   rolling       — the 24-hour rolling average (µg/Ncm); what the AQI bands classify
 *   aqi           — the AQI computed from the rolling average
 *
 * Reads go through externalData.loadDataset(), which applies the same
 * enrichWithAqi() pass the dashboard uses and caches the enriched rows for
 * EXTERNAL_API_CACHE_TTL_MS (default 60 s).
 */
const { loadDataset } = require("./externalData");
const {
  getAvailableStations,
  getStation,
  isPollutantAvailable,
  POLLUTANT_LABEL,
  POLLUTANT_UNIT,
} = require("../config/stations");

const DEFAULT_STATION = (process.env.CHARTS_DEFAULT_STATION || "meycauayan").toLowerCase();
const DEFAULT_POLLUTANT = (process.env.CHARTS_DEFAULT_POLLUTANT || "pm10").toLowerCase();

const VALUE_TYPES = ["concentration", "rolling", "aqi"];
const VALUE_LABEL = {
  concentration: "Hourly Reading",
  rolling: "24 HR Rolling Average",
  aqi: "AQI",
};

/** Thrown for bad query input so the route can answer 400 rather than 500. */
class BadSeriesRequest extends Error {}

/** Thrown when a cold build outran its deadline — the route answers 503. */
class SeriesWarming extends Error {}

/* ── Series cache: stale-while-revalidate + a hard cold deadline ──
 *
 * Built series are cached briefly so the Charts page can poll at real-time
 * cadence without rebuilding anything. Once a series is cached, a stale hit is
 * returned immediately and the refresh lands in the background, so a poll
 * never blocks on MongoDB.
 *
 * A genuinely cold build is bounded by COLD_BUILD_TIMEOUT_MS, which must stay
 * under the Nginx proxy_read_timeout (30 s): the build keeps running and
 * populates the cache, but the request answers 503 "warming up" instead of
 * hanging until the proxy returns 504.
 */
const SERIES_TTL_MS = Number(process.env.CHARTS_SERIES_TTL_MS || 30_000);
const COLD_BUILD_TIMEOUT_MS = Number(process.env.CHARTS_COLD_BUILD_TIMEOUT_MS || 20_000);

const _seriesCache = new Map(); // cacheKey -> { ts, payload }
const _inflight = new Map(); // cacheKey -> Promise

function withDeadline(promise, ms, key) {
  return new Promise((resolve, reject) => {
    const tid = setTimeout(
      () => reject(new SeriesWarming(`Series for '${key}' is still being built. Retry in a few seconds.`)),
      ms,
    );
    promise.then(
      (v) => { clearTimeout(tid); resolve(v); },
      (e) => { clearTimeout(tid); reject(e); },
    );
  });
}

/**
 * @param {boolean} [opts.wait] Wait for a cold build however long it takes,
 *   instead of giving up at COLD_BUILD_TIMEOUT_MS. Only the startup warm-up
 *   sets this — the deadline exists to keep an HTTP request inside the proxy
 *   timeout, and a background pre-build has no such constraint.
 */
async function cachedSeries(cacheKey, build, { wait = false } = {}) {
  const hit = _seriesCache.get(cacheKey);
  if (hit && Date.now() - hit.ts < SERIES_TTL_MS) return hit.payload;

  let pending = _inflight.get(cacheKey);
  if (!pending) {
    pending = build()
      .then((payload) => {
        if (payload) _seriesCache.set(cacheKey, { ts: Date.now(), payload });
        return payload;
      })
      .finally(() => _inflight.delete(cacheKey));
    _inflight.set(cacheKey, pending);
  }

  // Stale copy in hand: serve it now and let the refresh settle on its own.
  if (hit && !wait) {
    pending.catch(() => {});
    return hit.payload;
  }
  if (wait) return pending;
  return withDeadline(pending, COLD_BUILD_TIMEOUT_MS, cacheKey);
}

/**
 * Validate `?station=&pollutant=&value=`, falling back to the configured
 * defaults. Throws BadSeriesRequest naming the valid options.
 */
function resolveTarget(query = {}, { defaultValue = "concentration" } = {}) {
  const stationId = String(query.station || DEFAULT_STATION).trim().toLowerCase();
  const pollutant = String(query.pollutant || DEFAULT_POLLUTANT).trim().toLowerCase();
  const value = String(query.value || defaultValue).trim().toLowerCase();

  const station = getStation(stationId);
  if (!station || !station.pollutants.length) {
    const ids = getAvailableStations().map((s) => s.id).join(", ");
    throw new BadSeriesRequest(`Unknown station '${stationId}'. Available: ${ids}`);
  }
  if (!isPollutantAvailable(stationId, pollutant)) {
    throw new BadSeriesRequest(
      `Station '${stationId}' has no '${pollutant}' dataset. Available: ${station.pollutants.join(", ")}`,
    );
  }
  if (!VALUE_TYPES.includes(value)) {
    throw new BadSeriesRequest(`value must be one of: ${VALUE_TYPES.join(", ")}`);
  }
  return { station, pollutant, value };
}

function pickValue(reading, value) {
  if (value === "aqi") return reading.aqi;
  if (value === "rolling") return reading.rollingAverage24h;
  return reading.concentration;
}

/** Local calendar-day key for a reading, e.g. "2026-10-01". */
function dayKey(epochMs) {
  const d = new Date(epochMs);
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function seriesMeta({ station, pollutant, value, granularity, ds, points }) {
  return {
    station: station.id,
    stationName: station.name,
    pollutant,
    pollutantLabel: POLLUTANT_LABEL[pollutant] || pollutant.toUpperCase(),
    unit: value === "aqi" ? "AQI" : POLLUTANT_UNIT,
    value,
    granularity,
    yLabel: VALUE_LABEL[value],
    points,
    lastReadingAt: ds.meta.lastReadingAt,
    updatedAt: ds.meta.lastBackupAt,
    lastCheckedAt: ds.meta.lastCheckedAt,
  };
}

/**
 * Hourly series — one point per reading, oldest first.
 * Points carry `aqi` and `status` alongside `y` for tooltips and tables.
 */
async function buildHourlySeries(query = {}, opts = {}) {
  const { station, pollutant, value } = resolveTarget(query, { defaultValue: "concentration" });
  return cachedSeries(`hourly:${station.id}:${pollutant}:${value}`, async () => {
    const ds = await loadDataset(station.id, pollutant);
    if (!ds) return null;

    const series = [];
    for (const r of ds.readings) {
      const y = pickValue(r, value);
      if (y == null || !Number.isFinite(y)) continue;
      series.push({ t: r.epochMs, y, aqi: r.aqi, status: r.category });
    }
    return { series, meta: seriesMeta({ station, pollutant, value, granularity: "hourly", ds, points: series.length }) };
  }, opts);
}

/**
 * Daily series — one point per calendar day, oldest first. `y` is the mean of
 * that day's readings (rounded to 2 dp); `n` is how many readings it averaged,
 * so a partial day is visible rather than silently equal-weighted.
 */
async function buildDailySeries(query = {}, opts = {}) {
  const { station, pollutant, value } = resolveTarget(query, { defaultValue: "rolling" });
  return cachedSeries(`daily:${station.id}:${pollutant}:${value}`, async () => {
    const ds = await loadDataset(station.id, pollutant);
    if (!ds) return null;

    const days = new Map(); // "YYYY-MM-DD" -> { t, sum, n, aqiSum, aqiN }
    for (const r of ds.readings) {
      const y = pickValue(r, value);
      if (y == null || !Number.isFinite(y)) continue;
      const key = dayKey(r.epochMs);
      let d = days.get(key);
      if (!d) {
        // Anchor each day at local midnight so the x-axis ticks are clean dates.
        const at = new Date(r.epochMs);
        at.setHours(0, 0, 0, 0);
        d = { t: at.getTime(), sum: 0, n: 0, aqiSum: 0, aqiN: 0 };
        days.set(key, d);
      }
      d.sum += y;
      d.n += 1;
      if (r.aqi != null && Number.isFinite(r.aqi)) {
        d.aqiSum += r.aqi;
        d.aqiN += 1;
      }
    }

    const series = [...days.values()]
      .sort((a, b) => a.t - b.t)
      .map((d) => ({
        t: d.t,
        y: Math.round((d.sum / d.n) * 100) / 100,
        aqi: d.aqiN ? Math.round(d.aqiSum / d.aqiN) : null,
        n: d.n,
      }));

    return { series, meta: seriesMeta({ station, pollutant, value, granularity: "daily", ds, points: series.length }) };
  }, opts);
}

/** Stations and pollutants the Charts page can offer, for its selector. */
function chartTargets() {
  return {
    defaults: { station: DEFAULT_STATION, pollutant: DEFAULT_POLLUTANT },
    values: VALUE_TYPES,
    stations: getAvailableStations().map((s) => ({
      id: s.id,
      name: s.name,
      pollutants: s.pollutants.map((p) => ({ id: p, label: POLLUTANT_LABEL[p] || p.toUpperCase() })),
    })),
  };
}

/**
 * Pre-build the series the Charts page opens on, so the first admin visit
 * after a restart is served from cache instead of paying a cold MongoDB read.
 * Called in the background from server.js; failures are non-fatal.
 */
async function warmChartSeries() {
  const query = { station: DEFAULT_STATION, pollutant: DEFAULT_POLLUTANT };
  // wait: true — a background pre-build has no proxy timeout to respect, so it
  // must not abandon a slow first MongoDB read at the request deadline.
  const results = await Promise.allSettled([
    buildHourlySeries(query, { wait: true }),
    buildDailySeries(query, { wait: true }),
  ]);
  const failed = results.filter((r) => r.status === "rejected");
  if (failed.length) {
    console.warn(`[charts] warm-up incomplete: ${failed.map((f) => f.reason?.message).join("; ")}`);
  } else {
    const [hourly, daily] = results.map((r) => r.value);
    console.log(
      `[charts] warmed ${DEFAULT_STATION}:${DEFAULT_POLLUTANT} — ` +
        `${hourly?.series.length ?? 0} hourly, ${daily?.series.length ?? 0} daily points ` +
        `(latest ${hourly?.meta.lastReadingAt || "n/a"})`,
    );
  }
}

module.exports = {
  BadSeriesRequest,
  SeriesWarming,
  VALUE_TYPES,
  buildHourlySeries,
  buildDailySeries,
  chartTargets,
  resolveTarget,
  warmChartSeries,
};
