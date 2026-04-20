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

const { PORT, MONGO_URI } = require("./config/env");

// Services
const { ensureMongo, persistStationMeta, scheduleIngestion } = require("./services/mongo");
const {
  resolveWorkbookPath,
  loadWorkbook,
  readVizData,
  readSheetSeries,
} = require("./services/workbook");
const { readGoogleSheetAsSeries } = require("./services/googleSheets");
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

// ── Security headers ──
// Lightweight helmet-style headers without adding a dependency
app.use((_req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("X-XSS-Protection", "1; mode=block");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  res.setHeader(
    "Strict-Transport-Security",
    "max-age=31536000; includeSubDomains"
  );
  // Remove Express fingerprint
  res.removeHeader("X-Powered-By");
  next();
});

// ── CORS — restrict to known origins in production ──
const CORS_ORIGIN = process.env.CORS_ORIGIN; // comma-separated origins
app.use(
  cors(
    CORS_ORIGIN
      ? {
          origin: CORS_ORIGIN.split(",").map((o) => o.trim()),
          methods: ["GET", "POST", "OPTIONS"],
          allowedHeaders: ["Content-Type", "Accept"],
        }
      : undefined // allow all in dev when CORS_ORIGIN is unset
  )
);

// ── Body parsing with size limit ──
app.use(express.json({ limit: "1mb" }));

// ── Simple rate limiter (in-memory, per-IP) ──
const _hits = new Map();
const RATE_WINDOW_MS = Number(process.env.RATE_WINDOW_MS) || 60_000;
const RATE_MAX = Number(process.env.RATE_MAX) || 120;
app.use((req, res, next) => {
  // Skip rate-limit for health checks
  if (req.path === "/" || req.path === "/health") return next();
  const ip = req.ip || req.socket.remoteAddress || "unknown";
  const now = Date.now();
  let entry = _hits.get(ip);
  if (!entry || now - entry.start > RATE_WINDOW_MS) {
    entry = { start: now, count: 1 };
    _hits.set(ip, entry);
  } else {
    entry.count += 1;
  }
  if (entry.count > RATE_MAX) {
    return res
      .status(429)
      .json({ error: "Too many requests. Please try again later." });
  }
  next();
});
// Cleanup stale entries every 5 min
setInterval(() => {
  const cutoff = Date.now() - RATE_WINDOW_MS;
  for (const [ip, e] of _hits) if (e.start < cutoff) _hits.delete(ip);
}, 300_000);

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
  scheduleIngestion({ readVizData, readSheetSeries, readGoogleSheetAsSeries });
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

  // Pre-warm caches on startup
  if (MONGO_URI) {
    setTimeout(async () => {
      // 1) Pre-warm enriched tabular cache from MongoDB backup (fast, no Google Sheets needed)
      try {
        const { warmEnrichedCache } = require("./routes/tabular");
        await warmEnrichedCache();
      } catch (e) {
        console.warn(`[enriched-cache] warm-up error: ${e.message}`);
      }

      // 2) Pre-warm Google Sheets raw cache (slower, may timeout for large sheets)
      try {
        const { getRawTabularTable } = require("./services/googleSheets");
        const { TABULAR_SHEETS } = require("./config/sheets");
        let warmed = 0;
        let failed = 0;
        for (const [province, pollutants] of Object.entries(TABULAR_SHEETS)) {
          for (const pollutant of Object.keys(pollutants)) {
            try {
              const timeout = new Promise((_, rej) =>
                setTimeout(() => rej(new Error("warm-up timeout")), 20000)
              );
              await Promise.race([getRawTabularTable(province, pollutant), timeout]);
              warmed++;
            } catch (e) {
              failed++;
              console.warn(`[cache] Warm-up failed for ${province}/${pollutant}: ${e.message}`);
            }
          }
        }
        console.log(`[cache] Google Sheets cache warmed: ${warmed} ok, ${failed} failed`);
      } catch {}
    }, 5000);
  }
});
