/**
 * Date parsing, formatting, and Excel serial-number conversion utilities.
 */
const XLSX = require("../xlsxCompat");

// ── Excel serial → JS Date ──
function excelSerialToDate(serial) {
  return new Date(Math.round((serial - 25569) * 86400000));
}

/**
 * Auto-detect date format by scanning an array of raw date strings.
 * Returns 'DMY' if the dataset uses DD/MM/YYYY, 'MDY' otherwise.
 *
 * Logic: if ANY date has first part > 12, the whole set is DD/MM/YYYY
 * (because month can never be > 12). Conversely, if second part > 12 first,
 * the set is MM/DD/YYYY.
 */
function detectDateFormat(dateValues) {
  if (!Array.isArray(dateValues)) return "MDY";
  for (const v of dateValues) {
    if (v == null) continue;
    const s = String(v).trim();
    const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
    if (!m) continue;
    const a = Number(m[1]);
    const b = Number(m[2]);
    if (a > 12 && b <= 12) return "DMY";
    if (b > 12 && a <= 12) return "MDY";
  }
  return "MDY"; // default when all values are ambiguous (both ≤ 12)
}

/**
 * Parse a date value from various formats.
 * @param {*}      v      – raw value (string, number, null)
 * @param {string} [fmt]  – 'MDY' (default, MM/DD/YYYY) or 'DMY' (DD/MM/YYYY)
 */
function parseDateValue(v, fmt) {
  try {
    if (v == null) return null;
    if (typeof v === "number" && isFinite(v) && v > 30000 && v < 100000) {
      return excelSerialToDate(v);
    }
    const s = String(v).trim();
    if (!s) return null;

    const isDMY = fmt === "DMY";

    function buildStrictDate(year, monthIndex, day, hour = 0, minute = 0, second = 0) {
      const d = new Date(year, monthIndex, day, hour, minute, second);
      if (isNaN(d.getTime())) return null;
      if (
        d.getFullYear() !== year ||
        d.getMonth() !== monthIndex ||
        d.getDate() !== day ||
        d.getHours() !== hour ||
        d.getMinutes() !== minute ||
        d.getSeconds() !== second
      ) {
        return null;
      }
      return d;
    }

    function parseSlashParts(a, b, year, hour = 0, minute = 0, second = 0, forceDMY = isDMY) {
      const month = forceDMY ? Number(b) - 1 : Number(a) - 1;
      const day = forceDMY ? Number(a) : Number(b);
      return buildStrictDate(Number(year), month, day, hour, minute, second);
    }

    // A/B/YYYY with optional 24h time (H:MM or HH:MM:SS)
    // Handles: "3/2/2026", "03/02/2026", "13/09/2025 1:00"
    // When fmt='DMY': A=day, B=month.  Otherwise: A=month, B=day.
    const m = s.match(
      /^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?$/,
    );
    if (m) {
      const hour = Number(m[4] || 0);
      const minute = Number(m[5] || 0);
      const second = Number(m[6] || 0);
      return (
        parseSlashParts(m[1], m[2], m[3], hour, minute, second) ||
        parseSlashParts(m[1], m[2], m[3], hour, minute, second, !isDMY)
      );
    }

    // A/B/YYYY H:MM AM/PM or A/B/YYYY H:MM:SS AM/PM (12-hour format)
    // formatDateAmPm outputs MM/DD/YYYY 12h format; raw CSV may be either.
    const m2 = s.match(
      /^(\d{1,2})\/(\d{1,2})\/(\d{4})\s+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(AM|PM)$/i,
    );
    if (m2) {
      let h = Number(m2[4]);
      const ampm = m2[7].toUpperCase();
      if (ampm === "PM" && h < 12) h += 12;
      if (ampm === "AM" && h === 12) h = 0;
      return (
        parseSlashParts(m2[1], m2[2], m2[3], h, Number(m2[5]), Number(m2[6] || 0)) ||
        parseSlashParts(m2[1], m2[2], m2[3], h, Number(m2[5]), Number(m2[6] || 0), !isDMY)
      );
    }

    // Google Sheets gviz/tq CSV may return dates as Date(y,m,d,H,M,S)
    // where month is 0-based (0=Jan).
    const mGviz = s.match(/^Date\((\d{4}),(\d{1,2}),(\d{1,2})(?:,(\d{1,2}))?(?:,(\d{1,2}))?(?:,(\d{1,2}))?\)$/i);
    if (mGviz) {
      const d = new Date(
        Number(mGviz[1]),
        Number(mGviz[2]),       // already 0-based from gviz
        Number(mGviz[3]),
        Number(mGviz[4] || 0),
        Number(mGviz[5] || 0),
        Number(mGviz[6] || 0),
      );
      return isNaN(d.getTime()) ? null : d;
    }

    const d = new Date(s);
    return isNaN(d.getTime()) ? null : d;
  } catch {
    return null;
  }
}

const MONTH_ABBR = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

function formatDateAmPm(d) {
  if (!d || isNaN(d.getTime())) return "";
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  const yyyy = d.getFullYear();
  let h = d.getHours();
  const min = String(d.getMinutes()).padStart(2, "0");
  const ampm = h >= 12 ? "PM" : "AM";
  h = h % 12 || 12;
  return `${mm}/${dd}/${yyyy} ${h}:${min} ${ampm}`;
}

function parseExcelDate(n) {
  try {
    const d = XLSX.SSF.parse_date_code(n);
    if (!d) return null;
    const js = new Date(
      Date.UTC(
        d.y,
        (d.m || 1) - 1,
        d.d || 1,
        d.H || 0,
        d.M || 0,
        Math.floor(d.S || 0),
      ),
    );
    return js;
  } catch {
    return null;
  }
}

function coerceDate(val) {
  if (val == null) return null;
  if (val instanceof Date) return val;
  if (typeof val === "number") {
    const d = parseExcelDate(val);
    if (d) return d;
    const d2 = new Date(val);
    if (!isNaN(d2)) return d2;
  }
  const d3 = new Date(String(val));
  if (!isNaN(d3)) return d3;
  return null;
}

module.exports = {
  excelSerialToDate,
  detectDateFormat,
  parseDateValue,
  formatDateAmPm,
  parseExcelDate,
  coerceDate,
};
