/**
 * Chart series routes behind /admin/charts, plus workbook diagnostics.
 *
 * `/api/pm10-data` (hourly) and `/api/viz-data` (daily) are now served from
 * the **MongoDB tabular backup** — the same live snapshot behind the kiosk,
 * NLEX wall, Data Manager and partner API (see services/chartSeries.js). They
 * accept `?station=&pollutant=&value=` and follow the sheets pipeline in near
 * real time.
 *
 * The legacy Excel/SharePoint workbook is still reachable for comparison with
 * `?source=excel` (or `?yKey=`), and is used automatically only when
 * MONGO_URI is unset. It is deliberately NOT the automatic fallback: that read
 * takes several Microsoft Graph round-trips at 25 s each, which outlives the
 * Nginx proxy_read_timeout and surfaced as a 504 in the browser. Its ingested
 * series also stopped updating in November 2025.
 */
const { Router } = require("express");
const XLSX = require("../xlsxCompat");
const {
  resolveWorkbookPath,
  loadWorkbook,
  pickKeysFromRows,
  readVizData,
  readSheetSeries,
} = require("../services/workbook");
const { fetchSeriesFromMongo } = require("../services/mongo");
const {
  BadSeriesRequest,
  SeriesWarming,
  buildHourlySeries,
  buildDailySeries,
  chartTargets,
} = require("../services/chartSeries");
const { MONGO_URI } = require("../config/env");

const router = Router();

/** True when the caller explicitly asked for the legacy workbook read. */
function wantsWorkbook(req) {
  return !!req.query.yKey || String(req.query.source || "").toLowerCase() === "excel";
}

/**
 * Serve a chart series from the live tabular backup, with the legacy workbook
 * behind an explicit opt-in.
 *
 * @param {string}   sheetKey  legacy series key in Mongo ("PM10", "viz_data")
 * @param {Function} buildFn   (query) => Promise<{series, meta}|null> live builder
 * @param {Function} readFn    (yKey) => Promise<{series, meta}> workbook reader
 */
function serveSeries(sheetKey, buildFn, readFn) {
  return async (req, res) => {
    const { yKey } = req.query;

    // 1) Live tabular backup — the normal path.
    if (MONGO_URI && !wantsWorkbook(req)) {
      try {
        const built = await buildFn(req.query);
        if (built) return res.json({ ...built, source: "tabular-backup" });
        return res.status(503).json({
          error: "No backed-up readings for that station/pollutant yet.",
          hint: "The tabular backup has not synced this dataset. Check /api/backup/status.",
          series: [],
          meta: { points: 0 },
          source: "unavailable",
        });
      } catch (e) {
        if (e instanceof BadSeriesRequest) {
          return res.status(400).json({ error: e.message, series: [], source: "bad_request" });
        }
        if (e instanceof SeriesWarming) {
          // The build is still running and will populate the cache; a retry
          // shortly will be served from it.
          res.setHeader("Retry-After", "5");
          return res.status(503).json({ error: e.message, series: [], source: "warming" });
        }
        console.error(`[charts] ${sheetKey} series failed: ${e.message}`);
        return res.status(500).json({ error: "Failed to build series.", series: [], source: "error" });
      }
    }

    // 2) Legacy workbook — explicit ?source=excel / ?yKey=, or no Mongo at all.
    try {
      if (!yKey) {
        const stored = await fetchSeriesFromMongo(sheetKey);
        if (stored) return res.json({ ...stored, source: "mongo-legacy" });
      }
      const data = await readFn(yKey);
      res.json({ ...data, source: yKey ? "excel" : "excel-fallback" });
    } catch (e) {
      res.status(500).json({ error: e.message || `Failed to read ${sheetKey}`, series: [], source: "error" });
    }
  };
}

// Hourly readings per station/pollutant (default: concentration)
router.get("/api/pm10-data", serveSeries("PM10", buildHourlySeries, (yKey) => readSheetSeries("PM10", yKey)));

// Daily aggregate per station/pollutant (default: 24-hour rolling average)
router.get("/api/viz-data", serveSeries("viz_data", buildDailySeries, (yKey) => readVizData(yKey)));

// Stations / pollutants / value types the Charts page can select
router.get("/api/chart-targets", (_req, res) => res.json(chartTargets()));

// Diagnostics endpoint
router.get("/api/viz-data/diagnostics", async (req, res) => {
  try {
    const wbPath = resolveWorkbookPath();
    const wb = await loadWorkbook(wbPath);
    const sheetNames = wb.SheetNames;
    const sheetName =
      sheetNames.find((n) => n.toLowerCase() === "viz_data") || sheetNames[0];
    const ws = wb.Sheets[sheetName];
    let rows = [];
    let head = null;
    if (ws) {
      rows = XLSX.utils.sheet_to_json(ws, { raw: true, defval: null });
      head = rows[0] || null;
    }
    const keysPicked =
      Array.isArray(rows) && rows.length
        ? pickKeysFromRows(rows)
        : { xKey: null, yKey: null };
    const headerValues = head
      ? Object.fromEntries(
          Object.keys(head).map((k) => [k, (head[k] || "").toString().trim()]),
        )
      : {};
    const xLabel = keysPicked.xKey
      ? headerValues[keysPicked.xKey] || keysPicked.xKey
      : null;
    const yLabel = keysPicked.yKey
      ? headerValues[keysPicked.yKey] || keysPicked.yKey
      : null;
    res.json({
      path: wbPath,
      sheetNames,
      chosenSheet: sheetName,
      rowsCount: Array.isArray(rows) ? rows.length : 0,
      keysPicked,
      labels: { xLabel, yLabel },
      sample: Array.isArray(rows) ? rows.slice(0, 3) : [],
    });
  } catch (e) {
    res.status(500).json({ error: e.message || "Diagnostics failed" });
  }
});

module.exports = router;
