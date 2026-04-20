/**
 * Station metadata & weather routes.
 */
const { Router } = require("express");
const {
  OWM_API_KEY,
  STATION_LAT,
  STATION_LON,
  STATION_NAME,
  STATION_ADDRESS,
  MONGO_URI,
} = require("../config/env");
const { fetchWithRetry } = require("../utils/fetchUtils");
const { getStationCollection } = require("../services/mongo");

const router = Router();

// ── Server-side in-memory cache for weather data ──
const _weatherCache = new Map();
const WEATHER_CACHE_TTL = 120_000; // 2 minutes

function getCached(key) {
  const entry = _weatherCache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.ts > WEATHER_CACHE_TTL) {
    _weatherCache.delete(key);
    return null;
  }
  return entry.data;
}

function setCache(key, data) {
  // LRU: limit to 20 entries
  if (_weatherCache.size >= 20 && !_weatherCache.has(key)) {
    const oldest = _weatherCache.keys().next().value;
    _weatherCache.delete(oldest);
  }
  _weatherCache.set(key, { ts: Date.now(), data });
}

// Station current weather (Open-Meteo + OWM fallback) — cached server-side
router.get("/api/station/current", async (req, res) => {
  try {
    const lat = STATION_LAT;
    const lon = STATION_LON;

    // Check server-side cache first
    const cacheKey = `current:${lat}:${lon}`;
    const cached = getCached(cacheKey);
    if (cached) {
      res.setHeader("Cache-Control", "private, max-age=120, stale-while-revalidate=300");
      res.setHeader("X-Cache", "HIT");
      return res.json(cached);
    }
    if (!lat || !lon) {
      return res
        .status(400)
        .json({ error: "STATION_LAT and STATION_LON must be set in .env" });
    }
    const om = new URL("https://api.open-meteo.com/v1/forecast");
    om.searchParams.set("latitude", lat);
    om.searchParams.set("longitude", lon);
    om.searchParams.set(
      "current",
      "temperature_2m,relative_humidity_2m,pressure_msl",
    );
    om.searchParams.set("timezone", "auto");
    const omResp = await fetchWithRetry(om.toString(), {
      retries: 2,
      timeoutMs: 7000,
    });

    let temperature = null,
      humidity = null,
      pressure = null,
      time = null,
      units = null;
    if (omResp.ok && omResp.data?.current) {
      temperature = omResp.data.current.temperature_2m ?? null;
      humidity = omResp.data.current.relative_humidity_2m ?? null;
      pressure = omResp.data.current.pressure_msl ?? null;
      time = omResp.data.current.time ?? null;
      units = omResp.data.current_units ?? null;
    }

    if ((!temperature || !humidity || !pressure) && OWM_API_KEY) {
      const owmUrl = `https://api.openweathermap.org/data/2.5/weather?lat=${encodeURIComponent(lat)}&lon=${encodeURIComponent(lon)}&units=metric&appid=${encodeURIComponent(OWM_API_KEY)}`;
      const owResp = await fetchWithRetry(owmUrl, {
        retries: 2,
        timeoutMs: 7000,
      });
      if (owResp.ok && owResp.data) {
        const main = owResp.data.main || {};
        temperature =
          temperature ??
          (main.temp != null ? Math.round(main.temp * 10) / 10 : null);
        humidity = humidity ?? main.humidity ?? null;
        pressure = pressure ?? main.pressure ?? null;
        time =
          time ??
          (owResp.data.dt
            ? new Date(owResp.data.dt * 1000).toISOString()
            : null);
        units = units || {
          temperature_2m: "°C",
          relative_humidity_2m: "%",
          pressure_msl: "hPa",
        };
      }
    }

    if (temperature == null && humidity == null && pressure == null) {
      return res
        .status(502)
        .json({ error: omResp.error || `All upstream sources failed` });
    }
    // Cache weather for 2 minutes (weather doesn't change rapidly)
    res.setHeader("Cache-Control", "private, max-age=120, stale-while-revalidate=300");
    res.setHeader("X-Cache", "MISS");
    const body = {
      latitude: Number(lat),
      longitude: Number(lon),
      temperature_2m: temperature,
      relative_humidity_2m: humidity,
      pressure_msl: pressure,
      time,
      units,
      upstream: {
        openMeteoStatus: omResp.status,
        openWeatherUsed:
          !!OWM_API_KEY &&
          (temperature == null || humidity == null || pressure == null
            ? true
            : false),
      },
    };
    setCache(cacheKey, body);
    res.json(body);
  } catch (e) {
    res
      .status(500)
      .json({ error: e.message || "Failed to fetch station weather" });
  }
});

