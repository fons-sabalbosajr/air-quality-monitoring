import { useEffect, useState, useMemo, useCallback } from "react";
import { Select, Button, Tooltip, Badge, Dropdown, message, DatePicker, Modal, Space } from "antd";
import dayjs from "dayjs";
import {
  TbMapPin, TbDownload, TbFilter, TbActivity,
  TbRefresh, TbFileSpreadsheet, TbFileTypeCsv,
} from "react-icons/tb";
import { useAqi } from "../context/AqiContext";
import STATIONS, { getStation, getMergedStations } from "../config/stations";
import useTabularData from "../hooks/useTabularData";
import useStationWeather from "../hooks/useStationWeather";
import FallbackPanel from "../components/FallbackPanel";
import AqiHeroCard from "../components/AqiHeroCard";
import PollutantsCard from "../components/PollutantsCard";
import HistoricalAqiGraph from "../components/HistoricalAqiGraph";
import AqiCalendar from "../components/AqiCalendar";

/* ── Dashboard Page ────────────────────────────────────────────────── */
export default function DashboardPage() {
  const { setCategory } = useAqi() || { setCategory: () => {} };

  // Merged station list (Zambales PM10+PM2.5 → single entry)
  const DASH_STATIONS = useMemo(() => getMergedStations(), []);

  // Station selector – persisted in sessionStorage
  const [stationKey, setStationKey] = useState(() => {
    const saved = sessionStorage.getItem("aqm_station");
    // Map old individual keys to merged key
    if (saved) {
      const found = DASH_STATIONS.find((s) => s.key === saved);
      if (found) return saved;
      // Check if it's an un-merged key that belongs to a merged station
      const parent = DASH_STATIONS.find(
        (s) => s.merged && s.pollutants?.some((p) => p.key === saved)
      );
      if (parent) return parent.key;
    }
    return DASH_STATIONS[0].key;
  });
  const station = DASH_STATIONS.find((s) => s.key === stationKey) || DASH_STATIONS[0];

  useEffect(() => {
    sessionStorage.setItem("aqm_station", stationKey);
  }, [stationKey]);

  // Primary tabular data
  const tabular = useTabularData(station.province, station.pollutant);

  // Secondary pollutant data (for merged stations like Zambales PM10+PM2.5)
  const secondaryPollutant = station.merged
    ? station.pollutants?.find((p) => p.pollutant !== station.pollutant)
    : null;
  const tabular2 = useTabularData(
    secondaryPollutant ? station.province : null,
    secondaryPollutant ? secondaryPollutant.pollutant : null,
  );

  // Weather from Open-Meteo for this station's coordinates
  const weather = useStationWeather(station.lat, station.lon);

  /* ── Export helpers ────────────────────────────────────────────── */
  const [exportModalOpen, setExportModalOpen] = useState(false);
  const [exportDateRange, setExportDateRange] = useState(null);
  const [exportStatus, setExportStatus] = useState(null);

  const filteredExportRows = useMemo(() => {
    let rows = tabular.rows;
    if (!rows.length) return rows;
    const dateCol = tabular.dateCol;
    if (exportDateRange && exportDateRange[0] && exportDateRange[1] && dateCol) {
      const start = exportDateRange[0].startOf("day");
      const end = exportDateRange[1].endOf("day");
      rows = rows.filter((r) => {
        const d = dayjs(r[dateCol]);
        return d.isValid() && d.isAfter(start) && d.isBefore(end);
      });
    }
    if (exportStatus) {
      rows = rows.filter((r) => {
        const s = (r["Status"] ?? r["status"] ?? "").toString().toUpperCase();
        return s === exportStatus.toUpperCase();
      });
    }
    return rows;
  }, [tabular.rows, tabular.dateCol, exportDateRange, exportStatus]);

  const doExport = useCallback((format) => {
    const rows = filteredExportRows;
    if (!rows.length) {
      message.warning("No data matches the current filters");
      return;
    }
    if (format === "csv") {
      const cols = tabular.raw?.columns || Object.keys(rows[0]);
      const header = cols.join(",");
      const body = rows
        .map((r) =>
          cols.map((c) => {
            const v = r[c] ?? "";
            return String(v).includes(",") ? `"${v}"` : v;
          }).join(",")
        )
        .join("\n");
      const blob = new Blob([header + "\n" + body], { type: "text/csv" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `${station.name.replace(/\s+/g, "_")}_${dayjs().format("YYYY-MM-DD")}.csv`;
      a.click();
      URL.revokeObjectURL(a.href);
      message.success(`CSV exported (${rows.length} rows)`);
    } else {
      const blob = new Blob(
        [JSON.stringify({ station: station.name, rows }, null, 2)],
        { type: "application/json" }
      );
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `${station.name.replace(/\s+/g, "_")}_${dayjs().format("YYYY-MM-DD")}.json`;
      a.click();
      URL.revokeObjectURL(a.href);
      message.success(`JSON exported (${rows.length} rows)`);
    }
    setExportModalOpen(false);
  }, [filteredExportRows, tabular.raw, station.name]);

  const STATUS_OPTIONS = [
    { value: "Good", label: "Good" },
    { value: "Fair", label: "Fair" },
    { value: "Unhealthy for Sensitive Groups", label: "Unhealthy for Sensitive" },
    { value: "Very Unhealthy", label: "Very Unhealthy" },
    { value: "Acutely Unhealthy", label: "Acutely Unhealthy" },
    { value: "Emergency", label: "Emergency" },
  ];

  /* ── Station status summary ───────────────────────────────────── */
  const stationStatus = useMemo(() => {
    const row = tabular.latest;
    const total = tabular.rows.length;
    const withAqi = tabular.rows.filter((r) => {
      const v = r["AQI"] ?? r["aqi"];
      return v != null && isFinite(Number(v));
    }).length;
    const lastUpdate = row && tabular.dateCol ? row[tabular.dateCol] : null;
    const status = row ? (row["Status"] ?? row["status"] ?? null) : null;
    return { total, withAqi, lastUpdate, status };
  }, [tabular.latest, tabular.rows, tabular.dateCol]);

  // Extract latest AQI values from tabular data
  const latestAqi = useMemo(() => {
    const row = tabular.latest;
    if (!row) return { value: null, category: null, time: null };
    const aqi = row["AQI"] ?? row["aqi"];
    const status = row["Status"] ?? row["status"];
    // Find the date column
    const dateCol = tabular.dateCol;
    const time = dateCol ? row[dateCol] : null;
    return {
      value: aqi != null ? Number(aqi) : null,
      category: status || null,
      time: time ? new Date(time).toISOString() : null,
    };
  }, [tabular.latest, tabular.dateCol]);

  // Secondary AQI (for merged stations)
  const latestAqi2 = useMemo(() => {
    if (!station.merged) return null;
    const row = tabular2.latest;
    if (!row) return { value: null, category: null, time: null };
    const aqi = row["AQI"] ?? row["aqi"];
    const status = row["Status"] ?? row["status"];
    const dateCol = tabular2.dateCol;
    const time = dateCol ? row[dateCol] : null;
    return {
      value: aqi != null ? Number(aqi) : null,
      category: status || null,
      time: time ? new Date(time).toISOString() : null,
    };
  }, [station.merged, tabular2.latest, tabular2.dateCol]);

  // Detect dark mode from the DOM
  const [dark, setDark] = useState(false);
  useEffect(() => {
    const check = () =>
      setDark(document.documentElement.classList.contains("dark"));
    check();
    const obs = new MutationObserver(check);
    obs.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class"],
    });
    return () => obs.disconnect();
  }, []);

  // Push latest AQI category to context
  useEffect(() => {
    try {
      setCategory && setCategory(latestAqi.category);
    } catch {}
  }, [latestAqi.category]);

  // Fallback for when everything fails
  const [showFallback, setShowFallback] = useState(false);
  useEffect(() => {
    const id = setTimeout(() => {
      const noData = tabular.dailyRows.length === 0;
      const tabFailed = !!tabular.error;
      if (noData && tabFailed) setShowFallback(true);
      else setShowFallback(false);
    }, 25000);
    return () => clearTimeout(id);
  }, [tabular.dailyRows.length, tabular.error]);

  const hasAnyError = [tabular.error, weather.error].some(Boolean);
  const powerBiUrl =
    "https://app.powerbi.com/view?r=eyJrIjoiNjlhMWMxY2UtNDNjYi00NjQ4LTliNzYtNTM0NjU1OTY3ZDZlIiwidCI6ImY2ZjRhNjkyLTQzYjMtNDMzYi05MmIyLTY1YzRlNmNjZDkyMCIsImMiOjEwfQ%3D%3D";

  // Station selector dropdown options
  const stationOptions = DASH_STATIONS.map((s) => ({
    label: (
      <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <TbMapPin size={14} />
        {s.name}{s.merged ? ` (${s.pollutantLabel})` : ""}
      </span>
    ),
    value: s.key,
  }));

  // Compute accent color from current AQI for dashboard section gradients
  const dashAccent = useMemo(() => {
    const v = latestAqi.value;
    if (v == null || !isFinite(v)) return { color: "#0ea5e9", light: "rgba(14,165,233,0.06)", border: "rgba(14,165,233,0.15)" };
    if (v <= 50) return { color: "#34d399", light: "rgba(52,211,153,0.06)", border: "rgba(52,211,153,0.18)" };
    if (v <= 100) return { color: "#fbbf24", light: "rgba(251,191,36,0.06)", border: "rgba(251,191,36,0.18)" };
    if (v <= 150) return { color: "#fb923c", light: "rgba(251,146,60,0.06)", border: "rgba(251,146,60,0.18)" };
    if (v <= 200) return { color: "#f87171", light: "rgba(248,113,113,0.06)", border: "rgba(248,113,113,0.18)" };
    if (v <= 300) return { color: "#a78bfa", light: "rgba(167,139,250,0.06)", border: "rgba(167,139,250,0.18)" };
    return { color: "#fb7185", light: "rgba(251,113,133,0.07)", border: "rgba(251,113,133,0.2)" };
  }, [latestAqi.value]);

  return (
    <div
      className="dashboard-v2 space-y-6"
      style={{
        "--dash-accent": dashAccent.color,
        "--dash-accent-light": dashAccent.light,
        "--dash-accent-border": dashAccent.border,
      }}
    >      {/* Station Selector + Toolbar */}
      <div className="dashboard-station-selector">
        <Select
          value={stationKey}
          onChange={setStationKey}
          options={stationOptions}
          size="large"
          style={{ minWidth: 280 }}
          popupMatchSelectWidth={false}
          suffixIcon={<TbMapPin size={18} />}
        />

        <div className="dashboard-toolbar">
          {/* Station status badge */}
          {!tabular.loading && stationStatus.total > 0 && (
            <Tooltip title={
              <div style={{ fontSize: 12 }}>
                <div><strong>Records:</strong> {stationStatus.total}</div>
                <div><strong>With AQI:</strong> {stationStatus.withAqi}</div>
                {stationStatus.lastUpdate && (
                  <div><strong>Last update:</strong> {stationStatus.lastUpdate}</div>
                )}
                {stationStatus.status && (
                  <div><strong>Status:</strong> {stationStatus.status}</div>
                )}
              </div>
            }>
              <Badge
                status={stationStatus.withAqi > 0 ? "success" : "warning"}
                className="dashboard-status-badge"
                text={
                  <span className="dashboard-status-text">
                    <TbActivity size={14} />
                    <span>{stationStatus.withAqi} records</span>
                  </span>
                }
              />
            </Tooltip>
          )}

          {/* Export button – opens filter modal */}
          <Button
            icon={<TbDownload size={16} />}
            className="dashboard-toolbar-btn"
            size="middle"
            onClick={() => setExportModalOpen(true)}
          >
            <span className="toolbar-btn-label">Export</span>
          </Button>

          {/* Refresh */}
          <Tooltip title="Refresh data">
            <Button
              icon={<TbRefresh size={16} />}
              className="dashboard-toolbar-btn"
              size="middle"
              loading={tabular.loading}
              onClick={tabular.retry}
            />
          </Tooltip>
        </div>
      </div>

      {showFallback && (
        <FallbackPanel
          powerBiUrl={powerBiUrl}
          onRetry={() => window.location.reload()}
        />
      )}
      {!showFallback && hasAnyError && (
        <div style={{ display: "flex", justifyContent: "flex-end" }}>
          <Button
            type="default"
            size="small"
            href={powerBiUrl}
            target="_blank"
            rel="noopener noreferrer"
          >
            Open Legacy Power BI Dashboard
          </Button>
        </div>
      )}

      {/* 1. AQI Hero Card */}
      <AqiHeroCard
        aqiValue={latestAqi.value}
        aqiCategory={latestAqi.category}
        aqiTime={latestAqi.time}
        aqiLoading={tabular.loading}
        aqiError={tabular.error}
        aqiRefreshing={false}
        onRetry={tabular.retry}
        retrying={false}
        stationName={station.name}
        stationAddress={station.address}
        pollutantLabel={station.merged ? station.pollutants[0].label : station.pollutantLabel}
        temperature={weather.data?.temperature}
        humidity={weather.data?.humidity}
        pressure={weather.data?.pressure}
        windSpeed={weather.data?.windSpeed}
        windDirection={weather.data?.windDirection}
        weatherCode={weather.data?.weatherCode}
        apparentTemperature={weather.data?.apparentTemperature}
        uvIndex={weather.data?.uvIndex}
        cloudCover={weather.data?.cloudCover}
        weatherLoading={weather.loading}
        weatherError={weather.error}
        dark={dark}
        aqiValue2={latestAqi2?.value}
        aqiCategory2={latestAqi2?.category}
        aqiTime2={latestAqi2?.time}
        aqiLoading2={tabular2.loading}
        pollutantLabel2={secondaryPollutant?.label}
      />

      {/* 2. Major Air Pollutants */}
      <PollutantsCard
        latitude={station.lat}
        longitude={station.lon}
      />

      {/* 3. Historical Air Quality Data (bar chart) */}
      <HistoricalAqiGraph
        data={tabular.dailyRows}
        loading={tabular.loading}
        error={tabular.error}
        title={`Historical Air Quality Data – ${station.merged ? station.pollutantLabel : station.pollutantLabel} (AQI Graph)`}
        label={station.merged ? station.pollutants[0].label : undefined}
        data2={station.merged ? tabular2.dailyRows : undefined}
        label2={secondaryPollutant?.label}
        loading2={station.merged ? tabular2.loading : undefined}
      />

      {/* 4. Air Quality Calendar */}
      <AqiCalendar
        data={tabular.dailyRows}
        loading={tabular.loading}
        error={tabular.error}
        year={dayjs().year()}
        stations={DASH_STATIONS.map((s) => s.key)}
        stationFilter={stationKey}
        onStationChange={setStationKey}
        rawRows={tabular.rows}
        dateCol={tabular.dateCol}
        label={station.merged ? station.pollutants[0].label : undefined}
        data2={station.merged ? tabular2.dailyRows : undefined}
        rawRows2={station.merged ? tabular2.rows : undefined}
        dateCol2={station.merged ? tabular2.dateCol : undefined}
        label2={secondaryPollutant?.label}
      />

      {/* Export Filter Modal */}
      <Modal
        title="Export Data"
        open={exportModalOpen}
        onCancel={() => setExportModalOpen(false)}
        footer={null}
        width={440}
        centered
      >
        <div className="export-modal-body">
          <div className="export-filter-group">
            <label className="export-filter-label">Date Range</label>
            <DatePicker.RangePicker
              value={exportDateRange}
              onChange={setExportDateRange}
              style={{ width: "100%" }}
              allowClear
              size="middle"
            />
          </div>
          <div className="export-filter-group">
            <label className="export-filter-label">AQI Status</label>
            <Select
              value={exportStatus}
              onChange={setExportStatus}
              options={STATUS_OPTIONS}
              placeholder="All statuses"
              allowClear
              style={{ width: "100%" }}
              size="middle"
            />
          </div>
          <div className="export-filter-summary">
            {filteredExportRows.length} of {tabular.rows.length} records match
          </div>
          <Space style={{ width: "100%", justifyContent: "flex-end", marginTop: 12 }}>
            <Button
              icon={<TbFileTypeCsv size={16} />}
              onClick={() => doExport("csv")}
              type="primary"
            >
              Export CSV
            </Button>
            <Button
              icon={<TbFileSpreadsheet size={16} />}
              onClick={() => doExport("json")}
            >
              Export JSON
            </Button>
          </Space>
        </div>
      </Modal>
    </div>
  );
}
