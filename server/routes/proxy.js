/**
 * Proxy routes — OWM tile proxy and reverse geocoding.
 */
const { Router } = require("express");
const { OWM_API_KEY } = require("../config/env");

const router = Router();

// Proxy OpenWeatherMap tile layers
router.get("/api/tiles/owm/:layer/:z/:x/:y.png", async (req, res) => {
  try {
    if (!OWM_API_KEY) {
      return res
        .status(501)
        .json({ error: "OWM_API_KEY is not configured on the server" });
    }
    const { layer, z, x, y } = req.params;
    const allowed = new Set([
      "clouds_new",
      "precipitation_new",
      "rain_new",
      "wind_new",
      "temp_new",
      "pressure_new",
    ]);
    if (!allowed.has(layer)) {
      return res.status(400).json({ error: "Unsupported layer" });
    }
    const url = `https://tile.openweathermap.org/map/${encodeURIComponent(
      layer,
    )}/${encodeURIComponent(z)}/${encodeURIComponent(x)}/${encodeURIComponent(
      y,
    )}.png?appid=${encodeURIComponent(OWM_API_KEY)}`;
    const upstream = await fetch(url);
    if (!upstream.ok) {
      console.warn(`[owm-tiles] upstream ${upstream.status} ${layer}/${z}/${x}/${y}`);
      return res.status(upstream.status).end();
    }
    const buf = Buffer.from(await upstream.arrayBuffer());
    res.setHeader("Content-Type", "image/png");
    res.setHeader("Cache-Control", "public, max-age=300, s-maxage=300");
    return res.status(200).send(buf);
  } catch (e) {
    console.error(`[owm-tiles] error: ${e && e.message}`);
    return res.status(502).json({ error: "Tile proxy failed" });
  }
});

// Reverse geocoding proxy
router.get("/api/reverse-geocode", async (req, res) => {
  try {
    const { lat, lon } = req.query;
    if (!lat || !lon)
      return res.status(400).json({ error: "lat and lon are required" });

    const omUrl = `https://geocoding-api.open-meteo.com/v1/reverse?latitude=${encodeURIComponent(
      lat,
    )}&longitude=${encodeURIComponent(lon)}&language=en&format=json`;
    let name = null,
      region = null;
    try {
      const r = await fetch(omUrl);
      if (r.ok) {
        const j = await r.json();
        const rec = j?.results?.[0] || {};
        name =
          rec.name ||
          rec.city ||
          rec.locality ||
          rec.town ||
          rec.village ||
          null;
        region = rec.admin2 || rec.admin1 || rec.country || null;
      }
    } catch {}

    if (!name) {
      try {
        const bdcUrl = `https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=${encodeURIComponent(
          lat,
        )}&longitude=${encodeURIComponent(lon)}&localityLanguage=en`;
        const r2 = await fetch(bdcUrl);
        if (r2.ok) {
          const b = await r2.json();
          name = b.locality || b.city || null;
          region = b.principalSubdivision || b.countryName || region || null;
        }
      } catch {}
    }

    if (!name && !region)
      return res.status(404).json({ error: "No location found" });
    const display = name
      ? region && region !== name
        ? `${name}, ${region}`
        : name
      : region || "";
    res.json({ name, region, display });
  } catch (e) {
    res.status(500).json({ error: e.message || "Reverse geocoding failed" });
  }
});

module.exports = router;
