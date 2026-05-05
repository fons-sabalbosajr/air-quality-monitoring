/**
 * Tabular data routes (Google Sheets) + MongoDB backup fallback + export logging.
 */
const crypto = require("crypto");
const { Router } = require("express");
const { TABULAR_SHEETS } = require("../config/sheets");
const { getTabularTable, enrichWithAqi, getRawTabularTable } = require("../services/googleSheets");
const { ensureMongo } = require("../services/mongo");
const {
  backupOne,
  getBackupData,
  getBackupStatus,
  checkForUpdates,
  runBackupCycle,
  isSyncing,
} = require("../services/tabularBackup");
const { clearCache: clearSheetCache } = require("../services/googleSheets");
const { isMaintenanceMode } = require("../config/env");

const router = Router();

/**
 * Generate a weak ETag from response payload for conditional caching.
 */
function generateETag(body) {
  const hash = crypto.createHash("md5").update(JSON.stringify(body)).digest("hex").slice(0, 16);
  return `W/"${hash}"`;
}

/**
 * Set cache headers and handle ETag conditional responses.
 * Returns true if a 304 Not Modified was sent (caller should return early).
 */
function setCacheHeaders(req, res, body) {
  const etag = generateETag(body);
  // Private cache: don't store in shared proxies; revalidate after 60s
  res.setHeader("Cache-Control", "private, max-age=60, stale-while-revalidate=300");
  res.setHeader("ETag", etag);
  res.setHeader("Vary", "Accept");
  if (req.headers["if-none-match"] === etag) {
    res.status(304).end();
    return true;
  }
  return false;
}

// Debounce background backup refreshes — at most once per key every 2 min
const _lastBackupRefresh = new Map();
const BACKUP_REFRESH_DEBOUNCE_MS = 120_000; // 2 min

function maybeRefreshBackup(province, pollutant) {
  const key = `${province}:${pollutant}`;
  const now = Date.now();
  const last = _lastBackupRefresh.get(key) || 0;
  if (now - last < BACKUP_REFRESH_DEBOUNCE_MS) return; // skip, too soon
  _lastBackupRefresh.set(key, now);
  backupOne(province, pollutant).catch(() => {});
}

// In-memory enriched result cache — avoids re-fetching 5000+ rows from MongoDB every request
const _enrichedCache = new Map();
const ENRICHED_CACHE_TTL_MS = 120_000; // 2 min (near-real-time for kiosk)

function getCachedEnriched(key) {
  const entry = _enrichedCache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.ts > ENRICHED_CACHE_TTL_MS) {
    _enrichedCache.delete(key);
    return null;
  }
  return entry.json; // pre-serialized JSON string
}

function setCachedEnriched(key, body) {
  // Evict oldest if cache grows too large
  if (_enrichedCache.size >= 20) {
    const oldest = _enrichedCache.keys().next().value;
    _enrichedCache.delete(oldest);
  }
  _enrichedCache.set(key, { json: JSON.stringify(body), ts: Date.now() });
}

