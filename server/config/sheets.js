/**
 * Google Sheets URL configuration for tabular data sources.
 * Maps province → pollutant → sheet URL.
 */
const TABULAR_SHEETS = {
  meycauayan: {
    pm10: process.env.SHEET_PM10_MEYCAUAYAN_URL || null,
  },
  zambales: {
    pm10: process.env.SHEET_PM10_ZAMBALES_URL || null,
    pm25: process.env.SHEET_PM25_ZAMBALES_URL || null,
  },
  clark: {
    pm10: process.env.SHEET_PM10_CLARK_URL || null,
  },
  "san-fernando": {
    pm10: process.env.SHEET_PM10_SAN_FERNANDO_URL || null,
  },
};

module.exports = { TABULAR_SHEETS };
