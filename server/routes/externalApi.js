/**
 * External (partner) API — versioned, read-only, API-key protected.
 *
 * Partners get PRESENT and INCOMING data only: the latest reading per
 * station/pollutant plus a short rolling window of recent readings (so a
 * poller that was down can catch up). Historical data is not exposed.
 * Partners can additionally receive an hourly push — see services/apiPush.js.
 *
 * Public (key required):
 *   GET /api/v1/ping                                   — connection test / key info
 *   GET /api/v1/stations                               — station registry + data freshness
 *   GET /api/v1/latest                                 — latest reading for every station/pollutant
 *   GET /api/v1/stations/:station/latest               — latest reading(s) for one station
 *   GET /api/v1/stations/:station/:pollutant/latest    — latest reading for one dataset
 *   GET /api/v1/stations/:station/:pollutant/recent    — readings in the rolling recent window
 *
 * Admin (X-Admin-Token required — issue/list/revoke partner keys, webhooks):
 *   GET    /api/admin/api-keys
 *   POST   /api/admin/api-keys
 *   DELETE /api/admin/api-keys/:id
 *   PUT    /api/admin/api-keys/:id/webhook
 *   DELETE /api/admin/api-keys/:id/webhook
 *   POST   /api/admin/api-keys/:id/webhook/test
 *   GET    /api/admin/api-keys/:id/deliveries
 */
const { Router } = require("express");
const { isMaintenanceMode } = require("../config/env");
const { POLLUTANT_LABEL, POLLUTANT_UNIT, getAvailableStations, getStation, isPollutantAvailable } = require("../config/stations");
const { API_VERSION, stationSummary, loadDataset, loadLatest, buildLatestPayload } = require("../services/externalData");
const {
  requireApiKey,
  createApiKey,
  listApiClients,
  revokeApiKey,
  setWebhook,
  SCOPES,
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
      webhook: req.apiClient.webhook
        ? { enabled: req.apiClient.webhook.enabled, format: req.apiClient.webhook.format, schedule: PUSH_CRON, lastDeliveryAt: req.apiClient.webhook.lastDeliveryAt }
        : null,
    },
    recentWindowHours: RECENT_WINDOW_HOURS,
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
    res.json(await buildLatestPayload());
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

/**
 * Recent readings — a rolling window (RECENT_WINDOW_HOURS) ending now.
 * `from`/`to` may narrow the window but never widen it; anything earlier than
 * the window start (or the key's issue date) is silently clipped.
 */
v1.get("/stations/:station/:pollutant/recent", requireApiKey(["read:recent"]), async (req, res) => {
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
  const status = /required|must be|scope|valid|one of|not found|no webhook/i.test(e.message) ? 400 : 500;
  res.status(status).json({ error: status === 400 ? e.message : "Server error" });
}

router.get("/api/admin/api-keys", requireAdminToken, async (req, res) => {
  try {
    res.json({
      ok: true,
      scopes: SCOPES,
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
    const { name, organization, contactEmail, scopes, rateLimitPerMin, expiresAt, webhook } = req.body || {};
    const { key, client } = await createApiKey({
      name,
      organization,
      contactEmail,
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