// Tabular Results — serves MongoDB backup first (fast), refreshes from Sheets in background
router.get("/api/tabular/:province/:pollutant", async (req, res) => {
  try {
    if (isMaintenanceMode()) {
      return res.status(503).json({ error: "maintenance", message: "System is under maintenance. Please try again later." });
    }
    const province = String(req.params.province || "").toLowerCase();
    const pollutant = String(req.params.pollutant || "").toLowerCase();
    if (!province || !pollutant) {
      return res.status(400).json({ error: "Missing province or pollutant" });
    }
    if (!TABULAR_SHEETS[province] || !TABULAR_SHEETS[province][pollutant]) {
      return res.status(404).json({ error: "Unknown province or pollutant" });
    }

    // 0) Check in-memory enriched cache first (instant)
    const cacheKey = `${province}:${pollutant}`;
    const cachedJson = getCachedEnriched(cacheKey);
    if (cachedJson) {
      // Re-inject live sheetSyncing state (not stored in cache) and
      // forward the rest of the cached response as-is.
      const cached = JSON.parse(cachedJson);
      const live = { ...cached, sheetSyncing: isSyncing(cacheKey) };
      res.setHeader("Content-Type", "application/json");
      res.setHeader("Cache-Control", "public, max-age=60, stale-while-revalidate=300");
      return res.end(JSON.stringify(live));
    }

    // 1) Try MongoDB backup first (raw data, sub-second response)
    const backup = await getBackupData(province, pollutant);
    if (backup && backup.rows && backup.rows.length > 0) {
      // Compute AQI / Rolling Average / Status on-the-fly
      const enriched = enrichWithAqi(
        {
          columns: backup.columns,
          rows: backup.rows,
          dateKey: backup.dateKey,
          concKey: backup.concKey,
        },
        pollutant,
        { logsPerHour: 1 },
      );
      // Kick off a debounced background refresh from Google Sheets
      maybeRefreshBackup(province, pollutant);
      const body = {
        province: backup.province,
        pollutant: backup.pollutant,
        columns: enriched.columns,
        rows: enriched.rows,
        totalRows: enriched.rows.length,
        fetchedAt: backup.fetchedAt,
        source: backup.source,
        backupMeta: backup.backupMeta,
        dateKey: enriched.dateKey || null,
        concKey: enriched.concKey || null,
        // sheetSyncing: true when a live Google Sheets fetch is in progress for this key
        sheetSyncing: isSyncing(cacheKey),
        // latestAqiVerified: AQI on the newest row came directly from the Google Sheet
        latestAqiVerified: enriched.latestAqiVerified ?? false,
      };
      setCachedEnriched(cacheKey, body);
      if (setCacheHeaders(req, res, body)) return;
      return res.json(body);
    }

    // 2) No backup yet — fall back to Google Sheets (first-time load)
    //    Apply a 45s timeout so the frontend doesn't hang indefinitely.
    try {
      const sheetPromise = getRawTabularTable(province, pollutant);
      const timeoutPromise = new Promise((_, reject) =>
        setTimeout(() => reject(new Error("Google Sheets fetch timed out (45s)")), 45000)
      );
      const raw = await Promise.race([sheetPromise, timeoutPromise]);
      const enriched = enrichWithAqi(
        {
          columns: raw.columns,
          rows: raw.rows,
          dateKey: raw.dateKey,
          concKey: raw.concKey,
        },
        pollutant,
        { logsPerHour: 1 },
      );
      // Persist raw data to MongoDB for next time (non-blocking)
      maybeRefreshBackup(province, pollutant);
      const body = {
        province,
        pollutant,
        columns: enriched.columns,
        rows: enriched.rows,
        totalRows: enriched.rows.length,
        fetchedAt: raw.fetchedAt,
        source: raw.source,
        dateKey: enriched.dateKey || null,
        concKey: enriched.concKey || null,
        // Data is now fresh from Google Sheets — no background sync in progress
        sheetSyncing: false,
        latestAqiVerified: enriched.latestAqiVerified ?? false,
      };
      setCachedEnriched(cacheKey, body);
      if (setCacheHeaders(req, res, body)) return;
      return res.json(body);
    } catch (sheetErr) {
      throw sheetErr;
    }
  } catch (e) {
    const msg = e?.message || "Failed to read tabular sheet";
    const status = e?.code === "NOT_CONFIGURED" ? 400 : 500;
    res.status(status).json({ error: msg });
  }
});

