import { useEffect, useState, useMemo } from "react";
// getApiBase no longer needed here; API base handled by hook
import { Skeleton, Alert, Spin, Table, Card, Tag, DatePicker, Button } from "antd";
import dayjs from "dayjs";
import VizChart from "../components/VizChart";
import Pm10Chart from "../components/Pm10Chart";
import { useAqi } from "../context/AqiContext";
import { useApiEndpoint } from "../util/apiClient";
import FallbackPanel from "../components/FallbackPanel";

function useLatestAQI() {
  return useApiEndpoint('/api/aqi/latest', {
    refreshMs: 60000,
    retries: 2,
    timeoutMs: 12000,
    cacheTtlMs: 15000,
  });
}

function useStationCurrent() {
  return useApiEndpoint('/api/station/current', {
    refreshMs: 60000,
    retries: 2,
    timeoutMs: 10000,
    cacheTtlMs: 20000,
  });
}

function useStationForecast(days = 3) {
  return useApiEndpoint('/api/station/forecast', {
    params: { days },
    refreshMs: 600000, // 10 minutes
    retries: 2,
    timeoutMs: 12000,
    cacheTtlMs: 60000,
  });
}

function categoryTint(category) {
  const c = String(category || "").toUpperCase();
  if (c.includes("GOOD")) return "#52c41a"; // green
  if (c.includes("FAIR")) return "#d4b106"; // yellow
  if (c === "UNHEALTHY") return "#fa8c16"; // orange
  if (c.includes("VERY")) return "#f5222d"; // red (VERY UNHEALTHY)
  if (c.includes("ACUTELY")) return "#722ed1"; // purple
  if (c.includes("EMERGENCY") || c.includes("HAZARD")) return "#a8071a"; // maroon
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
  const { setCategory } = useAqi() || { setCategory: () => {} };
  const aqi = useLatestAQI();
  const station = useStationCurrent();
  const forecast = useStationForecast(3);
  const aqiDays = useAqiLastDays(3);
  const meta = useStationMeta();
  const [addrState, setAddrState] = useState({ loading: false, display: null });
  // Data for tables below charts
  // Tables data via resilient API hook
  const dailyData = useApiEndpoint('/api/viz-data', { retries: 3, timeoutMs: 60000, cacheTtlMs: 120000 });
  const hourlyData = useApiEndpoint('/api/pm10-data', { retries: 3, timeoutMs: 60000, cacheTtlMs: 90000 });
  const dailyRows = useMemo(() => Array.isArray(dailyData.data) ? dailyData.data : [], [dailyData.data]);
  const hourlyRows = useMemo(() => Array.isArray(hourlyData.data) ? hourlyData.data : [], [hourlyData.data]);
  // Date range filters (null = no filter)
  const [dailyRange, setDailyRange] = useState(null); // [startDayjs, endDayjs]
  const [hourlyRange, setHourlyRange] = useState(null);

  // Push latest AQI category to context for global UI (e.g., legend dot pulse)
  useEffect(() => {
    try {
      const cat = aqi?.data?.category || null;
      setCategory && setCategory(cat);
    } catch {}
  }, [aqi?.data?.category]);

  // Helpers
  function classify(y) {
    if (!isFinite(Number(y))) return { name: '—', color: 'default'};
    y = Number(y);
    if (y >= 301) return { name: 'EMERGENCY', color: '#a8071a' };
    if (y >= 201) return { name: 'ACUTELY UNHEALTHY', color: '#722ed1' };
    if (y >= 151) return { name: 'VERY UNHEALTHY', color: '#f5222d' };
    if (y >= 101) return { name: 'UNHEALTHY', color: '#fa8c16' };
    if (y >= 51) return { name: 'FAIR', color: '#d4b106' };
    return { name: 'GOOD', color: '#52c41a' };
  }

  function exportCSV(kind, rows) {
    if (!rows || !rows.length) return;
    const header = 'timestamp,value,status';
    const lines = rows.map(r => {
      const c = classify(r.y);
      return `${dayjs(r.t).toISOString()},${r.y},${c.name}`;
    });
    const csv = [header, ...lines].join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${kind}-export-${dayjs().format('YYYYMMDD-HHmmss')}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  // Resolve address for header: prefer .env address, fallback to reverse geocode via backend
  const lat = meta?.data?.latitude ?? station?.data?.latitude;
  const lon = meta?.data?.longitude ?? station?.data?.longitude;
  const rev = useApiEndpoint('/api/reverse-geocode', {
    params: { lat, lon },
    enabled: Number.isFinite(Number(lat)) && Number.isFinite(Number(lon)) && !(meta?.data?.address && meta.data.address.trim().length > 0),
    retries: 1,
    timeoutMs: 9000,
    cacheTtlMs: 300000,
    refreshMs: 0,
  });
  useEffect(() => {
    const hasAddr = !!meta?.data?.address && meta.data.address.trim().length > 0;
    const display = hasAddr ? meta.data.address : (rev?.data?.display || null);
    setAddrState({ loading: !hasAddr && !!rev.loading, display });
  }, [meta?.data?.address, rev.loading, rev?.data?.display]);

  // (Removed manual fetch; using hooks above)

  // Worst-case fallback: if core data does not load within 25s, show Power BI link with retry
  const [showFallback, setShowFallback] = useState(false);
  useEffect(() => {
    const id = setTimeout(() => {
      const noTables = dailyRows.length === 0 && hourlyRows.length === 0;
      const aqiFailed = !!aqi.error;
      const stationFailed = !!station.error && !!forecast.error;
      if (noTables && (aqiFailed || stationFailed)) setShowFallback(true);
    }, 25000);
    return () => clearTimeout(id);
  }, [dailyRows.length, hourlyRows.length, aqi.error, station.error, forecast.error]);

  // Show Power BI fallback button if ANY key data source has an error (soft fallback)
  const hasAnyError = [aqi.error, station.error, forecast.error, aqiDays.error, meta.error, dailyData.error, hourlyData.error].some(Boolean);
  const powerBiUrl = "https://app.powerbi.com/view?r=eyJrIjoiNjlhMWMxY2UtNDNjYi00NjQ4LTliNzYtNTM0NjU1OTY3ZDZlIiwidCI6ImY2ZjRhNjkyLTQzYjMtNDMzYi05MmIyLTY1YzRlNmNjZDkyMCIsImMiOjEwfQ%3D%3D&fbclid=IwY2xjawFB5F5leHRuA2FlbQIxMAABHUN0PdCwA3CeLh-6DJcav9RNTakWqqXb9tiX4NhZWuaoq6c9DFAjap_87A_aem_76ldAfP7LXMUux7n4bbWkA";

  // Apply sorting (recent first) + optional range filtering
  const dailyVisible = useMemo(() => {
    let rows = [...dailyRows];
    rows.sort((a,b)=> dayjs(b.t).valueOf() - dayjs(a.t).valueOf());
    if (dailyRange && Array.isArray(dailyRange) && dailyRange[0] && dailyRange[1]) {
      const [start,end] = dailyRange;
      rows = rows.filter(r => {
        const ts = dayjs(r.t);
        return (!start || !ts.isBefore(start, 'day')) && (!end || !ts.isAfter(end, 'day'));
      });
    }
    return rows;
  }, [dailyRows, dailyRange]);
  const hourlyVisible = useMemo(() => {
    let rows = [...hourlyRows];
    rows.sort((a,b)=> dayjs(b.t).valueOf() - dayjs(a.t).valueOf());
    if (hourlyRange && Array.isArray(hourlyRange) && hourlyRange[0] && hourlyRange[1]) {
      const [start,end] = hourlyRange;
      rows = rows.filter(r => {
        const ts = dayjs(r.t);
        return (!start || !ts.isBefore(start)) && (!end || !ts.isAfter(end));
      });
    }
    return rows;
  }, [hourlyRows, hourlyRange]);

  return (
    <div className="space-y-4">
      {showFallback && (
        <FallbackPanel
          powerBiUrl="https://app.powerbi.com/view?r=eyJrIjoiNjlhMWMxY2UtNDNjYi00NjQ4LTliNzYtNTM0NjU1OTY3ZDZlIiwidCI6ImY2ZjRhNjkyLTQzYjMtNDMzYi05MmIyLTY1YzRlNmNjZDkyMCIsImMiOjEwfQ%3D%3D&fbclid=IwY2xjawFB5F5leHRuA2FlbQIxMAABHUN0PdCwA3CeLh-6DJcav9RNTakWqqXb9tiX4NhZWuaoq6c9DFAjap_87A_aem_76ldAfP7LXMUux7n4bbWkA"
          onRetry={() => window.location.reload()}
        />
      )}
      {!showFallback && hasAnyError && (
        <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
          <Button type="default" size="small" href={powerBiUrl} target="_blank" rel="noopener noreferrer">
            Open Legacy Power BI Dashboard
          </Button>
        </div>
      )}
      {/* Header: Station Name (left) • Address (right) */}
      <div className="flex items-center justify-between gap-4">
        <div
          className="text-xl font-semibold truncate"
          title={meta.data?.name || "Station"}
        >
          {meta.loading ? (
            <Skeleton.Input active style={{ width: 200, height: 24 }} />
          ) : meta.error ? (
            "Station"
          ) : (
            meta.data?.name || "Station"
          )}
        </div>
        <div
          className="text-sm text-gray-500 dark:text-gray-400 text-right truncate"
          title={addrState.display || meta.data?.address || ""}
        >
          {addrState.loading ? (
            <Skeleton.Input active style={{ width: 300, height: 20 }} />
          ) : (
            addrState.display || meta.data?.address || ""
          )}
        </div>
      </div>
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
          onRetry={aqi.retry}
          retrying={aqi.retrying}
          onDaysRetry={aqiDays.retry}
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
              <div style={{ marginTop: 8 }}>
                <Button size="small" onClick={station.retry} loading={station.retrying}>Retry</Button>
              </div>
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
              <div style={{ marginTop: 8 }}>
                <Button size="small" onClick={station.retry} loading={station.retrying}>Retry</Button>
              </div>
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
              <div style={{ marginTop: 8 }}>
                <Button size="small" onClick={station.retry} loading={station.retrying}>Retry</Button>
              </div>
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
      { (aqi.refreshing || station.refreshing || forecast.refreshing) && (
        <div className="aqm-subline" style={{ marginTop: 4 }}>
          <span className="aqm-dot blink-soft" style={{ background: 'var(--aqm-muted)' }} />
          Tiles updated — charts will update in a moment…
        </div>
      )}
      {/* Air Quality Monitoring Graph */}
      <VizChart
        variant="tile"
        title="Air Quality Monitoring Daily Average (µg/Ncm)"
      />

      {/* PM10 chart below the Air Quality Monitoring Graph */}
      <Pm10Chart title="Hourly Station Reading (µg/Ncm)" />

      {/* Data tables under charts */}
      <div className="grid lg:grid-cols-2 gap-4 mt-2">
        <Card
          size="small"
          title={<span style={{ color: 'var(--aqm-muted)' }}>Daily Average Data</span>}
          extra={
            <div className="flex items-center gap-2">
              <DatePicker.RangePicker
                size="small"
                value={dailyRange}
                onChange={(v)=> setDailyRange(v)}
                allowClear
                style={{ width: 220 }}
              />
              <Button size="small" onClick={()=> exportCSV('daily', dailyVisible)}>Export CSV</Button>
            </div>
          }
          style={{ background: 'var(--aqm-panel-bg)', border: '1px solid var(--aqm-panel-border)' }}
          styles={{ header: { background: 'var(--aqm-panel-bg)', borderBottom: '1px solid var(--aqm-panel-border)' }, body: { background: 'var(--aqm-panel-bg)' } }}
          bodyStyle={{ padding: 0 }}
        >
          <Table
            size="small"
            columns={[
              { title: 'Date', dataIndex: 't', key: 't', render: v => dayjs(v).format('MM/DD/YYYY'), width: 130, sorter: (a,b)=> dayjs(a.t).valueOf() - dayjs(b.t).valueOf(), defaultSortOrder: 'descend' },
              { title: 'Average (µg/Ncm)', dataIndex: 'y', key: 'y', width: 160, sorter: (a,b)=> Number(a.y) - Number(b.y) },
              { title: 'Status', key: 'status', width: 160, render: (_, r) => {
                  const y = Number(r?.y);
                  let name = '—', color = 'default';
                  if (isFinite(y)) {
                    if (y >= 301) { name = 'EMERGENCY'; color = '#a8071a'; }
                    else if (y >= 201) { name = 'ACUTELY UNHEALTHY'; color = '#722ed1'; }
                    else if (y >= 151) { name = 'VERY UNHEALTHY'; color = '#f5222d'; }
                    else if (y >= 101) { name = 'UNHEALTHY'; color = '#fa8c16'; }
                    else if (y >= 51) { name = 'FAIR'; color = '#d4b106'; }
                    else { name = 'GOOD'; color = '#52c41a'; }
                  }
                  return <Tag color={color}>{name}</Tag>;
                }
              },
            ]}
            dataSource={dailyVisible.map((r,i)=>({ ...r, key: i }))}
            loading={dailyData.loading || dailyData.refreshing}
            pagination={{ pageSize: 10, size: 'small', showSizeChanger: false }}
            scroll={{ y: 260 }}
            style={{ background: 'transparent', fontSize: 11 }}
            className="compact-table"
          />
        </Card>
        <Card
          size="small"
          title={<span style={{ color: 'var(--aqm-muted)' }}>Hourly Readings</span>}
          extra={
            <div className="flex items-center gap-2">
              <DatePicker.RangePicker
                size="small"
                showTime={{ format: 'HH:00' }}
                value={hourlyRange}
                onChange={(v)=> setHourlyRange(v)}
                allowClear
                style={{ width: 260 }}
              />
              <Button size="small" onClick={()=> exportCSV('hourly', hourlyVisible)}>Export CSV</Button>
            </div>
          }
          style={{ background: 'var(--aqm-panel-bg)', border: '1px solid var(--aqm-panel-border)' }}
          styles={{ header: { background: 'var(--aqm-panel-bg)', borderBottom: '1px solid var(--aqm-panel-border)' }, body: { background: 'var(--aqm-panel-bg)' } }}
          bodyStyle={{ padding: 0 }}
        >
          <Table
            size="small"
            columns={[
              { title: 'Timestamp', dataIndex: 't', key: 't', render: v => dayjs(v).format('MM/DD/YYYY h:00 A'), width: 180, sorter: (a,b)=> dayjs(a.t).valueOf() - dayjs(b.t).valueOf(), defaultSortOrder: 'descend' },
              { title: 'Reading (µg/Ncm)', dataIndex: 'y', key: 'y', width: 170, sorter: (a,b)=> Number(a.y) - Number(b.y) },
              { title: 'Status', key: 'status', width: 160, render: (_, r) => {
                  const y = Number(r?.y);
                  let name = '—', color = 'default';
                  if (isFinite(y)) {
                    if (y >= 301) { name = 'EMERGENCY'; color = '#a8071a'; }
                    else if (y >= 201) { name = 'ACUTELY UNHEALTHY'; color = '#722ed1'; }
                    else if (y >= 151) { name = 'VERY UNHEALTHY'; color = '#f5222d'; }
                    else if (y >= 101) { name = 'UNHEALTHY'; color = '#fa8c16'; }
                    else if (y >= 51) { name = 'FAIR'; color = '#d4b106'; }
                    else { name = 'GOOD'; color = '#52c41a'; }
                  }
                  return <Tag color={color}>{name}</Tag>;
                }
              },
            ]}
            dataSource={hourlyVisible.map((r,i)=>({ ...r, key: i }))}
            loading={hourlyData.loading || hourlyData.refreshing}
            pagination={{ pageSize: 10, size: 'small', showSizeChanger: false }}
            scroll={{ y: 260 }}
            style={{ background: 'transparent', fontSize: 11 }}
            className="compact-table"
          />
        </Card>
      </div>
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
  onRetry,
  retrying,
  onDaysRetry,
}) {
  const tint = categoryTint(category);
  const catUpper = String(category || "").toUpperCase();
  const shouldPulse = [
    "FAIR",
    "UNHEALTHY",
    "VERY UNHEALTHY",
    "ACUTELY UNHEALTHY",
    "EMERGENCY",
    "HAZARD",
  ].some((k) => catUpper.includes(k));
  // Severity mapping for ring size and speed
  let ringSize = 6; // px
  let pulseDuration = 2.6; // seconds
  if (catUpper.includes("UNHEALTHY") && !catUpper.includes("VERY")) {
    ringSize = 10; pulseDuration = 2.4;
  }
  if (catUpper.includes("VERY UNHEALTHY")) {
    ringSize = 14; pulseDuration = 2.1;
  }
  if (catUpper.includes("ACUTELY")) {
    ringSize = 16; pulseDuration = 1.9;
  }
  if (catUpper.includes("EMERGENCY") || catUpper.includes("HAZARD")) {
    ringSize = 20; pulseDuration = 1.6;
  }
  const containerStyle = {
    background: `linear-gradient(135deg, ${hexToRgba(
      tint,
      0.08
    )} 0%, var(--aqm-panel-bg) 60%)`,
    borderColor: hexToRgba(tint, 0.25),
    ...(shouldPulse
      ? {
          // pass CSS vars for pulsing colors
          "--aqi-glow-outer": hexToRgba(tint, 0.22),
          "--aqi-glow-outer-strong": hexToRgba(tint, 0.38),
          "--aqi-glow-ring": hexToRgba(tint, 0.18),
          "--aqi-glow-ring-weak": hexToRgba(tint, 0.08),
          "--aqi-ring-size": `${ringSize}px`,
          "--aqi-halo-color": hexToRgba(tint, 0.10),
          "--aqi-halo-size": `${ringSize + 8}px`,
        }
      : {
          // static subtle glow when not pulsing (GOOD)
          boxShadow: `0 8px 18px ${hexToRgba(
            tint,
            0.18
          )}, 0 0 0 1px ${hexToRgba(tint, 0.14)}`,
        }),
  };
  return (
    <div
      className={`aqm-tile aqi${shouldPulse ? " aqi-pulse aqi-anim-halo" : ""}`}
      style={{
        ...containerStyle,
        ...(shouldPulse ? { animationDuration: `${pulseDuration}s`, "--aqi-anim-duration": `${pulseDuration}s` } : {}),
      }}
    >
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
          {onRetry && (
            <div style={{ marginTop: 8 }}>
              <Button size="small" onClick={onRetry} loading={retrying}>Retry</Button>
            </div>
          )}
        </div>
      ) : (
        <div className="aqm-tile-body">
          <div
            className="aqm-primary"
            style={{
              color: tint,
              display: "flex",
              alignItems: "baseline",
              gap: 6,
              flexWrap: "wrap",
            }}
          >
            {(() => {
              const n = Number(value);
              const v = isFinite(n) ? Math.round(n) : "--";
              const cat = (category || "--").toUpperCase();
              return (
                <>
                  <span style={{ fontSize: 28, fontWeight: 700 }}>{v}</span>
                  <span
                    style={{
                      fontSize: 12,
                      fontWeight: 500,
                      color: "var(--aqm-muted)",
                      textTransform: "none",
                    }}
                  >
                    µg/ncm
                  </span>
                  <span style={{ color: "var(--aqm-muted)", fontSize: 28, fontWeight: 700 }}>|</span>
                  <span
                    style={{
                      fontSize: 28,
                      fontWeight: 700,
                      textTransform: "uppercase",
                    }}
                  >
                    {cat}
                  </span>
                </>
              );
            })()}
          </div>
          {/* 'as of' subline removed per request */}
          {daysLoading ? (
            <div className="aqm-subline">Loading previous days…</div>
          ) : daysError ? (
            <div className="aqm-subline" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span>{daysError}</span>
              {onDaysRetry && (
                <Button size="small" type="link" onClick={onDaysRetry}>Retry</Button>
              )}
            </div>
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
  return useApiEndpoint('/api/aqi/last-days', {
    params: { days },
    refreshMs: 600000, // 10 minutes
    retries: 2,
    timeoutMs: 12000,
    cacheTtlMs: 60000,
  });
}

function useStationMeta() {
  return useApiEndpoint('/api/station/meta', {
    refreshMs: 600000, // 10 minutes
    retries: 2,
    timeoutMs: 10000,
    cacheTtlMs: 600000,
  });
}
