/**
 * AQM Server — Main entry point.
 *
 * Structure:
 *   config/   — Environment variables & sheet URL mapping
 *   utils/    — Date, math, and HTTP fetch helpers
 *   services/ — Business logic (AQI calc, Google Sheets, MongoDB, Workbook, Email)
 *   routes/   — Express route handlers
 */
require("dotenv").config();
const express = require("express");
const cors = require("cors");

const { PORT, CACHE_TTL_MS, MONGO_URI } = require("./config/env");

// Services
const { ensureMongo, persistStationMeta, scheduleIngestion } = require("./services/mongo");
const {
  resolveWorkbookPath,
  loadWorkbook,
  readVizData,
  readSheetSeries,
} = require("./services/workbook");
const {
  setDb: setBackupDb,
  scheduleBackup,
  ensureBackupIndexes,
} = require("./services/tabularBackup");

// Routes
const healthRoutes = require("./routes/health");
const tabularRoutes = require("./routes/tabular");
const emailRoutes = require("./routes/email");
const aqiRoutes = require("./routes/aqi");
const stationRoutes = require("./routes/station");
const workbookRoutes = require("./routes/workbookRoutes");
const proxyRoutes = require("./routes/proxy");

// ── Express setup ──
const app = express();
app.use(cors());
app.use(express.json());

// ── Register all routes ──
app.use(healthRoutes);
app.use(tabularRoutes);
app.use(emailRoutes);
app.use(aqiRoutes);
app.use(stationRoutes);
app.use(workbookRoutes);
app.use(proxyRoutes);

// ── MongoDB ingestion, backup & station meta ──
if (MONGO_URI) {
  scheduleIngestion({ readVizData, readSheetSeries });
  persistStationMeta();
  // Initialize tabular backup after MongoDB connects
  ensureMongo().then((db) => {
    setBackupDb(db);
    ensureBackupIndexes(db).catch(() => {});
    scheduleBackup();
  }).catch((err) => {
    console.warn(`[backup] MongoDB init deferred: ${err.message}`);
  });
} else {
  console.warn(
    "[ingest] MONGO_URI missing. Falling back to direct workbook reads only.",
  );
}

// ── Global crash guards ──
process.on("uncaughtException", (err) => {
  console.error("[UNCAUGHT EXCEPTION]", err?.stack || err);
});
process.on("unhandledRejection", (reason) => {
  console.error("[UNHANDLED REJECTION]", reason);
});

// ── Start server ──
app.listen(PORT, "0.0.0.0", () => {
  const external =
    process.env.RENDER_EXTERNAL_URL || process.env.VITE_API_BASE || "";
  if (external) {
    console.log(`Server ready on port ${PORT} (${external})`);
  } else {
    console.log(`Server ready on port ${PORT}`);
  }

  // Pre-warm workbook cache
  try {
    const wbPath = resolveWorkbookPath();
    setTimeout(() => {
      loadWorkbook(wbPath).catch(() => {});
    }, 10);
    // Background cache refresh
    let warming = false;
    const intervalMs = Math.max(60000, Number(CACHE_TTL_MS) || 60000);
    setInterval(async () => {
      if (warming) return;
      warming = true;
      try {
        await loadWorkbook(wbPath);
        await Promise.allSettled([readVizData(), readSheetSeries("PM10")]);
      } catch {}
      warming = false;
    }, intervalMs);
  } catch {}
});
