/**
 * Google Sheets data fetching, multi-pass enhancement,
 * and cached table retrieval.
 *
 * Uses CSV export per year-tab (via gviz/tq) instead of XLSX to avoid
 * stale formula result caches that produce incorrect dates.
 */
const { SHEET_CACHE_TTL_MS } = require("../config/env");
const { TABULAR_SHEETS, resolveSheetEntry } = require("../config/sheets");
const { parseDateValue, formatDateAmPm, detectDateFormat } = require("../utils/dateUtils");
const { coerceNumber, meanLast } = require("../utils/mathUtils");
const { phPm10Status24hFromAvg, phPm25Status24hFromAvg } = require("./aqiCalculator");

// ── Secure LRU cache with stale-while-revalidate ──
const MAX_CACHE_ENTRIES = 50;
const STALE_WHILE_REVALIDATE_MS = SHEET_CACHE_TTL_MS * 4; // serve stale up to 4x TTL
const _sheetCache = new Map();
const _revalidating = new Set(); // track in-flight background refreshes

function cacheSet(key, payload) {
  // Evict oldest entries when cache exceeds max size
  if (_sheetCache.size >= MAX_CACHE_ENTRIES && !_sheetCache.has(key)) {
    const oldestKey = _sheetCache.keys().next().value;
    _sheetCache.delete(oldestKey);
  }
  _sheetCache.set(key, { ts: Date.now(), payload });
}

function cacheGet(key) {
  const entry = _sheetCache.get(key);
  if (!entry) return { hit: false, fresh: false, stale: false, payload: null };
  const age = Date.now() - entry.ts;
  if (age < SHEET_CACHE_TTL_MS) {
    return { hit: true, fresh: true, stale: false, payload: entry.payload };
  }
  if (age < STALE_WHILE_REVALIDATE_MS) {
    return { hit: true, fresh: false, stale: true, payload: entry.payload };
  }
  _sheetCache.delete(key);
  return { hit: false, fresh: false, stale: false, payload: null };
}

const VERBOSE_SHEETS_LOGS = process.env.VERBOSE_SHEETS_LOGS === "true";

function extractSpreadsheetId(url) {
  if (!url) return null;
  const s = String(url);
  const m = s.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
  return m ? m[1] : null;
}

/* ── Simple CSV line parser (handles quoted fields) ─────────────── */
function parseCSVLine(line) {
  const result = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (inQuotes) {
      if (c === '"') {
        if (i + 1 < line.length && line[i + 1] === '"') {
          current += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        current += c;
      }
    } else {
      if (c === '"') {
        inQuotes = true;
      } else if (c === ",") {
        result.push(current.trim() || null);
        current = "";
      } else {
        current += c;
      }
    }
  }
  result.push(current.trim() || null);
  return result;
}

/**
 * Fetch a single sheet tab as CSV via Google Sheets gviz/tq endpoint.
 * Returns the CSV text or null if the tab doesn't exist.
 */
async function fetchSheetTabCSV(spreadsheetId, tabName) {
  const csvUrl =
    `https://docs.google.com/spreadsheets/d/${spreadsheetId}` +
    `/gviz/tq?tqx=out:csv&sheet=${encodeURIComponent(tabName)}`;

  const TIMEOUT_MS = 30000;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(csvUrl, {
      method: "GET",
      redirect: "follow",
      headers: { "User-Agent": "aqm-server/1.0", Accept: "text/csv,*/*" },
      signal: controller.signal,
    });
    clearTimeout(timer);
    if (!res.ok) return null;
    const text = await res.text();
    // Google Sheets returns an HTML page when the tab doesn't exist
    if (
      !text ||
      text.length < 10 ||
      text.trimStart().startsWith("<!") ||
      text.trimStart().startsWith("<html")
    ) {
      return null;
    }
    return text;
  } catch {
    clearTimeout(timer);
    return null;
  }
}

