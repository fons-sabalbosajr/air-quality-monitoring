import { useState, useMemo, useRef, useEffect } from "react";
import { Select, DatePicker, Tooltip as AntTooltip, Skeleton, Button, Tag } from "antd";
import FilterGroup from "@components/FilterGroup.jsx";
import dayjs from "dayjs";
import { TbChartBar } from "react-icons/tb";
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  Cell,
  ReferenceLine,
  CartesianGrid,
  Legend,
} from "recharts";

/* ── AQI colour bands ─────────────────────────────────────────────── */
const BANDS = [
  { name: "Good",                              min: 0,   max: 50,  color: "#34d399" },
  { name: "Fair",                              min: 51,  max: 100, color: "#fbbf24" },
  { name: "Unhealthy for Sensitive Groups",    min: 101, max: 150, color: "#fb923c" },
  { name: "Very Unhealthy",                    min: 151, max: 200, color: "#f87171" },
  { name: "Acutely Unhealthy",                 min: 201, max: 300, color: "#a78bfa" },
  { name: "Emergency",                         min: 301, max: 999, color: "#fb7185" },
];

function getColor(val) {
  const n = Number(val);
  if (!isFinite(n) || n < 0) return "#d9d9d9";
  const b = BANDS.find((b) => n >= b.min && n <= b.max);
  return b ? b.color : BANDS[BANDS.length - 1].color;
}

function classify(val) {
  const n = Number(val);
  if (!isFinite(n) || n < 0) return "—";
  const b = BANDS.find((b) => n >= b.min && n <= b.max);
  return b ? b.name : BANDS[BANDS.length - 1].name;
}

function formatDate(ts) {
  try {
    const d = new Date(ts);
    return `${String(d.getMonth() + 1).padStart(2, "0")}/${String(d.getDate()).padStart(2, "0")}/${d.getFullYear()}`;
  } catch {
    return ts;
  }
}

/**
 * Custom tooltip for the historical bar chart.
 */
function ChartTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="hist-chart-tooltip">
      <div className="hist-chart-tooltip-date">{formatDate(label)}</div>
      {payload.map((p, i) => {
        const val = p?.value;
        const cat = classify(val);
        const color = p.name === "y2" ? getColor2(val) : getColor(val);
        const lbl = p.name === "y2" ? (p.payload?._label2 || "PM2.5") : (p.payload?._label || "PM10");
        return (
          <div key={i}>
            <div className="hist-chart-tooltip-row">
              <span className="hist-chart-tooltip-dot" style={{ background: color }} />
              <span style={{ fontSize: 11, fontWeight: 600, opacity: 0.7 }}>{lbl}</span>
              <span className="hist-chart-tooltip-val" style={{ color }}>{val != null ? Math.round(val) : "—"}</span>
              <span className="hist-chart-tooltip-unit">µg/Ncm</span>
            </div>
            <div className="hist-chart-tooltip-cat" style={{ color }}>{cat}</div>
          </div>
        );
      })}
    </div>
  );
}

/* ── Secondary colour palette for PM2.5 (blue-teal tones) ─────── */
const BANDS2 = [
  { name: "Good",                              min: 0,   max: 50,  color: "#06b6d4" },
  { name: "Fair",                              min: 51,  max: 100, color: "#eab308" },
  { name: "Unhealthy for Sensitive Groups",    min: 101, max: 150, color: "#f97316" },
  { name: "Very Unhealthy",                    min: 151, max: 200, color: "#ef4444" },
  { name: "Acutely Unhealthy",                 min: 201, max: 300, color: "#8b5cf6" },
  { name: "Emergency",                         min: 301, max: 999, color: "#e11d48" },
];

function getColor2(val) {
  const n = Number(val);
  if (!isFinite(n) || n < 0) return "#d9d9d9";
  const b = BANDS2.find((b) => n >= b.min && n <= b.max);
  return b ? b.color : BANDS2[BANDS2.length - 1].color;
}

