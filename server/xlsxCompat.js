/**
 * Drop-in compatibility wrapper that replaces the vulnerable `xlsx` (SheetJS)
 * package with `exceljs`.
 *
 * It exposes the same surface that server.js relies on:
 *   - read(buffer, options)       → async (was sync in xlsx)
 *   - readFile(filePath, options)  → async (was sync in xlsx)
 *   - utils.sheet_to_json(ws, options) → sync
 *   - SSF.parse_date_code(serial)      → sync
 *
 * All XLSX.read / XLSX.readFile call-sites in server.js are inside async
 * functions, so the only required change there is adding `await`.
 */

const ExcelJS = require("exceljs");

/* ------------------------------------------------------------------ */
/*  Internal helpers                                                   */
/* ------------------------------------------------------------------ */

/**
 * Extract a usable JS value from an ExcelJS cell.
 *
 * @param {import('exceljs').Cell} cell
 * @param {boolean} raw   – true  → keep native types (number, Date, boolean …)
 *                          false → coerce everything to string
 * @param {boolean} cellDates – when true, Date values stay as Date objects;
 *                              when false, convert Dates back to Excel serial.
 * @param {boolean} [trackFormula] – when true, returns { value, isFormula }
 */
function getCellValue(cell, raw, cellDates, trackFormula) {
  if (!cell || cell.type === ExcelJS.ValueType.Null) {
    return trackFormula ? { value: null, isFormula: false } : null;
  }

  let val = cell.value;
  let isFormula = false;

  // Formula → use computed result
  if (
    cell.type === ExcelJS.ValueType.Formula &&
    val &&
    typeof val === "object"
  ) {
    isFormula = true;
    val = val.result !== undefined ? val.result : null;
  }

  // Rich-text → concatenate runs
  if (val && typeof val === "object" && Array.isArray(val.richText)) {
    val = val.richText.map((rt) => rt.text).join("");
  }

  // Hyperlink → use visible text
  if (val && typeof val === "object" && val.hyperlink) {
    val = val.text || val.hyperlink;
  }

  // SharedString → already a plain string in exceljs, no special handling.

  // Error values → null
  if (val && typeof val === "object" && val.error) {
    return trackFormula ? { value: null, isFormula } : null;
  }

  /* ---- type coercions ---- */

  if (!raw && val != null) {
    // raw:false  →  return everything as a string
    if (val instanceof Date) {
      // Mimic xlsx: format as locale-ish string (DD/MM/YYYY HH:MM)
      const pad = (n) => String(n).padStart(2, "0");
      const strVal = `${pad(val.getUTCDate())}/${pad(val.getUTCMonth() + 1)}/${val.getUTCFullYear()} ${pad(val.getUTCHours())}:${pad(val.getUTCMinutes())}`;
      return trackFormula ? { value: strVal, isFormula } : strVal;
    }
    const sv = String(val);
    return trackFormula ? { value: sv, isFormula } : sv;
  }

  if (!cellDates && val instanceof Date) {
    // Convert Date back to Excel serial number (1900 system with Lotus bug)
    const epoch = new Date(Date.UTC(1899, 11, 30)); // Dec 30 1899
    let serial = (val.getTime() - epoch.getTime()) / 86400000;
    if (serial > 59) serial += 1; // phantom Feb 29 1900
    return trackFormula ? { value: serial, isFormula } : serial;
  }

  return trackFormula ? { value: val, isFormula } : val;
}

/* ------------------------------------------------------------------ */
/*  Workbook conversion                                                */
/* ------------------------------------------------------------------ */

function wrapWorkbook(ejsWb, options) {
  const SheetNames = ejsWb.worksheets.map((ws) => ws.name);
  const Sheets = {};
  for (const ws of ejsWb.worksheets) {
    Sheets[ws.name] = { _ejsSheet: ws, _wbOpts: options };
  }
  return { SheetNames, Sheets };
}

/* ------------------------------------------------------------------ */
/*  Public API                                                         */
/* ------------------------------------------------------------------ */

/**
 * Read a workbook from a Buffer (async).
 * Options recognised: cellDates (boolean), type is always "buffer".
 */
async function read(buffer, options = {}) {
  const wb = new ExcelJS.Workbook();
  const buf = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer);
  await wb.xlsx.load(buf);
  return wrapWorkbook(wb, options);
}

/**
 * Read a workbook from a file path (async).
 */
async function readFile(filePath, options = {}) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(filePath);
  return wrapWorkbook(wb, options);
}

/**
 * Convert a worksheet to JSON.
 *
 * @param {object} wsWrapper  – the wrapper stored in Sheets[name]
 * @param {object} opts
 *   header: 1  → return array-of-arrays (matrix)
 *   raw: true  → keep native values (default)
 *   raw: false → coerce all values to strings
 *   defval     → value for missing / empty cells (default undefined)
 */
