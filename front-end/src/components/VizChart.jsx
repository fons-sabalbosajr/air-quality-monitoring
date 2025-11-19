import { useEffect, useState, useMemo } from "react";
import { useApiEndpoint } from "../util/apiClient";
import { getApiBase } from "../util/apiBase";
import { Card, Alert, Spin, Skeleton, Select, DatePicker, Button } from "antd";
import { useRef } from "react";
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  ReferenceLine,
  ReferenceArea,
  Brush,
  Customized,
} from "recharts";

function useVizData(yKey) {
  return useApiEndpoint('/api/viz-data', {
    params: yKey ? { yKey } : undefined,
    refreshMs: 300000,
    retries: 3,
    timeoutMs: 60000,
    cacheKey: yKey ? `viz:${yKey}` : 'viz:default',
    cacheTtlMs: 120000,
  });
}

function formatDateMMDDYYYY(ts) {
  try {
    const d = new Date(ts);
    const mm = String(d.getMonth() + 1).padStart(2, "0");
    const dd = String(d.getDate()).padStart(2, "0");
    const yyyy = d.getFullYear();
    return `${mm}/${dd}/${yyyy}`;
  } catch {
    return ts;
  }
}

function formatDateTime(ts) {
  try {
    const d = new Date(ts);
    const mm = String(d.getMonth() + 1).padStart(2, "0");
    const dd = String(d.getDate()).padStart(2, "0");
    const yyyy = d.getFullYear();
    const hh = String(d.getHours()).padStart(2, "0");
    const min = String(d.getMinutes()).padStart(2, "0");
    return `${mm}/${dd}/${yyyy} ${hh}:${min}`;
  } catch {
    return formatDateMMDDYYYY(ts);
  }
}

function BlinkingLastDot(props) {
  const { cx, cy, index, dataLength, color, enabled = true } = props;
  if (!enabled || index !== dataLength - 1) return null;
  return (
    <circle
      cx={cx}
      cy={cy}
      r={4}
      className="blink-dot"
      fill={color || "#ff4d4f"}
      stroke="none"
    />
  );
}

