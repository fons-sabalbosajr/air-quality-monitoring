/**
 * Tabular Data Backup Service
 *
 * Automatically backs up Google Sheets tabular data to MongoDB (air_data_backup).
 * Provides fallback data when Google Sheets is slow or unavailable.
 * Detects data changes and exposes freshness metadata.
 */
const cron = require("node-cron");
const { MONGO_URI, INGEST_TZ } = require("../config/env");
const { TABULAR_SHEETS } = require("../config/sheets");
const { getRawTabularTable } = require("./googleSheets");

const BACKUP_COLLECTION = "air_data_backup";
const BACKUP_META_COLLECTION = "air_data_backup_meta";
const BACKUP_CRON = process.env.BACKUP_CRON || "*/10 * * * *"; // every 10 min
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
  // Use first row, last row, count, and a sampling of values
  const first = JSON.stringify(rows[0] || {});
  const last = JSON.stringify(rows[rows.length - 1] || {});
  const mid =
    rows.length > 10
      ? JSON.stringify(rows[Math.floor(rows.length / 2)] || {})
      : "";
  return `${rows.length}:${first.length}:${last.length}:${simpleHash(first + last + mid)}`;
}

function simpleHash(str) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    hash = (hash << 5) - hash + ch;
    hash |= 0;
  }
  return hash.toString(36);
}

/**
 * Back up a single province/pollutant dataset.
 * Returns { updated, rowCount, province, pollutant }.
 */
async function backupOne(province, pollutant) {
  const col = getBackupCollection();
  const metaCol = getBackupMetaCollection();
  if (!col || !metaCol) return { updated: false, error: "DB not ready" };

  const backupKey = `${province}:${pollutant}`;
  _syncingKeys.add(backupKey);

  try {
    // Fetch RAW data (no AQI computation) — app computes AQI at serve time
    // Apply 45s timeout to prevent backup from hanging on slow Google Sheets
    const fetchTimeout = new Promise((_, reject) =>
      setTimeout(() => reject(new Error("Google Sheets fetch timed out (45s)")), 45000)
    );
    const payload = await Promise.race([getRawTabularTable(province, pollutant), fetchTimeout]);
    const rows = payload.rows || [];
    const columns = payload.columns || [];
    const newHash = hashRows(rows);

    // Check if data changed
    const existingMeta = await metaCol.findOne({ key: backupKey });
    if (existingMeta && existingMeta.hash === newHash) {
      // Data hasn't changed — update lastCheckedAt only
      await metaCol.updateOne(
        { key: backupKey },
        { $set: { lastCheckedAt: new Date() } },
      );
      return {
        updated: false,
        rowCount: rows.length,
        province,
        pollutant,
        reason: "unchanged",
      };
    }

    // Data changed — persist RAW rows to MongoDB
    const now = new Date();

    // Store rows in bulk (replace all for this key)
    await col.deleteMany({ _backupKey: backupKey });

    if (rows.length > 0) {
      const docs = rows.map((row, idx) => ({
        _backupKey: backupKey,
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
          hash: newHash,
          lastBackupAt: now,
          lastCheckedAt: now,
          source: "sheet-raw",
        },
      },
      { upsert: true },
    );

    return { updated: true, rowCount: rows.length, province, pollutant };
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

    const rows = await col
      .find({ _backupKey: backupKey })
      .sort({ _rowIndex: 1 })
      .toArray();

    // Strip internal fields
    const cleanRows = rows.map((r) => {
      const { _id, _backupKey, _rowIndex, _backedUpAt, ...rest } = r;
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
    const payload = await getRawTabularTable(province, pollutant);
    const newHash = hashRows(payload.rows || []);

    return {
      hasUpdate: newHash !== meta.hash,
      province,
      pollutant,
      lastBackupAt: meta.lastBackupAt,
      lastCheckedAt: meta.lastCheckedAt,
      currentRows: (payload.rows || []).length,
      backupRows: meta.rowCount,
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
