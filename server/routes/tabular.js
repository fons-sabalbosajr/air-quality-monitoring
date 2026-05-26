/**
 * Tabular data routes (Google Sheets) + MongoDB backup fallback + export logging.
 */
const crypto = require("crypto");
const { Router } = require("express");
const { TABULAR_SHEETS } = require("../config/sheets");
const { getTabularTable, enrichWithAqi, getRawTabularTable } = require("../services/googleSheets");
const { parseDateValue, formatDateAmPm } = require("../utils/dateUtils");
const { ensureMongo } = require("../services/mongo");
const {
  backupOne,
  getBackupData,
  getBackupStatus,
  checkForUpdates,
  runBackupCycle,
  isSyncing,
} = require("../services/tabularBackup");
const { clearCache: clearSheetCache, clearCacheForKey: clearSheetCacheForKey } = require("../services/googleSheets");
const { isMaintenanceMode } = require("../config/env");
const { requireAdminToken } = require("./admin-auth");

const router = Router();
const API_CACHE_CONTROL = "private, no-cache, max-age=0, must-revalidate";

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
  // AQI data is display-critical; always revalidate while still allowing ETag 304s.
  res.setHeader("Cache-Control", API_CACHE_CONTROL);
  res.setHeader("Pragma", "no-cache");
  res.setHeader("Expires", "0");
  res.setHeader("ETag", etag);
  res.setHeader("Vary", "Accept");
  if (req.headers["if-none-match"] === etag) {
    res.status(304).end();
    return true;
  }
  return false;
}

// Debounce background backup refreshes — active displays/admin pages monitor Sheets without overlapping syncs.
const _lastBackupRefresh = new Map();
const BACKUP_REFRESH_DEBOUNCE_MS = 30_000;
const LATEST_REFRESH_DEBOUNCE_MS = 15_000;
const LATEST_REFRESH_WAIT_MS = Number(process.env.LATEST_REFRESH_WAIT_MS || 8000);

function maybeRefreshBackup(province, pollutant, opts = {}) {
  const key = `${province}:${pollutant}`;
  const now = Date.now();
  const last = _lastBackupRefresh.get(key) || 0;
  const debounceMs = Number(opts.debounceMs ?? BACKUP_REFRESH_DEBOUNCE_MS);
  if (!opts.force && now - last < debounceMs) {
    return Promise.resolve({ updated: false, skipped: true, reason: "debounced" });
  }
  _lastBackupRefresh.set(key, now);
  return backupOne(province, pollutant, { force: opts.force === true })
    .then((result) => {
      if (result?.updated) {
        _enrichedCache.delete(key);
      }
      return result;
    })
    .catch((error) => ({ updated: false, error: error?.message || "refresh failed" }));
}

async function refreshBackupForLatest(province, pollutant) {
  const refresh = maybeRefreshBackup(province, pollutant, {
    debounceMs: LATEST_REFRESH_DEBOUNCE_MS,
  });
  const timeout = new Promise((resolve) => {
    setTimeout(() => resolve({ updated: false, timedOut: true }), LATEST_REFRESH_WAIT_MS);
  });
  return Promise.race([refresh, timeout]);
}

// In-memory enriched result cache — avoids re-fetching 5000+ rows from MongoDB every request
const _enrichedCache = new Map();
const ENRICHED_CACHE_TTL_MS = 30_000; // near-real-time for dashboard/NLEX

function isValidLatestAqiRow(row) {
  if (!row) return false;
  const aqi = Number(row["AQI"] ?? row["aqi"]);
  if (!isFinite(aqi) || aqi <= 0 || aqi > 500) return false;
  const status = row["Status"] ?? row["status"];
  if (/^(invalid|for\s*validation)$/i.test(String(status || ""))) return false;
  const concentrationKey = Object.keys(row).find((k) => /concentration/i.test(k));
  if (concentrationKey) {
    const concentration = Number(String(row[concentrationKey] ?? "").replace(/[, ]/g, ""));
    if (isFinite(concentration) && (concentration < 0 || concentration >= 9999)) return false;
  }
  return true;
}