function sheet_to_json(wsWrapper, opts = {}) {
  const ws = wsWrapper._ejsSheet;
  const wbOpts = wsWrapper._wbOpts || {};
  const cellDates = wbOpts.cellDates ?? false;
  const headerMode = opts.header; // 1 = matrix
  const raw = opts.raw !== undefined ? opts.raw : true;
  const defval = opts.defval !== undefined ? opts.defval : undefined;

  // --- build a dense matrix from the sheet ---------------------------
  const matrix = [];
  const formulaMatrix = []; // Track which cells are formulas
  let maxCol = 0;

  ws.eachRow({ includeEmpty: true }, (row, rowNumber) => {
    const rowData = [];
    const formulaFlags = [];
    row.eachCell({ includeEmpty: true }, (cell, colNumber) => {
      if (colNumber > maxCol) maxCol = colNumber;
      const tracked = getCellValue(cell, raw, cellDates, true);
      rowData[colNumber - 1] =
        tracked.value != null ? tracked.value : defval !== undefined ? defval : null;
      formulaFlags[colNumber - 1] = tracked.isFormula;
    });
    // Pad sparse positions
    for (let i = 0; i < rowData.length; i++) {
      if (rowData[i] === undefined) {
        rowData[i] = defval !== undefined ? defval : null;
      }
      if (formulaFlags[i] === undefined) {
        formulaFlags[i] = false;
      }
    }
    matrix[rowNumber - 1] = rowData;
    formulaMatrix[rowNumber - 1] = formulaFlags;
  });

  // Fill completely-empty rows that eachRow may have skipped
  for (let i = 0; i < matrix.length; i++) {
    if (!matrix[i]) {
      matrix[i] = new Array(maxCol).fill(defval !== undefined ? defval : null);
      formulaMatrix[i] = new Array(maxCol).fill(false);
    }
  }

  // ---- header:1 → array of arrays -----------------------------------
  if (headerMode === 1) {
    // Attach formula tracking data so callers can detect formula-generated
    // cells even when using matrix mode.  Non-enumerable to avoid breaking
    // JSON serialisation or spread operators on the result.
    Object.defineProperty(matrix, '__formulaMatrix', {
      value: formulaMatrix,
      enumerable: false,
    });
    return matrix;
  }

  // ---- default → array of objects keyed by first-row headers ---------
  if (matrix.length === 0) return [];

  const headerRow = matrix[0];
  const headers = [];
  let emptyIdx = 0;
  for (let i = 0; i < headerRow.length; i++) {
    const h = headerRow[i];
    if (h != null && String(h).trim() !== "") {
      headers[i] = String(h);
    } else {
      // xlsx convention: __EMPTY, __EMPTY_1, __EMPTY_2, …
      headers[i] = emptyIdx === 0 ? "__EMPTY" : `__EMPTY_${emptyIdx}`;
      emptyIdx++;
    }
  }

  // Handle duplicate header names (xlsx appends _1, _2, …)
  const seen = {};
  for (let i = 0; i < headers.length; i++) {
    const orig = headers[i];
    if (seen[orig] !== undefined) {
      seen[orig]++;
      headers[i] = `${orig}_${seen[orig]}`;
    } else {
      seen[orig] = 0;
    }
  }

  const result = [];
  for (let r = 1; r < matrix.length; r++) {
    const row = matrix[r];
    const fRow = formulaMatrix[r] || [];
    const obj = {};
    const formulaCols = [];
    for (let c = 0; c < headers.length; c++) {
      const v =
        row && row[c] !== undefined
          ? row[c]
          : defval !== undefined
            ? defval
            : undefined;
      if (v !== undefined) obj[headers[c]] = v;
      if (fRow[c]) formulaCols.push(headers[c]);
    }
    // Attach formula metadata (non-enumerable to avoid polluting JSON unless inspected)
    Object.defineProperty(obj, '__formulaCols', { value: formulaCols, enumerable: false, writable: true });
    result.push(obj);
  }
  return result;
}

/* ------------------------------------------------------------------ */
/*  SSF.parse_date_code – convert Excel serial → date components       */
/* ------------------------------------------------------------------ */

function parse_date_code(serial) {
  if (serial == null || !isFinite(serial)) return null;

  let s = serial;
  // Lotus 1-2-3 leap-year bug: serial 60 = phantom Feb 29, 1900
  if (s > 60) s -= 1;

  // Excel epoch: serial 1 → Jan 1 1900. Use Dec 31 1899 as base.
  const base = new Date(Date.UTC(1899, 11, 31));
  const wholeDays = Math.floor(s);
  const fracDay = s - wholeDays;

  const d = new Date(base.getTime() + wholeDays * 86400000);

  const totalSeconds = Math.round(fracDay * 86400);
  const H = Math.floor(totalSeconds / 3600);
  const M = Math.floor((totalSeconds % 3600) / 60);
  const S = totalSeconds % 60;

  return {
    y: d.getUTCFullYear(),
    m: d.getUTCMonth() + 1,
    d: d.getUTCDate(),
    H,
    M,
    S,
  };
}

/* ------------------------------------------------------------------ */
/*  Exports (mirrors the subset of the xlsx API used by server.js)     */
/* ------------------------------------------------------------------ */

module.exports = {
  read,
  readFile,
  utils: { sheet_to_json },
  SSF: { parse_date_code },
};
