export const AQI_COLORS = Object.freeze({
  good: "#3AAE49",
  fair: "#FFDE59",
  usg: "#FF904E",
  vu: "#FF3131",
  au: "#9E70F4",
  emergency: "#730000",
});

export const AQI_BG_COLORS = Object.freeze({
  good: "#e7f6e9",
  fair: "#fff8dc",
  usg: "#fff0e8",
  vu: "#ffe1e1",
  au: "#efe8ff",
  emergency: "#f2dddd",
});

export const AQI_STATUS_COLORS = Object.freeze({
  Good: AQI_COLORS.good,
  Fair: AQI_COLORS.fair,
  "Unhealthy for Sensitive Groups": AQI_COLORS.usg,
  "Very Unhealthy": AQI_COLORS.vu,
  "Acutely Unhealthy": AQI_COLORS.au,
  Emergency: AQI_COLORS.emergency,
});

export function getAqiColor(value, fallback = "#d9d9d9") {
  const n = Number(value);
  if (!isFinite(n) || n < 0) return fallback;
  if (n <= 50) return AQI_COLORS.good;
  if (n <= 100) return AQI_COLORS.fair;
  if (n <= 150) return AQI_COLORS.usg;
  if (n <= 200) return AQI_COLORS.vu;
  if (n <= 300) return AQI_COLORS.au;
  return AQI_COLORS.emergency;
}

export function getAqiStatusColor(status) {
  if (!status) return null;
  const normalized = String(status).toLowerCase();
  if (normalized.includes("good")) return AQI_COLORS.good;
  if (normalized.includes("fair")) return AQI_COLORS.fair;
  if (normalized.includes("sensitive")) return AQI_COLORS.usg;
  if (normalized.includes("very")) return AQI_COLORS.vu;
  if (normalized.includes("acutely")) return AQI_COLORS.au;
  if (normalized.includes("emergency")) return AQI_COLORS.emergency;
  return null;
}

export function hexToRgba(hex, alpha) {
  const cleanHex = String(hex).replace("#", "");
  const fullHex = cleanHex.length === 3
    ? cleanHex.split("").map((char) => char + char).join("")
    : cleanHex;
  const red = parseInt(fullHex.slice(0, 2), 16);
  const green = parseInt(fullHex.slice(2, 4), 16);
  const blue = parseInt(fullHex.slice(4, 6), 16);
  return `rgba(${red},${green},${blue},${alpha})`;
}