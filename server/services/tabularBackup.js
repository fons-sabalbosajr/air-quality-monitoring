/**
 * Tabular Data Backup Service
 *
 * Automatically backs up Google Sheets tabular data to MongoDB (air_data_backup).
 * Provides fallback data when Google Sheets is slow or unavailable.
 * Detects data changes and exposes freshness metadata.
 */
const cron = require("node-cron");
const crypto = require("crypto");
const { MONGO_URI, INGEST_TZ } = require("../config/env");
const { TABULAR_SHEETS } = require("../config/sheets");
const { getRawTabularTable } = require("./googleSheets");
const { parseDateValue } = require("../utils/dateUtils");
const { coerceNumber } = require("../utils/mathUtils");

const BACKUP_COLLECTION = "air_data_backup";
const BACKUP_META_COLLECTION = "air_data_backup_meta";
const BACKUP_CRON = process.env.BACKUP_CRON || "*/1 * * * *"; // every minute
let _backupRunning = false;
let _backupScheduled = false;
let _db = null;

// Track which province:pollutant pairs are actively syncing from Google Sheets
const _syncingKeys = new Set();

/**
 * Returns true while a Google Sheets → MongoDB backup is in progress
 * for the given province:pollutant key.
 */
function isSyncing(backupKey) {
  return _syncingKeys.has(backupKey);
}

/**
 * Inject the database instance (avoids circular dep with mongo.js).
 */
function setDb(db) {
  _db = db;
}

/**
 * Get backup collection.
 */
function getBackupCollection() {
  if (!_db) return null;
  return _db.collection(BACKUP_COLLECTION);
}

function getBackupMetaCollection() {
  if (!_db) return null;
  return _db.collection(BACKUP_META_COLLECTION);
}

/**
 * Compute a simple hash of row data to detect changes.
 */
function hashRows(rows) {
  if (!rows || !rows.length) return "empty";
  return crypto.createHash("sha256").update(JSON.stringify(rows)).digest("hex");
}

function countErraticRows(rows, concKey) {
  if (!Array.isArray(rows) || !concKey) return 0;
  return rows.reduce((count, row) => {
    const n = coerceNumber(row?.[concKey]);
    return n != null && (n < 0 || n >= 9999) ? count + 1 : count;
  }, 0);
}

function removeErraticRows(rows, concKey) {
  if (!Array.isArray(rows) || !concKey) return Array.isArray(rows) ? rows : [];
  return rows.filter((row) => {
    const n = coerceNumber(row?.[concKey]);
    return n == null || (n >= 0 && n < 9999);
  });
}

function rowEpochMs(row, dateKey) {
  if (!row || !dateKey || row[dateKey] == null) return 0;
  const parsed = parseDateValue(row[dateKey], "MDY") || parseDateValue(row[dateKey], "DMY");
  return parsed && parsed.getFullYear() >= 2015 ? parsed.getTime() : 0;
}

function findAqiKey(rows) {
  const sample = rows.find((row) => row && typeof row === "object") || {};
  return (
    Object.keys(sample).find((key) => /aqi\s*index/i.test(key)) ||
    Object.keys(sample).find((key) => /^aqi$/i.test(key)) ||
    null
  );
}

function summarizeSnapshot(rows, dateKey) {
  const aqiKey = findAqiKey(rows);
  let latestEpochMs = 0;
  let latestAqiEpochMs = 0;
  for (const row of rows) {
    const epochMs = rowEpochMs(row, dateKey);
    if (epochMs > latestEpochMs) latestEpochMs = epochMs;
    if (aqiKey) {
      const aqi = coerceNumber(row?.[aqiKey]);
      if (aqi != null && aqi > 0 && aqi <= 500 && epochMs > latestAqiEpochMs) {
        latestAqiEpochMs = epochMs;
      }
    }
  }
  return { latestEpochMs, latestAqiEpochMs };
}

function isRiskySheetSnapshot(existingMeta, rows, summary) {
  const existingCount = Number(existingMeta?.rowCount || 0);
  if (!existingCount) return false;
  if (!rows.length) return true;

  const currentCount = rows.length;
  const deletedRows = Math.max(0, existingCount - currentCount);
  const largeDrop = existingCount >= 100 && currentCount < Math.floor(existingCount * 0.85);
  const manyRowsDeleted = deletedRows > 25 && deletedRows > Math.ceil(existingCount * 0.05);
  const lostAllPublishableAqi = existingMeta.latestAqiEpochMs && !summary.latestAqiEpochMs;

  return largeDrop || manyRowsDeleted || lostAllPublishableAqi;
}

