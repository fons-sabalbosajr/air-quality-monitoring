/**
 * Tabular data routes (Google Sheets) + MongoDB backup fallback + export logging.
 */
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
} = require("../services/tabularBackup");

const router = Router();

// Tabular Results — serves MongoDB backup first (fast), refreshes from Sheets in background
router.get("/api/tabular/:province/:pollutant", async (req, res) => {
  try {
    const province = String(req.params.province || "").toLowerCase();
    const pollutant = String(req.params.pollutant || "").toLowerCase();
    if (!province || !pollutant) {
      return res.status(400).json({ error: "Missing province or pollutant" });
    }
    if (!TABULAR_SHEETS[province] || !TABULAR_SHEETS[province][pollutant]) {
      return res.status(404).json({ error: "Unknown province or pollutant" });
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
      // Kick off a background refresh from Google Sheets (non-blocking)
      backupOne(province, pollutant).catch(() => {});
      return res.json({
        province: backup.province,
        pollutant: backup.pollutant,
        columns: enriched.columns,
        rows: enriched.rows,
        totalRows: enriched.rows.length,
        fetchedAt: backup.fetchedAt,
        source: backup.source,
        backupMeta: backup.backupMeta,
      });
    }

    // 2) No backup yet — fall back to Google Sheets (first-time load)
    try {
      const raw = await getRawTabularTable(province, pollutant);
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
      backupOne(province, pollutant).catch(() => {});
      return res.json({
        province,
        pollutant,
        columns: enriched.columns,
        rows: enriched.rows,
        totalRows: enriched.rows.length,
        fetchedAt: raw.fetchedAt,
        source: raw.source,
      });
    } catch (sheetErr) {
      throw sheetErr;
    }
  } catch (e) {
    const msg = e?.message || "Failed to read tabular sheet";
    const status = e?.code === "NOT_CONFIGURED" ? 400 : 500;
    res.status(status).json({ error: msg });
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

// Force a backup cycle (admin trigger)
router.post("/api/backup/sync", async (_req, res) => {
  try {
    const results = await runBackupCycle("manual");
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

module.exports = router;
