import { useEffect, useState, useRef, useMemo } from "react";
import { useApiEndpoint } from "../util/apiClient";
import { Card, Alert, Spin, Select, Button, DatePicker } from "antd";
import FilterGroup from "@components/FilterGroup.jsx";
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  ReferenceArea,
  ReferenceLine,
  Brush,
  Customized,
} from "recharts";

function usePm10Data(yKey) {
  return useApiEndpoint('/api/pm10-data', {
    params: yKey ? { yKey } : undefined,
    refreshMs: 300000,
    retries: 3,
    timeoutMs: 60000,
    cacheKey: yKey ? `pm10:${yKey}` : 'pm10:default',
    cacheTtlMs: 90000,
  });
}

function formatDateTime(ts) {
  try {
    const d = new Date(ts);
    const mm = String(d.getMonth() + 1).padStart(2, "0");
    const dd = String(d.getDate()).padStart(2, "0");
    const yyyy = d.getFullYear();
    const h24 = d.getHours();
    const hh12 = String((h24 % 12) || 12).padStart(2, "0");
    // Always display top-of-hour minutes as 00 to match sheet values (1:00..23:00)
    const min = "00";
    const ampm = h24 >= 12 ? "PM" : "AM";
    return `${mm}/${dd}/${yyyy} ${hh12}:${min} ${ampm}`;
  } catch {
    return ts;
  }
}