/**
 * Download displayed values from each year-named tab as CSV,
 * merge rows from all tabs (e.g. "2025", "2026").
 *
 * CSV export returns the DISPLAYED values computed by Google Sheets,
 * avoiding stale formula cache issues present in XLSX export.
 */
async function fetchAllSheetsAsTable(sheetUrl) {
  const id = extractSpreadsheetId(sheetUrl);
  if (!id) throw new Error("Cannot extract spreadsheet ID from URL");

  // Try year-named tabs: up to 2 years in the past through current year
  const currentYear = new Date().getFullYear();
  const yearsToTry = [];
  for (let y = currentYear - 2; y <= currentYear; y++) {
    yearsToTry.push(String(y));
  }

  let columns = null;
  let allRows = [];
  const RAW_COL_PATTERNS = [/date|time/i, /concentration/i];
  let tabsFound = 0;

  // Track tab fingerprints to deduplicate — Google Sheets returns the
  // first tab's data when a requested tab name doesn't exist.
  const seenTabFingerprints = new Set();

  for (const year of yearsToTry) {
    const csvText = await fetchSheetTabCSV(id, year);
    if (!csvText) continue;

    // Fingerprint: first 200 chars + last 200 chars + length
    const fp = `${csvText.length}|${csvText.slice(0, 200)}|${csvText.slice(-200)}`;
    if (seenTabFingerprints.has(fp)) {
      // Duplicate tab content (non-existent tab returned first tab) — skip
      continue;
    }
    seenTabFingerprints.add(fp);
    tabsFound++;

    const lines = csvText.split("\n");
    if (lines.length < 2) continue;

    const headerRow = parseCSVLine(lines[0]).map((h, idx) => {
      const v = (h == null ? "" : String(h)).trim();
      return v || `Column ${idx + 1}`;
    });

    if (!columns) {
      columns = headerRow.filter((h) =>
        RAW_COL_PATTERNS.some((p) => p.test(h)),
      );
      if (!columns.length) columns = headerRow;
    }

    const colIndices = columns.map((c) => headerRow.indexOf(c));

    for (let i = 1; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue;
      const cells = parseCSVLine(line);
      if (!cells.some((c) => c != null && String(c).trim() !== "")) continue;

      const obj = {};
      for (let ci = 0; ci < columns.length; ci++) {
        const idx = colIndices[ci];
        obj[columns[ci]] = idx >= 0 ? (cells[idx] ?? null) : null;
      }
      // CSV values are always computed — no formula tracking needed
      Object.defineProperty(obj, "__formulaCols", {
        value: [],
        enumerable: false,
        writable: true,
      });
      allRows.push(obj);
    }
  }

  if (!tabsFound) {
    throw new Error("No year-named sheet tabs could be fetched");
  }

  return { columns: columns || [], rows: allRows };
}

// ====================================================================
// Phase 1: Clean raw rows (date interpolation, sort, dedup)
// Phase 2: Enrich with Rolling Avg + AQI + Status (computed at serve-time)
// ====================================================================

/**
 * Phase 1: Clean raw rows — date interpolation, sort, remove placeholders, dedup.
 * Returns rows in CHRONOLOGICAL order (oldest first) with _epochMs attached.
 * Does NOT compute AQI or Rolling Average — that happens at serve time.
 *
 * @param {object} table            - { columns, rows }
 * @param {object} [opts]           - options
 * @param {string} [opts.dateFormat]- explicit date format override: 'DMY' | 'MDY' | null (auto)
 */