// Station 3-day forecast — cached server-side 5 minutes
router.get("/api/station/forecast", async (req, res) => {
  try {
    const lat = STATION_LAT;
    const lon = STATION_LON;
    let days = Number(req.query.days || 3);
    if (!isFinite(days) || days <= 0) days = 3;
    days = Math.min(Math.max(Math.floor(days), 1), 7);

    const forecastCacheKey = `forecast:${lat}:${lon}:${days}`;
    const cachedForecast = getCached(forecastCacheKey);
    if (cachedForecast) {
      res.setHeader("Cache-Control", "private, max-age=300, stale-while-revalidate=600");
      res.setHeader("X-Cache", "HIT");
      return res.json(cachedForecast);
    }

    if (!lat || !lon) {
      return res
        .status(400)
        .json({ error: "STATION_LAT and STATION_LON must be set in .env" });
    }
    const url = new URL("https://api.open-meteo.com/v1/forecast");
    url.searchParams.set("latitude", lat);
    url.searchParams.set("longitude", lon);
    url.searchParams.set("daily", "temperature_2m_max,temperature_2m_min");
    url.searchParams.set("hourly", "relative_humidity_2m,pressure_msl");
    url.searchParams.set("timezone", "auto");
    url.searchParams.set("forecast_days", String(days));
    const r = await fetch(url.toString());
    if (!r.ok)
      return res.status(502).json({ error: `Weather upstream ${r.status}` });
    const j = await r.json();

    const daily = j?.daily || {};
    const dtime = daily.time || [];
    const tmax = daily.temperature_2m_max || [];
    const tmin = daily.temperature_2m_min || [];

    const hourly = j?.hourly || {};
    const htime = hourly.time || [];
    const rh = hourly.relative_humidity_2m || [];
    const p = hourly.pressure_msl || [];

    const groups = new Map();
    for (let i = 0; i < htime.length; i++) {
      const ts = htime[i];
      const dateKey = typeof ts === "string" ? ts.slice(0, 10) : null;
      if (!dateKey) continue;
      if (!groups.has(dateKey)) groups.set(dateKey, { rh: [], p: [] });
      const g = groups.get(dateKey);
      const rv = rh[i];
      const pv = p[i];
      if (rv != null && isFinite(Number(rv))) g.rh.push(Number(rv));
      if (pv != null && isFinite(Number(pv))) g.p.push(Number(pv));
    }

    const out = [];
    for (let i = 0; i < dtime.length && i < days; i++) {
      const date = dtime[i];
      const g = groups.get(date) || { rh: [], p: [] };
      const humidity_mean = g.rh.length
        ? g.rh.reduce((a, b) => a + b, 0) / g.rh.length
        : null;
      const pressure_mean = g.p.length
        ? g.p.reduce((a, b) => a + b, 0) / g.p.length
        : null;
      out.push({
        date,
        temp_max: tmax[i] ?? null,
        temp_min: tmin[i] ?? null,
        humidity_mean: humidity_mean != null ? Math.round(humidity_mean) : null,
        pressure_mean: pressure_mean != null ? Math.round(pressure_mean) : null,
      });
    }

    // Cache forecast for 5 minutes
    res.setHeader("Cache-Control", "private, max-age=300, stale-while-revalidate=600");
    res.setHeader("X-Cache", "MISS");
    const forecastBody = {
      latitude: Number(lat),
      longitude: Number(lon),
      days,
      forecast: out,
      units: {
        temp: j?.daily_units?.temperature_2m_max || "°C",
        humidity: j?.hourly_units?.relative_humidity_2m || "%",
        pressure: j?.hourly_units?.pressure_msl || "hPa",
      },
    };
    setCache(forecastCacheKey, forecastBody);
    res.json(forecastBody);
  } catch (e) {
    res
      .status(500)
      .json({ error: e.message || "Failed to fetch station forecast" });
  }
});

// Station metadata
router.get("/api/station/meta", async (req, res) => {
  try {
    let record = null;
    if (MONGO_URI) {
      try {
        const col = await getStationCollection();
        record = await col.findOne({ key: "default" });
      } catch (err) {
        console.warn(`[station-meta] mongo fetch failed: ${err.message}`);
      }
    }
    if (record) {
      // Station meta is very stable — cache for 10 minutes
      res.setHeader("Cache-Control", "private, max-age=600, stale-while-revalidate=1800");
      return res.json({
        name: record.name || null,
        address: record.address || null,
        latitude: record.latitude ?? null,
        longitude: record.longitude ?? null,
        updatedAt: record.updatedAt || null,
        source: "mongo",
      });
    }
    const lat = STATION_LAT ? Number(STATION_LAT) : null;
    const lon = STATION_LON ? Number(STATION_LON) : null;
    res.setHeader("Cache-Control", "private, max-age=600, stale-while-revalidate=1800");
    res.json({
      name: STATION_NAME,
      address: STATION_ADDRESS,
      latitude: lat,
      longitude: lon,
      source: "env",
    });
  } catch (e) {
    res.status(500).json({ error: e.message || "Failed to read station meta" });
  }
});

module.exports = router;