export default function Pm10Chart({ title = "Hourly Station Reading (µg/Ncm)", yKey, defaultRange }) {
  const { loading, refreshing, error, data, meta, retry, retrying } = usePm10Data(yKey);
  const [range, setRange] = useState(defaultRange || '1w'); // default to Last 1 week to avoid bulk loading
  const [customRange, setCustomRange] = useState(null); // dayjs[] | null overrides other filters
  const [selectedYear, setSelectedYear] = useState('all');
  const [selectedMonth, setSelectedMonth] = useState('all'); // 1..12 or 'all'
  const firstX = (data && data.length) ? data[0].t : undefined;
  const lastX = (data && data.length) ? data[data.length - 1].t : undefined;

  // Threshold coloring baseline (will extend last band dynamically if needed)
  const BASE_THRESHOLDS = [
    { name: 'GOOD', min: 0.0, max: 50.99, color: '#52c41a' },
    { name: 'FAIR', min: 51.0, max: 100.99, color: '#d4b106' },
    { name: 'UNHEALTHY', min: 101.0, max: 150.99, color: '#fa8c16' },
    { name: 'VERY UNHEALTHY', min: 151.0, max: 200.99, color: '#f5222d' },
    { name: 'ACUTELY UNHEALTHY', min: 201.0, max: 300.99, color: '#722ed1' },
    { name: 'EMERGENCY', min: 301.0, max: 400.99, color: '#a8071a' },
  ];

  function classify(val) {
    if (val == null || !isFinite(val)) return { name: '—', color: 'var(--aqm-muted)' };
    if (val >= 301) return { name: 'EMERGENCY', color: '#a8071a' };
    if (val >= 201) return { name: 'ACUTELY UNHEALTHY', color: '#722ed1' };
    if (val >= 151) return { name: 'VERY UNHEALTHY', color: '#f5222d' };
    if (val >= 101) return { name: 'UNHEALTHY', color: '#fa8c16' };
    if (val >= 51) return { name: 'FAIR', color: '#d4b106' };
    return { name: 'GOOD', color: '#52c41a' };
  }

  function BlinkingLastDot(props) {
    const { cx, cy, index, dataLength, color, enabled = true } = props;
    if (!enabled || index !== dataLength - 1) return null;
    return <circle cx={cx} cy={cy} r={4.5} className="blink-dot" fill={color || "var(--aqm-primary)"} stroke="none" />;
  }

  function filterByRange(arr, r) {
    if (!Array.isArray(arr) || arr.length === 0) return arr || [];
    const windows = {
      '12h': 12*60*60*1000,
      '1d': 24*60*60*1000,
      '1w': 7*24*60*60*1000,
      '1m': 30*24*60*60*1000,
      'all': Infinity,
    };
    if (!windows[r] || windows[r] === Infinity) return arr;
    const lastTs = arr.reduce((max, it) => {
      const ts = typeof it.t === 'number' ? it.t : Date.parse(it.t);
      return isFinite(ts) && ts > max ? ts : max;
    }, -Infinity);
    if (!isFinite(lastTs)) return arr;
    const cutoff = lastTs - windows[r];
    return arr.filter((it) => {
      const ts = typeof it.t === 'number' ? it.t : Date.parse(it.t);
      return isFinite(ts) && ts >= cutoff && ts <= lastTs;
    });
  }
  function filterByMonthYear(arr, year, month) {
    if (!Array.isArray(arr) || arr.length === 0) return arr || [];
    return arr.filter((it) => {
      const d = new Date(it.t);
      const y = d.getFullYear();
      const m = d.getMonth() + 1;
      const passYear = (year === 'all') || (y === year);
      const passMonth = (month === 'all') || (m === month);
      return passYear && passMonth;
    });
  }

  // initialize default to last point's calendar month
  useEffect(() => {
    if (!data || data.length === 0) return;
    if (selectedYear !== 'all' && selectedMonth !== 'all') return; // already set by user
    const d = new Date(data[data.length - 1].t);
    setSelectedYear(d.getFullYear());
    setSelectedMonth(d.getMonth() + 1);
  }, [data]);

  const base = (selectedYear !== 'all' || selectedMonth !== 'all')
    ? filterByMonthYear(data, selectedYear, selectedMonth)
    : data;

  function filterByCustom(arr, dr) {
    if (!Array.isArray(arr) || arr.length === 0) return arr || [];
    if (!dr || !dr[0] || !dr[1]) return arr;
    try {
  const start = dr[0].startOf('day').valueOf();
  const end = dr[1].endOf('day').valueOf();
      return arr.filter(it => {
        const ts = typeof it.t === 'number' ? it.t : Date.parse(it.t);
        return isFinite(ts) && ts >= start && ts <= end;
      });
    } catch { return arr; }
  }

  const filtered = (range === 'custom' && customRange)
    ? filterByCustom(data, customRange)
    : ((selectedYear !== 'all' || selectedMonth !== 'all')
        ? base
        : filterByRange(base, range));

  // Reset brush when switching custom range for clarity
  useEffect(() => {
    setBrushRange(null);
  }, [customRange]);
  const lastPoint = (filtered && filtered.length > 0) ? filtered[filtered.length - 1] : null;
  const lastClass = classify(lastPoint?.y);
  // Removed gradient/clip id: switching to multiple Line series for threshold colors
  // Persist Brush zoom across refresh
  const [brushRange, setBrushRange] = useState(null);
  useEffect(() => {
    if (!brushRange) return;
    const n = (filtered?.length ?? 0);
    if (!n) return;
    const ns = Math.max(0, Math.min(brushRange.startIndex ?? 0, n - 1));
    const ne = Math.max(ns, Math.min(brushRange.endIndex ?? n - 1, n - 1));
    if (ns !== (brushRange.startIndex ?? 0) || ne !== (brushRange.endIndex ?? 0)) {
      setBrushRange({ startIndex: ns, endIndex: ne });
    }
  }, [filtered?.length]);

  // Reset Brush when filters change (intentional), but keep on refresh
  useEffect(() => {
    setBrushRange(null);
  }, [range, selectedYear, selectedMonth]);

  // Augment data with per-threshold series for colored segments
  // Dynamic max for current filtered dataset
  const filteredMax = useMemo(() => {
    const vals = filtered.map(p => Number(p.y)).filter(v => isFinite(v));
    return vals.length ? Math.max(...vals) : 0;
  }, [filtered]);
  const THRESHOLDS = useMemo(() => {
    const last = BASE_THRESHOLDS[BASE_THRESHOLDS.length - 1];
    if (filteredMax > last.max) {
      return BASE_THRESHOLDS.map((t, idx) => idx === BASE_THRESHOLDS.length - 1 ? { ...t, max: filteredMax * 1.05 } : t);
    }
    return BASE_THRESHOLDS;
  }, [filteredMax]);
  const segmented = useMemo(() => filtered.map((p) => {
    const o = { ...p };
    THRESHOLDS.forEach((b, i) => {
      const key = `y_b${i}`;
      o[key] = (p.y >= b.min && p.y <= b.max) ? p.y : null;
    });
    return o;
  }), [filtered, THRESHOLDS]);

  // Build gradient stops across the x-axis so the stroke blends between categories
  const gradientStops = useMemo(() => {
    if (!filtered || filtered.length === 0) return [];
    const n = filtered.length - 1;
    return filtered.map((pt, i) => {
      const cls = classify(Number(pt.y));
      const offset = n === 0 ? 0 : (i / n) * 100; // percentage along the x-axis
      return { offset: `${offset.toFixed(3)}%`, color: cls.color };
    });
  }, [filtered]);

  // Floating tile state
  const containerRef = useRef(null);
  const tileRef = useRef(null);
  const positionedRef = useRef(false);
  const [tilePos, setTilePos] = useState({ left: 24, top: 12 }); // increased initial left margin

  useEffect(() => {
    if (!containerRef.current || !tileRef.current || positionedRef.current || !lastPoint) return;
    const c = containerRef.current;
    const t = tileRef.current;
    const cw = c.clientWidth || 0;
    const tw = t.clientWidth || 0;
    const safeLeftMargin = 24; // minimum distance from left edge
    const rightMargin = 15; // distance from right edge
    const left = Math.max(safeLeftMargin, cw - tw - rightMargin); // push to right side
    const top = 12;
    setTilePos({ left, top });
    positionedRef.current = true;
  }, [lastPoint]);

  function onTileMouseDown(e) {
    e.preventDefault();
    const c = containerRef.current;
    const t = tileRef.current;
    if (!c || !t) return;
    const startX = e.clientX;
    const startY = e.clientY;
    const startLeft = tilePos?.left ?? 8;
    const startTop = tilePos?.top ?? 8;
    const cw = c.clientWidth || 0;
    const ch = c.clientHeight || 0;
    const tw = t.clientWidth || 0;
    const th = t.clientHeight || 0;
  const safeLeftMargin = 24; // increased left drag boundary
    const safeTopMargin = 8;
    const minLeft = safeLeftMargin, minTop = safeTopMargin, maxLeft = Math.max(safeLeftMargin, cw - tw - 4), maxTop = Math.max(safeTopMargin, ch - th - 4);
    function move(ev) {
      const dx = ev.clientX - startX;
      const dy = ev.clientY - startY;
      let nl = startLeft + dx;
      let nt = startTop + dy;
      nl = Math.min(Math.max(nl, minLeft), maxLeft);
      nt = Math.min(Math.max(nt, minTop), maxTop);
      setTilePos({ left: nl, top: nt });
    }
    function up() {
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
    }
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
  }

  return (
    <Card
      title={<span style={{ color: 'var(--aqm-muted)' }}>{title}</span>}
      size="small"
      style={{ background: 'var(--aqm-panel-bg)', border: '1px solid var(--aqm-panel-border)' }}
      styles={{ header: { background: 'var(--aqm-panel-bg)', borderBottom: '1px solid var(--aqm-panel-border)' }, body: { background: 'var(--aqm-panel-bg)' } }}
      extra={
        <FilterGroup label="Hourly Range" defaultOpen={true}>
          {/* Year selector */}
          <Select
            size="small"
            value={selectedYear}
            onChange={setSelectedYear}
            className="aqm-fluid"
            options={(() => {
              const years = Array.from(new Set((data || []).map((d) => new Date(d.t).getFullYear()))).sort((a,b)=>a-b);
              return [{ value: 'all', label: 'All years' }, ...years.map((y) => ({ value: y, label: String(y) }))];
            })()}
          />
          {/* Month selector */}
          <Select
            size="small"
            value={selectedMonth}
            onChange={setSelectedMonth}
            className="aqm-fluid"
            options={[
              { value: 'all', label: 'All months' },
              { value: 1, label: 'January' },
              { value: 2, label: 'February' },
              { value: 3, label: 'March' },
              { value: 4, label: 'April' },
              { value: 5, label: 'May' },
              { value: 6, label: 'June' },
              { value: 7, label: 'July' },
              { value: 8, label: 'August' },
              { value: 9, label: 'September' },
              { value: 10, label: 'October' },
              { value: 11, label: 'November' },
              { value: 12, label: 'December' },
            ]}
          />
          {/* Range selector: selecting a range clears Month/Year filters (except custom) */}
          <Select
            size="small"
            value={range}
            onChange={(v) => {
              setRange(v);
              if (v !== 'custom') setCustomRange(null);
              if (v !== 'custom' && (selectedYear !== 'all' || selectedMonth !== 'all')) {
                setSelectedYear('all');
                setSelectedMonth('all');
              }
            }}
            className="aqm-fluid"
            options={[
              { value: '12h', label: 'Last 12 hours' },
              { value: '1d', label: 'Last 1 day' },
              { value: '1w', label: 'Last 1 week' },
              { value: '1m', label: 'Last 1 month' },
              { value: 'all', label: 'All data' },
              { value: 'custom', label: 'Custom range' },
            ]}
          />
          <DatePicker.RangePicker
            allowClear
            size="small"
            className="aqm-fluid"
            value={customRange}
            onChange={(vals) => {
              if (vals && vals[0] && vals[1]) {
                setCustomRange(vals);
                setRange('custom');
                if (selectedYear !== 'all' || selectedMonth !== 'all') {
                  setSelectedYear('all');
                  setSelectedMonth('all');
                }
              } else {
                setCustomRange(null);
                if (range === 'custom') setRange('1w'); // default to last week on clear
              }
            }}
          />
        </FilterGroup>
      }
    >
      {error && (
        <div style={{ marginBottom: 12 }}>
          <Alert
            type="error"
            message="Failed to load hourly station data"
            description={error}
            showIcon
            action={<Button size="small" onClick={retry} loading={retrying}>Retry</Button>}
          />
        </div>
      )}
      {!error && loading && (
        <div className="flex items-center gap-2"><Spin size="small" /><span>Loading chart…</span></div>
      )}
      {/* Active month/year label with clear filters */}
      {!loading && !error && (
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
          <div style={{ fontSize: 12, color: 'var(--aqm-muted)' }}>
            {(() => {
              const label = (() => {
                if (range === 'custom' && customRange && customRange[0] && customRange[1]) {
                  const s = customRange[0].format('MM/DD/YYYY');
                  const e = customRange[1].format('MM/DD/YYYY');
                  return `Showing: Custom ${s} – ${e}`;
                }
                if (selectedYear !== 'all' && selectedMonth !== 'all') {
                  return `Showing: ${['January','February','March','April','May','June','July','August','September','October','November','December'][selectedMonth-1]} ${selectedYear}`;
                }
                if (range === '12h') return 'Showing: Last 12 hours';
                if (range === '1d') return 'Showing: Last 1 day';
                if (range === '1w') return 'Showing: Last 1 week';
                if (range === '1m') return 'Showing: Last 1 month';
                return 'Showing: All data';
              })();
              const pts = filtered || [];
              if (!pts.length) return label;
              const nums = pts.map(p => Number(p.y)).filter(Number.isFinite);
              if (!nums.length) return label;
              const sum = nums.reduce((a,b)=>a+b,0);
              const avg = sum/nums.length;
              const min = Math.min(...nums);
              const max = Math.max(...nums);
              const last = nums[nums.length-1];
              const c = classify(last);
              return `${label} — ${nums.length} hourly readings. Average ${avg.toFixed(1)} µg/Ncm (min ${min}, max ${max}). Latest reading: ${last} µg/Ncm (${c.name}).`;
            })()}
          </div>
          {(selectedYear !== 'all' || selectedMonth !== 'all') && (
            <Button size="small" type="link" onClick={() => { setSelectedYear('all'); setSelectedMonth('all'); }}>Clear filters</Button>
          )}
        </div>
      )}
      {!loading && !error && filtered.length === 0 && (
        <Alert type="warning" message="No data in selected range" showIcon />
      )}

      {!error && filtered.length > 0 && (
        <div ref={containerRef} className="aqm-chart-height-hourly" style={{ width: '100%', position: 'relative', minWidth: 0 }}>
          {lastPoint && (
            <div
              ref={tileRef}
              onMouseDown={onTileMouseDown}
              style={{
                position: 'absolute',
                left: tilePos.left,
                top: tilePos.top,
                cursor: 'move',
                zIndex: 5,
                background: 'var(--aqm-panel-bg)',
                border: '1px solid var(--aqm-panel-border)',
                borderRadius: 12,
                padding: 12,
                boxShadow: '0 6px 16px var(--aqm-panel-shadow)',
                userSelect: 'none',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                <span className="aqm-dot" style={{ background: lastClass.color }} />
                <span style={{ fontSize: 13, fontWeight: 600 }}>{lastClass.name}</span>
              </div>
              <div style={{ fontSize: 12, color: 'var(--aqm-muted)' }}>{formatDateTime(lastPoint.t)}</div>
              <div style={{ fontSize: 13 }}>
                Hourly Reading: <strong style={{ color: lastClass.color }}>{lastPoint.y}</strong>{' '}
                <span style={{ color: 'var(--aqm-muted)' }}>µg/Ncm</span>
              </div>
            </div>
          )}
          <ResponsiveContainer>
            <LineChart data={segmented} margin={{ top: 10, right: 8, bottom: 12, left: 0 }}>
              {/* Dynamic gradient definition for category transitions */}
              <defs>
                <linearGradient id="pm10Gradient" x1="0" y1="0" x2="1" y2="0">
                  {gradientStops.map((s) => (
                    <stop key={s.offset} offset={s.offset} stopColor={s.color} />
                  ))}
                </linearGradient>
              </defs>
              
              {/* Threshold bands as background shading */}
              {THRESHOLDS.map((b, idx) => (
                <ReferenceArea key={b.name+idx} y1={b.min} y2={b.max} fill={b.color} fillOpacity={0.08} strokeOpacity={0} />
              ))}

              <CartesianGrid strokeDasharray="3 3" stroke="var(--aqm-panel-border)" strokeOpacity={0.5} />
              <XAxis dataKey="t" tickFormatter={formatDateTime} minTickGap={32} stroke="var(--aqm-panel-border)" tick={{ fill: 'var(--aqm-muted)', fontSize: 10 }} />
              <YAxis
                width={64}
                domain={[0, (dataMax) => Math.ceil((dataMax || 0) * 1.05) || 10]}
                stroke="var(--aqm-panel-border)"
                tick={{ fill: 'var(--aqm-muted)', fontSize: 11 }}
                label={{ value: 'µg/Ncm', angle: -90, position: 'insideLeft', offset: 10, fill: 'var(--aqm-muted)' }}
              />
              <Tooltip
                content={(props) => {
                  function SingleValueTooltip({ active, label, payload }) {
                    if (!active || !payload || payload.length === 0) return null;
                    const itemY = payload.find((p) => p && p.dataKey === 'y' && p.value != null);
                    const itemSeg = payload.find((p) => p && /^y_b\d+$/.test(String(p.dataKey)) && p.value != null);
                    const item = itemY || itemSeg || payload.find((p) => p && p.value != null);
                    if (!item) return null;
                    const value = item.value;
                    const color = classify(Number(value))?.color || 'var(--aqm-primary)';
                    const when = formatDateTime(label);
                    const yLabel = meta?.yLabel;
                    const name = (!yLabel || /_+EMPTY/i.test(yLabel) || /EMPTY/i.test(yLabel)) ? 'Hourly Reading' : yLabel;
                    return (
                      <div style={{ background: 'var(--aqm-panel-bg)', border: '1px solid ' + 'var(--aqm-panel-border)', borderRadius: 8, padding: 8 }}>
                        <div style={{ fontSize: 11, color: 'var(--aqm-muted)', marginBottom: 4 }}>{when}</div>
                        <div style={{ fontSize: 12 }}>
                          <span style={{ color: 'var(--aqm-muted)', marginRight: 6 }}>{name}:</span>
                          <strong style={{ color }}>{value}</strong>
                          <span style={{ color: 'var(--aqm-muted)', marginLeft: 4 }}>µg/Ncm</span>
                        </div>
                      </div>
                    );
                  }
                  return <SingleValueTooltip {...props} />;
                }}
                wrapperStyle={{ outline: 'none' }}
              />
              {/* Threshold separators */}
              {THRESHOLDS.map((b,i) => (
                <ReferenceLine key={b.name+"-sep"} y={b.max} stroke="var(--aqm-panel-border)" strokeDasharray="3 3" strokeOpacity={0.5} />
              ))}

              {/* Single gradient stroke line so transitions between categories are colored, not gray */}
              <Line
                type="monotone"
                dataKey="y"
                name={(!meta?.yLabel || /_+EMPTY/i.test(meta.yLabel) || /EMPTY/i.test(meta.yLabel)) ? 'Hourly Reading:' : meta?.yLabel}
                stroke="url(#pm10Gradient)"
                strokeWidth={2.2}
                connectNulls
                dot={<BlinkingLastDot enabled={!!lastPoint} dataLength={filtered.length} color={lastClass.color} />}
                activeDot={{ r: 3 }}
                isAnimationActive={false}
              />

              {lastPoint && (
                <Customized
                  component={(props) => {
                    try {
                      const xKey = Object.keys(props.xAxisMap || {})[0];
                      const yKey2 = Object.keys(props.yAxisMap || {})[0];
                      const xAxis = props.xAxisMap?.[xKey];
                      const yAxis = props.yAxisMap?.[yKey2];
                      if (!xAxis || !yAxis) return null;
                      const x = xAxis?.scale?.(lastPoint.t);
                      const y = yAxis?.scale?.(lastPoint.y);
                      if (!isFinite(x) || !isFinite(y)) return null;
                      const x1 = x + (props.offset?.left || 0);
                      const y1 = y + (props.offset?.top || 0);
                      const t = tileRef.current;
                      if (!t) return null;
                      const tw = t.clientWidth || 0;
                      const th = t.clientHeight || 0;
                      const rect = { l: tilePos.left, t: tilePos.top, r: tilePos.left + tw, b: tilePos.top + th };
                      function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
                      let qx = clamp(x1, rect.l, rect.r);
                      let qy = clamp(y1, rect.t, rect.b);
                      if (x1 >= rect.l && x1 <= rect.r && y1 >= rect.t && y1 <= rect.b) {
                        const dl = Math.abs(x1 - rect.l), dr = Math.abs(rect.r - x1);
                        const dt = Math.abs(y1 - rect.t), db = Math.abs(rect.b - y1);
                        const m = Math.min(dl, dr, dt, db);
                        if (m === dl) { qx = rect.l; qy = y1; }
                        else if (m === dr) { qx = rect.r; qy = y1; }
                        else if (m === dt) { qx = x1; qy = rect.t; }
                        else { qx = x1; qy = rect.b; }
                      }
                      const x2 = qx, y2 = qy;
                      const dx = x2 - x1, dy = y2 - y1;
                      const len = Math.sqrt(dx*dx + dy*dy) || 1;
                      const ux = dx/len, uy = dy/len;
                      const headLen = Math.min(12, Math.max(8, len*0.08));
                      const inset = 6;
                      const hx = x2 - ux * inset, hy = y2 - uy * inset;
                      const bx = x2 - ux * (headLen + inset), by = y2 - uy * (headLen + inset);
                      const perpX = -uy, perpY = ux;
                      const w = 5;
                      const a1x = bx + perpX * w, a1y = by + perpY * w;
                      const a2x = bx - perpX * w, a2y = by - perpY * w;
                      return (
                        <g pointerEvents="none">
                          <line x1={x1} y1={y1} x2={x2} y2={y2} stroke="#ffffff" strokeWidth={4} strokeOpacity={0.6} />
                          <line x1={x1} y1={y1} x2={x2} y2={y2} stroke={lastClass.color} strokeWidth={2} />
                          <polygon points={`${hx},${hy} ${a1x},${a1y} ${a2x},${a2y}`} fill={lastClass.color} fillOpacity={0.95} />
                        </g>
                      );
                    } catch { return null; }
                  }}
                />
              )}

              {/* Zoom brush (theme-aware) */}
              <Brush
                dataKey="t"
                height={28}
                travellerWidth={12}
                stroke="var(--aqm-panel-border)"
                fill="var(--aqm-panel-bg)"
                startIndex={brushRange?.startIndex}
                endIndex={brushRange?.endIndex}
                onChange={(e) => {
                  if (e && typeof e.startIndex === 'number' && typeof e.endIndex === 'number') {
                    // Throttle updates via rAF for smoother interaction
                    if (!Pm10Chart.__raf) Pm10Chart.__raf = { id: 0, pending: null };
                    Pm10Chart.__raf.pending = { startIndex: e.startIndex, endIndex: e.endIndex };
                    if (!Pm10Chart.__raf.id) {
                      Pm10Chart.__raf.id = requestAnimationFrame(() => {
                        setBrushRange(Pm10Chart.__raf.pending);
                        Pm10Chart.__raf.id = 0;
                      });
                    }
                  }
                }}
                tickFormatter={formatDateTime}
              >
                {/* Mini preview to improve usability */}
                <LineChart data={filtered}>
                  <Line type="monotone" dataKey="y" stroke="var(--aqm-muted)" strokeOpacity={0.6} dot={false} strokeWidth={1} />
                </LineChart>
              </Brush>
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}
    </Card>
  );
}