export default function HistoricalAqiGraph({
  data = [],
  loading,
  error,
  title = "Historical Air Quality Data",
  label,
  data2,
  label2,
  loading2,
}) {
  const [range, setRange] = useState("3m");
  const [customRange, setCustomRange] = useState(null);
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    const mq = window.matchMedia("(max-width: 640px)");
    setIsMobile(mq.matches);
    const handler = (e) => setIsMobile(e.matches);
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, []);

  const hasDual = Array.isArray(data2) && data2.length > 0;

  const filteredData = useMemo(() => {
    let rows = [...data].sort((a, b) => new Date(a.t) - new Date(b.t));
    if (customRange && customRange[0] && customRange[1]) {
      const [s, e] = customRange;
      rows = rows.filter((r) => {
        const d = dayjs(r.t);
        return !d.isBefore(s, "day") && !d.isAfter(e, "day");
      });
    } else if (range !== "all") {
      const now = dayjs();
      const map = { "1w": 7, "1m": 30, "3m": 90, "6m": 180, "1y": 365 };
      const days = map[range] || 90;
      const cutoff = now.subtract(days, "day");
      rows = rows.filter((r) => dayjs(r.t).isAfter(cutoff));
    }

    // If dual data, merge secondary values by date
    if (hasDual) {
      const lookup2 = {};
      for (const r of data2) {
        const key = dayjs(r.t).format("YYYY-MM-DD");
        lookup2[key] = r.y;
      }
      rows = rows.map((r) => {
        const key = dayjs(r.t).format("YYYY-MM-DD");
        return { ...r, y2: lookup2[key] ?? null, _label: label || "PM10", _label2: label2 || "PM2.5" };
      });
    }

    return rows;
  }, [data, data2, hasDual, range, customRange, label, label2]);

  // Compute min/max for display
  const stats = useMemo(() => {
    if (!filteredData.length) return { min: null, max: null, avg: null };
    const vals = filteredData.map((r) => Number(r.y)).filter(isFinite);
    if (!vals.length) return { min: null, max: null, avg: null };
    return {
      min: Math.min(...vals),
      max: Math.max(...vals),
      avg: vals.reduce((a, b) => a + b, 0) / vals.length,
    };
  }, [filteredData]);

  return (
    <div className="dashboard-section hist-aqi-section">
      <div className="section-header">
        <div className="section-header-icon">
          <TbChartBar size={22} />
        </div>
        <div>
          <h3 className="section-title">{title}</h3>
          <p className="section-subtitle">Color-coded daily averages by AQI band</p>
        </div>
        <div className="section-header-actions">
          <FilterGroup label="Filters">
            <Select
              size="small"
              value={range}
              onChange={(v) => { setRange(v); setCustomRange(null); }}
              style={{ width: 110 }}
              options={[
                { label: "1 Week", value: "1w" },
                { label: "1 Month", value: "1m" },
                { label: "3 Months", value: "3m" },
                { label: "6 Months", value: "6m" },
                { label: "1 Year", value: "1y" },
                { label: "All", value: "all" },
              ]}
            />
            <DatePicker.RangePicker
              size="small"
              value={customRange}
              onChange={(v) => setCustomRange(v)}
              allowClear
            />
          </FilterGroup>
        </div>
      </div>

      {/* Legend strip */}
      <div className="hist-aqi-legend">
        {BANDS.map((b) => (
          <span key={b.name} className="hist-aqi-legend-item">
            <span className="hist-aqi-legend-dot" style={{ background: b.color }} />
            {b.name} ({b.min}–{b.max})
          </span>
        ))}
      </div>

      {/* Dual pollutant indicator */}
      {hasDual && (
        <div className="hist-aqi-dual-legend">
          <span className="hist-aqi-dual-item">
            <span className="hist-aqi-dual-swatch" style={{ background: "#34d399", borderRadius: 2 }} />
            {label || "PM10"}
          </span>
          <span className="hist-aqi-dual-item">
            <span className="hist-aqi-dual-swatch" style={{ background: "#06b6d4", borderRadius: 2, opacity: 0.75 }} />
            {label2 || "PM2.5"}
          </span>
        </div>
      )}

      {/* Min / Max / Avg summary bar */}
      {filteredData.length > 0 && stats.min != null && (
        <div className="hist-aqi-stats">
          <Tag color={getColor(stats.min)}>Min: {Math.round(stats.min)}</Tag>
          <Tag color={getColor(stats.max)}>Max: {Math.round(stats.max)}</Tag>
          <Tag color={getColor(stats.avg)}>Avg: {Math.round(stats.avg)}</Tag>
          <span className="hist-aqi-reading-count">
            {filteredData.length} readings
          </span>
        </div>
      )}

      {loading ? (
        <Skeleton active paragraph={{ rows: 6 }} />
      ) : error ? (
        <div className="section-empty">{error}</div>
      ) : !filteredData.length ? (
        <div className="section-empty">No data available for the selected range</div>
      ) : (
        <div className="hist-aqi-chart-wrap">
          <ResponsiveContainer width="100%" height={340}>
            <BarChart data={filteredData} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--aqm-panel-border)" />
              <XAxis
                dataKey="t"
                tickFormatter={(v) => {
                  try {
                    const d = new Date(v);
                    return `${d.getMonth() + 1}/${d.getDate()}`;
                  } catch {
                    return v;
                  }
                }}
                tick={{ fontSize: 10 }}
                interval={isMobile ? Math.max(0, Math.floor(filteredData.length / 6)) : "preserveStartEnd"}
              />
              <YAxis tick={{ fontSize: 10 }} domain={["auto", "auto"]} />
              <Tooltip content={<ChartTooltip />} />
              {BANDS.slice(0, -1).map((b) => (
                <ReferenceLine
                  key={b.name}
                  y={b.max}
                  stroke={b.color}
                  strokeDasharray="3 3"
                  strokeOpacity={0.4}
                />
              ))}
              <Bar dataKey="y" name="y" radius={[3, 3, 0, 0]} maxBarSize={hasDual ? 14 : 20}>
                {filteredData.map((entry, idx) => (
                  <Cell key={idx} fill={getColor(entry.y)} fillOpacity={0.88} />
                ))}
              </Bar>
              {hasDual && (
                <Bar dataKey="y2" name="y2" radius={[3, 3, 0, 0]} maxBarSize={14}>
                  {filteredData.map((entry, idx) => (
                    <Cell key={idx} fill={getColor2(entry.y2)} fillOpacity={0.65} />
                  ))}
                </Bar>
              )}
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}