// Latest single enriched row — fast endpoint for AQI card quick poll.
// Uses the in-memory enriched cache when warm (instant), otherwise loads
// from MongoDB and enriches all rows so the rolling-average AQI is correct.
router.get("/api/tabular/:province/:pollutant/latest", async (req, res) => {
  try {
    if (isMaintenanceMode()) {
      return res.status(503).json({ error: "maintenance", message: "System is under maintenance. Please try again later." });
    }
    const province = String(req.params.province || "").toLowerCase();
    const pollutant = String(req.params.pollutant || "").toLowerCase();
    if (!province || !pollutant) {
      return res.status(400).json({ error: "Missing province or pollutant" });
    }
    if (!TABULAR_SHEETS[province] || !TABULAR_SHEETS[province][pollutant]) {
      return res.status(404).json({ error: "Unknown province or pollutant" });
    }

    // 1) Use warm in-memory enriched cache (built by the full tabular route) — instant
    const fullCacheKey = `${province}:${pollutant}`;
    const cachedJson = getCachedEnriched(fullCacheKey);
    if (cachedJson) {
      const parsed = JSON.parse(cachedJson);
      // Return the latest valid row (skip erratic: AQI=0 or Invalid/For Validation)
      const row = parsed.rows
        ? (parsed.rows.find((r) => {
            const aqi = r["AQI"] ?? r["aqi"];
            if (aqi == null || Number(aqi) === 0) return false;
            const status = r["Status"] ?? r["status"];
            if (/^(invalid|for\s*validation)$/i.test(String(status || ""))) return false;
            return true;
          }) || parsed.rows[0] || null)
        : null;
      const body = { province, pollutant, row, fetchedAt: parsed.fetchedAt, source: parsed.source };
      if (setCacheHeaders(req, res, body)) return;
      return res.json(body);
    }

    // 2) Load from MongoDB backup, enrich all rows (rolling-average requires full history),
    //    cache the enriched result so the next full tabular call is also instant.
    const backup = await getBackupData(province, pollutant);
    if (backup && backup.rows && backup.rows.length > 0) {
      const enriched = enrichWithAqi(
        { columns: backup.columns, rows: backup.rows, dateKey: backup.dateKey, concKey: backup.concKey },
        pollutant,
        { logsPerHour: 1 },
      );
      const fullBody = {
        province: backup.province,
        pollutant: backup.pollutant,
        columns: enriched.columns,
        rows: enriched.rows,
        totalRows: enriched.rows.length,
        fetchedAt: backup.fetchedAt,
        source: backup.source,
        backupMeta: backup.backupMeta,
        dateKey: enriched.dateKey || null,
        concKey: enriched.concKey || null,
      };
      setCachedEnriched(fullCacheKey, fullBody);
      // Return latest valid row (skip erratic: AQI=0 or Invalid/For Validation)
      const row = enriched.rows
        ? (enriched.rows.find((r) => {
            const aqi = r["AQI"] ?? r["aqi"];
            if (aqi == null || Number(aqi) === 0) return false;
            const status = r["Status"] ?? r["status"];
            if (/^(invalid|for\s*validation)$/i.test(String(status || ""))) return false;
            return true;
          }) || enriched.rows[0] || null)
        : null;
      const body = { province, pollutant, row, fetchedAt: backup.fetchedAt, source: backup.source };
      if (setCacheHeaders(req, res, body)) return;
      return res.json(body);
    }

    return res.status(404).json({ error: "No data available yet" });
  } catch (e) {
    res.status(500).json({ error: e?.message || "Failed to read latest row" });
  }
});

// Backup status — freshness info for all datasets
router.get("/api/backup/status", async (_req, res) => {
  try {
    const statuses = await getBackupStatus();
    res.json({ ok: true, datasets: statuses });
  } catch (e) {
    res.status(500).json({ error: e.message || "Failed to get backup status" });
  }
});