async function markPendingSnapshot(metaCol, backupKey, existingMeta, details) {
  const now = new Date();
  const alreadyPending = existingMeta?.pendingHash === details.hash;
  if (!alreadyPending) {
    await metaCol.updateOne(
      { key: backupKey },
      {
        $set: {
          pendingHash: details.hash,
          pendingRowCount: details.rowCount,
          pendingRawRowCount: details.rawRowCount,
          pendingErraticRows: details.erraticRows,
          pendingLatestEpochMs: details.latestEpochMs || null,
          pendingLatestAqiEpochMs: details.latestAqiEpochMs || null,
          pendingSince: now,
          lastCheckedAt: now,
          syncProtection: "awaiting-confirmation",
        },
      },
      { upsert: true },
    );
  }
  return alreadyPending;
}

/**
 * Back up a single province/pollutant dataset.
 * @param {string} province
 * @param {string} pollutant
 * @param {object} [opts]
 * @param {boolean} [opts.force] - bypass hash check and always overwrite MongoDB
 * Returns { updated, rowCount, province, pollutant }.
 */
async function backupOne(province, pollutant, { force = false } = {}) {
  const col = getBackupCollection();
  const metaCol = getBackupMetaCollection();
  if (!col || !metaCol) return { updated: false, error: "DB not ready" };

  const backupKey = `${province}:${pollutant}`;
  if (_syncingKeys.has(backupKey)) {
    return { updated: false, syncing: true, reason: "already-syncing", province, pollutant };
  }
  _syncingKeys.add(backupKey);

  try {
    // Fetch RAW data (no AQI computation) — app computes AQI at serve time
    // Apply 45s timeout to prevent backup from hanging on slow Google Sheets
    const fetchTimeout = new Promise((_, reject) =>
      setTimeout(() => reject(new Error("Google Sheets fetch timed out (45s)")), 45000)
    );
    const payload = await Promise.race([
      getRawTabularTable(province, pollutant, { forceRefresh: force, allowStale: false }),
      fetchTimeout,
    ]);
    const rawRows = payload.rows || [];
    const erraticRows = countErraticRows(rawRows, payload.concKey);
    const rows = removeErraticRows(rawRows, payload.concKey);
    const columns = payload.columns || [];
    const newHash = hashRows(rows);
    const rawRowCount = rawRows.length;
    const summary = summarizeSnapshot(rows, payload.dateKey);

    // Check if data changed (skip when force=true to always overwrite)
    const existingMeta = await metaCol.findOne({ key: backupKey });
    if (!force && existingMeta && existingMeta.hash === newHash) {
      // Data hasn't changed — update lastCheckedAt only
      await metaCol.updateOne(
        { key: backupKey },
        {
          $set: { lastCheckedAt: new Date(), syncProtection: null },
          $unset: {
            pendingHash: "",
            pendingRowCount: "",
            pendingRawRowCount: "",
            pendingErraticRows: "",
            pendingLatestEpochMs: "",
            pendingLatestAqiEpochMs: "",
            pendingSince: "",
          },
        },
      );
      return {
        updated: false,
        rowCount: rows.length,
        province,
        pollutant,
        reason: "unchanged",
      };
    }

    if (existingMeta?.rowCount > 0 && rows.length === 0) {
      await metaCol.updateOne(
        { key: backupKey },
        {
          $set: {
            lastCheckedAt: new Date(),
            syncProtection: "empty-sheet-snapshot-preserved-backup",
          },
        },
      );
      return {
        updated: false,
        protected: true,
        reason: "empty-sheet-snapshot",
        rowCount: existingMeta.rowCount,
        rawRowCount,
        erraticRows,
        province,
        pollutant,
      };
    }

    if (!force && isRiskySheetSnapshot(existingMeta, rows, summary)) {
      const confirmed = await markPendingSnapshot(metaCol, backupKey, existingMeta, {
        hash: newHash,
        rowCount: rows.length,
        rawRowCount,
        erraticRows,
        latestEpochMs: summary.latestEpochMs,
        latestAqiEpochMs: summary.latestAqiEpochMs,
      });
      if (!confirmed) {
        return {
          updated: false,
          protected: true,
          reason: "awaiting-stable-sheet-confirmation",
          rowCount: existingMeta?.rowCount || 0,
          pendingRowCount: rows.length,
          rawRowCount,
          erraticRows,
          province,
          pollutant,
        };
      }
    }

    // Data changed — persist RAW rows to MongoDB
    const now = new Date();
    const generation = `${now.getTime()}-${crypto.randomBytes(6).toString("hex")}`;

    // Stage rows first, then switch metadata to the staged generation.
    // This avoids briefly exposing an empty backup if insertMany fails midway.
    if (rows.length > 0) {
      const docs = rows.map((row, idx) => ({
        _backupKey: backupKey,
        _generation: generation,
        _rowIndex: idx,
        ...row,
        _backedUpAt: now,
      }));
      const CHUNK = 500;
      for (let i = 0; i < docs.length; i += CHUNK) {
        await col.insertMany(docs.slice(i, i + CHUNK), { ordered: false });
      }
    }

    // Update meta — include dateKey/concKey for AQI computation at serve time
    await metaCol.updateOne(
      { key: backupKey },
      {
        $set: {
          key: backupKey,
          province,
          pollutant,
          columns,
          dateKey: payload.dateKey || null,
          concKey: payload.concKey || null,
          rowCount: rows.length,
          erraticRows,
          rawRowCount,
          latestEpochMs: summary.latestEpochMs || null,
          latestAqiEpochMs: summary.latestAqiEpochMs || null,
          hash: newHash,
          activeGeneration: generation,
          lastBackupAt: now,
          lastCheckedAt: now,
          source: "sheet-raw",
          syncProtection: null,
        },
        $unset: {
          pendingHash: "",
          pendingRowCount: "",
          pendingRawRowCount: "",
          pendingErraticRows: "",
          pendingLatestEpochMs: "",
          pendingLatestAqiEpochMs: "",
          pendingSince: "",
        },
      },
      { upsert: true },
    );

    await col.deleteMany({ _backupKey: backupKey, _generation: { $ne: generation } });

    const deletedRows = Math.max(0, Number(existingMeta?.rowCount || 0) - rows.length);
    return { updated: true, rowCount: rows.length, rawRowCount, erraticRows, deletedRows, province, pollutant };
  } catch (err) {
    return { updated: false, error: err.message, province, pollutant };
  } finally {
    _syncingKeys.delete(backupKey);
  }
}

