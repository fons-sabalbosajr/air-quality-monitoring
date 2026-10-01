/**
 * ChartsPage — /admin/charts
 *
 * Hourly and daily series for one station/pollutant at a time, served from the
 * live MongoDB tabular backup (the same snapshot behind the kiosk, NLEX wall
 * and partner API). The legacy Excel/SharePoint workbook that used to back
 * this page stopped updating in November 2025; it is still reachable server
 * side with ?source=excel for comparison.
 *
 * Everything on the page polls on REFRESH_MS so it tracks the once-a-minute
 * sheets sync, and each card carries a Freshness badge so a pipeline that
 * falls behind is visible rather than inferred.
 */
import VizChart from "../components/VizChart";
import Pm10Chart from "../components/Pm10Chart";
import Freshness from "../components/Freshness";
import { Table, Card, Tag, DatePicker, Button, Select, Space, Alert } from "antd";
import FilterGroup from "@components/FilterGroup.jsx";
import { ReloadOutlined } from "@ant-design/icons";
import { useMemo, useState, useEffect, useCallback } from "react";
import dayjs from "dayjs";
import { getApiBase } from "../util/apiBase";
import { readJsonResponse } from "../util/jsonResponse";

// Matches the server-side sheets sync (every minute) and the chart components.
const REFRESH_MS = 60_000;

const FALLBACK_STATIONS = [
  { id: "meycauayan", name: "Meycauayan AQMS", pollutants: [{ id: "pm10", label: "PM10" }, { id: "pm25", label: "PM2.5" }] },
  { id: "zambales", name: "Zambales AQMS", pollutants: [{ id: "pm10", label: "PM10" }, { id: "pm25", label: "PM2.5" }] },
  { id: "clark", name: "Clark AQMS", pollutants: [{ id: "pm10", label: "PM10" }] },
  { id: "san-fernando", name: "San Fernando AQMS", pollutants: [{ id: "pm10", label: "PM10" }] },
];

