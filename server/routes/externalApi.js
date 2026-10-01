/**
 * External (partner) API — versioned, read-only, API-key protected.
 *
 * Partners get PRESENT and INCOMING data only: the latest reading per
 * station/pollutant plus a short rolling window of recent readings (so a
 * poller that was down can catch up). Historical data is not exposed.
 * Partners can additionally receive an hourly push — see services/apiPush.js.
 *
 * Every key is STATION-SCOPED (services/apiKeys.js): the list, latest and
 * per-station endpoints only ever return the stations approved for that
 * key; any other station answers 403 station_not_allowed.
 *
 * Public (key required):
 *   GET /api/v1/ping                                   — connection test / key info (incl. approved stations)
 *   GET /api/v1/stations                               — approved stations + data freshness
 *   GET /api/v1/latest                                 — latest reading for every approved station/pollutant
 *   GET /api/v1/aqi                                    — EMB-CO shape: station + TIMESTAMP + PM10_AQI/PM25_AQI
 *   GET /api/v1/stations/:station/aqi                  — EMB-CO shape for one station
 *   GET /api/v1/stations/:station/latest               — latest reading(s) for one station
 *   GET /api/v1/stations/:station/:pollutant/latest    — latest reading for one dataset
 *   GET /api/v1/stations/:station/:pollutant/recent    — readings in the rolling recent window
 *
 * The /aqi endpoints return the flat EMB Central Office payload. The same
 * shape is available on /latest and /stations/:station/latest with
 * `?format=emb`, and as the `emb` webhook push format.
 *
 * Admin (X-Admin-Token required — issue/list/revoke partner keys, stations, webhooks):
 *   GET    /api/admin/api-keys
 *   POST   /api/admin/api-keys
 *   DELETE /api/admin/api-keys/:id
 *   PUT    /api/admin/api-keys/:id/stations
 *   PUT    /api/admin/api-keys/:id/webhook
 *   DELETE /api/admin/api-keys/:id/webhook
 *   POST   /api/admin/api-keys/:id/webhook/test
 *   GET    /api/admin/api-keys/:id/deliveries
 */
const { Router } = require("express");
const { isMaintenanceMode } = require("../config/env");
const { POLLUTANT_LABEL, POLLUTANT_UNIT, getAvailableStations, getStation, isPollutantAvailable } = require("../config/stations");
const {
  API_VERSION,
  EMB_VALUE_TYPES,
  stationSummary,
  loadDataset,
  loadLatest,
  buildLatestPayload,
  normalizeValueType,
  toEmbStation,
  toEmbPayload,
} = require("../services/externalData");
const {
  requireApiKey,
  createApiKey,
  listApiClients,
  revokeApiKey,
  setStations,
  setWebhook,
  isStationAllowed,
  SCOPES,
  STATION_IDS,
  WEBHOOK_FORMATS,
} = require("../services/apiKeys");
const { pushToClientNow, listDeliveries, PUSH_CRON } = require("../services/apiPush");
const { requireAdminToken } = require("./admin-auth");

const router = Router();

// Rolling window of "recent" readings partners may fetch (catch-up after downtime).
const RECENT_WINDOW_HOURS = Number(process.env.EXTERNAL_API_RECENT_WINDOW_HOURS || 48);
const RECENT_MAX_LIMIT = 500;

/* ── Helpers ───────────────────────────────────────────────────── */

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

function maintenanceGuard(req, res, next) {
  if (isMaintenanceMode()) {
    res.setHeader("Retry-After", "300");
    return res.status(503).json({ error: "maintenance", message: "System is under maintenance. Please try again later." });
  }
  next();
}

/**
 * Resolve `:station` and enforce the key's station scope. Returns the
 * station, or null after having already sent the 404 / 403 response.
 *
 * `emb` shapes the error bodies as `{ status: "error", … }` so a client that
 * branches on `status` sees a consistent envelope on every response.
 */
