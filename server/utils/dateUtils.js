/**
 * Date parsing, formatting, and Excel serial-number conversion utilities.
 */
const XLSX = require("../xlsxCompat");

// ── Excel serial → JS Date ──
function excelSerialToDate(serial) {
  return new Date(Math.round((serial - 25569) * 86400000));
}

function parseDateValue(v) {
  try {
    if (v == null) return null;
    if (typeof v === "number" && isFinite(v) && v > 30000 && v < 100000) {
      return excelSerialToDate(v);
    }
    const s = String(v).trim();
    if (!s) return null;

    // DD/MM/YYYY with optional 24h time (H:MM or HH:MM:SS)
    // Handles: "3/2/2026", "03/02/2026", "03/02/2026 1:00", "03/02/2026 01:00:30"
    // Philippine sheets use DD/MM/YYYY format throughout
    const m = s.match(
      /^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?$/,
    );
    if (m) {
      const d = new Date(
        Number(m[3]),
        Number(m[2]) - 1,
        Number(m[1]),
        Number(m[4] || 0),
        Number(m[5] || 0),
        Number(m[6] || 0),
      );
      return isNaN(d.getTime()) ? null : d;
    }

    // DD/MM/YYYY H:MM AM/PM or DD/MM/YYYY H:MM:SS AM/PM (12-hour format)
    const m2 = s.match(
      /^(\d{1,2})\/(\d{1,2})\/(\d{4})\s+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(AM|PM)$/i,
    );
    if (m2) {
      let h = Number(m2[4]);
      const ampm = m2[7].toUpperCase();
      if (ampm === "PM" && h < 12) h += 12;
      if (ampm === "AM" && h === 12) h = 0;
      const d = new Date(
        Number(m2[3]),
        Number(m2[2]) - 1,
        Number(m2[1]),
        h,
        Number(m2[5]),
        Number(m2[6] || 0),
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
  const mon = MONTH_ABBR[d.getMonth()];
  const dd = String(d.getDate()).padStart(2, "0");
  const yyyy = d.getFullYear();
  let h = d.getHours();
  const min = String(d.getMinutes()).padStart(2, "0");
  const ampm = h >= 12 ? "PM" : "AM";
  h = h % 12 || 12;
  return `${mon} ${dd}, ${yyyy} ${h}:${min} ${ampm}`;
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
  parseDateValue,
  formatDateAmPm,
  parseExcelDate,
  coerceDate,
};