function prepareRawRows(table, opts = {}) {
  const columns = Array.isArray(table?.columns) ? [...table.columns] : [];
  const rows = Array.isArray(table?.rows) ? table.rows : [];
  if (!rows.length) return { columns, rows: [], dateKey: null, concKey: null };

  const dateKey =
    columns.find((c) => /date|time/i.test(c)) ||
    Object.keys(rows[0] || {}).find((k) => /date|time/i.test(k));
  const concKey =
    columns.find((c) => /concentration/i.test(c)) ||
    Object.keys(rows[0] || {}).find((k) => /concentration/i.test(k));

  // ── Auto-detect date format (DD/MM/YYYY vs MM/DD/YYYY) ──
  let dateFmt = opts.dateFormat || null; // explicit override from sheets config
  if (dateKey && !dateFmt) {
    const sampleDates = rows.slice(0, 500).map((r) => r[dateKey]);
    dateFmt = detectDateFormat(sampleDates);
  }
  if (!dateFmt) dateFmt = "MDY";
  if (dateFmt === "DMY" && VERBOSE_SHEETS_LOGS) {
    console.log("[prepareRawRows] Using DD/MM/YYYY date format" + (opts.dateFormat ? " (explicit override)" : " (auto-detected)"));
  }

  // ── Pass 1: Parse all dates → epoch timestamps ──
  const epochs = new Array(rows.length);
  for (let i = 0; i < rows.length; i++) {
    if (dateKey) {
      const d = parseDateValue(rows[i][dateKey], dateFmt);
      epochs[i] = d ? d.getTime() : 0;
    } else {
      epochs[i] = 0;
    }
  }

  // ── Pass 1b: Interpolate missing dates ──
  // Google Sheets CSV export sometimes returns empty date fields for
  // formula-computed cells (commonly for days 13-31 of each month).
  if (dateKey) {
    const HOUR_MS = 3600000;

    // Forward-fill
    for (let i = 1; i < rows.length; i++) {
      if (epochs[i] === 0 && epochs[i - 1] > 0) {
        epochs[i] = epochs[i - 1] + HOUR_MS;
        rows[i][dateKey] = formatDateAmPm(new Date(epochs[i]));
      }
    }

    // Backward-fill leading empties
    let firstValid = -1;
    for (let i = 0; i < rows.length; i++) {
      if (epochs[i] > 0) { firstValid = i; break; }
    }
    if (firstValid > 0) {
      for (let i = firstValid - 1; i >= 0; i--) {
        epochs[i] = epochs[i + 1] - HOUR_MS;
        rows[i][dateKey] = formatDateAmPm(new Date(epochs[i]));
      }
    }

    // Second forward pass for remaining gaps
    for (let i = 1; i < rows.length; i++) {
      if (epochs[i] === 0 && epochs[i - 1] > 0) {
        epochs[i] = epochs[i - 1] + HOUR_MS;
        rows[i][dateKey] = formatDateAmPm(new Date(epochs[i]));
      }
    }

    const interpolated = epochs.filter((e, i) => {
      const orig = parseDateValue(table.rows[i]?.[dateKey], dateFmt);
      return e > 0 && !orig;
    }).length;
    if (interpolated > 0 && VERBOSE_SHEETS_LOGS) {
      console.log(`[prepareRawRows] Interpolated ${interpolated} missing dates`);
    }
  }

  // ── Pass 2: Sort chronologically ──
  const chronoIndices = Array.from({ length: rows.length }, (_, i) => i);
  chronoIndices.sort((a, b) => epochs[a] - epochs[b]);

  // ── Pass 2b: Remove future-dated rows ──
  const nowMs = Date.now();
  let validIndices = chronoIndices.filter(
    (i) => epochs[i] === 0 || epochs[i] <= nowMs,
  );

  // ── Pass 2c: Remove formula-generated / placeholder rows ──
  if (dateKey && concKey) {
    validIndices = validIndices.filter((i) => {
      const fc = rows[i].__formulaCols;
      if (!fc) return true;
      const dateIsFormula = fc.includes(dateKey);
      const concIsFormula = fc.includes(concKey);
      if (dateIsFormula && concIsFormula) return false;
      if (dateIsFormula) {
        const concVal = rows[i][concKey];
        const numConc = coerceNumber(concVal);
        const isEmpty =
          concVal == null ||
          (typeof concVal === "string" && concVal.trim() === "") ||
          numConc === 0;
        if (isEmpty) return false;
      }
      return true;
    });
  }

  // ── Pass 2d: Remove ALL rows with empty/null/zero concentration ──
  // Equipment downtime produces rows with dates but no reading.
  // These corrupt the rolling average and should not appear in output.
  if (concKey) {
    validIndices = validIndices.filter((i) => {
      const concVal = rows[i][concKey];
      const numVal = coerceNumber(concVal);
      const isEmpty =
        concVal == null ||
        (typeof concVal === "string" && concVal.trim() === "") ||
        numVal === 0;
      return !isEmpty;
    });
  }

  // ── Pass 2e: Detect and remove shared-formula placeholder rows ──
  if (dateKey && concKey && validIndices.length > 2) {
    const lastConcVal = rows[validIndices[validIndices.length - 1]][concKey];
    let sameCount = 0;
    for (let j = validIndices.length - 1; j >= 0; j--) {
      const cv = rows[validIndices[j]][concKey];
      if (
        cv === lastConcVal ||
        (coerceNumber(cv) === coerceNumber(lastConcVal) &&
          coerceNumber(cv) != null)
      ) {
        sameCount++;
      } else {
        break;
      }
    }
    if (sameCount >= 10 && coerceNumber(lastConcVal) != null) {
      validIndices.splice(validIndices.length - sameCount);
    }
  }

  // ── Deduplicate by epoch (keep first occurrence) ──
  const seenEpochs = new Set();
  const dedupedIndices = [];
  for (const i of validIndices) {
    if (epochs[i] > 0) {
      if (seenEpochs.has(epochs[i])) continue;
      seenEpochs.add(epochs[i]);
    }
    dedupedIndices.push(i);
  }

  // ── Build result rows (chronological order, oldest first) ──
  const resultRows = dedupedIndices.map((i) => {
    const r = {};
    for (const col of columns) {
      r[col] = rows[i][col] ?? null;
    }
    r._epochMs = epochs[i]; // attach for sorting/indexing
    return r;
  });

  return { columns, rows: resultRows, dateKey, concKey };
}

