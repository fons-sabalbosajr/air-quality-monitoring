/**
 * AQI routes — latest AQI value & previous N-day AQI.
 * Data sources: MongoDB (ingested from Google Sheets) → Google Sheets direct → Excel workbook fallback.
 */
const crypto = require("crypto");
const { Router } = require("express");
const XLSX = require("../xlsxCompat");
const { coerceDate } = require("../utils/dateUtils");
const { inferAqiCategory, phPm10Status24hFromAvg, phPm25Status24hFromAvg } = require("../services/aqiCalculator");
const { resolveWorkbookPath, loadWorkbook, pickKeysFromRows, readVizData } = require("../services/workbook");
const { fetchLatestFromMongo, fetchSeriesFromMongo, fetchRecentFromMongo } = require("../services/mongo");
const { readGoogleSheetAsSeries } = require("../services/googleSheets");

const router = Router();

// ── Cache helpers ──
function setAqiCacheHeaders(res, body) {
  const hash = crypto.createHash("md5").update(JSON.stringify(body)).digest("hex").slice(0, 16);
  const etag = `W/"${hash}"`;
  res.setHeader("Cache-Control", "private, max-age=60, stale-while-revalidate=300");
  res.setHeader("ETag", etag);
  res.setHeader("Vary", "Accept");
  return etag;
}

function handleConditional(req, res, body) {
  const etag = setAqiCacheHeaders(res, body);
  if (req.headers["if-none-match"] === etag) {
    res.status(304).end();
    return true;
  }
  return false;
}

// Latest AQI category — MongoDB (Google Sheets ingestion) → Google Sheets direct → Excel fallback
router.get("/api/aqi/latest", async (req, res) => {
  try {
    // 1) Try MongoDB first (ingested data from Google Sheets)
    // Query all station sheets in parallel, pick the one with the most recent data point
    const sheetKeys = ["clark_pm10", "meycauayan_pm10", "meycauayan_pm25", "zambales_pm10", "zambales_pm25", "san-fernando_pm10"];
    const results = await Promise.all(sheetKeys.map((key) => fetchLatestFromMongo(key).then((r) => ({ key, ...r }))));
    let bestDoc = null;
    let bestSheet = null;
    for (const { key, doc } of results) {
      // Skip erratic readings (zero concentration is an invalid measurement)
      if (doc && doc.value > 0 && (!bestDoc || doc.epochMs > bestDoc.epochMs)) {
        bestDoc = doc;
        bestSheet = key;
      }
    }
    if (bestDoc) {
      const concentration = bestDoc.value;
      // Determine pollutant from sheet key and compute AQI from concentration
      const isPm25 = bestSheet.includes("pm25");
      const statusFn = isPm25 ? phPm25Status24hFromAvg : phPm10Status24hFromAvg;
      const { aqi, status } = statusFn(concentration);
      const body = {
        parameter: isPm25 ? "PM2.5" : "PM10",
        concentration,
        value: aqi,
        category: status || inferAqiCategory(aqi),
        time: bestDoc.epochMs,
        sheet: bestSheet,
        source: "mongo",
      };
      if (handleConditional(req, res, body)) return;
      return res.json(body);
    }

    // 2) Try Google Sheets direct (clark_pm10 as primary station)
    try {
      const gsData = await readGoogleSheetAsSeries("clark", "pm10");
      if (gsData?.series?.length) {
        const latest = gsData.series[gsData.series.length - 1];
        const { aqi, status } = phPm10Status24hFromAvg(latest.y);
        const body = {
          parameter: "PM10",
          concentration: latest.y,
          value: aqi,
          category: status || inferAqiCategory(aqi),
          time: latest.t,
          source: "google-sheets",
        };
        if (handleConditional(req, res, body)) return;
        return res.json(body);
      }
    } catch {}

    // 3) Excel workbook fallback (legacy)

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
    const body = {
      parameter: "PM10",
      value: last.value,
      category,
      time: last.t,
      path: wbPath,
      source: "excel",
    };
    if (handleConditional(req, res, body)) return;
    res.json(body);
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
    let source = "mongo";

    // 1) Try clark_pm10 from MongoDB first (primary station), then fallback
    const primaryKeys = ["clark_pm10"];
    let activePollutant = "pm10";
    for (const key of primaryKeys) {
      const stored = await fetchRecentFromMongo(key, days + 2);
      if (stored?.series?.length) {
        seriesPayload = stored.series;
        activePollutant = key.includes("pm25") ? "pm25" : "pm10";
        break;
      }
    }

    // 2) Google Sheets direct fallback
    if (!seriesPayload) {
      try {
        const gsData = await readGoogleSheetAsSeries("clark", "pm10");
        if (gsData?.series?.length) {
          seriesPayload = gsData.series;
          source = "google-sheets";
        }
      } catch {}
    }

    // 3) Excel workbook fallback (legacy)
    if (!seriesPayload) {
      try {
        const { series } = await readVizData();
        seriesPayload = series;
        source = "excel";
      } catch {}
    }

    if (!Array.isArray(seriesPayload) || seriesPayload.length === 0) {
      return res.status(404).json({ error: "No AQI series data found" });
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
      const concentration = lastByDate.get(date);
      const statusFn = activePollutant === "pm25" ? phPm25Status24hFromAvg : phPm10Status24hFromAvg;
      const { aqi, status } = statusFn(Number(concentration));
      return { date, concentration, value: aqi, category: status || inferAqiCategory(aqi) };
    });
    const body = {
      days: items.length,
      items,
      source,
    };
    if (handleConditional(req, res, body)) return;
    res.json(body);
  } catch (e) {
    res
      .status(500)
      .json({ error: e.message || "Failed to compute AQI last days" });
  }
});

module.exports = router;