/**
 * Run a full backup cycle — fetch all configured provinces/pollutants concurrently.
 * @param {string} reason - label for logs
 * @param {object} [opts]
 * @param {boolean} [opts.force] - when true, bypass maintenance mode (admin trigger)
 */
async function runBackupCycle(reason = "scheduled", { force = false } = {}) {
  if (!MONGO_URI || !_db) return;
  if (_backupRunning) return;
  const { isMaintenanceMode } = require("../config/env");
  if (!force && isMaintenanceMode()) {
    console.log(`[backup] skipped — maintenance mode (${reason})`);
    return;
  }
  _backupRunning = true;

  try {
    // Collect all province:pollutant pairs that have a configured URL
    const tasks = [];
    for (const [province, pollutants] of Object.entries(TABULAR_SHEETS)) {
      for (const [pollutant, entry] of Object.entries(pollutants)) {
        if (!entry) continue; // skip unconfigured entries
        tasks.push({ province, pollutant });
      }
    }

    // Run all backups concurrently (previously sequential — e.g. 6 × 11s = 66s)
    const results = await Promise.all(
      tasks.map(({ province, pollutant }) => backupOne(province, pollutant))
    );

    const updated = results.filter((r) => r.updated).length;
    const failed  = results.filter((r) => r.error).length;
    const summary = results.map((r) =>
      r.error
        ? `${r.province}:${r.pollutant} ERR(${r.error})`
        : `${r.province}:${r.pollutant} ${r.updated ? `+${r.rowCount}rows` : "unchanged"}`
    ).join(" | ");
    console.log(`[backup] ${reason}: ${updated} updated, ${failed} failed — ${summary}`);

    return results;
  } catch (err) {
    console.error(`[backup] ${reason} failed: ${err.message}`);
  } finally {
    _backupRunning = false;
  }
}

/**
 * Fetch backed-up tabular data from MongoDB.
 * Used as fallback when Google Sheets is slow/unavailable.
 */
