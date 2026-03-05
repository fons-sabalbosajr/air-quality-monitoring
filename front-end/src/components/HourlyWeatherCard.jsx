import { useEffect, useState, useCallback } from "react";
import { Skeleton } from "antd";
import {
  TbDroplet,
  TbWind,
  TbCloudRain,
  TbTemperature,
  TbClock,
} from "react-icons/tb";
import {
  WiDaySunny,
  WiNightClear,
  WiDayCloudy,
  WiNightAltCloudy,
  WiCloudy,
  WiFog,
  WiRain,
  WiSnow,
  WiThunderstorm,
  WiRaindrops,
  WiShowers,
} from "react-icons/wi";
import "./HourlyWeatherCard.css";

/* ── Weather code → icon / label (day/night aware) ── */
function weatherMeta(code, hour) {
  const isNight = hour < 6 || hour >= 18;
  if (code == null) return { icon: <WiCloudy size={32} />, label: "Unknown" };
  if (code === 0)
    return isNight
      ? { icon: <WiNightClear size={36} />, label: "Clear" }
      : { icon: <WiDaySunny size={36} />, label: "Sunny" };
  if (code <= 3)
    return isNight
      ? { icon: <WiNightAltCloudy size={36} />, label: "Partly Cloudy" }
      : { icon: <WiDayCloudy size={36} />, label: "Partly Cloudy" };
  if (code <= 48) return { icon: <WiFog size={36} />, label: "Foggy" };
  if (code <= 57) return { icon: <WiRaindrops size={36} />, label: "Drizzle" };
  if (code <= 67) return { icon: <WiRain size={36} />, label: "Rain" };
  if (code <= 77) return { icon: <WiSnow size={36} />, label: "Snow" };
  if (code <= 82) return { icon: <WiShowers size={36} />, label: "Showers" };
  if (code <= 86) return { icon: <WiSnow size={36} />, label: "Snow Showers" };
  if (code <= 99)
    return { icon: <WiThunderstorm size={36} />, label: "Thunderstorm" };
  return { icon: <WiCloudy size={32} />, label: "Unknown" };
}

/* ── Temp gradient color ── */
function tempColor(temp) {
  if (temp == null) return "#94a3b8";
  if (temp >= 35) return "#ef4444";
  if (temp >= 30) return "#f97316";
  if (temp >= 25) return "#eab308";
  if (temp >= 20) return "#22c55e";
  if (temp >= 15) return "#06b6d4";
  return "#3b82f6";
}

