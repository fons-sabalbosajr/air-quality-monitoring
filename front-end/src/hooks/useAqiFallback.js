/**
 * useAqiFallback – provides an alternate AQI value from Open-Meteo
 * when the EMBR3 station data is outdated (> STALE_THRESHOLD_DAYS old).
 *
 * This data is NOT saved to the database — it's purely a real-time
 * display fallback fetched from the Open-Meteo Air Quality API.
 *
 * Returns {
 *   isFallback : boolean  – true when showing fallback data
 *   fallbackAqi: number | null
 *   fallbackCategory: string | null
 *   fallbackTime: string | null  – ISO timestamp
 *   fallbackSource: string       – attribution label
 * }
 */
import { useEffect, useState, useCallback, useRef, useMemo } from "react";

/** How many days before EMBR3 data is considered "outdated" */
const STALE_THRESHOLD_DAYS = 3;

/* AQI colour bands (same scale as the dashboard) */
const AQI_BANDS = [
  { name: "Good", min: 0, max: 50 },
  { name: "Fair", min: 51, max: 100 },
  { name: "Unhealthy for Sensitive Groups", min: 101, max: 150 },
  { name: "Very Unhealthy", min: 151, max: 200 },
  { name: "Acutely Unhealthy", min: 201, max: 300 },
  { name: "Emergency", min: 301, max: 999 },
];

function aqiCategory(val) {
  const n = Number(val);
  if (!isFinite(n) || n < 0) return null;
  const band = AQI_BANDS.find((b) => n >= b.min && n <= b.max);
  return band ? band.name : AQI_BANDS[AQI_BANDS.length - 1].name;
}

export default function useAqiFallback(latitude, longitude, latestTime) {
  const [fallbackAqi, setFallbackAqi] = useState(null);
  const [fallbackCategory, setFallbackCategory] = useState(null);
  const [fallbackTime, setFallbackTime] = useState(null);
  const [loading, setLoading] = useState(false);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  // Determine if EMBR3 data is stale
  const isStale = useMemo(() => {
    if (!latestTime) return true; // no data at all → stale
    const latest = new Date(latestTime);
    if (isNaN(latest.getTime())) return true;
    const now = new Date();
    const diffMs = now - latest;
    const diffDays = diffMs / (1000 * 60 * 60 * 24);
    return diffDays > STALE_THRESHOLD_DAYS;
  }, [latestTime]);

  const fetchFallback = useCallback(async () => {
    if (!isStale || !latitude || !longitude) return;
    setLoading(true);
    try {
      const params = new URLSearchParams({
        latitude: String(latitude),
        longitude: String(longitude),
        current: "us_aqi,pm10,pm2_5",
        timezone: "auto",
      });
      const res = await fetch(
        `https://air-quality-api.open-meteo.com/v1/air-quality?${params}`
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      if (!mountedRef.current) return;
      const current = json.current || {};
      const aqi = current.us_aqi ?? current.european_aqi ?? null;
      setFallbackAqi(aqi != null ? Number(aqi) : null);
      setFallbackCategory(aqi != null ? aqiCategory(aqi) : null);
      setFallbackTime(current.time ? new Date(current.time).toISOString() : new Date().toISOString());
    } catch {
      // silently fail — the EMBR3 value is still shown
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  }, [isStale, latitude, longitude]);

  useEffect(() => {
    fetchFallback();
    // Re-fetch every 10 min if still stale
    const iv = setInterval(fetchFallback, 600_000);
    return () => clearInterval(iv);
  }, [fetchFallback]);

  return {
    isFallback: isStale && fallbackAqi != null,
    isStale,
    fallbackAqi,
    fallbackCategory,
    fallbackTime,
    fallbackLoading: loading,
    fallbackSource: "Open-Meteo Air Quality Index",
  };
}
