import { useEffect, useState } from "react";
import { Card, Alert, Spin, Skeleton, Select } from "antd";
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
  const [state, setState] = useState({ loading: true, refreshing: false, error: null, data: [], meta: null });
  useEffect(() => {
    let cancelled = false;
    const base = import.meta.env.VITE_API_BASE || "http://localhost:3001";
    async function run() {
      setState((s) => ({ ...s, loading: (s.data && s.data.length) ? false : true, refreshing: (s.data && s.data.length) ? true : false, error: null }));
      try {
        const url = new URL("/api/viz-data", base);
        if (yKey) url.searchParams.set("yKey", yKey);
        const res = await fetch(url.toString());
        if (!res.ok) throw new Error(`API ${res.status}`);
        const json = await res.json();
        if (!cancelled)
          setState({ loading: false, refreshing: false, error: null, data: json.series || [], meta: json.meta || null });
      } catch (e) {
        if (!cancelled)
          setState((s) => ({ ...s, loading: false, refreshing: false, error: e.message || "Failed to load" }));
      }
    }
    run();
    const id = setInterval(run, 60_000); // refresh every minute
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [yKey]);
  return state;
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

function BlinkingLastDot(props) {
  const { cx, cy, index, dataLength, color } = props;
  if (index !== dataLength - 1) return null;
  return <circle cx={cx} cy={cy} r={4} className="blink-dot" fill={color || "#ff4d4f"} stroke="none" />;
}

export default function VizChart({ title = "viz_data • 24 HR AQI Value", yKey, variant = 'card' }) {
  const { loading, refreshing, error, data } = useVizData(yKey);
  const displayYLabel = "24 HR AQI Value";
  const THRESHOLDS = [
    { name: 'GOOD', min: 0.0, max: 50.99, color: '#08979c' },
    { name: 'FAIR', min: 51.0, max: 100.99, color: '#d4b106' },
    { name: 'UNHEALTHY', min: 101.0, max: 150.99, color: '#cf1322' },
    { name: 'VERY UNHEALTHY', min: 151.0, max: 200.99, color: '#531dab' },
    { name: 'ACUTELY UNHEALTHY', min: 201.0, max: 300.99, color: '#fa8c16' },
    { name: 'EMERGENCY', min: 301.0, max: 400.99, color: '#ff4d4f' },
  ];

  function classify(val) {
    if (val == null || !isFinite(val)) return { name: '—', color: 'var(--aqm-muted)' };
    if (val >= 301) return { name: 'EMERGENCY', color: '#ff4d4f' };
    if (val >= 201) return { name: 'ACUTELY UNHEALTHY', color: '#fa8c16' };
    if (val >= 151) return { name: 'VERY UNHEALTHY', color: '#531dab' };
    if (val >= 101) return { name: 'UNHEALTHY', color: '#cf1322' };
    if (val >= 51) return { name: 'FAIR', color: '#d4b106' };
    return { name: 'GOOD', color: '#08979c' };
  }

  const yMax = 400.99;
  const yDomain = [0, Math.ceil(yMax + 0.01)];
  const [range, setRange] = useState('all'); // 'all' | '7d' | '30d'

  function filterByRange(arr, r) {
    if (!Array.isArray(arr) || arr.length === 0) return arr || [];
    if (r === 'all') return arr;
    function parseTs(v) {
      if (typeof v === 'number') return v;
      if (typeof v === 'string') {
        // ISO-like: YYYY-MM-DD or with time
        if (/^\d{4}-\d{2}-\d{2}/.test(v)) {
          const n = Date.parse(v);
          if (isFinite(n)) return n;
        }
        // US date: MM/DD/YYYY (optionally followed by time)
        if (/^\d{1,2}\/\d{1,2}\/\d{4}/.test(v)) {
          const [mdy] = v.split(/\s+/);
          const [mm, dd, yyyy] = mdy.split('/').map(Number);
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
    const windowMs = r === '7d' ? 7*24*60*60*1000 : 30*24*60*60*1000;
    const cutoff = lastTs - windowMs;
    return arr.filter((it) => {
      const ts = parseTs(it.t);
      return isFinite(ts) && ts >= cutoff && ts <= lastTs;
    });
  }

  const filtered = filterByRange(data, range);
  const firstX = (filtered && filtered.length > 0) ? filtered[0].t : undefined;
  const lastX = (filtered && filtered.length > 0) ? filtered[filtered.length - 1].t : undefined;
  const lastPoint = (filtered && filtered.length > 0) ? filtered[filtered.length - 1] : null;
  const lastClass = classify(lastPoint?.y);

  // Floating tile drag + line-to-point
  const containerRef = useRef(null);
  const tileRef = useRef(null);
  const positionedRef = useRef(false);
  const [tilePos, setTilePos] = useState({ left: 8, top: 8 }); // default visible
  const [anchorPos, setAnchorPos] = useState(null); // {x, y}

  // Initialize tile position to top-right after first render with sizes known
  useEffect(() => {
    if (!containerRef.current || !tileRef.current || positionedRef.current || !lastPoint) return;
    const c = containerRef.current;
    const t = tileRef.current;
    const cw = c.clientWidth || 0;
    const tw = t.clientWidth || 0;
    const left = Math.max(8, cw - tw - 8);
    const top = 8;
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
    const minLeft = 4, minTop = 4, maxLeft = Math.max(4, cw - tw - 4), maxTop = Math.max(4, ch - th - 4);

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

  // No area fill; plain line stroke using theme primary

  const ChartBody = (
    <>
      {error && <Alert type="error" message="Failed to load viz_data" description={error} showIcon />}
      {!error && (loading && (!data || data.length === 0)) && (
        <div className="flex items-center gap-2">
          <Spin size="small" />
          <span>Loading chart…</span>
        </div>
      )}
      {!loading && !error && data.length === 0 && (
        <Alert type="warning" message="No data" description="Could not find rows in the viz_data sheet." showIcon />
      )}
      {/* Controls */}
      {!error && (
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 8 }}>
          <Select
            size="small"
            value={range}
            onChange={setRange}
            style={{ width: 160 }}
            options={[
              { value: 'all', label: 'All data' },
              { value: '7d', label: 'Last 7 days' },
              { value: '30d', label: 'Last 30 days' },
            ]}
          />
        </div>
      )}

      {!loading && !error && filtered.length === 0 && (
        <Alert type="warning" message="No data in selected range" showIcon />
      )}

      {(!loading || (filtered && filtered.length > 0)) && !error && filtered.length > 0 && (
        <div ref={containerRef} style={{ width: "100%", height: 360, position: 'relative' }}>
          {/* Draggable floating tile for last point */}
          {lastPoint && (
            <div
              ref={tileRef}
              onMouseDown={onTileMouseDown}
              style={{ position: 'absolute', left: tilePos.left, top: tilePos.top, cursor: 'move', zIndex: 5, background: 'var(--aqm-panel-bg)', border: '1px solid var(--aqm-panel-border)', borderRadius: 10, padding: 8, boxShadow: '0 4px 12px var(--aqm-panel-shadow)', userSelect: 'none' }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
                <span className="aqm-dot" style={{ background: lastClass.color }} />
                <span style={{ fontSize: 12, fontWeight: 600 }}>{lastClass.name}</span>
              </div>
              <div style={{ fontSize: 11, color: 'var(--aqm-muted)' }}>{formatDateMMDDYYYY(lastPoint.t)}</div>
              <div style={{ fontSize: 12 }}>Value: <strong style={{ color: lastClass.color }}>{lastPoint.y}</strong></div>
            </div>
          )}
          <ResponsiveContainer>
            <LineChart data={filtered} margin={{ top: 10, right: 8, bottom: 0, left: 0 }}>
              {/* Threshold bands as background shading */}
              {firstX != null && lastX != null && (
                <>
                  {THRESHOLDS.map((b, idx) => (
                    <ReferenceArea key={idx} x1={firstX} x2={lastX} y1={b.min} y2={b.max} fill={b.color} fillOpacity={0.08} strokeOpacity={0} />
                  ))}
                </>
              )}

              <CartesianGrid strokeDasharray="3 3" strokeOpacity={0.25} />
              <XAxis dataKey="t" tickFormatter={formatDateMMDDYYYY} minTickGap={32} strokeOpacity={0.6} />
              <YAxis domain={yDomain} width={56} strokeOpacity={0.6} label={{ value: displayYLabel, angle: -90, position: "insideLeft", offset: 10 }} />
              <Tooltip labelFormatter={(v) => formatDateMMDDYYYY(v)} formatter={(v) => [v, displayYLabel]} />

              {/* Threshold lines */}
              {[50.99, 100.99, 150.99, 200.99, 300.99, 400.99].map((y, i) => (
                <ReferenceLine key={i} y={y} stroke="#94a3b8" strokeDasharray="3 3" strokeOpacity={0.6} />
              ))}

              <Line
                type="monotone"
                dataKey="y"
                stroke="var(--aqm-primary)"
                strokeWidth={2}
                dot={<BlinkingLastDot dataLength={filtered.length} color={lastClass.color} />}
                isAnimationActive={false}
              />

              {/* Line pointing from last point to floating tile */}
              {lastPoint && (
                <Customized component={(props) => {
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
                    const rect = { l: tilePos.left, t: tilePos.top, r: tilePos.left + tw, b: tilePos.top + th };
                    function clamp(v, a, b){ return Math.max(a, Math.min(b, v)); }
                    let qx = clamp(x1, rect.l, rect.r);
                    let qy = clamp(y1, rect.t, rect.b);
                    // If projection falls inside the rect, snap to nearest edge
                    if (x1 >= rect.l && x1 <= rect.r && y1 >= rect.t && y1 <= rect.b) {
                      const dl = Math.abs(x1 - rect.l), dr = Math.abs(rect.r - x1);
                      const dt = Math.abs(y1 - rect.t), db = Math.abs(rect.b - y1);
                      const m = Math.min(dl, dr, dt, db);
                      if (m === dl) { qx = rect.l; qy = y1; }
                      else if (m === dr) { qx = rect.r; qy = y1; }
                      else if (m === dt) { qx = x1; qy = rect.t; }
                      else { qx = x1; qy = rect.b; }
                    }
                    const x2 = qx; const y2 = qy;
                    // Arrow head near the tile side
                    const dx = x2 - x1;
                    const dy = y2 - y1;
                    const len = Math.sqrt(dx*dx + dy*dy) || 1;
                    const ux = dx / len, uy = dy / len;
                    const headLen = Math.min(12, Math.max(8, len * 0.08));
                    // Nudge arrowhead slightly inside towards the tile
                    const inset = 6;
                    const hx = x2 - ux * inset;
                    const hy = y2 - uy * inset;
                    const bx = x2 - ux * (headLen + inset);
                    const by = y2 - uy * (headLen + inset);
                    // perpendicular for arrow width
                    const perpX = -uy, perpY = ux;
                    const w = 5;
                    const a1x = bx + perpX * w;
                    const a1y = by + perpY * w;
                    const a2x = bx - perpX * w;
                    const a2y = by - perpY * w;
                    return (
                      <g pointerEvents="none">
                        {/* white underlay for visibility */}
                        <line x1={x1} y1={y1} x2={x2} y2={y2} stroke="#ffffff" strokeWidth={4} strokeOpacity={0.6} />
                        {/* colored line on top */}
                        <line x1={x1} y1={y1} x2={x2} y2={y2} stroke={lastClass.color} strokeWidth={2} />
                        {/* arrow head triangle near tile */}
                        <polygon points={`${hx},${hy} ${a1x},${a1y} ${a2x},${a2y}`} fill={lastClass.color} fillOpacity={0.95} />
                      </g>
                    );
                  } catch {
                    return null;
                  }
                }} />
              )}

              {/* Brush for zooming */}
              <Brush dataKey="t" height={22} travellerWidth={8} stroke="#94a3b8" tickFormatter={formatDateMMDDYYYY} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* Category legend (single-line pill badges) */}
      {!loading && !error && (
        <div className="mt-2" style={{
          display: 'flex', flexWrap: 'nowrap', gap: 6,
          background: 'var(--aqm-panel-bg)', border: '1px solid var(--aqm-panel-border)',
          borderRadius: 10, padding: '6px 8px',
          whiteSpace: 'nowrap', overflowX: 'auto', overflowY: 'hidden'
        }}>
          {THRESHOLDS.map((b) => (
            <div key={b.name} style={{
              display: 'inline-flex', alignItems: 'center', gap: 6,
              padding: '3px 6px', borderRadius: 9999,
              background: `linear-gradient(135deg, rgba(0,0,0,0) 0%, ${b.color}18 100%)`,
              border: `1px solid ${b.color}44`
            }}>
              <span style={{ width: 8, height: 8, borderRadius: 9999, background: b.color, display: 'inline-block' }} />
              <span style={{ fontSize: 11, fontWeight: 600 }}>{b.name}</span>
              <span style={{ fontSize: 10, color: 'var(--aqm-muted)' }}>({b.min}–{b.max})</span>
            </div>
          ))}
        </div>
      )}

      {/* Move last point details into floating tile above */}
    </>
  );

  if (variant === 'tile') {
    return (
      <div className="aqm-tile">
        <div className="aqm-tile-header">{title}</div>
        {refreshing && <Spin size="small" className="aqm-tile-spinner" />}
        <div className="aqm-tile-body">
          {ChartBody}
        </div>
      </div>
    );
  }

  return (
    <Card title={title} size="small">
      {ChartBody}
    </Card>
  );
}
