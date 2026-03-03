/**
 * AQI breakpoint calculations for PM10 and PM2.5
 * using Philippine DENR DAO 2000-81 breakpoints.
 */

function phPm10Status24hFromAvg(C) {
  const bp = [
    { clo: 0, chi: 54, ilo: 0, ihi: 50, status: "Good" },
    { clo: 55, chi: 154, ilo: 51, ihi: 100, status: "Fair" },
    {
      clo: 155,
      chi: 254,
      ilo: 101,
      ihi: 150,
      status: "Unhealthy for Sensitive Groups",
    },
    { clo: 255, chi: 354, ilo: 151, ihi: 200, status: "Very Unhealthy" },
    { clo: 355, chi: 424, ilo: 201, ihi: 300, status: "Acutely Unhealthy" },
    { clo: 425, chi: 9999, ilo: 301, ihi: 500, status: "Emergency" },
  ];
  if (!isFinite(Number(C)) || Number(C) < 0) return { aqi: null, status: "" };
  const c = Number(C);
  for (const b of bp) {
    if (c <= b.chi) {
      const aqi = ((b.ihi - b.ilo) / (b.chi - b.clo)) * (c - b.clo) + b.ilo;
      return { aqi: Math.round(aqi), status: b.status };
    }
  }
  return { aqi: 500, status: "Emergency" };
}

function phPm25Status24hFromAvg(C) {
  const bp = [
    { clo: 0, chi: 25, ilo: 0, ihi: 50, status: "Good" },
    { clo: 25.1, chi: 35, ilo: 51, ihi: 100, status: "Fair" },
    {
      clo: 35.1,
      chi: 45,
      ilo: 101,
      ihi: 150,
      status: "Unhealthy for Sensitive Groups",
    },
    { clo: 45.1, chi: 55, ilo: 151, ihi: 200, status: "Very Unhealthy" },
    { clo: 55.1, chi: 90, ilo: 201, ihi: 300, status: "Acutely Unhealthy" },
    { clo: 90.1, chi: 9999, ilo: 301, ihi: 500, status: "Emergency" },
  ];
  if (!isFinite(Number(C)) || Number(C) < 0) return { aqi: null, status: "" };
  const c = Number(C);
  for (const b of bp) {
    if (c <= b.chi) {
      const aqi = ((b.ihi - b.ilo) / (b.chi - b.clo)) * (c - b.clo) + b.ilo;
      return { aqi: Math.round(aqi), status: b.status };
    }
  }
  return { aqi: 500, status: "Emergency" };
}

function inferAqiCategory(v) {
  const val = Number(v);
  if (!isFinite(val)) return null;
  if (val <= 50) return "GOOD";
  if (val <= 100) return "MODERATE";
  if (val <= 150) return "UNHEALTHY FOR SENSITIVE GROUPS";
  if (val <= 200) return "UNHEALTHY";
  if (val <= 300) return "VERY UNHEALTHY";
  if (val <= 500) return "HAZARDOUS";
  return "EMERGENCY";
}

module.exports = {
  phPm10Status24hFromAvg,
  phPm25Status24hFromAvg,
  inferAqiCategory,
};
