/**
 * useStationWeather – fetches real-time weather from Open-Meteo for given coordinates.
 *
 * Returns complete weather data:
 *   temperature, humidity, pressure, windSpeed, windDirection,
 *   weatherCode, apparentTemperature, uvIndex, visibility,
 *   loading, error
 */
import { useEffect, useState, useCallback } from "react";

export default function useStationWeather(lat, lon) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const fetchWeather = useCallback(async () => {
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
      setLoading(false);
      setError(null);
      setData(null);
      return;
    }
    setLoading(true);
    setError(null);
    try {
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
          "visibility",    // non-standard – may be missing; handled gracefully
          "cloud_cover",
        ].join(","),
        timezone: "auto",
      });
      const res = await fetch(
        `https://api.open-meteo.com/v1/forecast?${params}`
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();

      const c = json.current || {};
      setData({
        temperature: c.temperature_2m ?? null,
        humidity: c.relative_humidity_2m ?? null,
        apparentTemperature: c.apparent_temperature ?? null,
        pressure: c.pressure_msl ?? null,
        windSpeed: c.wind_speed_10m ?? null,
        windDirection: c.wind_direction_10m ?? null,
        weatherCode: c.weather_code ?? null,
        uvIndex: c.uv_index ?? null,
        visibility: c.visibility ?? null,
        cloudCover: c.cloud_cover ?? null,
        time: c.time ?? null,
      });
    } catch (e) {
      setError(e.message || "Weather unavailable");
    } finally {
      setLoading(false);
    }
  }, [lat, lon]);

  useEffect(() => {
    fetchWeather();
    // Refresh weather every 10 minutes
    const iv = setInterval(fetchWeather, 600_000);
    return () => clearInterval(iv);
  }, [fetchWeather]);

  return { data, loading, error, retry: fetchWeather };
}
