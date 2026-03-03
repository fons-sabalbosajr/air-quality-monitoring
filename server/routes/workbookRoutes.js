/**
 * Workbook-based data routes (viz_data, PM10 series, diagnostics).
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

const router = Router();

// PM10 worksheet series
router.get("/api/pm10-data", async (req, res) => {
  try {
    const { yKey } = req.query;
    if (!yKey) {
      const stored = await fetchSeriesFromMongo("PM10");
      if (stored) {
        return res.json({ ...stored, source: "mongo" });
      }
    }
    const data = await readSheetSeries("PM10", yKey);
    res.json({ ...data, source: yKey ? "excel" : "excel-fallback" });
  } catch (e) {
    res.status(500).json({ error: e.message || "Failed to read PM10 sheet" });
  }
});

// Viz-data series
router.get("/api/viz-data", async (req, res) => {
  try {
    const { yKey } = req.query;
    if (!yKey) {
      const stored = await fetchSeriesFromMongo("viz_data");
      if (stored) {
        return res.json({ ...stored, source: "mongo" });
      }
    }
    const data = await readVizData(yKey);
    res.json({ ...data, source: yKey ? "excel" : "excel-fallback" });
  } catch (e) {
    res.status(500).json({ error: e.message || "Failed to read viz_data" });
  }
});

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
