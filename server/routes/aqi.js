/**
 * AQI routes — latest AQI value & previous N-day AQI.
 */
const { Router } = require("express");
const XLSX = require("../xlsxCompat");
const { coerceDate } = require("../utils/dateUtils");
const { inferAqiCategory } = require("../services/aqiCalculator");
const { resolveWorkbookPath, loadWorkbook, pickKeysFromRows, readVizData } = require("../services/workbook");
const { fetchLatestFromMongo, fetchSeriesFromMongo } = require("../services/mongo");

const router = Router();

// Latest AQI category (from viz_data sheet)
router.get("/api/aqi/latest", async (req, res) => {
  try {
    const stored = await fetchLatestFromMongo("viz_data");
    if (stored?.doc) {
      const value = stored.doc.value;
      res.json({
        parameter: "PM10",
        value,
        category: inferAqiCategory(value),
        time: stored.doc.epochMs,
        path: stored.meta?.path || resolveWorkbookPath(),
        source: "mongo",
      });
      return;
    }

    const wbPath = resolveWorkbookPath();
    const wb = await loadWorkbook(wbPath);
    const sheetName =
      wb.SheetNames.find((n) => n.toLowerCase() === "viz_data") ||
      wb.SheetNames[0];
    const ws = wb.Sheets[sheetName];
    if (!ws) return res.status(404).json({ error: "viz_data sheet not found" });
    const rows = XLSX.utils.sheet_to_json(ws, { raw: true, defval: null });
    if (!Array.isArray(rows) || rows.length < 2)
      return res.status(404).json({ error: "No rows in viz_data" });

    const headerRow = rows[0] || {};
    const headerValues = Object.fromEntries(
      Object.keys(headerRow).map((k) => [
        k,
        (headerRow[k] || "").toString().trim(),
      ]),
    );
    const xKey =
      Object.keys(headerValues).find((k) =>
        /date|time/i.test(headerValues[k] || ""),
      ) ||
      (Object.keys(headerValues).includes("Data Visualization Process")
        ? "Data Visualization Process"
        : null);
    const yPrefOrder = [
      /24\s*HR\s*ROLLING\s*AQI\s*VALUE/i,
      /^\s*AQI\s*$/i,
      /HOURLY\s*CONC/i,
      /TRUNCATED\s*VALUE/i,
    ];
    let valueKey = null;
    for (const rx of yPrefOrder) {
      const found = Object.keys(headerValues).find((k) =>
        rx.test(headerValues[k] || ""),
      );
      if (found) {
        valueKey = found;
        break;
      }
    }
    let categoryKey =
      Object.keys(headerValues).find((k) =>
        /AQI\s*CATEG(ORY)?/i.test(headerValues[k] || ""),
      ) || null;

    if (!valueKey || !xKey) {
      const picked = pickKeysFromRows(rows);
      const fallbackX = picked.xKey;
      const fallbackY = picked.yKey;
      const xUse = xKey || fallbackX;
      const yUse = valueKey || fallbackY;
      valueKey = yUse;
      if (!categoryKey && rows.length > 1) {
        const keys = Object.keys(rows[1] || {});
        categoryKey =
          keys.find((k) => {
            if (k === xUse || k === yUse) return false;
            const v = rows[1]?.[k];
            if (v == null) return false;
            const n = Number(String(v).replace(/[, ]/g, ""));
            return !isFinite(n) && /category|aqi/i.test(String(v))
              ? true
              : /category|aqi/i.test(k);
          }) || null;
      }
    }

    let last = null;
    for (let i = rows.length - 1; i >= 1; i--) {
      const r = rows[i];
      const t = coerceDate(xKey ? r[xKey] : r["Data Visualization Process"]);
      let valRaw = valueKey ? r[valueKey] : null;
      if (typeof valRaw === "string") valRaw = valRaw.replace(/[, ]/g, "");
      const aqiVal = Number(valRaw);
      const cat = categoryKey
        ? r[categoryKey] != null
          ? String(r[categoryKey]).trim()
          : null
        : null;
      if (t && isFinite(aqiVal)) {
        last = { t: t.getTime(), value: aqiVal, category: cat || null };
        break;
      }
    }
    if (!last) return res.status(404).json({ error: "No valid AQI row" });

    const category = last.category || inferAqiCategory(last.value);
    res.json({
      parameter: "PM10",
      value: last.value,
      category,
      time: last.t,
      path: wbPath,
      source: "excel",
    });
  } catch (e) {
    res.status(500).json({ error: e.message || "Failed to read latest AQI" });
  }
});

// Previous N calendar days AQI values
router.get("/api/aqi/last-days", async (req, res) => {
  try {
    let days = Number(req.query.days || 3);
    if (!isFinite(days) || days <= 0) days = 3;
    days = Math.min(Math.max(Math.floor(days), 1), 14);
    let seriesPayload = null;
    const stored = await fetchSeriesFromMongo("viz_data");
    if (stored?.series?.length) {
      seriesPayload = stored.series;
    } else {
      const { series } = await readVizData();
      seriesPayload = series;
    }
    if (!Array.isArray(seriesPayload) || seriesPayload.length === 0) {
      return res.status(404).json({ error: "No viz_data series" });
    }
    const todayKey = new Date().toISOString().slice(0, 10);
    const lastByDate = new Map();
    for (const pt of seriesPayload) {
      const d = new Date(pt.t);
      const key = new Date(d.getFullYear(), d.getMonth(), d.getDate())
        .toISOString()
        .slice(0, 10);
      if (key === todayKey) continue;
      lastByDate.set(key, pt.y);
    }
    const dates = Array.from(lastByDate.keys())
      .sort((a, b) => (a < b ? 1 : -1))
      .slice(0, days)
      .sort();
    const items = dates.map((date) => {
      const val = lastByDate.get(date);
      return { date, value: val, category: inferAqiCategory(Number(val)) };
    });
    res.json({
      days: items.length,
      items,
      source: stored?.series ? "mongo" : "excel",
    });
  } catch (e) {
    res
      .status(500)
      .json({ error: e.message || "Failed to compute AQI last days" });
  }
});

module.exports = router;