/**
 * Phase 2: Enrich clean rows with Rolling Average, AQI, Status.
 * Formats dates and reverses to newest-first.
 * Input rows must be in chronological order (oldest first, from prepareRawRows).
 */
function enrichWithAqi(prepared, pollutantKey, opts = {}) {
  const logsPerHour = Number(opts.logsPerHour || 1);
  const requiredLogs = 24 * logsPerHour;
  const statusFn =
    pollutantKey === "pm25" ? phPm25Status24hFromAvg : phPm10Status24hFromAvg;

  const columns = [...(prepared.columns || [])];
  const rows = prepared.rows || [];
  const dateKey =
    prepared.dateKey || columns.find((c) => /date|time/i.test(c));
  const concKey =
    prepared.concKey || columns.find((c) => /concentration/i.test(c));

  if (!rows.length) return { columns, rows: [] };

  const rollingKey =
    columns.find((c) => /rolling\s*average/i.test(c)) || "Rolling Average";
  const aqiCatKey =
    columns.find((c) => /aqi/i.test(c) && /category/i.test(c)) || null;

  const numericSeen = [];
  const enrichedRows = [];

  for (let pos = 0; pos < rows.length; pos++) {
    const r = { ...rows[pos] };

    // Format date from _epochMs or parse existing string
    if (dateKey) {
      const epochMs = r._epochMs;
      if (epochMs && epochMs > 0) {
        r[dateKey] = formatDateAmPm(new Date(epochMs));
      } else {
        const d = parseDateValue(r[dateKey]);
        if (d) r[dateKey] = formatDateAmPm(d);
      }
    }
    delete r._epochMs;

    if (concKey) {
      const n = coerceNumber(r[concKey]);
      const isSentinel = n != null && n >= 9999;

      // Skip rows with null/empty concentration (equipment downtime)
      if (n == null) {
        continue;
      }

      // Erratic / sentinel values (>=9999): keep the row for tabular display
      // but exclude from rolling average and mark as "For Validation"
      if (isSentinel) {
        r[rollingKey] = null;
        r["AQI"] = null;
        r["Status"] = "For Validation";
        if (aqiCatKey) delete r[aqiCatKey];
        enrichedRows.push(r);
        continue;
      }

      numericSeen.push(n);

      const avg24h = numericSeen.length
        ? meanLast(numericSeen, requiredLogs)
        : 0;
      r[rollingKey] = avg24h;

      const { aqi, status } = statusFn(avg24h);
      r["AQI"] = aqi;
      r["Status"] = status;

      if (aqiCatKey) delete r[aqiCatKey];
    }

    // Reverse: newest first
    enrichedRows.push(r);
  }

  // Reverse to newest-first
  enrichedRows.reverse();

  const filteredColumns = columns.filter((c) => c !== aqiCatKey);
  const ensureCol = (c) => {
    if (!filteredColumns.includes(c)) filteredColumns.push(c);
  };
  if (concKey) {
    ensureCol(rollingKey);
    ensureCol("AQI");
    ensureCol("Status");
  }

  return { columns: filteredColumns, rows: enrichedRows };
}

