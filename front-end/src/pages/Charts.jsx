import VizChart from "../components/VizChart";
import Pm10Chart from "../components/Pm10Chart";
import { Table, Card, Tag, DatePicker, Button, Alert } from "antd";
import FilterGroup from "@components/FilterGroup.jsx";
import { useMemo, useState, useEffect } from "react";
import dayjs from "dayjs";
import { getApiBase } from "../util/apiBase";

export default function ChartsPage() {
  // We'll render charts first; tables will reuse their data via window caches if exposed later
  // For now we let each chart load; then build tables off a lightweight fetch duplicating endpoints.
  // This keeps components decoupled; could lift state up later.

  const [dailyRows, setDailyRows] = useState([]);
  const [hourlyRows, setHourlyRows] = useState([]);
  const [loadingDaily, setLoadingDaily] = useState(true);
  const [loadingHourly, setLoadingHourly] = useState(true);
  const [dailyRange, setDailyRange] = useState(null);
  const [hourlyRange, setHourlyRange] = useState(null);
  const base = getApiBase();

  useEffect(() => {
    let cancelled = false;
    async function runDaily() {
      setLoadingDaily(true);
      try {
        const res = await fetch(new URL('/api/viz-data', base));
        const json = await res.json();
        if (!cancelled) setDailyRows(json.series || []);
      } catch { /* ignore */ }
      finally { if (!cancelled) setLoadingDaily(false); }
    }
    async function runHourly() {
      setLoadingHourly(true);
      try {
        const res = await fetch(new URL('/api/pm10-data', base));
        const json = await res.json();
        if (!cancelled) setHourlyRows(json.series || []);
      } catch { /* ignore */ }
      finally { if (!cancelled) setLoadingHourly(false); }
    }
    runDaily();
    runHourly();
    return () => { cancelled = true; };
  }, [base]);

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
    { title: 'Status', key: 'status', width: 160, render: (_, r) => { const c = classify(r.y); return <Tag color={c.color}>{c.name}</Tag>; }},
  ], []);
  const hourlyColumns = useMemo(() => [
    { title: 'Timestamp', dataIndex: 't', key: 't', render: v => dayjs(v).format('MM/DD/YYYY h:00 A'), width: 180, fixed: 'left', sorter: (a,b)=> dayjs(a.t).valueOf() - dayjs(b.t).valueOf(), defaultSortOrder: 'descend' },
    { title: 'Reading (µg/Ncm)', dataIndex: 'y', key: 'y', width: 150, sorter: (a,b)=> Number(a.y) - Number(b.y) },
    { title: 'Status', key: 'status', width: 160, render: (_, r) => { const c = classify(r.y); return <Tag color={c.color}>{c.name}</Tag>; }},
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

  const hasAnyError = (!loadingDaily && dailyRows.length === 0) || (!loadingHourly && hourlyRows.length === 0);
  const powerBiUrl = "https://app.powerbi.com/view?r=eyJrIjoiNjlhMWMxY2UtNDNjYi00NjQ4LTliNzYtNTM0NjU1OTY3ZDZlIiwidCI6ImY2ZjRhNjkyLTQzYjMtNDMzYi05MmIyLTY1YzRlNmNjZDkyMCIsImMiOjEwfQ%3D%3D&fbclid=IwY2xjawFB5F5leHRuA2FlbQIxMAABHUN0PdCwA3CeLh-6DJcav9RNTakWqqXb9tiX4NhZWuaoq6c9DFAjap_87A_aem_76ldAfP7LXMUux7n4bbWkA";
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-semibold">Charts</h2>
        {hasAnyError && (
          <Button type="default" size="small" href={powerBiUrl} target="_blank" rel="noopener noreferrer">
            Open Legacy Power BI
          </Button>
        )}
      </div>
      <VizChart defaultRange="7d" />
      <Pm10Chart defaultRange="1w" />
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
          bodyStyle={{ padding: 0, background: 'transparent' }}
        >
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
          bodyStyle={{ padding: 0, background: 'transparent' }}
        >
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
