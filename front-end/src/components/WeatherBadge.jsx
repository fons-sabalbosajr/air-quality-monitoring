import { useEffect, useMemo, useState } from "react";
import { theme } from "antd";
import { getApiBase } from "../util/apiBase";
import "./WeatherBadge.css";

function codeToCondition(code) {
  // Open-Meteo weather codes mapping (simplified)
  if (code === 0) return { label: "Clear", emoji: "☀️" };
  if ([1, 2].includes(code)) return { label: "Partly cloudy", emoji: "⛅" };
  if (code === 3) return { label: "Overcast", emoji: "☁️" };
  if ([45, 48].includes(code)) return { label: "Fog", emoji: "🌫️" };
  if ([51, 53, 55, 56, 57].includes(code))
    return { label: "Drizzle", emoji: "🌦️" };
  if ([61, 63, 65, 80, 81, 82].includes(code))
    return { label: "Rain", emoji: "🌧️" };
  if ([66, 67, 95, 96, 99].includes(code))
    return { label: "Storm", emoji: "⛈️" };
  if ([71, 73, 75, 77, 85, 86].includes(code))
    return { label: "Snow", emoji: "❄️" };
  return { label: "—", emoji: "🌡️" };
}

export default function WeatherBadge() {
  const { token } = theme.useToken();
  const [state, setState] = useState({
    loading: true,
    error: null,
    city: null,
    lat: null,
    lon: null,
    temp: null,
    tmax: null,
    tmin: null,
    tmaxY: null,
    tminY: null,
    wind: null,
    code: null,
    iconUrl: null,
  });
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    let cancelled = false;

    function update(partial) {
      if (!cancelled) setState((s) => ({ ...s, ...partial }));
    }

    if (!navigator.geolocation) {
      update({ loading: false, error: "Geolocation not supported" });
      return;
    }
    let refreshTimer;

    async function fetchGoogleWeather(lat, lon) {
      const apiKey = import.meta.env.VITE_GOOGLE_WEATHER_API_KEY;
      const base = import.meta.env.VITE_GOOGLE_WEATHER_BASE || "https://weather.googleapis.com/v1";
      if (!apiKey) return null;
      try {
        const url = `${base}/weather:lookup?location=${lat},${lon}&units=metric&languageCode=en&key=${apiKey}`;
        const res = await fetch(url);
        if (!res.ok) return null;
        const data = await res.json();
        const current = data?.currentConditions || data?.current || null;
        const daily = data?.dailyForecast || data?.daily || null;
        const temp = Math.round(current?.temperature ?? current?.temp ?? NaN);
        let wind = current?.windSpeed ?? current?.wind?.speed ?? null;
        if (typeof wind === "number" && wind < 40) wind = Math.round(wind * 3.6);
        const condition = current?.summary || current?.weatherDescription || current?.condition || null;
        const iconUrl = current?.weatherIcon || current?.iconUrl || null;
        let tmax = null, tmin = null;
        const today = Array.isArray(daily) ? daily[0] : daily?.[0];
        if (today) {
          tmax = Math.round(today?.maxTemperature ?? today?.tmax ?? NaN);
          tmin = Math.round(today?.minTemperature ?? today?.tmin ?? NaN);
        }
        return { temp, wind: Number.isFinite(wind) ? wind : null, label: condition, tmax, tmin, iconUrl };
      } catch {
        return null;
      }
    }

  async function fetchOpenMeteo(lat, lon, doReverseGeo = false) {
      try {
        const weatherUrl = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current_weather=true&daily=temperature_2m_max,temperature_2m_min&past_days=1&forecast_days=1&timezone=auto`;
        const res = await fetch(weatherUrl);
        const data = await res.json();
        const temp = Math.round(data?.current_weather?.temperature ?? NaN);
        const wind = Math.round(data?.current_weather?.windspeed ?? NaN);
        const code = data?.current_weather?.weathercode ?? null;
        const tmaxArr = data?.daily?.temperature_2m_max ?? [];
        const tminArr = data?.daily?.temperature_2m_min ?? [];
        const lastIdx = Math.max(0, tmaxArr.length - 1);
        const prevIdx = Math.max(0, lastIdx - 1);
        const tmax = Math.round(tmaxArr[lastIdx] ?? NaN);
        const tmin = Math.round(tminArr[lastIdx] ?? NaN);
        const tmaxY = Math.round(tmaxArr[prevIdx] ?? NaN);
        const tminY = Math.round(tminArr[prevIdx] ?? NaN);

        let cityName = null;
        if (doReverseGeo) {
          try {
            const base = getApiBase();
            const rgUrl = new URL(`${base}/api/reverse-geocode?lat=${encodeURIComponent(lat)}&lon=${encodeURIComponent(lon)}`).toString();
            const rg = await fetch(rgUrl);
            if (rg.ok) {
              const j = await rg.json();
              cityName = j.display || j.name || null;
            }
          } catch {}
        }

        // Prepare partial update; only set city when reverse geocoding is requested
        const partial = {
          loading: false,
          temp,
          wind,
          code,
          tmax,
          tmin,
          tmaxY,
          tminY,
          iconUrl: null,
        };
        if (doReverseGeo) {
          partial.city = cityName || null;
        }
        update(partial);
      } catch (e) {
        update({ loading: false, error: "Weather unavailable" });
      }
    }

    async function fetchWeather(lat, lon, doReverseGeo = false) {
      const google = await fetchGoogleWeather(lat, lon);
      if (google && (Number.isFinite(google.temp) || Number.isFinite(google.wind))) {
        let codeFromLabel = null;
        if (!state.code && google.label) {
          const lc = String(google.label).toLowerCase();
          if (lc.includes("thunder")) codeFromLabel = 95;
          else if (lc.includes("snow")) codeFromLabel = 71;
          else if (lc.includes("rain") || lc.includes("shower")) codeFromLabel = 61;
          else if (lc.includes("drizzle")) codeFromLabel = 51;
          else if (lc.includes("fog") || lc.includes("mist") || lc.includes("haze")) codeFromLabel = 45;
          else if (lc.includes("overcast")) codeFromLabel = 3;
          else if (lc.includes("cloud")) codeFromLabel = 2;
          else if (lc.includes("clear") || lc.includes("sun")) codeFromLabel = 0;
        }
        update({
          loading: false,
          temp: google.temp ?? null,
          wind: google.wind ?? null,
          code: codeFromLabel ?? state.code,
          tmax: Number.isFinite(google.tmax) ? google.tmax : state.tmax,
          tmin: Number.isFinite(google.tmin) ? google.tmin : state.tmin,
          iconUrl: google.iconUrl || null,
        });
        if (doReverseGeo) await fetchOpenMeteo(lat, lon, true);
        return;
      }
      await fetchOpenMeteo(lat, lon, doReverseGeo);
    }

    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        const { latitude, longitude } = pos.coords;
        update({ lat: latitude, lon: longitude });
        await fetchWeather(latitude, longitude, true);
        // Refresh current weather periodically (every 60s)
        refreshTimer = setInterval(() => {
          fetchWeather(latitude, longitude, false);
        }, 60000);

        // Also watch position to keep location fresh (updates city if it changes)
        try {
          const watchId = navigator.geolocation.watchPosition(
            (p) => {
              const { latitude: la, longitude: lo } = p.coords;
              update({ lat: la, lon: lo });
              // When location changes, refresh and update city name
              fetchWeather(la, lo, true);
            },
            () => {},
            { enableHighAccuracy: false, timeout: 8000, maximumAge: 60 * 1000 }
          );
          // store watchId on window for cleanup scope
          window.__aqmWatchId = watchId;
        } catch {}
      },
      () => update({ loading: false, error: "Location permission denied" }),
      { enableHighAccuracy: false, timeout: 8000, maximumAge: 5 * 60 * 1000 }
    );

    const tick = setInterval(() => setNow(new Date()), 1000);
    return () => {
      cancelled = true;
      if (refreshTimer) clearInterval(refreshTimer);
      try {
        if (window.__aqmWatchId != null) {
          navigator.geolocation.clearWatch(window.__aqmWatchId);
          delete window.__aqmWatchId;
        }
      } catch {}
      clearInterval(tick);
    };
  }, []);

  const {
    loading,
    error,
    city,
    lat,
    lon,
    temp,
    tmax,
    tmin,
    tmaxY,
    tminY,
    wind,
    code,
  } = state;
  const { label } = codeToCondition(code);

  // Map condition to Google Material Symbols name
  const iconName = useMemo(() => {
    const m = {
      Clear: "sunny",
      "Partly cloudy": "partly_cloudy_day",
      Overcast: "cloud",
      Fog: "foggy",
      Drizzle: "rainy",
      Rain: "rainy",
      Storm: "thunderstorm",
      Snow: "snowing",
      "—": "thermostat",
    };
    return m[label] || "weather_mix";
  }, [label]);

  const pillStyle = {
    display: "flex",
    alignItems: "center",
    gap: 8,
    padding: 6,
    background: "transparent",
    color: token.colorText,
    fontSize: 12,
    lineHeight: 1.2,
    maxWidth: 620,
    textShadow: "0 1px 2px rgba(0,0,0,0.35)",
  };

  let text = "Weather…";
  if (loading) {
    text = "Locating weather…";
  } else if (error) {
    text = error;
  } else if (temp != null) {
    const loc = city || null;
    // Show actual location when available; otherwise omit the line
    const line1 = loc ? `${loc}` : null;
    const parts = [];
    parts.push(`${temp}°C ${label}`);
    if (Number.isFinite(tmax) && Number.isFinite(tmin))
      parts.push(`H${tmax}° L${tmin}°`);
    if (Number.isFinite(wind)) parts.push(`Wind ${wind} km/h`);
    const line2 = parts.join(" · ");
    let line3 = null;
    if (
      Number.isFinite(tmax) &&
      Number.isFinite(tmin) &&
      Number.isFinite(tmaxY) &&
      Number.isFinite(tminY)
    ) {
      const avgToday = (tmax + tmin) / 2;
      const avgY = (tmaxY + tminY) / 2;
      const delta = Math.round(avgToday - avgY);
      if (Number.isFinite(delta) && delta !== 0) {
        const adjective = delta > 0 ? "warmer" : "colder";
        const deg = Math.abs(delta);
        line3 = `${deg}°C ${adjective} than yesterday`;
      } else {
        line3 = `same as yesterday`;
      }
    }
    text = { line1, line2, line3 };
  }

  // format date/time with AM/PM
  const dateStr = now.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
  const timeStr = now.toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
  // Ensure month has a trailing dot like "Nov." to match requested style
  let monthShort = now.toLocaleString(undefined, { month: "short" });
  if (!monthShort.endsWith(".")) monthShort = monthShort + ".";
  const dateStrDot = `${monthShort} ${now.getDate()}, ${now.getFullYear()}`;
  const dateTimeStr = `${dateStrDot} • ${timeStr}`;

  if (typeof text === "string") {
    return (
      <div style={{ ...pillStyle }}>
        {/* Left: DateTime (single line) */}
        <span style={{ fontSize: 12, opacity: 0.9 }}>{dateTimeStr}</span>
        {/* Separator */}
        <span style={{ opacity: 0.4 }}>|</span>
        {/* Weather icon (Google Material Symbols or URL if provided) */}
        {state.iconUrl ? (
          <img src={state.iconUrl} alt={label} style={{ width: 22, height: 22 }} />
        ) : (
          <span className="material-symbols-rounded" style={{ fontVariationSettings: "'FILL' 1, 'wght' 400, 'opsz' 24", fontSize: 22, opacity: 0.95 }}>
            {iconName}
          </span>
        )}
        {/* Right: Status text */}
        <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
          <span>{text}</span>
        </div>
      </div>
    );
  }

  // Compute a best-effort location line
  const locLine = city || (
    Number.isFinite(lat) && Number.isFinite(lon)
      ? `${lat.toFixed(4)}, ${lon.toFixed(4)}`
      : null
  );

  return (
    <div style={{ ...pillStyle }}>
      {/* Left: DateTime (single line) */}
      <span style={{ fontSize: 12, opacity: 0.9 }}>{dateTimeStr}</span>
      {/* Separator between datetime and data group */}
      <span style={{ opacity: 0.4 }}>|</span>

      {/* Weather icon (Google Material Symbols or URL if provided) */}
      {state.iconUrl ? (
        <img src={state.iconUrl} alt={label} style={{ width: 22, height: 22 }} />
      ) : (
        <span className="material-symbols-rounded" style={{ fontVariationSettings: "'FILL' 1, 'wght' 400, 'opsz' 24", fontSize: 22, opacity: 0.95 }}>
          {iconName}
        </span>
      )}

      {/* Right: Weather data group (without date/time) */}
      <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
        {(text.line1 || locLine) && (
          <span style={{ fontWeight: 600, fontSize: 13 }}>
            {text.line1 || locLine}
          </span>
        )}
        <span style={{ fontSize: 12, opacity: 0.95 }}>{text.line2}</span>
        {text.line3 && (
          <span style={{ fontSize: 11, opacity: 0.9 }}>{text.line3}</span>
        )}
      </div>
    </div>
  );
}