export default function ChartsPage() {
  const base = getApiBase();

  // ── Which dataset the whole page is showing ──
  const [stations, setStations] = useState(FALLBACK_STATIONS);
  const [station, setStation] = useState("meycauayan");
  const [pollutant, setPollutant] = useState("pm10");

  const [dailyRows, setDailyRows] = useState([]);
  const [hourlyRows, setHourlyRows] = useState([]);
  const [dailyMeta, setDailyMeta] = useState(null);
  const [hourlyMeta, setHourlyMeta] = useState(null);
  const [loadingDaily, setLoadingDaily] = useState(true);
  const [loadingHourly, setLoadingHourly] = useState(true);
  const [tableError, setTableError] = useState(null);
  const [dailyRange, setDailyRange] = useState(null);
  const [hourlyRange, setHourlyRange] = useState(null);
  const [tablesRefreshedAt, setTablesRefreshedAt] = useState(null);

  // Discover the selectable stations/pollutants from the server so a station
  // added to config/stations.js appears here without a frontend change.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(new URL(`${base}/api/chart-targets`));
        if (!res.ok) return;
        const json = await readJsonResponse(res, "Chart targets request");
        if (cancelled || !Array.isArray(json.stations) || !json.stations.length) return;
        setStations(json.stations);
        if (json.defaults?.station) setStation(json.defaults.station);
        if (json.defaults?.pollutant) setPollutant(json.defaults.pollutant);
      } catch { /* keep the fallback list */ }
    })();
    return () => { cancelled = true; };
  }, [base]);

  const pollutantOptions = useMemo(() => {
    const s = stations.find((x) => x.id === station);
    return (s?.pollutants ?? [{ id: "pm10", label: "PM10" }]).map((p) => ({ value: p.id, label: p.label }));
  }, [stations, station]);

  // Keep the pollutant valid when switching to a station that lacks it
  // (Clark and San Fernando measure PM10 only).
  useEffect(() => {
    if (!pollutantOptions.some((o) => o.value === pollutant)) {
      setPollutant(pollutantOptions[0]?.value ?? "pm10");
    }
  }, [pollutantOptions, pollutant]);

  const loadTables = useCallback(
    async (signal) => {
      const qs = `station=${encodeURIComponent(station)}&pollutant=${encodeURIComponent(pollutant)}`;
      async function one(path, setRows, setMeta, setLoading) {
        setLoading(true);
        try {
          const res = await fetch(new URL(`${base}${path}?${qs}`), { signal, cache: "no-store" });
          const json = await readJsonResponse(res, "Chart series request");
          if (signal?.aborted) return null;
          setRows(json.series ?? []);
          setMeta(json.meta ?? null);
          return res.ok ? null : json.error || `HTTP ${res.status}`;
        } catch (e) {
          if (e?.name === "AbortError") return null;
          return e?.message || "Request failed";
        } finally {
          if (!signal?.aborted) setLoading(false);
        }
      }
      const [dErr, hErr] = await Promise.all([
        one("/api/viz-data", setDailyRows, setDailyMeta, setLoadingDaily),
        one("/api/pm10-data", setHourlyRows, setHourlyMeta, setLoadingHourly),
      ]);
      if (signal?.aborted) return;
      setTableError(dErr || hErr || null);
      setTablesRefreshedAt(Date.now());
    },
    [base, station, pollutant],
  );

  useEffect(() => {
    const ac = new AbortController();
    loadTables(ac.signal);
    const id = setInterval(() => loadTables(ac.signal), REFRESH_MS);
    return () => { ac.abort(); clearInterval(id); };
  }, [loadTables]);

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

  const dailyColumns = useMemo(() => [
    { title: 'Date', dataIndex: 't', key: 't', render: v => dayjs(v).format('MM/DD/YYYY'), width: 130, fixed: 'left', sorter: (a,b)=> dayjs(a.t).valueOf() - dayjs(b.t).valueOf(), defaultSortOrder: 'descend' },
    { title: 'Average (µg/Ncm)', dataIndex: 'y', key: 'y', width: 140, sorter: (a,b)=> Number(a.y) - Number(b.y) },
    { title: 'Readings', dataIndex: 'n', key: 'n', width: 100, render: (v) => v ?? '—' },
    { title: 'Status', key: 'status', width: 160, render: (_, r) => { const c = classify(r.y); return <Tag color={c.color}>{c.name}</Tag>; }},
  ], []);
  const hourlyColumns = useMemo(() => [
    { title: 'Timestamp', dataIndex: 't', key: 't', render: v => dayjs(v).format('MM/DD/YYYY h:00 A'), width: 180, fixed: 'left', sorter: (a,b)=> dayjs(a.t).valueOf() - dayjs(b.t).valueOf(), defaultSortOrder: 'descend' },
    { title: 'Reading (µg/Ncm)', dataIndex: 'y', key: 'y', width: 150, sorter: (a,b)=> Number(a.y) - Number(b.y) },
    { title: 'AQI', dataIndex: 'aqi', key: 'aqi', width: 90, render: (v) => v ?? '—', sorter: (a,b)=> Number(a.aqi||0) - Number(b.aqi||0) },
    { title: 'Status', key: 'status', width: 180, render: (_, r) => { const c = classify(r.aqi ?? r.y); return <Tag color={c.color}>{r.status || c.name}</Tag>; }},
  ], []);

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

  function exportCSV(kind, rows) {
    if (!rows || !rows.length) return;
    const header = 'timestamp,value,aqi,status';
    const lines = rows.map(r => {
      const c = classify(r.aqi ?? r.y);
      return `${dayjs(r.t).toISOString()},${r.y},${r.aqi ?? ''},${r.status || c.name}`;
    });
    const csv = [header, ...lines].join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${station}-${pollutant}-${kind}-${dayjs().format('YYYYMMDD-HHmmss')}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  const stationLabel = stations.find((s) => s.id === station)?.name ?? station;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between" style={{ flexWrap: 'wrap', gap: 8 }}>
        <h2 className="text-xl font-semibold">Charts — {stationLabel}</h2>
        <Space wrap>
          <Select
            size="small"
            value={station}
            onChange={setStation}
            style={{ minWidth: 190 }}
            options={stations.map((s) => ({ value: s.id, label: s.name }))}
          />
          <Select
            size="small"
            value={pollutant}
            onChange={setPollutant}
            style={{ minWidth: 110 }}
            options={pollutantOptions}
          />
          <Button
            size="small"
            icon={<ReloadOutlined />}
            onClick={() => loadTables()}
            loading={loadingDaily || loadingHourly}
          >
            Refresh
          </Button>
        </Space>
      </div>

      {tableError && (
        <Alert
          type="warning"
          showIcon
          message="Could not refresh the tables"
          description={tableError}
          action={<Button size="small" onClick={() => loadTables()}>Retry</Button>}
        />
      )}

      <VizChart station={station} pollutant={pollutant} defaultRange="7d" />
      <Pm10Chart station={station} pollutant={pollutant} defaultRange="1w" />
      <div className="grid lg:grid-cols-2 gap-4 mt-6">
        <div className="aqm-scroll-x aqm-scroll-fade">
        <Card
          size="small"
          title={<span style={{ color: 'var(--aqm-muted)' }}>Daily Average Data</span>}
          extra={
            <FilterGroup label="Daily Filters">
              <DatePicker.RangePicker
                size="small"
                value={dailyRange}
                onChange={(v)=> setDailyRange(v)}
                allowClear
                className="aqm-fluid"
              />
              <Button size="small" onClick={()=> exportCSV('daily', dailyVisible)}>Export CSV</Button>
            </FilterGroup>
          }
          style={{ background: 'transparent', border: '1px solid var(--aqm-panel-border)' }}
          styles={{ body: { padding: 0, background: 'transparent' } }}
        >
          {dailyMeta?.lastReadingAt && (
            <div style={{ padding: '8px 12px 0' }}>
              <Freshness
                lastReadingAt={dailyMeta.lastReadingAt}
                syncedAt={dailyMeta.updatedAt}
                refreshedAt={tablesRefreshedAt}
              />
            </div>
          )}
          <Table
            size="small"
            columns={dailyColumns}
            dataSource={dailyVisible.map((r,i)=>({ ...r, key: i }))}
            loading={loadingDaily}
            pagination={{ pageSize: 10, size: 'small', showSizeChanger: false }}
            scroll={{ x: 'max-content', y: 260 }}
            style={{ background: 'transparent', fontSize: 12 }}
          />
        </Card>
        </div>
        <div className="aqm-scroll-x aqm-scroll-fade">
        <Card
          size="small"
          title={<span style={{ color: 'var(--aqm-muted)' }}>Hourly Readings</span>}
          extra={
            <FilterGroup label="Hourly Filters">
              <DatePicker.RangePicker
                size="small"
                showTime={{ format: 'HH:00' }}
                value={hourlyRange}
                onChange={(v)=> setHourlyRange(v)}
                allowClear
                className="aqm-fluid"
              />
              <Button size="small" onClick={()=> exportCSV('hourly', hourlyVisible)}>Export CSV</Button>
            </FilterGroup>
          }
          style={{ background: 'transparent', border: '1px solid var(--aqm-panel-border)' }}
          styles={{ body: { padding: 0, background: 'transparent' } }}
        >
          {hourlyMeta?.lastReadingAt && (
            <div style={{ padding: '8px 12px 0' }}>
              <Freshness
                lastReadingAt={hourlyMeta.lastReadingAt}
                syncedAt={hourlyMeta.updatedAt}
                refreshedAt={tablesRefreshedAt}
              />
            </div>
          )}
          <Table
            size="small"
            columns={hourlyColumns}
            dataSource={hourlyVisible.map((r,i)=>({ ...r, key: i }))}
            loading={loadingHourly}
            pagination={{ pageSize: 10, size: 'small', showSizeChanger: false }}
            scroll={{ x: 'max-content', y: 260 }}
            style={{ background: 'transparent', fontSize: 12 }}
          />
        </Card>
        </div>
      </div>
    </div>
  );
}