function rowEpochMs(row, dateKey) {
  if (!row || !dateKey || row[dateKey] == null) return 0;
  const parsed = parseDateValue(row[dateKey], "MDY") || parseDateValue(row[dateKey], "DMY");
  if (!parsed || parsed.getFullYear() < 2015) return 0;
  return parsed.getTime();
}

function selectLatestAqiRow(rows, dateKey) {
  if (!Array.isArray(rows) || !rows.length) return { row: null, time: null, displayTime: null };
  let best = null;
  for (const row of rows) {
    if (!isValidLatestAqiRow(row)) continue;
    const epochMs = rowEpochMs(row, dateKey);
    if (!best || epochMs > best.epochMs) {
      best = { row, epochMs };
    }
  }
  if (!best) return { row: null, time: null, displayTime: null };
  const time = best.epochMs || null;
  return {
    row: best.row,
    time,
    displayTime: time ? formatDateAmPm(new Date(time)) : null,
  };
}

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
      if (setCacheHeaders(req, res, live)) return;
      return res.json(live);
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
    const waitFresh = /^(1|true|yes)$/i.test(String(req.query.waitFresh || ""));
    let refreshResult = null;
    if (waitFresh) {
      refreshResult = await refreshBackupForLatest(province, pollutant);
    } else {
      maybeRefreshBackup(province, pollutant, {
        debounceMs: LATEST_REFRESH_DEBOUNCE_MS,
      });
    }
    const refreshedBackup = refreshResult?.updated
      ? await getBackupData(province, pollutant)
      : null;
    if (refreshedBackup && refreshedBackup.rows && refreshedBackup.rows.length > 0) {
      const enriched = enrichWithAqi(
        {
          columns: refreshedBackup.columns,
          rows: refreshedBackup.rows,
          dateKey: refreshedBackup.dateKey,
          concKey: refreshedBackup.concKey,
        },
        pollutant,
        { logsPerHour: 1 },
      );
      const fullBody = {
        province: refreshedBackup.province,
        pollutant: refreshedBackup.pollutant,
        columns: enriched.columns,
        rows: enriched.rows,
        totalRows: enriched.rows.length,
        fetchedAt: refreshedBackup.fetchedAt,
        source: refreshedBackup.source,
        backupMeta: refreshedBackup.backupMeta,
        dateKey: enriched.dateKey || null,
        concKey: enriched.concKey || null,
        latestAqiVerified: enriched.latestAqiVerified ?? false,
      };
      setCachedEnriched(fullCacheKey, fullBody);
      const latest = selectLatestAqiRow(enriched.rows, enriched.dateKey);
      const body = {
        province,
        pollutant,
        row: latest.row,
        time: latest.time,
        displayTime: latest.displayTime,
        dateKey: enriched.dateKey || null,
        fetchedAt: refreshedBackup.fetchedAt,
        source: refreshedBackup.source,
        backupMeta: refreshedBackup.backupMeta,
        sheetSyncing: isSyncing(fullCacheKey),
        latestAqiVerified: enriched.latestAqiVerified ?? false,
      };
      if (setCacheHeaders(req, res, body)) return;
      return res.json(body);
    }

    const cachedJson = getCachedEnriched(fullCacheKey);
    if (cachedJson) {
      const parsed = JSON.parse(cachedJson);
      const latest = selectLatestAqiRow(parsed.rows, parsed.dateKey);
      const body = {
        province,
        pollutant,
        row: latest.row,
        time: latest.time,
        displayTime: latest.displayTime,
        dateKey: parsed.dateKey || null,
        fetchedAt: parsed.fetchedAt,
        source: parsed.source,
        backupMeta: parsed.backupMeta || null,
        sheetSyncing: isSyncing(fullCacheKey),
        latestAqiVerified: parsed.latestAqiVerified ?? false,
      };
      if (setCacheHeaders(req, res, body)) return;
      return res.json(body);
    }

    // 2) Load from MongoDB backup, enrich all rows (rolling-average requires full history),
    //    cache the enriched result so the next full tabular call is also instant.
    const backup = await getBackupData(province, pollutant);
    if (backup && backup.rows && backup.rows.length > 0) {
      maybeRefreshBackup(province, pollutant);
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
        latestAqiVerified: enriched.latestAqiVerified ?? false,
      };
      setCachedEnriched(fullCacheKey, fullBody);
      const latest = selectLatestAqiRow(enriched.rows, enriched.dateKey);
      const body = {
        province,
        pollutant,
        row: latest.row,
        time: latest.time,
        displayTime: latest.displayTime,
        dateKey: enriched.dateKey || null,
        fetchedAt: backup.fetchedAt,
        source: backup.source,
        backupMeta: backup.backupMeta,
        sheetSyncing: isSyncing(fullCacheKey),
        latestAqiVerified: enriched.latestAqiVerified ?? false,
      };
      if (setCacheHeaders(req, res, body)) return;
      return res.json(body);
    }

    return res.status(404).json({ error: "No data available yet" });
  } catch (e) {
    res.status(500).json({ error: e?.message || "Failed to read latest row" });
  }
});