/**
 * Combined enhancement: prepareRawRows + enrichWithAqi (backward compat).
 */
function enhanceTabularRows(table, pollutantKey, opts = {}) {
  try {
    const prepared = prepareRawRows(table, { dateFormat: opts.dateFormat });
    return { ...table, ...enrichWithAqi(prepared, pollutantKey, opts) };
  } catch (err) {
    console.error(`[enhanceTabularRows] Unexpected error: ${err.message}`);
    return table || { columns: [], rows: [] };
  }
}

/**
 * Fetch raw data from Google Sheets, cleaned and deduped but WITHOUT AQI computation.
 * Stores _epochMs on each row for indexing. Used by the backup service.
 */
async function getRawTabularTable(provinceKey, pollutantKey) {
  const entry = resolveSheetEntry(TABULAR_SHEETS?.[provinceKey]?.[pollutantKey]);
  const sheetUrl = entry.url;
  const dateFormat = entry.dateFormat;
  if (!sheetUrl) {
    const err = new Error("Sheet URL not configured");
    err.code = "NOT_CONFIGURED";
    throw err;
  }
  const cacheKey = `raw-tabular:${provinceKey}:${pollutantKey}`;
  const cached = cacheGet(cacheKey);

  // Fresh cache → return immediately
  if (cached.fresh) {
    return { ...cached.payload, source: "cache" };
  }

  // Stale cache → return stale data immediately, revalidate in background
  if (cached.stale) {
    if (!_revalidating.has(cacheKey)) {
      _revalidating.add(cacheKey);
      fetchAndCacheRaw(cacheKey, sheetUrl, provinceKey, pollutantKey, dateFormat)
        .finally(() => _revalidating.delete(cacheKey));
    }
    return { ...cached.payload, source: "stale-cache" };
  }

  // No cache → fetch synchronously
  return fetchAndCacheRaw(cacheKey, sheetUrl, provinceKey, pollutantKey, dateFormat);
}

/**
 * Internal: fetch from Google Sheets, prepare rows, and cache the result.
 */
async function fetchAndCacheRaw(cacheKey, sheetUrl, provinceKey, pollutantKey, dateFormat) {
  try {
    const table = await fetchAllSheetsAsTable(sheetUrl);
    const prepared = prepareRawRows(table, { dateFormat });
    const payload = {
      province: provinceKey,
      pollutant: pollutantKey,
      columns: prepared.columns,
      rows: prepared.rows,
      dateKey: prepared.dateKey,
      concKey: prepared.concKey,
      totalRows: prepared.rows.length,
      fetchedAt: Date.now(),
      source: "sheet",
    };
    cacheSet(cacheKey, payload);
    return payload;
  } catch (fetchErr) {
    console.error(
      `[raw-tabular] Error fetching ${provinceKey}/${pollutantKey}: ${fetchErr.message}`,
    );
    // Fall back to any stale data
    const stale = cacheGet(cacheKey);
    if (stale.hit) {
      return { ...stale.payload, source: "stale-cache" };
    }
    throw fetchErr;
  }
}

