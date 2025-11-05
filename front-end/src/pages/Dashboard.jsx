import { useEffect, useState } from "react";
import { Skeleton, Alert, Spin } from "antd";
import VizChart from "../components/VizChart";

function useLatestAQI() {
  const [state, setState] = useState({
    loading: true,
    refreshing: false,
    error: null,
    data: null,
  });
  useEffect(() => {
    let cancelled = false;
    const base = import.meta.env.VITE_API_BASE || "http://localhost:3001";
    async function run() {
      setState((s) => ({
        ...s,
        loading: s.data ? false : true,
        refreshing: !!s.data,
        error: null,
      }));
      try {
        const res = await fetch(new URL("/api/aqi/latest", base));
        if (!res.ok) throw new Error(`API ${res.status}`);
        const json = await res.json();
        if (!cancelled)
          setState({
            loading: false,
            refreshing: false,
            error: null,
            data: json,
          });
      } catch (e) {
        if (!cancelled)
          setState((s) => ({
            ...s,
            loading: false,
            refreshing: false,
            error: e.message || "Failed to load",
          }));
      }
    }
    run();
    const id = setInterval(run, 60_000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);
  return state;
}

function useStationCurrent() {
  const [state, setState] = useState({
    loading: true,
    refreshing: false,
    error: null,
    data: null,
  });
  useEffect(() => {
    let cancelled = false;
    const base = import.meta.env.VITE_API_BASE || "http://localhost:3001";
    async function run() {
      setState((s) => ({
        ...s,
        loading: s.data ? false : true,
        refreshing: !!s.data,
        error: null,
      }));
      try {
        const res = await fetch(new URL("/api/station/current", base));
        if (!res.ok) throw new Error(await res.text());
        const json = await res.json();
        if (!cancelled)
          setState({
            loading: false,
            refreshing: false,
            error: null,
            data: json,
          });
      } catch (e) {
        if (!cancelled)
          setState((s) => ({
            ...s,
            loading: false,
            refreshing: false,
            error: e.message || "Failed to load",
          }));
      }
    }
    run();
    const id = setInterval(run, 60_000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);
  return state;
}

function useStationForecast(days = 3) {
  const [state, setState] = useState({
    loading: true,
    refreshing: false,
    error: null,
    data: null,
  });
  useEffect(() => {
    let cancelled = false;
    const base = import.meta.env.VITE_API_BASE || "http://localhost:3001";
    async function run() {
      setState((s) => ({
        ...s,
        loading: s.data ? false : true,
        refreshing: !!s.data,
        error: null,
      }));
      try {
        const url = new URL("/api/station/forecast", base);
        url.searchParams.set("days", String(days));
        const res = await fetch(url.toString());
        if (!res.ok) throw new Error(await res.text());
        const json = await res.json();
        if (!cancelled)
          setState({
            loading: false,
            refreshing: false,
            error: null,
            data: json,
          });
      } catch (e) {
        if (!cancelled)
          setState((s) => ({
            ...s,
            loading: false,
            refreshing: false,
            error: e.message || "Failed to load",
          }));
      }
    }
    run();
    const id = setInterval(run, 60_000 * 10); // refresh every 10 minutes
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [days]);
  return state;
}

function categoryTint(category) {
  const c = String(category || "").toUpperCase();
  if (c.includes("GOOD")) return "#08979c"; // cyan-700
  if (c.includes("MODERATE")) return "#d4b106"; // amber-700
  if (c.includes("SENSITIVE")) return "#fa8c16"; // orange-600
  if (c === "UNHEALTHY") return "#cf1322"; // red-700
  if (c.includes("VERY")) return "#531dab"; // violet-800
  if (c.includes("HAZARD") || c.includes("EMERGENCY")) return "#ff4d4f"; // rose-500
  return "#1677ff"; // default primary
}

function hexToRgba(hex, alpha) {
  let h = hex.replace("#", "");
  if (h.length === 3)
    h = h
      .split("")
      .map((ch) => ch + ch)
      .join("");
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

export default function DashboardPage() {
  const aqi = useLatestAQI();
  const station = useStationCurrent();
  const forecast = useStationForecast(3);
  const aqiDays = useAqiLastDays(3);

  return (
    <div className="space-y-4">
  <h2 className="text-xl font-semibold">Clark Station</h2>

      <div className="aqm-tiles">
        {/* Latest AQI Category (PM10) */}
        <AQITile
          loading={aqi.loading}
          refreshing={aqi.refreshing}
          error={aqi.error}
          category={aqi.data?.category}
          value={aqi.data?.value}
          time={aqi.data?.time}
          daysLoading={aqiDays.loading}
          daysRefreshing={aqiDays.refreshing}
          daysError={aqiDays.error}
          daysItems={aqiDays.data?.items || []}
        />

        {/* Outdoor Temperature */}
        <div
          className="aqm-tile"
          style={tempContainerStyle(station.data?.temperature_2m)}
        >
          <div className="aqm-tile-header">Outdoor Temperature</div>
          {(station.refreshing || forecast.refreshing) && (
            <Spin size="small" className="aqm-tile-spinner" />
          )}
          {station.loading ? (
            <div className="aqm-tile-body">
              <Skeleton.Input active style={{ width: 120, height: 28 }} />
            </div>
          ) : station.error ? (
            <div className="aqm-tile-body">
              <Alert
                type="warning"
                message="Unavailable"
                description={station.error}
                showIcon
              />
            </div>
          ) : (
            <div className="aqm-tile-body">
              <div
                className="aqm-primary aqm-value-xl"
                style={{ color: tempTint(station.data?.temperature_2m) }}
              >
                {station.data?.temperature_2m ?? "--"}
                <span className="aqm-unit">°C</span>
              </div>
              {forecast.loading ? (
                <div className="aqm-subline">Loading 3-day forecast…</div>
              ) : forecast.error ? (
                <div className="aqm-subline">{forecast.error}</div>
              ) : (
                <MiniForecast
                  kind="temp"
                  items={forecast.data?.forecast || []}
                />
              )}
            </div>
          )}
        </div>

        {/* Outside Humidity */}
        <div
          className="aqm-tile"
          style={humidityContainerStyle(station.data?.relative_humidity_2m)}
        >
          <div className="aqm-tile-header">Outside Humidity</div>
          {(station.refreshing || forecast.refreshing) && (
            <Spin size="small" className="aqm-tile-spinner" />
          )}
          {station.loading ? (
            <div className="aqm-tile-body">
              <Skeleton.Input active style={{ width: 120, height: 28 }} />
            </div>
          ) : station.error ? (
            <div className="aqm-tile-body">
              <Alert
                type="warning"
                message="Unavailable"
                description={station.error}
                showIcon
              />
            </div>
          ) : (
            <div className="aqm-tile-body">
              <div
                className="aqm-primary aqm-value"
                style={{
                  color: humidityTint(station.data?.relative_humidity_2m),
                }}
              >
                {station.data?.relative_humidity_2m ?? "--"}
                <span className="aqm-unit">%</span>
              </div>
              {forecast.loading ? (
                <div className="aqm-subline">Loading 3-day forecast…</div>
              ) : forecast.error ? (
                <div className="aqm-subline">{forecast.error}</div>
              ) : (
                <MiniForecast
                  kind="humidity"
                  items={forecast.data?.forecast || []}
                />
              )}
            </div>
          )}
        </div>

        {/* Pressure */}
        <div
          className="aqm-tile"
          style={pressureContainerStyle(station.data?.pressure_msl)}
        >
          <div className="aqm-tile-header">Pressure</div>
          {(station.refreshing || forecast.refreshing) && (
            <Spin size="small" className="aqm-tile-spinner" />
          )}
          {station.loading ? (
            <div className="aqm-tile-body">
              <Skeleton.Input active style={{ width: 140, height: 28 }} />
            </div>
          ) : station.error ? (
            <div className="aqm-tile-body">
              <Alert
                type="warning"
                message="Unavailable"
                description={station.error}
                showIcon
              />
            </div>
          ) : (
            <div className="aqm-tile-body">
              <div
                className="aqm-primary aqm-value"
                style={{ color: pressureTint(station.data?.pressure_msl) }}
              >
                {station.data?.pressure_msl ?? "--"}
                <span className="aqm-unit"> hPa</span>
              </div>
              {forecast.loading ? (
                <div className="aqm-subline">Loading 3-day forecast…</div>
              ) : forecast.error ? (
                <div className="aqm-subline">{forecast.error}</div>
              ) : (
                <MiniForecast
                  kind="pressure"
                  items={forecast.data?.forecast || []}
                />
              )}
            </div>
          )}
        </div>
      </div>
      {/* Station chart moved here, styled as a tile with refreshing spinner */}
      <VizChart variant="tile" title="AQI Chart" />
    </div>
  );
}

function AQITile({
  loading,
  refreshing,
  error,
  category,
  value,
  time,
  daysLoading,
  daysRefreshing,
  daysError,
  daysItems,
}) {
  const tint = categoryTint(category);
  const containerStyle = {
    background: `linear-gradient(135deg, ${hexToRgba(
      tint,
      0.08
    )} 0%, var(--aqm-panel-bg) 60%)`,
    borderColor: hexToRgba(tint, 0.25),
  };
  return (
    <div className="aqm-tile aqi" style={containerStyle}>
      <div className="aqm-tile-header">Latest AQI Category (PM10)</div>
      {(refreshing || daysRefreshing) && (
        <Spin size="small" className="aqm-tile-spinner" />
      )}
      {loading ? (
        <div className="aqm-tile-body">
          <Skeleton active paragraph={false} title={{ width: 140 }} />
          <div style={{ height: 6 }} />
          <Skeleton.Input active style={{ width: 160, height: 28 }} />
        </div>
      ) : error ? (
        <div className="aqm-tile-body">
          <Alert
            type="warning"
            message="Unavailable"
            description={error}
            showIcon
          />
        </div>
      ) : (
        <div className="aqm-tile-body">
          <div className="aqm-primary aqm-category" style={{ color: tint }}>
            {(category || "--").toUpperCase()}
          </div>
          {/* 'as of' subline removed per request */}
          {daysLoading ? (
            <div className="aqm-subline">Loading previous days…</div>
          ) : daysError ? (
            <div className="aqm-subline">{daysError}</div>
          ) : (
            <AqiMini items={daysItems} />
          )}
        </div>
      )}
    </div>
  );
}

function AqiMini({ items }) {
  return (
    <div className="aqm-forecast aqm-forecast--aqi">
      {(items || []).slice(0, 3).map((it) => {
        const tint = categoryTint(it.category);
        const n = Number(it.value);
        const val = isFinite(n) ? Math.round(n) : "--";
        return (
          <div key={it.date} className="aqm-forecast-item">
            <div className="aqm-forecast-day">{dayLabel(it.date)}</div>
            <div className="aqm-forecast-val" style={{ color: tint }}>
              {val} µg/Ncm
            </div>
          </div>
        );
      })}
    </div>
  );
}

function dayLabel(isoDate) {
  try {
    // Expect isoDate as YYYY-MM-DD
    const [y, m, d] = isoDate.split("-").map(Number);
    const mm = String(m).padStart(2, "0");
    const dd = String(d).padStart(2, "0");
    return `${mm}/${dd}`;
  } catch {
    return isoDate;
  }
}

function MiniForecast({ kind, items }) {
  const display = (it) => {
    if (kind === "temp") {
      if (it.temp_max == null && it.temp_min == null) return "--";
      const tmax = it.temp_max != null ? Math.round(it.temp_max) : "--";
      const tmin = it.temp_min != null ? Math.round(it.temp_min) : "--";
      return `${tmax}°/${tmin}°`;
    }
    if (kind === "humidity") {
      return it.humidity_mean != null
        ? `${Math.round(it.humidity_mean)}%`
        : "--";
    }
    if (kind === "pressure") {
      return it.pressure_mean != null
        ? `${Math.round(it.pressure_mean)} hPa`
        : "--";
    }
    return "--";
  };
  return (
    <div className="aqm-forecast">
      {(items || []).slice(0, 3).map((it) => (
        <div key={it.date} className="aqm-forecast-item">
          <div className="aqm-forecast-day">{dayLabel(it.date)}</div>
          <div className="aqm-forecast-val">{display(it)}</div>
        </div>
      ))}
    </div>
  );
}

// Dynamic tint helpers for tiles
function tempTint(v) {
  const n = Number(v);
  if (!isFinite(n)) return "#1677ff";
  if (n <= 10) return "#3b82f6"; // cold - blue
  if (n <= 17) return "#06b6d4"; // cool - cyan
  if (n <= 27) return "#16a34a"; // comfortable - green
  if (n <= 32) return "#f59e0b"; // warm - amber
  if (n <= 37) return "#ef4444"; // hot - red
  return "#b91c1c"; // extreme hot - darker red
}
function tempContainerStyle(v) {
  const tint = tempTint(v);
  return {
    background: `linear-gradient(135deg, ${hexToRgba(
      tint,
      0.08
    )} 0%, var(--aqm-panel-bg) 60%)`,
    borderColor: hexToRgba(tint, 0.25),
  };
}

function humidityTint(v) {
  const n = Number(v);
  if (!isFinite(n)) return "#1677ff";
  if (n < 30) return "#f59e0b"; // too dry - amber
  if (n <= 60) return "#16a34a"; // comfortable - green
  if (n <= 75) return "#06b6d4"; // humid - cyan
  return "#3b82f6"; // very humid - blue
}
function humidityContainerStyle(v) {
  const tint = humidityTint(v);
  return {
    background: `linear-gradient(135deg, ${hexToRgba(
      tint,
      0.08
    )} 0%, var(--aqm-panel-bg) 60%)`,
    borderColor: hexToRgba(tint, 0.25),
  };
}

function pressureTint(v) {
  const n = Number(v);
  if (!isFinite(n)) return "#1677ff";
  if (n < 1005) return "#3b82f6"; // low - blue
  if (n <= 1020) return "#16a34a"; // normal - green
  return "#ef4444"; // high - red
}
function pressureContainerStyle(v) {
  const tint = pressureTint(v);
  return {
    background: `linear-gradient(135deg, ${hexToRgba(
      tint,
      0.08
    )} 0%, var(--aqm-panel-bg) 60%)`,
    borderColor: hexToRgba(tint, 0.25),
  };
}

function useAqiLastDays(days = 3) {
  const [state, setState] = useState({
    loading: true,
    refreshing: false,
    error: null,
    data: null,
  });
  useEffect(() => {
    let cancelled = false;
    const base = import.meta.env.VITE_API_BASE || "http://localhost:3001";
    async function run() {
      setState((s) => ({
        ...s,
        loading: s.data ? false : true,
        refreshing: !!s.data,
        error: null,
      }));
      try {
        const url = new URL("/api/aqi/last-days", base);
        url.searchParams.set("days", String(days));
        const res = await fetch(url.toString());
        if (!res.ok) throw new Error(await res.text());
        const json = await res.json();
        if (!cancelled)
          setState({
            loading: false,
            refreshing: false,
            error: null,
            data: json,
          });
      } catch (e) {
        if (!cancelled)
          setState((s) => ({
            ...s,
            loading: false,
            refreshing: false,
            error: e.message || "Failed to load",
          }));
      }
    }
    run();
    const id = setInterval(run, 60_000 * 10); // refresh every 10 minutes
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [days]);
  return state;
}