// JSONP bundle for legacy signage webviews. Script-tag loading avoids CORS
// issues in VNNOX-style preview/player environments.
router.get("/api/nlex-latest.js", async (req, res) => {
  const rawCallback = String(req.query.callback || "__aqmNlexLatest");
  const callback = /^[A-Za-z_$][\w$]*(\.[A-Za-z_$][\w$]*)*$/.test(rawCallback)
    ? rawCallback
    : "__aqmNlexLatest";
  const datasets = [
    { province: "clark", pollutant: "pm10" },
    { province: "san-fernando", pollutant: "pm10" },
    { province: "meycauayan", pollutant: "pm10" },
    { province: "meycauayan", pollutant: "pm25" },
    { province: "zambales", pollutant: "pm10" },
    { province: "zambales", pollutant: "pm25" },
  ];
  const data = {};

  async function latestFor(province, pollutant) {
    const cacheKey = `${province}:${pollutant}`;
    maybeRefreshBackup(province, pollutant, {
      debounceMs: LATEST_REFRESH_DEBOUNCE_MS,
    });

    const cachedJson = getCachedEnriched(cacheKey);
    if (cachedJson) {
      const parsed = JSON.parse(cachedJson);
      const latest = selectLatestAqiRow(parsed.rows, parsed.dateKey);
      return {
        province,
        pollutant,
        row: latest.row,
        time: latest.time,
        displayTime: latest.displayTime,
        dateKey: parsed.dateKey || null,
        fetchedAt: parsed.fetchedAt,
        source: parsed.source,
        sheetSyncing: isSyncing(cacheKey),
        latestAqiVerified: parsed.latestAqiVerified ?? false,
      };
    }

    const backup = await getBackupData(province, pollutant);
    if (!backup || !backup.rows || backup.rows.length === 0) {
      return { province, pollutant, row: null, error: "No data available yet" };
    }

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
      latestAqiVerified: enriched.latestAqiVerified ?? false,
    };
    setCachedEnriched(cacheKey, fullBody);
    const latest = selectLatestAqiRow(enriched.rows, enriched.dateKey);
    return {
      province,
      pollutant,
      row: latest.row,
      time: latest.time,
      displayTime: latest.displayTime,
      dateKey: enriched.dateKey || null,
      fetchedAt: backup.fetchedAt,
      source: backup.source,
      backupMeta: backup.backupMeta,
      sheetSyncing: isSyncing(cacheKey),
      latestAqiVerified: enriched.latestAqiVerified ?? false,
    };
  }

  for (const item of datasets) {
    const key = `${item.province}:${item.pollutant}`;
    try {
      data[key] = await latestFor(item.province, item.pollutant);
    } catch (error) {
      data[key] = {
        province: item.province,
        pollutant: item.pollutant,
        row: null,
        error: error?.message || "Failed to read latest row",
      };
    }
  }

  const body = { ok: true, generatedAt: Date.now(), data };
  res.setHeader("Cache-Control", API_CACHE_CONTROL);
  res.setHeader("Pragma", "no-cache");
  res.setHeader("Expires", "0");
  res.type("application/javascript; charset=utf-8");
  res.send(`${callback}(${JSON.stringify(body)});`);
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
router.post("/api/backup/sync", requireAdminToken, async (_req, res) => {
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

// Per-station force-sync: bypasses all caches and overwrites MongoDB from Google Sheets.
// Use when data in the app doesn’t match the sheet (stale cache, failed backup, etc.).
router.post("/api/tabular/:province/:pollutant/force-sync", requireAdminToken, async (req, res) => {
  try {
    const province  = String(req.params.province  || "").toLowerCase();
    const pollutant = String(req.params.pollutant || "").toLowerCase();
    if (!province || !pollutant) {
      return res.status(400).json({ error: "Missing province or pollutant" });
    }
    if (!TABULAR_SHEETS[province] || !TABULAR_SHEETS[province][pollutant]) {
      return res.status(404).json({ error: "Unknown province or pollutant" });
    }

    const cacheKey = `${province}:${pollutant}`;

    // 1) Evict all in-memory caches for this station
    _enrichedCache.delete(cacheKey);
    clearSheetCacheForKey(`raw-tabular:${cacheKey}`);
    clearSheetCacheForKey(`tabular:${cacheKey}`);

    // 2) Reset the background-refresh debounce so the next regular request
    //    also triggers a refresh even if it was called recently
    _lastBackupRefresh.delete(cacheKey);

    // 3) Force a direct Google Sheets fetch → overwrite MongoDB backup (bypass hash check)
    const syncResult = await backupOne(province, pollutant, { force: true });
    if (syncResult.error) {
      return res.status(502).json({
        ok: false,
        error: `Google Sheets sync failed: ${syncResult.error}`,
        cacheCleared: true,
      });
    }

    // 4) Load the fresh backup and enrich it
    const backup = await getBackupData(province, pollutant);
    if (!backup || !backup.rows || backup.rows.length === 0) {
      return res.status(404).json({ ok: false, error: "No data returned from sheet" });
    }
    const enriched = enrichWithAqi(
      { columns: backup.columns, rows: backup.rows, dateKey: backup.dateKey, concKey: backup.concKey },
      pollutant,
      { logsPerHour: 1 },
    );
    const body = {
      province: backup.province,
      pollutant: backup.pollutant,
      columns: enriched.columns,
      rows: enriched.rows,
      totalRows: enriched.rows.length,
      fetchedAt: Date.now(),
      source: "sheet",
      sheetSyncing: false,
      latestAqiVerified: enriched.latestAqiVerified ?? false,
      syncResult: {
        updated: syncResult.updated,
        rowCount: syncResult.rowCount,
        rawRowCount: syncResult.rawRowCount ?? null,
        erraticRows: syncResult.erraticRows ?? null,
        deletedRows: syncResult.deletedRows ?? 0,
        protected: syncResult.protected ?? false,
        reason: syncResult.reason ?? null,
      },
    };
    setCachedEnriched(cacheKey, body);
    console.log(`[force-sync] ${cacheKey}: ${syncResult.updated ? `✓ updated (${syncResult.rowCount} rows)` : `= unchanged (${syncResult.rowCount} rows)`}`);
    res.json(body);
  } catch (e) {
    res.status(500).json({ error: e?.message || "Force sync failed" });
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
        dateKey: enriched.dateKey || null, concKey: enriched.concKey || null,
        latestAqiVerified: enriched.latestAqiVerified ?? false,
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