function resolveAllowedStation(req, res, { emb = false } = {}) {
  const wrap = (body) => (emb ? { status: "error", ...body } : body);
  const station = getStation(req.params.station);
  if (!station || !station.pollutants.length) {
    res.status(404).json(wrap({ error: "unknown_station", message: `Unknown station '${req.params.station}'.` }));
    return null;
  }
  if (!isStationAllowed(req.apiClient, station.id)) {
    res.status(403).json(
      wrap({
        error: "station_not_allowed",
        message: `This API key is not approved for station '${station.id}'. Approved: ${req.apiClient.stations.join(", ")}.`,
      }),
    );
    return null;
  }
  return station;
}

/** True when the caller asked for the EMB Central Office payload shape. */
function wantsEmbFormat(req) {
  return /^(emb|emb-co|emb_co)$/i.test(String(req.query.format || "").trim());
}

/**
 * Read `reading_value_type` (aliased `valueType`) off the query string.
 * Returns the normalised type, or null after having sent the 400 response.
 */
function resolveValueType(req, res, { emb = false } = {}) {
  try {
    return normalizeValueType(req.query.reading_value_type ?? req.query.valueType ?? "aqi");
  } catch (e) {
    const body = { error: "bad_request", message: e.message, allowed: EMB_VALUE_TYPES };
    res.status(400).json(emb ? { status: "error", ...body } : body);
    return null;
  }
}

/** Latest reading for every pollutant of one station (errors inlined per pollutant). */
async function stationReadings(station) {
  const readings = [];
  for (const p of station.pollutants) {
    const latest = await loadLatest(station.id, p).catch(() => null);
    readings.push(latest || { station: station.id, pollutant: p, error: "no_data" });
  }
  return readings;
}

/* ── Public v1 routes ──────────────────────────────────────────── */

const v1 = Router();
v1.use(maintenanceGuard);

v1.get("/ping", requireApiKey(), (req, res) => {
  res.json({
    ok: true,
    apiVersion: API_VERSION,
    serverTime: new Date().toISOString(),
    client: {
      name: req.apiClient.name,
      organization: req.apiClient.organization,
      scopes: req.apiClient.scopes,
      stations: req.apiClient.stations,
      webhook: req.apiClient.webhook
        ? { enabled: req.apiClient.webhook.enabled, format: req.apiClient.webhook.format, schedule: PUSH_CRON, lastDeliveryAt: req.apiClient.webhook.lastDeliveryAt }
        : null,
    },
    recentWindowHours: RECENT_WINDOW_HOURS,
    readingValueTypes: EMB_VALUE_TYPES,
  });
});