// Check for updates on a specific dataset
router.get("/api/backup/check/:province/:pollutant", async (req, res) => {
  try {
    const province = String(req.params.province || "").toLowerCase();
    const pollutant = String(req.params.pollutant || "").toLowerCase();
    const result = await checkForUpdates(province, pollutant);
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Force a backup cycle (admin trigger — bypasses maintenance mode)
router.post("/api/backup/sync", async (_req, res) => {
  try {
    // Clear in-memory sheet cache so fresh data is fetched from Google Sheets
    clearSheetCache();
    // Also clear enriched tabular cache so next request re-enriches from new data
    _enrichedCache.clear();
    const results = await runBackupCycle("manual", { force: true });
    res.json({ ok: true, results });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Export log (save to MongoDB)
router.post("/api/export-log", async (req, res) => {
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
router.get("/api/export-logs", async (req, res) => {
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

/**
 * Pre-warm the enriched cache for all datasets from MongoDB backup.
 * Call after MongoDB is connected and backups are available.
 */
async function warmEnrichedCache() {
  const keys = [];
  for (const [prov, polls] of Object.entries(TABULAR_SHEETS)) {
    for (const poll of Object.keys(polls)) {
      keys.push({ province: prov, pollutant: poll });
    }
  }
  let ok = 0;
  for (const { province, pollutant } of keys) {
    const cacheKey = `${province}:${pollutant}`;
    try {
      const backup = await getBackupData(province, pollutant);
      if (!backup || !backup.rows?.length) continue;
      const enriched = enrichWithAqi(
        { columns: backup.columns, rows: backup.rows, dateKey: backup.dateKey, concKey: backup.concKey },
        pollutant,
        { logsPerHour: 1 }
      );
      const body = {
        province: backup.province, pollutant: backup.pollutant,
        columns: enriched.columns, rows: enriched.rows, totalRows: enriched.rows.length,
        fetchedAt: backup.fetchedAt, source: backup.source, backupMeta: backup.backupMeta,
      };
      setCachedEnriched(cacheKey, body);
      ok++;
    } catch (e) {
      console.warn(`[enriched-cache] warm failed for ${cacheKey}: ${e.message}`);
    }
  }
  console.log(`[enriched-cache] warmed ${ok}/${keys.length} datasets`);
}

module.exports = router;
module.exports.warmEnrichedCache = warmEnrichedCache;

/* ═══════════════════════════════════════════════════════════════
   ADMIN CRUD + CSV EXPORT  (require X-Admin-Token)
   ═══════════════════════════════════════════════════════════════ */
const { ObjectId } = require("mongodb");
const { requireAdminToken } = require("./admin-auth");

function getBackupCollection(db, province, pollutant) {
  return db.collection("air_data_backup");
}

function backupDocId(province, pollutant) {
  return `${province}:${pollutant}`;
}

/**
 * GET /api/tabular/:province/:pollutant/export
 * Download all rows as CSV (no auth required — data is already public via the main endpoint).
 */
router.get("/api/tabular/:province/:pollutant/export", async (req, res) => {
  const { province, pollutant } = req.params;
  try {
    const backup = await getBackupData(province, pollutant);
    if (!backup || !backup.rows?.length) {
      return res.status(404).json({ error: "No data found" });
    }
    const { columns, rows } = backup;
    const safeCol = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
    const header = columns.map(safeCol).join(",");
    const lines  = rows.map((r) => columns.map((c) => safeCol(r[c] ?? "")).join(","));
    const csv    = [header, ...lines].join("\r\n");

    const filename = `${province}-${pollutant}-${new Date().toISOString().slice(0,10)}.csv`;
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.send(csv);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

/**
 * POST /api/tabular/:province/:pollutant/rows
 * Add a new row to the backup dataset.
 */
router.post("/api/tabular/:province/:pollutant/rows", requireAdminToken, async (req, res) => {
  const { province, pollutant } = req.params;
  const { row } = req.body;
  if (!row || typeof row !== "object" || Array.isArray(row)) {
    return res.status(400).json({ error: "row object required" });
  }
  try {
    const db  = await ensureMongo();
    const col = db.collection("air_data_backup");
    const doc = await col.findOne({ _id: backupDocId(province, pollutant) });
    if (!doc) return res.status(404).json({ error: "Dataset not found" });

    const newRow = { ...row, _id: new ObjectId().toHexString() };
    await col.updateOne(
      { _id: backupDocId(province, pollutant) },
      { $push: { rows: newRow } }
    );
    // Invalidate enriched cache
    _enrichedCache.delete(`${province}:${pollutant}`);
    res.json({ ok: true, row: newRow });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

/**
 * PUT /api/tabular/:province/:pollutant/rows/:id
 * Update a row in the backup dataset by its _id field.
 */
router.put("/api/tabular/:province/:pollutant/rows/:id", requireAdminToken, async (req, res) => {
  const { province, pollutant, id } = req.params;
  const { row } = req.body;
  if (!row || typeof row !== "object") {
    return res.status(400).json({ error: "row object required" });
  }
  try {
    const db  = await ensureMongo();
    const col = db.collection("air_data_backup");
    const result = await col.updateOne(
      { _id: backupDocId(province, pollutant), "rows._id": id },
      { $set: { "rows.$": { ...row, _id: id } } }
    );
    if (result.matchedCount === 0) {
      return res.status(404).json({ error: "Row not found" });
    }
    _enrichedCache.delete(`${province}:${pollutant}`);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

/**
 * DELETE /api/tabular/:province/:pollutant/rows/:id
 * Remove a row from the backup dataset by its _id field.
 */
router.delete("/api/tabular/:province/:pollutant/rows/:id", requireAdminToken, async (req, res) => {
  const { province, pollutant, id } = req.params;
  try {
    const db  = await ensureMongo();
    const col = db.collection("air_data_backup");
    const result = await col.updateOne(
      { _id: backupDocId(province, pollutant) },
      { $pull: { rows: { _id: id } } }
    );
    if (result.matchedCount === 0) {
      return res.status(404).json({ error: "Dataset not found" });
    }
    _enrichedCache.delete(`${province}:${pollutant}`);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});
