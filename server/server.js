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
const { router: adminAuthRoutes } = require("./routes/admin-auth");
const nlexSettingsRoutes = require("./routes/nlexSettings");
const kioskSettingsRoutes = require("./routes/kioskSettings");

// ── Express setup ──
const app = express();

// ── Security headers ──
// Lightweight helmet-style headers without adding a dependency.
// /nlex is intentionally frameable for VNNOX web-display players.
app.use((_req, res, next) => {
  const path = String(_req.path || "").toLowerCase();
  const isNlexDisplay =
    path === "/nlex" ||
    path === "/air-quality-monitoring/nlex" ||
    path.endsWith("/nlex/");
  const frameAncestors =
    process.env.VNNOX_FRAME_ANCESTORS ||
    process.env.FRAME_ANCESTORS ||
    "'self' https: http:";

  res.setHeader("X-Content-Type-Options", "nosniff");
  if (isNlexDisplay) {
    res.removeHeader("X-Frame-Options");
    res.setHeader("Content-Security-Policy", `frame-ancestors ${frameAncestors}`);
    res.setHeader("Cross-Origin-Resource-Policy", "cross-origin");
  } else {
    res.setHeader("X-Frame-Options", "SAMEORIGIN");
    res.setHeader("Content-Security-Policy", "frame-ancestors 'self'");
  }
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
          methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
          allowedHeaders: ["Content-Type", "Accept", "X-Admin-Token"],
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
app.use(adminAuthRoutes);
app.use(nlexSettingsRoutes);
app.use(kioskSettingsRoutes);
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
        const { warmEnrichedCache, warmNlexLatestCache } = require("./routes/tabular");
        await warmEnrichedCache();
        await warmNlexLatestCache();
      } catch (e) {
        console.warn(`[enriched-cache] warm-up error: ${e.message}`);
      }

      // 2) Sync all stations: Google Sheets → MongoDB → re-warm enriched cache.
      //    Runs in the background so startup is not blocked. Ensures all pages
      //    (Dashboard, Kiosk, TabularResults, Charts) serve fresh data after a
      //    server restart or config change (e.g. date format correction).
      try {
        const { runBackupCycle } = require("./services/tabularBackup");
        const {
          warmEnrichedCache: rewarm,
          warmNlexLatestCache: rewarmNlex,
        } = require("./routes/tabular");
        runBackupCycle("startup-sync", { force: true })
          .then(() => rewarm())
          .then(() => rewarmNlex())
          .then(() => console.log("[cache] startup-sync complete — all pages serve fresh data"))
          .catch((e) => console.warn(`[cache] startup-sync error: ${e?.message}`));
      } catch {}
    }, 5000);
  }
});