async function getTabularTable(provinceKey, pollutantKey) {
  const entry = resolveSheetEntry(TABULAR_SHEETS?.[provinceKey]?.[pollutantKey]);
  const sheetUrl = entry.url;
  const dateFormat = entry.dateFormat;
  if (!sheetUrl) {
    const err = new Error("Sheet URL not configured");
    err.code = "NOT_CONFIGURED";
    throw err;
  }
  const cacheKey = `tabular:${provinceKey}:${pollutantKey}`;
  const cached = cacheGet(cacheKey);

  // Fresh cache → return immediately
  if (cached.fresh) {
    return { ...cached.payload, source: "cache" };
  }

  // Stale cache → return stale data immediately, revalidate in background
  if (cached.stale) {
    if (!_revalidating.has(cacheKey)) {
      _revalidating.add(cacheKey);
      fetchAndCacheTabular(cacheKey, sheetUrl, provinceKey, pollutantKey, dateFormat)
        .finally(() => _revalidating.delete(cacheKey));
    }
    return { ...cached.payload, source: "stale-cache" };
  }

  // No cache → fetch synchronously
  return fetchAndCacheTabular(cacheKey, sheetUrl, provinceKey, pollutantKey, dateFormat);
}

/**
 * Internal: fetch from Google Sheets, enhance with AQI, and cache.
 */
async function fetchAndCacheTabular(cacheKey, sheetUrl, provinceKey, pollutantKey, dateFormat) {
  try {
    let table = await fetchAllSheetsAsTable(sheetUrl);
    table = enhanceTabularRows(table, pollutantKey, { logsPerHour: 1, dateFormat });
    const payload = {
      province: provinceKey,
      pollutant: pollutantKey,
      columns: table.columns,
      rows: table.rows,
      totalRows: table.rows.length,
      fetchedAt: Date.now(),
      source: "sheet",
    };
    cacheSet(cacheKey, payload);
    return payload;
  } catch (fetchErr) {
    console.error(
      `[tabular] Error fetching ${provinceKey}/${pollutantKey}: ${fetchErr.message}`,
    );
    const stale = cacheGet(cacheKey);
    if (stale.hit) {
      console.warn(
        `[tabular] Serving stale cache for ${provinceKey}/${pollutantKey}`,
      );
      return { ...stale.payload, source: "stale-cache" };
    }
    throw fetchErr;
  }
}

/**
 * Convert Google Sheets tabular data to a time-series format
 * compatible with persistSeriesToMongo (the air_data collection).
 *
 * Returns { series: [{ t: epochMs, y: concentration }], meta }
 */
async function readGoogleSheetAsSeries(province, pollutant) {
  const raw = await getRawTabularTable(province, pollutant);
  const concKey = raw.concKey;
  const series = [];
  for (const r of raw.rows) {
    if (!r._epochMs || r._epochMs <= 0) continue;
    const y = coerceNumber(r[concKey]);
    if (y == null || !isFinite(y) || y <= 0) continue;
    series.push({ t: r._epochMs, y });
  }
  series.sort((a, b) => a.t - b.t);
  const sheetKey = `${province}_${pollutant}`;
  return {
    series,
    meta: {
      sheet: sheetKey,
      yKey: concKey,
      yLabel: concKey || "Concentration",
      points: series.length,
    },
  };
}

module.exports = {
  fetchAllSheetsAsTable,
  enhanceTabularRows,
  prepareRawRows,
  enrichWithAqi,
  getRawTabularTable,
  getTabularTable,
  readGoogleSheetAsSeries,
};
