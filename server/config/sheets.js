/**
 * Google Sheets URL configuration for tabular data sources.
 * Maps province → pollutant → { url, dateFormat? }.
 *
 * dateFormat: 'DMY' forces DD/MM/YYYY parsing (e.g. Clark AQMS)
 *             'MDY' forces MM/DD/YYYY parsing
 *             omit  → auto-detect from data
 */
const TABULAR_SHEETS = {
  meycauayan: {
    pm10: process.env.SHEET_PM10_MEYCAUAYAN_URL || null,
    pm25: process.env.SHEET_PM25_MEYCAUAYAN_URL || null,
  },
  zambales: {
    pm10: { url: process.env.SHEET_PM10_ZAMBALES_URL || null, tabName: "PM10" },
    pm25: process.env.SHEET_PM25_ZAMBALES_URL || null,
  },
  clark: {
    pm10: {
      url: process.env.SHEET_PM10_CLARK_URL || null,
      dateFormat: "DMY",  // Clark uses DD/MM/YYYY in Google Sheets
      tabName: "PM10",
    },
  },
  "san-fernando": {
    pm10: process.env.SHEET_PM10_SAN_FERNANDO_URL || null,
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