v1.get("/stations", requireApiKey(["read:stations"]), async (req, res) => {
  try {
    // Only the stations this key was approved for
    const stations = getAvailableStations().filter((s) => isStationAllowed(req.apiClient, s.id));
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
  const emb = wantsEmbFormat(req);
  const valueType = emb ? resolveValueType(req, res, { emb }) : "aqi";
  if (!valueType) return;
  try {
    const payload = await buildLatestPayload(req.apiClient.stations);
    res.json(emb ? toEmbPayload(payload, valueType) : payload);
  } catch (e) {
    console.error(`[external-api] /latest failed: ${e.message}`);
    const body = { error: "server_error", message: "Failed to load latest readings." };
    res.status(500).json(emb ? { status: "error", ...body } : body);
  }
});

/**
 * EMB Central Office shape for every approved station. Keys are issued per
 * station, so this normally answers with the single bare station object; see
 * toEmbPayload() for the multi-station form.
 */
v1.get("/aqi", requireApiKey(["read:latest"]), async (req, res) => {
  const valueType = resolveValueType(req, res, { emb: true });
  if (!valueType) return;
  try {
    const payload = await buildLatestPayload(req.apiClient.stations);
    if (!payload.readings.length) {
      return res.status(404).json({ status: "error", error: "no_data", message: "No readings available yet." });
    }
    res.json(toEmbPayload(payload, valueType));
  } catch (e) {
    console.error(`[external-api] /aqi failed: ${e.message}`);
    res.status(500).json({ status: "error", error: "server_error", message: "Failed to load latest readings." });
  }
});

/** EMB Central Office shape for one station — always a single bare object. */
v1.get("/stations/:station/aqi", requireApiKey(["read:latest"]), async (req, res) => {
  const station = resolveAllowedStation(req, res, { emb: true });
  if (!station) return;
  const valueType = resolveValueType(req, res, { emb: true });
  if (!valueType) return;
  try {
    const readings = await stationReadings(station);
    if (!readings.some((r) => !r.error)) {
      return res.status(404).json({ status: "error", error: "no_data", message: "No readings available yet." });
    }
    res.json({ status: "success", ...toEmbStation(station.name, readings, valueType) });
  } catch (e) {
    console.error(`[external-api] /stations/${station.id}/aqi failed: ${e.message}`);
    res.status(500).json({ status: "error", error: "server_error", message: "Failed to load latest reading." });
  }
});

v1.get("/stations/:station/latest", requireApiKey(["read:latest"]), async (req, res) => {
  const emb = wantsEmbFormat(req);
  const station = resolveAllowedStation(req, res, { emb });
  if (!station) return;
  const valueType = emb ? resolveValueType(req, res, { emb }) : "aqi";
  if (!valueType) return;
  try {
    const readings = await stationReadings(station);
    if (emb) {
      if (!readings.some((r) => !r.error)) {
        return res.status(404).json({ status: "error", error: "no_data", message: "No readings available yet." });
      }
      return res.json({ status: "success", ...toEmbStation(station.name, readings, valueType) });
    }
    res.json({ apiVersion: API_VERSION, station: stationSummary(station), readings });
  } catch (e) {
    console.error(`[external-api] /stations/${station.id}/latest failed: ${e.message}`);
    const body = { error: "server_error", message: "Failed to load latest reading." };
    res.status(500).json(emb ? { status: "error", ...body } : body);
  }
});

v1.get("/stations/:station/:pollutant/latest", requireApiKey(["read:latest"]), async (req, res) => {
  const station = resolveAllowedStation(req, res);
  if (!station) return;
  const pollutant = String(req.params.pollutant || "").toLowerCase();
  if (!isPollutantAvailable(station.id, pollutant)) {
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

/**
 * Recent readings — a rolling window (RECENT_WINDOW_HOURS) ending now.
 * `from`/`to` may narrow the window but never widen it; anything earlier than
 * the window start (or the key's issue date) is silently clipped.
 */
v1.get("/stations/:station/:pollutant/recent", requireApiKey(["read:recent"]), async (req, res) => {
  const station = resolveAllowedStation(req, res);
  if (!station) return;
  const pollutant = String(req.params.pollutant || "").toLowerCase();
  if (!isPollutantAvailable(station.id, pollutant)) {
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
  const limit = clampInt(req.query.limit, { def: 100, min: 1, max: RECENT_MAX_LIMIT });
  const order = String(req.query.order || "desc").toLowerCase() === "asc" ? "asc" : "desc";
  const validOnly = req.query.validOnly === "1" || req.query.validOnly === "true";

  const now = Date.now();
  const keyIssuedAt = req.apiClient.createdAt ? new Date(req.apiClient.createdAt).getTime() : 0;
  const windowStart = Math.max(now - RECENT_WINDOW_HOURS * 3_600_000, keyIssuedAt);
  const effFrom = Math.max(windowStart, from ?? windowStart);
  const effTo = Math.min(now, to ?? now);

  try {
    const ds = await loadDataset(station.id, pollutant);
    if (!ds) return res.status(404).json({ error: "no_data", message: "No readings available yet." });

    let rows = ds.readings.filter((r) => r.epochMs >= effFrom && r.epochMs <= effTo);
    if (validOnly) rows = rows.filter((r) => r.valid);
    if (order === "desc") rows = [...rows].reverse();
    const total = rows.length;
    const readings = rows.slice(0, limit);

    res.json({
      apiVersion: API_VERSION,
      station: stationSummary(station),
      pollutant,
      pollutantLabel: POLLUTANT_LABEL[pollutant] || pollutant.toUpperCase(),
      unit: POLLUTANT_UNIT,
      window: {
        hours: RECENT_WINDOW_HOURS,
        from: new Date(effFrom).toISOString(),
        to: new Date(effTo).toISOString(),
        clipped: from != null && from < windowStart,
      },
      query: { order, validOnly, limit },
      total,
      returned: readings.length,
      truncated: total > readings.length,
      lastReadingAt: ds.meta.lastReadingAt,
      updatedAt: ds.meta.lastBackupAt,
      readings,
    });
  } catch (e) {
    console.error(`[external-api] recent ${station.id}/${pollutant} failed: ${e.message}`);
    res.status(500).json({ error: "server_error", message: "Failed to load recent readings." });
  }
});

// Historical endpoint is intentionally not offered — make that explicit.
v1.get("/stations/:station/:pollutant/readings", requireApiKey(), (req, res) => {
  res.status(404).json({
    error: "not_available",
    message: `Historical readings are not exposed. Use /recent (rolling ${RECENT_WINDOW_HOURS}h window) or the hourly push.`,
  });
});

// Anything else under /api/v1 → JSON 404 (not the default HTML one)
v1.use((req, res) => {
  res.status(404).json({ error: "not_found", message: `No route for ${req.method} ${req.originalUrl}` });
});

router.use("/api/v1", v1);

/* ── Admin: partner key & webhook management ───────────────────── */

function adminError(res, e) {
  const status = /required|must be|scope|station|valid|one of|not found|no webhook/i.test(e.message) ? 400 : 500;
  res.status(status).json({ error: status === 400 ? e.message : "Server error" });
}

router.get("/api/admin/api-keys", requireAdminToken, async (req, res) => {
  try {
    res.json({
      ok: true,
      scopes: SCOPES,
      stations: STATION_IDS,
      webhookFormats: WEBHOOK_FORMATS,
      pushSchedule: PUSH_CRON,
      recentWindowHours: RECENT_WINDOW_HOURS,
      clients: await listApiClients(),
    });
  } catch (e) {
    res.status(500).json({ error: "Server error" });
  }
});

router.post("/api/admin/api-keys", requireAdminToken, async (req, res) => {
  try {
    const { name, organization, contactEmail, stations, scopes, rateLimitPerMin, expiresAt, webhook } = req.body || {};
    const { key, client } = await createApiKey({
      name,
      organization,
      contactEmail,
      stations,
      scopes,
      rateLimitPerMin,
      expiresAt,
      webhook,
      createdBy: "admin-ui",
    });
    // The plaintext key is returned exactly once.
    res.status(201).json({ ok: true, key, client });
  } catch (e) {
    adminError(res, e);
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

// Replace the approved-station list for a key (takes effect on the next request / push)
router.put("/api/admin/api-keys/:id/stations", requireAdminToken, async (req, res) => {
  try {
    const client = await setStations(req.params.id, (req.body || {}).stations);
    if (!client) return res.status(404).json({ error: "Key not found" });
    res.json({ ok: true, client });
  } catch (e) {
    adminError(res, e);
  }
});

router.put("/api/admin/api-keys/:id/webhook", requireAdminToken, async (req, res) => {
  try {
    const client = await setWebhook(req.params.id, req.body || {});
    if (!client) return res.status(404).json({ error: "Key not found" });
    res.json({ ok: true, client });
  } catch (e) {
    adminError(res, e);
  }
});

router.delete("/api/admin/api-keys/:id/webhook", requireAdminToken, async (req, res) => {
  try {
    const client = await setWebhook(req.params.id, null);
    if (!client) return res.status(404).json({ error: "Key not found" });
    res.json({ ok: true, client });
  } catch (e) {
    res.status(500).json({ error: "Server error" });
  }
});

router.post("/api/admin/api-keys/:id/webhook/test", requireAdminToken, async (req, res) => {
  try {
    const result = await pushToClientNow(req.params.id, "test");
    res.status(result.ok ? 200 : 502).json({ ok: result.ok, result });
  } catch (e) {
    adminError(res, e);
  }
});

router.get("/api/admin/api-keys/:id/deliveries", requireAdminToken, async (req, res) => {
  try {
    res.json({ ok: true, deliveries: await listDeliveries(req.params.id, req.query.limit) });
  } catch (e) {
    res.status(500).json({ error: "Server error" });
  }
});

module.exports = router;