async function getBackupData(province, pollutant) {
  const col = getBackupCollection();
  const metaCol = getBackupMetaCollection();
  if (!col || !metaCol) return null;

  const backupKey = `${province}:${pollutant}`;

  try {
    const meta = await metaCol.findOne({ key: backupKey });
    if (!meta) return null;

    const query = meta.activeGeneration
      ? { _backupKey: backupKey, _generation: meta.activeGeneration }
      : { _backupKey: backupKey };

    const rows = await col
      .find(query)
      .sort({ _rowIndex: 1 })
      .toArray();

    // Strip internal fields
    const cleanRows = rows.map((r) => {
      const { _id, _backupKey, _generation, _rowIndex, _backedUpAt, ...rest } = r;
      return rest;
    });

    return {
      province,
      pollutant,
      columns: meta.columns || [],
      rows: cleanRows,
      dateKey: meta.dateKey || null,
      concKey: meta.concKey || null,
      totalRows: cleanRows.length,
      fetchedAt: meta.lastBackupAt ? meta.lastBackupAt.getTime() : Date.now(),
      source: "mongodb-backup",
      backupMeta: {
        lastBackupAt: meta.lastBackupAt,
        lastCheckedAt: meta.lastCheckedAt,
        rowCount: meta.rowCount,
        rawRowCount: meta.rawRowCount,
        erraticRows: meta.erraticRows,
        syncProtection: meta.syncProtection || null,
      },
    };
  } catch (err) {
    console.warn(`[backup] getBackupData(${backupKey}) failed: ${err.message}`);
    return null;
  }
}

/**
 * Get freshness metadata for all backed-up datasets.
 */
async function getBackupStatus() {
  const metaCol = getBackupMetaCollection();
  if (!metaCol) return [];

  try {
    return await metaCol.find({}).sort({ key: 1 }).toArray();
  } catch {
    return [];
  }
}

/**
 * Check if there is newer data in Google Sheets compared to the backup.
 * Returns { hasUpdate, province, pollutant, lastBackupAt }.
 */
async function checkForUpdates(province, pollutant) {
  const metaCol = getBackupMetaCollection();
  if (!metaCol) return { hasUpdate: false };

  const backupKey = `${province}:${pollutant}`;
  try {
    const meta = await metaCol.findOne({ key: backupKey });
    if (!meta) return { hasUpdate: true, reason: "no-backup" };

    // Fetch fresh raw data from sheets
    const payload = await getRawTabularTable(province, pollutant, { allowStale: false });
    const rawRows = payload.rows || [];
    const rows = removeErraticRows(rawRows, payload.concKey);
    const newHash = hashRows(rows);
    const erraticRows = countErraticRows(rawRows, payload.concKey);
    const summary = summarizeSnapshot(rows, payload.dateKey);

    return {
      hasUpdate: newHash !== meta.hash,
      riskySnapshot: isRiskySheetSnapshot(meta, rows, summary),
      province,
      pollutant,
      lastBackupAt: meta.lastBackupAt,
      lastCheckedAt: meta.lastCheckedAt,
      currentRows: rows.length,
      rawRows: rawRows.length,
      backupRows: meta.rowCount,
      erraticRows,
      backupErraticRows: meta.erraticRows ?? null,
    };
  } catch {
    return { hasUpdate: false, error: "check-failed" };
  }
}

/**
 * Schedule automatic backup via cron.
 */
function scheduleBackup() {
  if (_backupScheduled || !MONGO_URI) return;
  try {
    cron.schedule(BACKUP_CRON, () => runBackupCycle("cron"), {
      timezone: INGEST_TZ,
    });
    console.log(`[backup] cron scheduled (${BACKUP_CRON})`);

    // Run immediately on startup (don't delay)
    runBackupCycle("startup").catch(() => {});
    _backupScheduled = true;
  } catch (err) {
    console.error(`[backup] schedule failed: ${err.message}`);
  }
}

/**
 * Ensure indexes for the backup collections.
 */
async function ensureBackupIndexes(db) {
  try {
    const col = db.collection(BACKUP_COLLECTION);
    const metaCol = db.collection(BACKUP_META_COLLECTION);
    await Promise.all([
      col.createIndex({ _backupKey: 1, _rowIndex: 1 }),
      col.createIndex({ _backupKey: 1, _generation: 1, _rowIndex: 1 }),
      col.createIndex({ _backupKey: 1 }),
      metaCol.createIndex({ key: 1 }, { unique: true }),
    ]);
  } catch {}
}

module.exports = {
  setDb,
  backupOne,
  runBackupCycle,
  getBackupData,
  getBackupStatus,
  checkForUpdates,
  scheduleBackup,
  ensureBackupIndexes,
  isSyncing,
};