export default function HourlyWeatherCard({ latitude, longitude }) {
  const [hours, setHours] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const fetchHourly = useCallback(async () => {
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({
        latitude: String(latitude),
        longitude: String(longitude),
        hourly: [
          "temperature_2m",
          "relative_humidity_2m",
          "weather_code",
          "wind_speed_10m",
          "precipitation_probability",
        ].join(","),
        timezone: "auto",
        forecast_days: "2",
      });
      const res = await fetch(
        `https://api.open-meteo.com/v1/forecast?${params}`,
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();

      const h = json.hourly || {};
      const times = h.time || [];
      const now = new Date();
      let startIdx = times.findIndex((t) => new Date(t) >= now);
      if (startIdx < 0) startIdx = 0;

      const result = [];
      for (let i = startIdx; i < Math.min(startIdx + 24, times.length); i++) {
        result.push({
          time: times[i],
          temp: h.temperature_2m?.[i],
          humidity: h.relative_humidity_2m?.[i],
          weatherCode: h.weather_code?.[i],
          wind: h.wind_speed_10m?.[i],
          precipProb: h.precipitation_probability?.[i],
        });
      }
      setHours(result);
    } catch (e) {
      setError(e.message || "Failed to fetch hourly forecast");
    } finally {
      setLoading(false);
    }
  }, [latitude, longitude]);

  useEffect(() => {
    fetchHourly();
    const iv = setInterval(fetchHourly, 600_000);
    return () => clearInterval(iv);
  }, [fetchHourly]);

  const formatHour = (iso) => {
    const d = new Date(iso);
    const h = d.getHours();
    if (h === 0) return "12 AM";
    if (h === 12) return "12 PM";
    return h > 12 ? `${h - 12} PM` : `${h} AM`;
  };

  /* ── Day label for separators ── */
  const formatDayLabel = (iso) => {
    const d = new Date(iso);
    const today = new Date();
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);
    if (d.toDateString() === today.toDateString()) return "Today";
    if (d.toDateString() === tomorrow.toDateString()) return "Tomorrow";
    return d.toLocaleDateString("en-US", {
      weekday: "short",
      month: "short",
      day: "numeric",
    });
  };

  const isDifferentDay = (a, b) => {
    if (!a || !b) return false;
    const da = new Date(a).toDateString();
    const db = new Date(b).toDateString();
    return da !== db;
  };

  /* ── Summary for "Now" header ── */
  const nowData = hours[0];
  const nowMeta = nowData
    ? weatherMeta(nowData.weatherCode, new Date(nowData.time).getHours())
    : null;

  return (
    <div>
      {/* ── Header row ── */}
      <div className="hourly-weather-header">
        <div className="hourly-weather-header-left">
          <div className="hourly-weather-header-icon">
            <TbCloudRain size={20} />
          </div>
          <div>
            <h3 className="hourly-weather-title">Hourly Forecast</h3>
            <p className="hourly-weather-subtitle">24-hour weather outlook</p>
          </div>
        </div>
        {nowData && !loading && (
          <div className="hourly-weather-now-badge">
            <span className="hourly-now-icon">{nowMeta?.icon}</span>
            <span className="hourly-now-temp">
              {nowData.temp != null ? `${Math.round(nowData.temp)}°C` : "—"}
            </span>
            <span className="hourly-now-label">{nowMeta?.label}</span>
          </div>
        )}
      </div>

      {/* ── Timeline ── */}
      {loading ? (
        <div className="hourly-weather-skeleton">
          <Skeleton active paragraph={{ rows: 2 }} title={false} />
        </div>
      ) : error ? (
        <div className="pollutants-error">{error}</div>
      ) : (
        <div className="hourly-weather-scroll">
          <div className="hourly-weather-track">
            {hours.map((h, i) => {
              const hr = new Date(h.time).getHours();
              const meta = weatherMeta(h.weatherCode, hr);
              const tc = tempColor(h.temp);
              const isNow = i === 0;
              const showDaySep =
                i > 0 && isDifferentDay(hours[i - 1].time, h.time);
              return (
                <>
                  {showDaySep && (
                    <div key={`sep-${h.time}`} className="hourly-day-separator">
                      <div className="hourly-day-separator-line" />
                      <span className="hourly-day-separator-label">
                        {formatDayLabel(h.time)}
                      </span>
                      <div className="hourly-day-separator-line" />
                    </div>
                  )}
                  <div
                    key={h.time}
                    className={`hourly-tile${isNow ? " hourly-tile--now" : ""}`}
                  >
                    {/* Time label */}
                    <span className="hourly-tile-time">
                      {isNow ? "Now" : formatHour(h.time)}
                    </span>

                    {/* Weather icon */}
                    <div className="hourly-tile-icon">{meta.icon}</div>

                    {/* Temperature with color accent */}
                    <span className="hourly-tile-temp" style={{ color: tc }}>
                      {h.temp != null ? `${Math.round(h.temp)}°` : "—"}
                    </span>

                    {/* Mini stat bar */}
                    <div className="hourly-tile-stats">
                      <span className="hourly-tile-stat" title="Humidity">
                        <TbDroplet
                          size={11}
                          className="hourly-stat-icon hourly-stat-icon--blue"
                        />
                        <span>
                          {h.humidity != null ? `${h.humidity}%` : "—"}
                        </span>
                      </span>
                      <span className="hourly-tile-stat" title="Rain chance">
                        <TbCloudRain
                          size={11}
                          className="hourly-stat-icon hourly-stat-icon--cyan"
                        />
                        <span>
                          {h.precipProb != null ? `${h.precipProb}%` : "—"}
                        </span>
                      </span>
                    </div>

                    {/* Temp bar indicator */}
                    <div className="hourly-tile-bar-track">
                      <div
                        className="hourly-tile-bar-fill"
                        style={{
                          width: `${h.temp != null ? Math.min(100, Math.max(8, ((h.temp - 15) / 25) * 100)) : 0}%`,
                          background: tc,
                        }}
                      />
                    </div>
                  </div>
                </>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
