/**
 * useStationWeather – fetches real-time weather from Open-Meteo for given coordinates.
 *
 * Returns complete weather data:
 *   temperature, humidity, pressure, windSpeed, windDirection,
 *   weatherCode, apparentTemperature, uvIndex, visibility,
 *   loading, error
 */
import { useEffect, useState, useCallback } from "react";

const WEATHER_REFRESH_MS = 600_000;
const WEATHER_CACHE = new Map();

function getWeatherCacheKey(lat, lon) {
  return `${lat}:${lon}`;
}

function readCachedWeather(lat, lon) {
  const entry = WEATHER_CACHE.get(getWeatherCacheKey(lat, lon));
  if (!entry?.data) return null;

  return {
    ...entry,
    fresh: Date.now() - entry.cachedAt < WEATHER_REFRESH_MS,
  };
}

async function requestWeather(lat, lon, force = false) {
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;

  const cacheKey = getWeatherCacheKey(lat, lon);
  const cached = readCachedWeather(lat, lon);
  if (!force && cached?.data) return cached.data;

  const existing = WEATHER_CACHE.get(cacheKey);
  if (existing?.pending) return existing.pending;

  const pending = (async () => {
    const params = new URLSearchParams({
      latitude: String(lat),
      longitude: String(lon),
      current: [
        "temperature_2m",
        "relative_humidity_2m",
        "apparent_temperature",
        "pressure_msl",
        "wind_speed_10m",
        "wind_direction_10m",
        "weather_code",
        "uv_index",
        "visibility",
        "cloud_cover",
      ].join(","),
      timezone: "auto",
    });
    const res = await fetch(`https://api.open-meteo.com/v1/forecast?${params}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    const json = await res.json();
    const current = json.current || {};
    return {
      temperature: current.temperature_2m ?? null,
      humidity: current.relative_humidity_2m ?? null,
      apparentTemperature: current.apparent_temperature ?? null,
      pressure: current.pressure_msl ?? null,
      windSpeed: current.wind_speed_10m ?? null,
      windDirection: current.wind_direction_10m ?? null,
      weatherCode: current.weather_code ?? null,
      uvIndex: current.uv_index ?? null,
      visibility: current.visibility ?? null,
      cloudCover: current.cloud_cover ?? null,
      time: current.time ?? null,
    };
  })();

  WEATHER_CACHE.set(cacheKey, {
    ...(existing || {}),
    pending,
  });

  try {
    const data = await pending;
    WEATHER_CACHE.set(cacheKey, {
      data,
      cachedAt: Date.now(),
      pending: null,
    });
    return data;
  } catch (error) {
    if (cached?.data) {
      WEATHER_CACHE.set(cacheKey, {
        ...cached,
        pending: null,
      });
    } else {
      WEATHER_CACHE.delete(cacheKey);
    }
    throw error;
  }
}

export function prefetchStationWeather(lat, lon) {
  return requestWeather(lat, lon).catch(() => null);
}

export default function useStationWeather(lat, lon) {
  const initialCache = readCachedWeather(lat, lon);
  const [data, setData] = useState(initialCache?.data || null);
  const [loading, setLoading] = useState(Boolean(Number.isFinite(lat) && Number.isFinite(lon) && !initialCache?.data));
  const [error, setError] = useState(null);

  const fetchWeather = useCallback(async ({ force = false, background = false } = {}) => {
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
      setLoading(false);
      setError(null);
      setData(null);
      return;
    }

    const cached = readCachedWeather(lat, lon);
    if (cached?.data) {
      setData(cached.data);
      setError(null);
    }

    if (!background) {
      setLoading(!cached?.data);
    }

    try {
      const nextData = await requestWeather(lat, lon, force);
      setData(nextData);
      setError(null);
    } catch (e) {
      setError(e.message || "Weather unavailable");
    } finally {
      setLoading(false);
    }
  }, [lat, lon]);

  useEffect(() => {
    const cached = readCachedWeather(lat, lon);
    if (cached?.data) {
      setData(cached.data);
      setLoading(false);
      setError(null);
    } else {
      setData(null);
      setLoading(Boolean(Number.isFinite(lat) && Number.isFinite(lon)));
      setError(null);
    }

    if (!cached?.fresh) {
      fetchWeather({ force: true, background: Boolean(cached?.data) });
    }

    const iv = setInterval(() => {
      fetchWeather({ force: true, background: true });
    }, WEATHER_REFRESH_MS);
    return () => clearInterval(iv);
  }, [fetchWeather]);

  return { data, loading, error, retry: fetchWeather };
}
