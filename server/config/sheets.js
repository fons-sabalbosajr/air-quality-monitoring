/**
 * Google Sheets URL configuration for tabular data sources.
 * Maps province → pollutant → { url, dateFormat? }.
 *
 * dateFormat: 'MDY' forces MM/DD/YYYY parsing
 *             'DMY' forces DD/MM/YYYY parsing (legacy, no longer used)
 *             omit  → auto-detect from data (recommended)
 */
const TABULAR_SHEETS = {
  meycauayan: {
    // 2026 tab uses MM/DD/YYYY; force MDY so legacy DMY year tabs don't confuse auto-detect
    pm10: { url: process.env.SHEET_PM10_MEYCAUAYAN_URL || null, dateFormat: "MDY" },
    pm25: process.env.SHEET_PM25_MEYCAUAYAN_URL || null,
  },
  zambales: {
    // PM10 tab uses DD/MM/YYYY throughout (confirmed May 2026)
    pm10: { url: process.env.SHEET_PM10_ZAMBALES_URL || null, tabName: "PM10", dateFormat: "DMY" },
    pm25: process.env.SHEET_PM25_ZAMBALES_URL || null,
  },
  clark: {
    pm10: {
      url: process.env.SHEET_PM10_CLARK_URL || null,
      // All sheets standardised to MM/DD/YYYY 24HR as of April 2026
      dateFormat: "MDY",
      tabName: "PM10",
    },
  },
  "san-fernando": {
    // 2026 tab uses MM/DD/YYYY; force MDY so legacy DMY year tabs don't confuse auto-detect
    pm10: { url: process.env.SHEET_PM10_SAN_FERNANDO_URL || null, dateFormat: "MDY" },
  },
};

/**
 * Helper: resolve a sheet entry to { url, dateFormat }.
 * Supports both string URLs (legacy) and { url, dateFormat } objects.
 */
function resolveSheetEntry(entry) {
  if (!entry) return { url: null, dateFormat: null, tabName: null };
  if (typeof entry === "string") return { url: entry, dateFormat: null, tabName: null };
  return { url: entry.url || null, dateFormat: entry.dateFormat || null, tabName: entry.tabName || null };
}

module.exports = { TABULAR_SHEETS, resolveSheetEntry };
