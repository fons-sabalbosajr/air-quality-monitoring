import { useEffect, useState, useMemo } from "react";
import { Select, Button, Tooltip, message, Modal, Tag } from "antd";
import dayjs from "dayjs";
import {
  TbMapPin,
  TbRefresh, TbMail, TbAlertTriangle, TbClock,
} from "react-icons/tb";
import { useAqi } from "../context/AqiContext";
import { getMergedStations, getStationPhoto } from "../config/stations";
import useTabularData from "../hooks/useTabularData";
import useStationWeather from "../hooks/useStationWeather";
import { getApiBase } from "../util/apiBase";
import ConnectionErrorCard from "../components/ConnectionErrorCard";
import AqiHeroCard from "../components/AqiHeroCard";
import HourlyWeatherCard from "../components/HourlyWeatherCard";
import HistoricalAqiGraph from "../components/HistoricalAqiGraph";
import AqiCalendar from "../components/AqiCalendar";
import WindMapCard from "../components/WindMapCard";
import "./Dashboard.css";

/* ── Status colour helper ─────────────────────────────────────────── */
const STATUS_COLORS = {
  Good: "#52c41a",
  Fair: "#d4b106",
  "Unhealthy for Sensitive Groups": "#fa8c16",
  "Very Unhealthy": "#f5222d",
  "Acutely Unhealthy": "#722ed1",
  Emergency: "#a8071a",
};
function getStatusColor(status) {
  if (!status) return null;
  const s = String(status).toLowerCase();
  for (const [key, color] of Object.entries(STATUS_COLORS)) {
    if (s.includes(key.toLowerCase().split(" ")[0])) return color;
  }
  return null;
}

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

  /* ── Data request modal ────────────────────────────────────────── */
  const [requestModalOpen, setRequestModalOpen] = useState(false);


  // Extract latest AQI values from tabular data.
  // Prefer the live `latest` row; fall back to `cachedLatest` (secureStorage)
  // so the AQI card renders immediately on load without a loading skeleton.
  const latestAqi = useMemo(() => {
    const row = tabular.latest || tabular.cachedLatest;
    if (!row) return { value: null, category: null, time: null };
    const aqi = row["AQI"] ?? row["aqi"];
    const status = row["Status"] ?? row["status"];
    // Find the date column
    const dateCol = tabular.dateCol;
    const time = dateCol ? row[dateCol] : null;
    let isoTime = null;
    if (time) {
      const d = new Date(time);
      // Sanity-check the year: reject impossibly old dates that arise when
      // dateCol detection falls back to cols[0] (a non-date column like
      // concentration), which produces epoch-0 (~1970) after new Date().
      if (!isNaN(d.getTime()) && d.getFullYear() >= 2015) {
        isoTime = d.toISOString();
      }
    }
    return {
      value: aqi != null ? Number(aqi) : null,
      category: status || null,
      time: isoTime,
    };
  }, [tabular.latest, tabular.cachedLatest, tabular.dateCol]);



  // Secondary AQI (for merged stations)
  const latestAqi2 = useMemo(() => {
    if (!station.merged) return null;
    const row = tabular2.latest || tabular2.cachedLatest;
    if (!row) return { value: null, category: null, time: null };
    const aqi = row["AQI"] ?? row["aqi"];
    const status = row["Status"] ?? row["status"];
    const dateCol = tabular2.dateCol;
    const time = dateCol ? row[dateCol] : null;
    let isoTime = null;
    if (time) {
      const d = new Date(time);
      if (!isNaN(d.getTime()) && d.getFullYear() >= 2015) {
        isoTime = d.toISOString();
      }
    }
    return {
      value: aqi != null ? Number(aqi) : null,
      category: status || null,
      time: isoTime,
    };
  }, [station.merged, tabular2.latest, tabular2.cachedLatest, tabular2.dateCol]);

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

  const hasAnyError = [tabular.error, weather.error].some(Boolean);

  // Detect stale data (>7 days old) — show watermark overlay
  const isStale = useMemo(() => {
    if (!latestAqi.time) return false;
    const latest = new Date(latestAqi.time);
    if (isNaN(latest.getTime())) return false;
    const diffDays = (Date.now() - latest.getTime()) / (1000 * 60 * 60 * 24);
    return diffDays > 7;
  }, [latestAqi.time]);

  // Detect stale secondary pollutant (PM2.5) — blur/hide in hero card
  const isStale2 = useMemo(() => {
    if (!station.merged || !latestAqi2) return false;
    // No data at all → treat as stale
    if (latestAqi2.value == null && !latestAqi2.time) return true;
    if (!latestAqi2.time) return true;
    const latest = new Date(latestAqi2.time);
    if (isNaN(latest.getTime())) return true;
    const diffDays = (Date.now() - latest.getTime()) / (1000 * 60 * 60 * 24);
    return diffDays > 7;
  }, [station.merged, latestAqi2]);

  // ── Check all stations for stale data (>7 days old) ──
  const [staleStations, setStaleStations] = useState(new Set());
  useEffect(() => {
    let cancelled = false;
    async function checkAll() {
      const base = getApiBase();
      const staleSet = new Set();
      await Promise.allSettled(
        DASH_STATIONS.map(async (s) => {
          try {
            const url = `${base}/api/tabular/${encodeURIComponent(s.province)}/${encodeURIComponent(s.pollutant)}`;
            const res = await fetch(url, { headers: { Accept: "application/json" } });
            if (!res.ok) { staleSet.add(s.key); return; }
            const json = await res.json();
            const rows = json?.rows;
            if (!rows?.length) { staleSet.add(s.key); return; }
            const dateCol = json.columns?.find((c) => /date|time/i.test(c));
            const latestRow = rows[0];
            const dateStr = dateCol ? latestRow[dateCol] : null;
            if (!dateStr) { staleSet.add(s.key); return; }
            const d = new Date(dateStr);
            // Guard against epoch-0 dates (mis-detected column) — treat as non-stale
            if (isNaN(d.getTime()) || d.getFullYear() < 2015) return;
            if ((Date.now() - d.getTime()) / 86400000 > 7) {
              staleSet.add(s.key);
            }
          } catch {
            staleSet.add(s.key);
          }
        })
      );
      if (!cancelled) setStaleStations(staleSet);
    }
    checkAll();
    return () => { cancelled = true; };
  }, [DASH_STATIONS]);

  // Station selector dropdown options — sorted alphabetically, with stale indicator
  const stationOptions = DASH_STATIONS.map((s) => {
    const isOutdated = staleStations.has(s.key);
    return {
      label: (
        <span style={{ display: "flex", alignItems: "center", gap: 6, whiteSpace: "nowrap" }}>
          <TbMapPin size={14} />
          {s.name}{s.merged ? ` (${s.pollutantLabel})` : ""}
          {isOutdated && (
            <Tag
              color="warning"
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 3,
                fontSize: 9,
                fontWeight: 700,
                margin: 0,
                padding: "0 6px",
                lineHeight: "16px",
                borderRadius: 4,
                marginLeft: 4,
                whiteSpace: "nowrap",
                flexShrink: 0,
              }}
            >
              <TbAlertTriangle size={10} />
              Outdated
            </Tag>
          )}
        </span>
      ),
      value: s.key,
    };
  });

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

  // Live clock for toolbar
  const [now, setNow] = useState(new Date());
  useEffect(() => {
    const iv = setInterval(() => setNow(new Date()), 30000); // update every 30s
    return () => clearInterval(iv);
  }, []);
  const formattedDate = dayjs(now).format("MMM D, YYYY");
  const formattedTime = dayjs(now).format("h:mm A");

  return (
    <div
      className="dashboard-v2 space-y-6"
      style={{
        "--dash-accent": dashAccent.color,
        "--dash-accent-light": dashAccent.light,
        "--dash-accent-border": dashAccent.border,
      }}
    >
      {/* Station Selector + Toolbar */}
      <div className="dashboard-station-selector">
        <Select
          value={stationKey}
          onChange={setStationKey}
          options={stationOptions}
          size="large"
          style={{ minWidth: 340 }}
          popupMatchSelectWidth={false}
          popupClassName="dashboard-station-popup"
          suffixIcon={<TbMapPin size={18} />}
        />

        <div className="dashboard-toolbar">
          {/* Today's date & time */}
          <span className="dashboard-datetime">
            <TbClock size={14} />
            <span className="dashboard-datetime-date">{formattedDate}</span>
            <span className="dashboard-datetime-time">{formattedTime}</span>
          </span>

          {/* Request Data button – directs to Records Unit */}
          <Tooltip title="Request data export from EMB Records Unit">
            <Button
              icon={<TbMail size={16} />}
              className="dashboard-toolbar-btn"
              size="middle"
              onClick={() => setRequestModalOpen(true)}
            >
              <span className="toolbar-btn-label">Request Data</span>
            </Button>
          </Tooltip>

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

      {hasAnyError && (
        <ConnectionErrorCard
          error={tabular.error || weather.error}
          onRetry={tabular.retry}
          retrying={tabular.loading}
        />
      )}

      {/* 1. AQI Hero Card */}
      <AqiHeroCard
        aqiValue={latestAqi.value}
        aqiCategory={latestAqi.category}
        aqiTime={latestAqi.time}
        aqiLoading={tabular.loading && !tabular.cachedLatest}
        aqiError={tabular.error}
        aqiRefreshing={tabular.loading && !!tabular.cachedLatest}
        onRetry={tabular.retry}
        retrying={false}
        stationName={station.name}
        stationAddress={station.address}
        pollutantLabel={station.merged ? station.pollutants[0].label : station.pollutantLabel}
        isFallback={false}
        fallbackSource={""}
        sheetSyncing={tabular.sheetSyncing || tabular2.sheetSyncing}
        aqiVerified={tabular.latestAqiVerified}
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
        aqiLoading2={tabular2.loading && !tabular2.cachedLatest}
        pollutantLabel2={secondaryPollutant?.label}
        isStale={isStale}
        isStale2={isStale2}
        stationPhoto={getStationPhoto(station.province || station.key)}
      />

      {/* 3. Hourly Weather Forecast */}
      <HourlyWeatherCard
        latitude={station.lat}
        longitude={station.lon}
      />

      {/* 3. Historical Air Quality Data + Wind Map */}
      <div className="dashboard-chart-wind-row">
        <div className="dashboard-chart-wind-main">
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
        </div>
        <div className="dashboard-chart-wind-side">
          <WindMapCard
            latitude={station.lat}
            longitude={station.lon}
            stationName={station.name}
          />
        </div>
      </div>

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

      {/* Data Request Modal */}
      <Modal
        title="📋 Request Air Quality Data"
        open={requestModalOpen}
        onCancel={() => setRequestModalOpen(false)}
        footer={[
          <Button key="close" onClick={() => setRequestModalOpen(false)}>
            Close
          </Button>,
          <Button
            key="email"
            type="primary"
            icon={<TbMail size={14} />}
            onClick={() => {
              window.location.href =
                `mailto:recordsr3@emb.gov.ph?subject=${encodeURIComponent(
                  `Air Quality Data Request — ${station.name}`
                )}&body=${encodeURIComponent(
                  `Good day,\n\nI would like to request air quality monitoring data for the following:\n\n` +
                  `Station: ${station.name}\n` +
                  `Address: ${station.address}\n` +
                  `Pollutant: ${station.merged ? station.pollutantLabel : station.pollutantLabel}\n\n` +
                  `Please process my request at your earliest convenience.\n\nThank you.`
                )}`;
              message.success("Opening email client...");
            }}
          >
            Send Request via Email
          </Button>,
        ]}
        width={480}
        centered
      >
        <div style={{ lineHeight: 1.8, fontSize: 14 }}>
          <p style={{ marginBottom: 12 }}>
            To obtain air quality monitoring data, please submit a request to the
            <strong> EMB Region 3 Records Unit</strong>. The Records Unit will
            process your request and provide the data accordingly.
          </p>

          <div className="request-modal-info-card">
            <div style={{ fontWeight: 600, marginBottom: 6 }}>📧 Records Unit Email</div>
            <a
              href="mailto:recordsr3@emb.gov.ph"
              style={{ fontSize: 16, fontWeight: 700, color: "var(--aqm-primary, #1677ff)" }}
            >
              recordsr3@emb.gov.ph
            </a>
          </div>

          <div className="request-modal-info-card">
            <div style={{ fontWeight: 600, marginBottom: 6 }}>📍 Current Station</div>
            <div>{station.name}</div>
            <div style={{ fontSize: 12, opacity: 0.7 }}>{station.address}</div>
            <div style={{ marginTop: 4, fontSize: 12 }}>
              Pollutant: <strong>{station.merged ? station.pollutantLabel : station.pollutantLabel}</strong>
            </div>
          </div>

          <p style={{ marginTop: 14, fontSize: 12, opacity: 0.6 }}>
            Click <strong>"Send Request via Email"</strong> to open your email client
            with a pre-filled request template.
          </p>
        </div>
      </Modal>
    </div>
  );
}
