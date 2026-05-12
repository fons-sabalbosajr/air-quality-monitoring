import { useState, useMemo, useEffect } from "react";
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
import { AQI_COLORS } from "../utils/aqiPalette";
import "./HistoricalAqiGraph.css";

/* ── AQI colour bands ─────────────────────────────────────────────── */
const BANDS = [
  { name: "Good",                              min: 0,   max: 50,  color: AQI_COLORS.good },
  { name: "Fair",                              min: 51,  max: 100, color: AQI_COLORS.fair },
  { name: "Unhealthy for Sensitive Groups",    min: 101, max: 150, color: AQI_COLORS.usg },
  { name: "Very Unhealthy",                    min: 151, max: 200, color: AQI_COLORS.vu },
  { name: "Acutely Unhealthy",                 min: 201, max: 300, color: AQI_COLORS.au },
  { name: "Emergency",                         min: 301, max: 999, color: AQI_COLORS.emergency },
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
  { name: "Good",                              min: 0,   max: 50,  color: AQI_COLORS.good },
  { name: "Fair",                              min: 51,  max: 100, color: AQI_COLORS.fair },
  { name: "Unhealthy for Sensitive Groups",    min: 101, max: 150, color: AQI_COLORS.usg },
  { name: "Very Unhealthy",                    min: 151, max: 200, color: AQI_COLORS.vu },
  { name: "Acutely Unhealthy",                 min: 201, max: 300, color: AQI_COLORS.au },
  { name: "Emergency",                         min: 301, max: 999, color: AQI_COLORS.emergency },
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
  const [range, setRange] = useState("1m");
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
    if (!rows.length) return rows;

    // Build secondary-pollutant lookup by day
    const lookup2 = {};
    if (hasDual) {
      for (const r of data2) {
        const key = dayjs(r.t).format("YYYY-MM-DD");
        if (!lookup2[key]) lookup2[key] = [];
        lookup2[key].push(Number(r.y));
      }
    }

    // Group primary rows by day
    const dailyMap = {};
    for (const r of rows) {
      const key = dayjs(r.t).format("YYYY-MM-DD");
      if (!dailyMap[key]) dailyMap[key] = [];
      dailyMap[key].push(r);
    }

    // Generate continuous daily data, filling gaps with null
    const sortedKeys = Object.keys(dailyMap).sort();
    const startDay = dayjs(sortedKeys[0]);
    const endDay   = dayjs(sortedKeys[sortedKeys.length - 1]);
    const result   = [];
    let cursor     = startDay;

    while (!cursor.isAfter(endDay, "day")) {
      const key     = cursor.format("YYYY-MM-DD");
      const dayRows = dailyMap[key];

      if (dayRows && dayRows.length) {
        const avgY = dayRows.reduce((s, r) => s + Number(r.y), 0) / dayRows.length;
        const entry = {
          t: cursor.toISOString(),
          y: Math.round(avgY),
          conc: dayRows[0].conc,
          status: dayRows[0].status,
        };
        if (hasDual) {
          const arr2 = lookup2[key];
          entry.y2      = arr2 && arr2.length ? Math.round(arr2.reduce((s, v) => s + v, 0) / arr2.length) : null;
          entry._label  = label  || "PM10";
          entry._label2 = label2 || "PM2.5";
        }
        result.push(entry);
      } else {
        // Missing day → empty placeholder
        const entry = { t: cursor.toISOString(), y: null, conc: null, status: null };
        if (hasDual) {
          entry.y2      = null;
          entry._label  = label  || "PM10";
          entry._label2 = label2 || "PM2.5";
        }
        result.push(entry);
      }
      cursor = cursor.add(1, "day");
    }

    return result;
  }, [data, data2, hasDual, range, customRange, label, label2]);

  // Compute min/max for display (exclude null/gap days)
  const stats = useMemo(() => {
    if (!filteredData.length) return { min: null, max: null, avg: null, count: 0 };
    const vals = filteredData.filter((r) => r.y != null).map((r) => Number(r.y)).filter(isFinite);
    if (!vals.length) return { min: null, max: null, avg: null, count: 0 };
    return {
      min: Math.min(...vals),
      max: Math.max(...vals),
      avg: vals.reduce((a, b) => a + b, 0) / vals.length,
      count: vals.length,
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
            {b.name}{" "}
            <Tag color={b.color} style={{ fontSize: 10, fontWeight: 700, margin: 0, padding: "0 4px", lineHeight: "16px", borderRadius: 4 }}>
              {b.min}–{b.max}
            </Tag>
          </span>
        ))}
      </div>

      {/* Min / Max / Avg summary bar (with pollutant labels for dual) */}
      {filteredData.length > 0 && stats.min != null && (
        <div className="hist-aqi-stats">
          {hasDual && (
            <>
              <Tag color={AQI_COLORS.good} style={{ fontWeight: 700, fontSize: 11 }}>
                {label || "PM10"}
              </Tag>
              <Tag color="#06b6d4" style={{ fontWeight: 700, fontSize: 11 }}>
                {label2 || "PM2.5"}
              </Tag>
              <span style={{ borderLeft: '1px solid var(--aqm-border, #e5e7eb)', height: 16, margin: '0 4px' }} />
            </>
          )}
          <Tag color={getColor(stats.min)}>Min: {Math.round(stats.min)}</Tag>
          <Tag color={getColor(stats.max)}>Max: {Math.round(stats.max)}</Tag>
          <Tag color={getColor(stats.avg)}>Avg: {Math.round(stats.avg)}</Tag>
          <span className="hist-aqi-reading-count">
            {stats.count} daily readings
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