export default function VizChart({
  title = "Air Quality Monitoring Daily Average (µg/Ncm)",
  yKey,
  variant = "card",
  defaultRange,
  autoRefresh = true,
}) {
  const { loading, refreshing, error, data, retry, retrying } = useVizData(yKey, autoRefresh);
  const displayYLabel = "24 HR AQI Value";
  const BASE_THRESHOLDS = [
    { name: "GOOD", min: 0.0, max: 50.99, color: "#52c41a" },
    { name: "FAIR", min: 51.0, max: 100.99, color: "#d4b106" },
    { name: "UNHEALTHY", min: 101.0, max: 150.99, color: "#fa8c16" },
    { name: "VERY UNHEALTHY", min: 151.0, max: 200.99, color: "#f5222d" },
    { name: "ACUTELY UNHEALTHY", min: 201.0, max: 300.99, color: "#722ed1" },
    { name: "EMERGENCY", min: 301.0, max: 400.99, color: "#a8071a" },
  ];

  function classify(val) {
    if (val == null || !isFinite(val))
      return { name: "—", color: "var(--aqm-muted)" };
    if (val >= 301) return { name: "EMERGENCY", color: "#a8071a" };
    if (val >= 201) return { name: "ACUTELY UNHEALTHY", color: "#722ed1" };
    if (val >= 151) return { name: "VERY UNHEALTHY", color: "#f5222d" };
    if (val >= 101) return { name: "UNHEALTHY", color: "#fa8c16" };
    if (val >= 51) return { name: "FAIR", color: "#d4b106" };
    return { name: "GOOD", color: "#52c41a" };
  }

  const [range, setRange] = useState(defaultRange || "all"); // 'all' | '7d' | '30d' | 'custom'
  const [customRange, setCustomRange] = useState(null); // [dayjs, dayjs] | null

  function filterByRange(arr, r) {
    if (!Array.isArray(arr) || arr.length === 0) return arr || [];
    if (r === "all") return arr;
    function parseTs(v) {
      if (typeof v === "number") return v;
      if (typeof v === "string") {
        // ISO-like: YYYY-MM-DD or with time
        if (/^\d{4}-\d{2}-\d{2}/.test(v)) {
          const n = Date.parse(v);
          if (isFinite(n)) return n;
        }
        // US date: MM/DD/YYYY (optionally followed by time)
        if (/^\d{1,2}\/\d{1,2}\/\d{4}/.test(v)) {
          const [mdy] = v.split(/\s+/);
          const [mm, dd, yyyy] = mdy.split("/").map(Number);
          const n = new Date(yyyy, (mm || 1) - 1, dd || 1).getTime();
          if (isFinite(n)) return n;
        }
        const n = Date.parse(v);
        if (isFinite(n)) return n;
      }
      return NaN;
    }
    // Anchor window to the last data point, not 'now'
    const lastTs = arr.reduce((max, it) => {
      const ts = parseTs(it.t);
      return isFinite(ts) && ts > max ? ts : max;
    }, -Infinity);
    if (!isFinite(lastTs)) return arr;
    const windowMs =
      r === "7d" ? 7 * 24 * 60 * 60 * 1000 : 30 * 24 * 60 * 60 * 1000;
    const cutoff = lastTs - windowMs;
    return arr.filter((it) => {
      const ts = parseTs(it.t);
      return isFinite(ts) && ts >= cutoff && ts <= lastTs;
    });
  }

  function filterByCustom(arr, dr) {
    if (!Array.isArray(arr) || arr.length === 0) return arr || [];
    if (!dr || !dr[0] || !dr[1]) return arr;
    try {
      const start = dr[0].startOf('day').valueOf();
      const end = dr[1].endOf('day').valueOf();
      function parseTs(v) {
        if (typeof v === 'number') return v;
        const n = Date.parse(v);
        return isFinite(n) ? n : NaN;
      }
      return arr.filter(it => {
        const ts = parseTs(it.t);
        return isFinite(ts) && ts >= start && ts <= end;
      });
    } catch {
      return arr;
    }
  }

  const filtered = (range === 'custom' && customRange)
    ? filterByCustom(data, customRange)
    : filterByRange(data, range);
  // Dynamic Y-axis max based on highest reading in current filtered range (ignores static threshold cap)
  const filteredMax = useMemo(() => {
    const vals = filtered.map((p) => Number(p.y)).filter((v) => isFinite(v));
    if (!vals.length) return 0;
    return Math.max(...vals);
  }, [filtered]);
  // Add a small 5% headroom so the top point is not glued to the top edge
  const dynamicMaxRaw = filteredMax * 1.05;
  const dynamicMax = dynamicMaxRaw > 0 ? dynamicMaxRaw : 10;
  // Extend last threshold band if dynamic max exceeds configured emergency max
  const THRESHOLDS = useMemo(() => {
    const maxConfigured = BASE_THRESHOLDS[BASE_THRESHOLDS.length - 1].max;
    if (dynamicMax > maxConfigured) {
      return BASE_THRESHOLDS.map((t, idx) =>
        idx === BASE_THRESHOLDS.length - 1 ? { ...t, max: dynamicMax } : t
      );
    }
    return BASE_THRESHOLDS;
  }, [dynamicMax]);
  const yDomain = [0, Math.ceil(dynamicMax)];
  const firstX = filtered && filtered.length > 0 ? filtered[0].t : undefined;
  const lastX =
    filtered && filtered.length > 0
      ? filtered[filtered.length - 1].t
      : undefined;
  const lastPoint =
    filtered && filtered.length > 0 ? filtered[filtered.length - 1] : null;
  const lastClass = classify(lastPoint?.y);
  // Removed gradient/clip id: switching to multiple Line series for threshold colors
  // Preserve Brush zoom across refresh
  const [brushRange, setBrushRange] = useState(null); // {startIndex, endIndex}
  useEffect(() => {
    // Clamp persisted brush indices when data length changes
    if (!brushRange) return;
    const n = filtered?.length ?? 0;
    if (!n) return;
    const ns = Math.max(0, Math.min(brushRange.startIndex ?? 0, n - 1));
    const ne = Math.max(ns, Math.min(brushRange.endIndex ?? n - 1, n - 1));
    if (
      ns !== (brushRange.startIndex ?? 0) ||
      ne !== (brushRange.endIndex ?? 0)
    ) {
      setBrushRange({ startIndex: ns, endIndex: ne });
    }
  }, [filtered?.length]);

  // Reset brush when switching to/from a custom date range for clarity
  useEffect(() => {
    setBrushRange(null);
  }, [customRange, range]);

  // Create per-threshold segmented series so the line changes color across ranges
  const segmented = useMemo(
    () =>
      filtered.map((p) => {
        const o = { ...p };
        THRESHOLDS.forEach((b, i) => {
          const key = `y_b${i}`;
          o[key] = p.y >= b.min && p.y <= b.max ? p.y : null;
        });
        return o;
      }),
    [filtered, THRESHOLDS]
  );

  // Floating tile drag + line-to-point
  const containerRef = useRef(null);
  const tileRef = useRef(null);
  const positionedRef = useRef(false);
  const [tilePos, setTilePos] = useState({ left: 24, top: 12 }); // increased left margin
  const [anchorPos, setAnchorPos] = useState(null); // {x, y}

  // Initialize tile position to top-right after first render with sizes known
  useEffect(() => {
    if (
      !containerRef.current ||
      !tileRef.current ||
      positionedRef.current ||
      !lastPoint
    )
      return;
    const c = containerRef.current;
    const t = tileRef.current;
    // Place inside the plotting area on the top-right with safe margins.
    const cw = c.clientWidth || 0;
    const tw = t.clientWidth || 0;
    const safeLeftMargin = 24; // minimum distance from left edge
    const rightMargin = 15; // distance from right edge
    const left = Math.max(safeLeftMargin, cw - tw - rightMargin); // push to right side
    const top = 12;
    setTilePos({ left, top });
    positionedRef.current = true;
  }, [lastPoint]);

  // Update anchor position whenever tile moves or sizes change
  useEffect(() => {
    const c = containerRef.current;
    const t = tileRef.current;
    if (!c || !t || !tilePos) return;
    const ax = tilePos.left + (t.clientWidth || 0) / 2;
    const ay = tilePos.top + (t.clientHeight || 0) / 2;
    setAnchorPos({ x: ax, y: ay });
  }, [tilePos, filtered?.length]);

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
  const safeLeftMargin = 24; // drag boundary (allow closer to left if user wants)
    const safeTopMargin = 8;
    const minLeft = safeLeftMargin,
      minTop = safeTopMargin,
      maxLeft = Math.max(safeLeftMargin, cw - tw - 4),
      maxTop = Math.max(safeTopMargin, ch - th - 4);

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
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", up);
    }
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
  }

  // No area fill; plain line stroke using theme primary

  const ChartBody = (
    <>
      {/* Custom single-value tooltip to avoid duplicate entries from base and segmented lines */}
      {(() => {
        // Define once per render; used by Tooltip below
        function SingleValueTooltip({ active, label, payload }) {
          if (!active || !payload || payload.length === 0) return null;
          // Prefer the base 'y' item; fallback to any non-null segmented value
          const itemY = payload.find(
            (p) => p && p.dataKey === "y" && p.value != null
          );
          const itemSeg = payload.find(
            (p) => p && /^y_b\d+$/.test(String(p.dataKey)) && p.value != null
          );
          const item =
            itemY || itemSeg || payload.find((p) => p && p.value != null);
          if (!item) return null;
          const value = item.value;
          const color = item.color || item.stroke || "var(--aqm-primary)";
          const when =
            variant === "card"
              ? formatDateTime(label)
              : formatDateMMDDYYYY(label);
          return (
            <div
              style={{
                background: "var(--aqm-panel-bg)",
                border: "1px solid var(--aqm-panel-border)",
                borderRadius: 8,
                padding: 8,
              }}
            >
              <div
                style={{
                  fontSize: 11,
                  color: "var(--aqm-muted)",
                  marginBottom: 4,
                }}
              >
                {when}
              </div>
              <div style={{ fontSize: 12 }}>
                <span style={{ color: "var(--aqm-muted)", marginRight: 6 }}>
                  {displayYLabel}:
                </span>
                <strong style={{ color }}>{value}</strong>
                <span style={{ color: "var(--aqm-muted)", marginLeft: 4 }}>
                  µg/Ncm
                </span>
              </div>
            </div>
          );
        }
        // Keep a reference to silence lints; actual render happens below
        return null;
      })()}
      {error && (
        <div style={{ marginBottom: 12 }}>
          <Alert
            type="error"
            message="Failed to load daily average data"
            description={error}
            showIcon
            action={<Button size="small" onClick={retry} loading={retrying}>Retry</Button>}
          />
        </div>
      )}
      {!error && loading && (!data || data.length === 0) && (
        <div className="flex items-center gap-2">
          <Spin size="small" />
          <span>Loading chart…</span>
        </div>
      )}
      {!loading && !error && data.length === 0 && (
        <Alert
          type="warning"
          message="No daily average data"
          description="No rows found in viz_data sheet."
          showIcon
          action={<Button size="small" onClick={retry} loading={retrying}>Retry</Button>}
        />
      )}
      {/* Threshold indicators at top */}
      {!error && (
        <div
          className="mt-2"
          style={{
            display: "flex",
            flexWrap: "nowrap",
            gap: 6,
            background: "var(--aqm-panel-bg)",
            border: "1px solid var(--aqm-panel-border)",
            borderRadius: 10,
            padding: "6px 8px",
            whiteSpace: "nowrap",
            overflowX: "auto",
            overflowY: "hidden",
            marginBottom: 8,
          }}
        >
          {THRESHOLDS.map((b) => (
            <div
              key={b.name}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
                padding: "3px 6px",
                borderRadius: 9999,
                background: `linear-gradient(135deg, rgba(0,0,0,0) 0%, ${b.color}18 100%)`,
                border: `1px solid ${b.color}44`,
              }}
            >
              <span
                style={{
                  width: 8,
                  height: 8,
                  borderRadius: 9999,
                  background: b.color,
                  display: "inline-block",
                }}
              />
              <span style={{ fontSize: 11, fontWeight: 600 }}>{b.name}</span>
              <span style={{ fontSize: 10, color: "var(--aqm-muted)" }}>
                ({b.min}–{b.max})
              </span>
            </div>
          ))}
        </div>
      )}

      {/* Header row: summary left, dropdown right */}
      {!error && (
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            gap: 8,
            marginBottom: 8,
            flexWrap: "wrap",
          }}
        >
          <div style={{ fontSize: 12, color: "var(--aqm-muted)" }}>
            {(() => {
              const rangeLabel = (() => {
                if (range === 'custom' && customRange && customRange[0] && customRange[1]) {
                  const s = customRange[0].format('MM/DD/YYYY');
                  const e = customRange[1].format('MM/DD/YYYY');
                  return `Custom: ${s} – ${e}`;
                }
                if (range === '7d') return 'Last 7 days';
                if (range === '30d') return 'Last 30 days';
                return 'All data';
              })();
              const pts = filtered || [];
              if (!pts.length) return `Showing: ${rangeLabel}`;
              const nums = pts.map((p) => Number(p.y)).filter(Number.isFinite);
              if (!nums.length) return `Showing: ${rangeLabel}`;
              const sum = nums.reduce((a, b) => a + b, 0);
              const avg = sum / nums.length;
              const min = Math.min(...nums);
              const max = Math.max(...nums);
              const last = nums[nums.length - 1];
              const c = classify(last);
              return `Showing: ${rangeLabel} — ${
                nums.length
              } daily readings. Average ${avg.toFixed(
                1
              )} µg/Ncm (min ${min}, max ${max}). Latest daily average: ${last} µg/Ncm (${
                c.name
              }).`;
            })()}
          </div>
          <div style={{ display: "flex", alignItems: "center" }}>
            <Select
              size="small"
              value={range}
              onChange={(v) => {
                setRange(v);
                if (v !== 'custom') setCustomRange(null);
              }}
              style={{ width: 160 }}
              options={[
                { value: "all", label: "All data" },
                { value: "7d", label: "Last 7 days" },
                { value: "30d", label: "Last 30 days" },
                { value: "custom", label: "Custom range" },
              ]}
            />
            <DatePicker.RangePicker
              allowClear
              size="small"
              style={{ marginLeft: 8 }}
              value={customRange}
              onChange={(vals) => {
                if (vals && vals[0] && vals[1]) {
                  setCustomRange(vals);
                  setRange('custom');
                } else {
                  setCustomRange(null);
                  if (range === 'custom') setRange('all');
                }
              }}
            />
          </div>
        </div>
      )}

      {!loading && !error && filtered.length === 0 && (
        <Alert type="warning" message="No data in selected range" showIcon />
      )}

      {(!loading || (filtered && filtered.length > 0)) &&
        !error &&
        filtered.length > 0 && (
          <div
            ref={containerRef}
            style={{
              width: "100%",
              height: 360,
              position: "relative",
              minWidth: 0,
            }}
          >
            {/* Draggable floating tile for last point */}
            {lastPoint && (
              <div
                ref={tileRef}
                onMouseDown={onTileMouseDown}
                style={{
                  position: "absolute",
                  left: tilePos.left,
                  top: tilePos.top,
                  cursor: "move",
                  zIndex: 5,
                  background: "var(--aqm-panel-bg)",
                  border: "1px solid var(--aqm-panel-border)",
                  borderRadius: 12,
                  padding: 12,
                  boxShadow: "0 6px 16px var(--aqm-panel-shadow)",
                  userSelect: "none",
                }}
              >
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    marginBottom: 6,
                  }}
                >
                  <span
                    className="aqm-dot"
                    style={{ background: lastClass.color }}
                  />
                  <span style={{ fontSize: 13, fontWeight: 600 }}>
                    {lastClass.name}
                  </span>
                </div>
                <div style={{ fontSize: 12, color: "var(--aqm-muted)" }}>
                  {variant === "card"
                    ? formatDateTime(lastPoint.t)
                    : formatDateMMDDYYYY(lastPoint.t)}
                </div>
                <div style={{ fontSize: 13 }}>
                  Value:{" "}
                  <strong style={{ color: lastClass.color }}>
                    {lastPoint.y}
                  </strong>{" "}
                  <span style={{ color: "var(--aqm-muted)" }}>µg/Ncm</span>
                </div>
              </div>
            )}
            <ResponsiveContainer>
              <LineChart
                data={segmented}
                margin={{ top: 10, right: 8, bottom: 12, left: 0 }}
              >
                {/* Threshold bands as background shading */}
                {THRESHOLDS.map((b, idx) => (
                  <ReferenceArea
                    key={idx}
                    y1={b.min}
                    y2={b.max}
                    fill={b.color}
                    fillOpacity={0.08}
                    strokeOpacity={0}
                  />
                ))}

                <CartesianGrid
                  strokeDasharray="3 3"
                  stroke="var(--aqm-panel-border)"
                  strokeOpacity={0.5}
                />
                <XAxis
                  dataKey="t"
                  tickFormatter={formatDateMMDDYYYY}
                  minTickGap={32}
                  stroke="var(--aqm-panel-border)"
                  tick={{ fill: "var(--aqm-muted)", fontSize: 10 }}
                />
                <YAxis
                  domain={yDomain}
                  width={56}
                  stroke="var(--aqm-panel-border)"
                  tick={{ fill: "var(--aqm-muted)" }}
                  label={{
                    value: displayYLabel,
                    angle: -90,
                    position: "insideLeft",
                    offset: 10,
                    fill: "var(--aqm-muted)",
                  }}
                />
                <Tooltip
                  content={(props) => {
                    // Inline wrapper to access closure variables
                    function SingleValueTooltip({ active, label, payload }) {
                      if (!active || !payload || payload.length === 0)
                        return null;
                      const itemY = payload.find(
                        (p) => p && p.dataKey === "y" && p.value != null
                      );
                      const itemSeg = payload.find(
                        (p) =>
                          p &&
                          /^y_b\d+$/.test(String(p.dataKey)) &&
                          p.value != null
                      );
                      const item =
                        itemY ||
                        itemSeg ||
                        payload.find((p) => p && p.value != null);
                      if (!item) return null;
                      const value = item.value;
                      // Color by threshold classification
                      const color =
                        classify(Number(item.value))?.color ||
                        "var(--aqm-primary)";
                      const when =
                        variant === "card"
                          ? formatDateTime(label)
                          : formatDateMMDDYYYY(label);
                      return (
                        <div
                          style={{
                            background: "var(--aqm-panel-bg)",
                            border: "1px solid var(--aqm-panel-border)",
                            borderRadius: 8,
                            padding: 8,
                          }}
                        >
                          <div
                            style={{
                              fontSize: 11,
                              color: "var(--aqm-muted)",
                              marginBottom: 4,
                            }}
                          >
                            {when}
                          </div>
                          <div style={{ fontSize: 12 }}>
                            <span
                              style={{
                                color: "var(--aqm-muted)",
                                marginRight: 6,
                              }}
                            >
                              {displayYLabel}:
                            </span>
                            <strong style={{ color }}>{value}</strong>
                            <span
                              style={{
                                color: "var(--aqm-muted)",
                                marginLeft: 4,
                              }}
                            >
                              µg/Ncm
                            </span>
                          </div>
                        </div>
                      );
                    }
                    return <SingleValueTooltip {...props} />;
                  }}
                  wrapperStyle={{ outline: "none" }}
                />

                {/* Threshold lines */}
                {THRESHOLDS.map((b, i) => (
                  <ReferenceLine
                    key={b.name + "-line"}
                    y={b.max}
                    stroke="var(--aqm-panel-border)"
                    strokeDasharray="3 3"
                    strokeOpacity={0.5}
                  />
                ))}

                {/* Base line (theme color) to ensure visibility even if custom renderer fails) */}
                <Line
                  type="monotone"
                  dataKey="y"
                  stroke="var(--aqm-primary)"
                  strokeOpacity={0.45}
                  strokeWidth={1.5}
                  connectNulls
                  dot={
                    <BlinkingLastDot
                      enabled={!!lastPoint}
                      dataLength={filtered.length}
                      color={lastClass.color}
                    />
                  }
                  activeDot={{ r: 3 }}
                  isAnimationActive={false}
                />

                {/* Per-threshold colored lines using segmented series */}
                {THRESHOLDS.map((b, i) => (
                  <Line
                    key={`segline-${i}`}
                    type="monotone"
                    dataKey={`y_b${i}`}
                    stroke={b.color}
                    strokeWidth={2}
                    dot={false}
                    connectNulls={false}
                    isAnimationActive={false}
                  />
                ))}

                {/* Line pointing from last point to floating tile */}
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
                        // Compute connector endpoint at nearest edge of the floating tile
                        const t = tileRef.current;
                        if (!t) return null;
                        const tw = t.clientWidth || 0;
                        const th = t.clientHeight || 0;
                        const rect = {
                          l: tilePos.left,
                          t: tilePos.top,
                          r: tilePos.left + tw,
                          b: tilePos.top + th,
                        };
                        function clamp(v, a, b) {
                          return Math.max(a, Math.min(b, v));
                        }
                        let qx = clamp(x1, rect.l, rect.r);
                        let qy = clamp(y1, rect.t, rect.b);
                        // If projection falls inside the rect, snap to nearest edge
                        if (
                          x1 >= rect.l &&
                          x1 <= rect.r &&
                          y1 >= rect.t &&
                          y1 <= rect.b
                        ) {
                          const dl = Math.abs(x1 - rect.l),
                            dr = Math.abs(rect.r - x1);
                          const dt = Math.abs(y1 - rect.t),
                            db = Math.abs(rect.b - y1);
                          const m = Math.min(dl, dr, dt, db);
                          if (m === dl) {
                            qx = rect.l;
                            qy = y1;
                          } else if (m === dr) {
                            qx = rect.r;
                            qy = y1;
                          } else if (m === dt) {
                            qx = x1;
                            qy = rect.t;
                          } else {
                            qx = x1;
                            qy = rect.b;
                          }
                        }
                        const x2 = qx;
                        const y2 = qy;
                        // Arrow head near the tile side
                        const dx = x2 - x1;
                        const dy = y2 - y1;
                        const len = Math.sqrt(dx * dx + dy * dy) || 1;
                        const ux = dx / len,
                          uy = dy / len;
                        const headLen = Math.min(12, Math.max(8, len * 0.08));
                        // Nudge arrowhead slightly inside towards the tile
                        const inset = 6;
                        const hx = x2 - ux * inset;
                        const hy = y2 - uy * inset;
                        const bx = x2 - ux * (headLen + inset);
                        const by = y2 - uy * (headLen + inset);
                        // perpendicular for arrow width
                        const perpX = -uy,
                          perpY = ux;
                        const w = 5;
                        const a1x = bx + perpX * w;
                        const a1y = by + perpY * w;
                        const a2x = bx - perpX * w;
                        const a2y = by - perpY * w;
                        return (
                          <g pointerEvents="none">
                            {/* white underlay for visibility */}
                            <line
                              x1={x1}
                              y1={y1}
                              x2={x2}
                              y2={y2}
                              stroke="#ffffff"
                              strokeWidth={4}
                              strokeOpacity={0.6}
                            />
                            {/* colored line on top */}
                            <line
                              x1={x1}
                              y1={y1}
                              x2={x2}
                              y2={y2}
                              stroke={lastClass.color}
                              strokeWidth={2}
                            />
                            {/* arrow head triangle near tile */}
                            <polygon
                              points={`${hx},${hy} ${a1x},${a1y} ${a2x},${a2y}`}
                              fill={lastClass.color}
                              fillOpacity={0.95}
                            />
                          </g>
                        );
                      } catch {
                        return null;
                      }
                    }}
                  />
                )}

                {/* Brush for zooming (theme-aware) */}
                <Brush
                  dataKey="t"
                  height={28}
                  travellerWidth={12}
                  stroke="var(--aqm-panel-border)"
                  fill="var(--aqm-panel-bg)"
                  startIndex={brushRange?.startIndex}
                  endIndex={brushRange?.endIndex}
                  onChange={(e) => {
                    if (
                      e &&
                      typeof e.startIndex === "number" &&
                      typeof e.endIndex === "number"
                    ) {
                      // Throttle updates via rAF for smoother interaction
                      if (!VizChart.__raf)
                        VizChart.__raf = { id: 0, pending: null };
                      VizChart.__raf.pending = {
                        startIndex: e.startIndex,
                        endIndex: e.endIndex,
                      };
                      if (!VizChart.__raf.id) {
                        VizChart.__raf.id = requestAnimationFrame(() => {
                          setBrushRange(VizChart.__raf.pending);
                          VizChart.__raf.id = 0;
                        });
                      }
                    }
                  }}
                  tickFormatter={formatDateMMDDYYYY}
                >
                  {/* Mini preview to improve selection */}
                  <LineChart data={filtered}>
                    <Line
                      type="monotone"
                      dataKey="y"
                      stroke="var(--aqm-muted)"
                      strokeOpacity={0.6}
                      dot={false}
                      strokeWidth={1}
                    />
                  </LineChart>
                </Brush>
              </LineChart>
            </ResponsiveContainer>
          </div>
        )}

      {/* Move last point details into floating tile above */}
    </>
  );

  if (variant === "tile") {
    return (
      <div className="aqm-tile">
        <div className="aqm-tile-header">{title}</div>
        {refreshing && <Spin size="small" className="aqm-tile-spinner" />}
        <div className="aqm-tile-body">{ChartBody}</div>
      </div>
    );
  }

  return (
    <Card
      title={<span style={{ color: "var(--aqm-muted)" }}>{title}</span>}
      size="small"
      style={{
        background: "var(--aqm-panel-bg)",
        border: "1px solid var(--aqm-panel-border)",
      }}
      styles={{
        header: {
          background: "var(--aqm-panel-bg)",
          borderBottom: "1px solid var(--aqm-panel-border)",
        },
        body: { background: "var(--aqm-panel-bg)" },
      }}
    >
      {ChartBody}
    </Card>
  );
}
