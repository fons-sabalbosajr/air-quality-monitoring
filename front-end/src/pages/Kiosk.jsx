import { useEffect, useState, useMemo, useCallback, useRef } from "react";
import {
  ConfigProvider,
  theme,
  Spin,
  Tooltip,
  Badge,
  Modal,
  Table,
  Tag,
  Button,
  Select,
  DatePicker,
  Slider,
  Input,
  Space,
  Divider,
  Segmented,
  message,
} from "antd";
import {
  DownloadOutlined,
  FilterOutlined,
  ClearOutlined,
  ReloadOutlined,
  MailOutlined,
} from "@ant-design/icons";
import dayjs from "dayjs";
import {
  TbLayoutDashboard,
  TbTable,
  TbMap2,
  TbMapPin,
  TbActivity,
  TbArrowRight,
  TbArrowLeft,
  TbPlayerPause,
  TbPlayerPlay,
  TbCloud,
  TbX,
  TbCurrentLocation,
  TbInfoCircle,
  TbPhone,
  TbMail,
  TbWorld,
  TbBuildingSkyscraper,
  TbBrandFacebook,
  TbExternalLink,
  TbSend,
} from "react-icons/tb";
import { AqiProvider, useAqi } from "../context/AqiContext";
import STATIONS, { getStation } from "../config/stations";
import useTabularData from "../hooks/useTabularData";
import useStationWeather from "../hooks/useStationWeather";
import AqiHeroCard from "../components/AqiHeroCard";
import PollutantsCard from "../components/PollutantsCard";
import AqiCategoryMeter from "../components/AqiCategoryMeter";
import { getApiBase } from "../util/apiBase";
import embLogo from "../assets/emblogo.svg";

/* ── Kiosk-specific stations: merge Zambales PM10+PM2.5 into one ── */
const KIOSK_STATIONS = (() => {
  const merged = [];
  const zambalesAdded = new Set();
  for (const s of STATIONS) {
    if (s.province === "zambales") {
      if (!zambalesAdded.has("zambales")) {
        merged.push({
          key: "zambales-merged",
          province: "zambales",
          pollutant: "pm10", // primary fetch
          pollutantLabel: "PM10 & PM2.5",
          name: "Zambales AQMS",
          address: s.address,
          lat: s.lat,
          lon: s.lon,
          merged: true, // flag for dual-pollutant display
          pollutants: ["pm10", "pm25"],
        });
        zambalesAdded.add("zambales");
      }
    } else {
      merged.push({ ...s, merged: false });
    }
  }
  return merged;
})();

const CYCLE_INTERVAL = 25000; // 25 seconds per station (longer to allow AQI data to load)

/* ── Inner content (needs AqiProvider context) ─────────────────── */
function KioskContent() {
  const { setCategory } = useAqi() || { setCategory: () => {} };

  // ── Dark mode detection ──
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

  // ── Station auto-cycling ──
  const [stationIdx, setStationIdx] = useState(0);
  const [paused, setPaused] = useState(false);
  const timerRef = useRef(null);
  const [transitioning, setTransitioning] = useState(false);

  const station = KIOSK_STATIONS[stationIdx];

  // Auto-cycle effect
  useEffect(() => {
    if (paused) return;
    timerRef.current = setInterval(() => {
      setTransitioning(true);
      setTimeout(() => {
        setStationIdx((prev) => (prev + 1) % KIOSK_STATIONS.length);
        setTransitioning(false);
      }, 400);
    }, CYCLE_INTERVAL);
    return () => clearInterval(timerRef.current);
  }, [paused]);

  const goNext = useCallback(() => {
    setTransitioning(true);
    setTimeout(() => {
      setStationIdx((prev) => (prev + 1) % KIOSK_STATIONS.length);
      setTransitioning(false);
    }, 300);
  }, []);

  const goPrev = useCallback(() => {
    setTransitioning(true);
    setTimeout(() => {
      setStationIdx((prev) => (prev - 1 + KIOSK_STATIONS.length) % KIOSK_STATIONS.length);
      setTransitioning(false);
    }, 300);
  }, []);

  // ── Data hooks ──
  const tabular = useTabularData(station.province, station.pollutant);
  // Secondary pollutant for merged Zambales (PM2.5)
  const secondaryPollutant = station.merged ? "pm25" : null;
  const tabular2 = useTabularData(
    secondaryPollutant ? station.province : null,
    secondaryPollutant,
  );
  const weather = useStationWeather(station.lat, station.lon);

  // ── Derived AQI (primary) ──
  const latestAqi = useMemo(() => {
    const row = tabular.latest;
    if (!row) return { value: null, category: null, time: null };
    const aqi = row["AQI"] ?? row["aqi"];
    const status = row["Status"] ?? row["status"];
    const dateCol = tabular.dateCol;
    const time = dateCol ? row[dateCol] : null;
    return {
      value: aqi != null ? Number(aqi) : null,
      category: status || null,
      time: time ? new Date(time).toISOString() : null,
    };
  }, [tabular.latest, tabular.dateCol]);

  // ── Derived AQI (secondary – PM2.5 for merged Zambales) ──
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

  // Push to context
  useEffect(() => {
    try {
      setCategory && setCategory(latestAqi.category);
    } catch {}
  }, [latestAqi.category]);

  // ── Progress bar for auto-cycle ──
  const [progress, setProgress] = useState(0);
  useEffect(() => {
    if (paused) return;
    setProgress(0);
    const step = 50; // ms
    const iv = setInterval(() => {
      setProgress((p) => {
        const next = p + (step / CYCLE_INTERVAL) * 100;
        return next >= 100 ? 100 : next;
      });
    }, step);
    return () => clearInterval(iv);
  }, [stationIdx, paused]);

  // ── Station dots ──
  const stationDots = KIOSK_STATIONS.map((s, i) => (
    <button
      key={s.key}
      className={`kiosk-dot${i === stationIdx ? " kiosk-dot--active" : ""}`}
      onClick={() => {
        setTransitioning(true);
        setTimeout(() => {
          setStationIdx(i);
          setTransitioning(false);
        }, 300);
      }}
      aria-label={s.name}
    />
  ));

  // ── Current time ──
  const [now, setNow] = useState(dayjs());
  useEffect(() => {
    const iv = setInterval(() => setNow(dayjs()), 1000);
    return () => clearInterval(iv);
  }, []);

  // ── Modal states ──
  const [tabularModalOpen, setTabularModalOpen] = useState(false);
  const [mapModalOpen, setMapModalOpen] = useState(false);

  // Pause auto-cycle when modals are open
  useEffect(() => {
    if (tabularModalOpen || mapModalOpen) {
      setPaused(true);
    }
  }, [tabularModalOpen, mapModalOpen]);

  return (
    <div className="kiosk-page">
      {/* ── Top Bar ── */}
      <header className="kiosk-header">
        <div className="kiosk-brand">
          <img src={embLogo} alt="EMB" className="kiosk-logo" />
          <div className="kiosk-brand-text">
            <span className="kiosk-brand-title">EMB Region III</span>
            <span className="kiosk-brand-sub">
              Air Quality Monitoring System
            </span>
          </div>
        </div>
        <div className="kiosk-clock">
          <span className="kiosk-clock-time">{now.format("h:mm:ss A")}</span>
          <span className="kiosk-clock-date">
            {now.format("dddd, MMMM D, YYYY")}
          </span>
        </div>
      </header>

      {/* ── Station Carousel Controls ── */}
      <div className="kiosk-carousel-controls">
        <button
          className="kiosk-nav-btn"
          onClick={goPrev}
          aria-label="Previous station"
        >
          <TbArrowLeft size={18} />
        </button>
        <div className="kiosk-station-indicator">
          <div className="kiosk-dots">{stationDots}</div>
          <div className="kiosk-station-label">
            <TbMapPin size={14} />
            <span>{station.name}</span>
            <span className="kiosk-station-addr">{station.address}</span>
          </div>
        </div>
        <button
          className="kiosk-nav-btn"
          onClick={() => setPaused((p) => !p)}
          aria-label={paused ? "Resume" : "Pause"}
        >
          {paused ? <TbPlayerPlay size={18} /> : <TbPlayerPause size={18} />}
        </button>
        <button
          className="kiosk-nav-btn"
          onClick={goNext}
          aria-label="Next station"
        >
          <TbArrowRight size={18} />
        </button>
      </div>

      {/* ── Progress bar ── */}
      {!paused && (
        <div className="kiosk-progress-track">
          <div
            className="kiosk-progress-bar"
            style={{ width: `${progress}%` }}
          />
        </div>
      )}

      {/* ── Main Content (card-like fade transition) ── */}
      <main className={`kiosk-main${transitioning ? " kiosk-main--fade" : ""}`}>
        {/* AQI Hero Card (merged: dual gauges in one card) */}
        <section className="kiosk-section kiosk-hero-section">
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
            pollutantLabel={station.merged ? "PM10" : station.pollutantLabel}
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
            aqiValue2={station.merged ? latestAqi2?.value : undefined}
            aqiCategory2={station.merged ? latestAqi2?.category : undefined}
            aqiTime2={station.merged ? latestAqi2?.time : undefined}
            aqiLoading2={station.merged ? tabular2.loading : undefined}
            pollutantLabel2={station.merged ? "PM2.5" : undefined}
          />
        </section>

        {/* AQI Category Meter - full width below hero */}
        <section className="kiosk-section" style={{ padding: "16px 24px" }}>
          <AqiCategoryMeter
            value={latestAqi.value}
            category={latestAqi.category}
            loading={tabular.loading}
            label={station.merged ? "PM10" : undefined}
          />
          {station.merged && (
            <div style={{ marginTop: 12 }}>
              <AqiCategoryMeter
                value={latestAqi2?.value}
                category={latestAqi2?.category}
                loading={tabular2.loading}
                label="PM2.5"
              />
            </div>
          )}
        </section>

        {/* Major Air Pollutants - full width */}
        <section className="kiosk-section">
          <PollutantsCard latitude={station.lat} longitude={station.lon} />
        </section>
      </main>

      {/* ── Floating Bottom Navigation ── */}
      <nav className="kiosk-bottom-nav">
        <button
          className="kiosk-bottom-btn kiosk-bottom-btn--active"
          onClick={() => {
            /* already on kiosk overview */
          }}
        >
          <TbLayoutDashboard size={22} />
          <span>Overview</span>
        </button>
        <button
          className="kiosk-bottom-btn"
          onClick={() => setTabularModalOpen(true)}
        >
          <TbTable size={22} />
          <span>Tabular Results</span>
        </button>
        <button
          className="kiosk-bottom-btn"
          onClick={() => setMapModalOpen(true)}
        >
          <TbMap2 size={22} />
          <span>Map</span>
        </button>
      </nav>

      {/* ── Tabular Results Modal ── */}
      <KioskTabularModal
        open={tabularModalOpen}
        onClose={() => setTabularModalOpen(false)}
        station={station}
        tabular={tabular}
        tabular2={station.merged ? tabular2 : null}
        dark={dark}
      />

      {/* ── Map Modal ── */}
      <KioskMapModal
        open={mapModalOpen}
        onClose={() => setMapModalOpen(false)}
        dark={dark}
      />
    </div>
  );
}

/* ── Status colour helpers (same as TabularResults) ───────────── */
const STATUS_OPTIONS = [
  { value: "Good", color: "#52c41a" },
  { value: "Fair", color: "#d4b106" },
  { value: "Unhealthy for Sensitive Groups", color: "#fa8c16" },
  { value: "Very Unhealthy", color: "#f5222d" },
  { value: "Acutely Unhealthy", color: "#722ed1" },
  { value: "Emergency", color: "#a8071a" },
];

function statusTint(status) {
  const s = String(status || "").toLowerCase();
  if (!s) return null;
  const found = STATUS_OPTIONS.find((o) =>
    s.includes(o.value.toLowerCase().split(" ")[0]),
  );
  return found?.color ?? null;
}

/* ── CSV Export helper ───────────────────────────────────────── */
function exportToCsv(columns, rows, filename) {
  const esc = (v) => {
    if (v == null) return "";
    const s = String(v);
    if (s.includes(",") || s.includes('"') || s.includes("\n"))
      return `"${s.replace(/"/g, '""')}"`;
    return s;
  };
  const header = columns.map(esc).join(",");
  const body = rows
    .map((r) => columns.map((c) => esc(r[c])).join(","))
    .join("\n");
  const blob = new Blob(["\uFEFF" + header + "\n" + body], {
    type: "text/csv;charset=utf-8;",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

/* ── Parse date strings back (for filter comparison) ─────────── */
const MONTH_ABBR_MAP = {
  Jan: 0, Feb: 1, Mar: 2, Apr: 3, May: 4, Jun: 5,
  Jul: 6, Aug: 7, Sep: 8, Oct: 9, Nov: 10, Dec: 11,
};
function parseFormattedDate(s) {
  if (!s) return null;
  const m = String(s).match(
    /^([A-Za-z]{3})\s+(\d{1,2}),\s*(\d{4})\s+(\d{1,2}):(\d{2})\s*(AM|PM)$/i,
  );
  if (!m) return null;
  const mon = MONTH_ABBR_MAP[m[1].charAt(0).toUpperCase() + m[1].slice(1).toLowerCase()];
  if (mon == null) return null;
  let h = Number(m[4]);
  const ampm = m[6].toUpperCase();
  if (ampm === "PM" && h < 12) h += 12;
  if (ampm === "AM" && h === 12) h = 0;
  return new Date(Number(m[3]), mon, Number(m[2]), h, Number(m[5]));
}

/* ── Province display name ───────────────────────────────────── */
const PROVINCE_LABELS = {
  meycauayan: "Meycauayan",
  zambales: "Zambales",
  clark: "Clark",
  "san-fernando": "San Fernando",
};

/* ══════════════════════════════════════════════════════════════════
   Kiosk Tabular Modal
   Full-featured table with filters, export, and email sharing
   ══════════════════════════════════════════════════════════════════ */
function KioskTabularModal({ open, onClose, station, tabular, tabular2, dark }) {
  const { token } = theme.useToken();
  const [activePollutant, setActivePollutant] = useState("pm10");
  const [showFilters, setShowFilters] = useState(false);
  const [filters, setFilters] = useState({
    dateRange: null,
    statuses: [],
    aqiRange: [0, 500],
    concentrationSearch: "",
  });

  // Email modal state
  const [emailModalOpen, setEmailModalOpen] = useState(false);
  const [emailTo, setEmailTo] = useState("");
  const [emailSending, setEmailSending] = useState(false);

  const clearFilters = useCallback(() => {
    setFilters({ dateRange: null, statuses: [], aqiRange: [0, 500], concentrationSearch: "" });
  }, []);

  // Determine which tabular data to show
  const activeTabular = activePollutant === "pm25" && tabular2 ? tabular2 : tabular;
  const pollutantLabel = activePollutant === "pm25" ? "PM2.5" : "PM10";
  const provinceLabel = PROVINCE_LABELS[station?.province] || station?.province || "";

  const columns = useMemo(() => {
    if (!activeTabular?.raw?.columns) return [];
    return activeTabular.raw.columns;
  }, [activeTabular?.raw?.columns]);

  const dataSource = useMemo(() => {
    const rows = activeTabular?.rows || [];
    return rows.map((r, idx) => ({ __key: idx, ...r }));
  }, [activeTabular?.rows]);

  // Apply filters
  const filteredData = useMemo(() => {
    const dateKey = columns.find((c) => /date|time/i.test(c));
    return dataSource.filter((row) => {
      if (filters.dateRange && filters.dateRange[0] && filters.dateRange[1] && dateKey) {
        const d = parseFormattedDate(row[dateKey]);
        if (d) {
          const start = filters.dateRange[0].startOf("day").toDate();
          const end = filters.dateRange[1].endOf("day").toDate();
          if (d < start || d > end) return false;
        }
      }
      if (filters.statuses.length > 0) {
        const rs = String(row["Status"] || "");
        if (!filters.statuses.some((s) => rs === s)) return false;
      }
      if (filters.aqiRange[0] > 0 || filters.aqiRange[1] < 500) {
        const a = row["AQI"];
        if (a != null && typeof a === "number") {
          if (a < filters.aqiRange[0] || a > filters.aqiRange[1]) return false;
        }
      }
      if (filters.concentrationSearch) {
        const concKey = columns.find((c) => /concentration/i.test(c));
        if (concKey) {
          const val = String(row[concKey] ?? "");
          if (!val.includes(filters.concentrationSearch)) return false;
        }
      }
      return true;
    });
  }, [dataSource, columns, filters]);

  const activeFilterCount = useMemo(() => {
    let n = 0;
    if (filters.dateRange && filters.dateRange[0]) n++;
    if (filters.statuses.length) n++;
    if (filters.aqiRange[0] > 0 || filters.aqiRange[1] < 500) n++;
    if (filters.concentrationSearch) n++;
    return n;
  }, [filters]);

  // Table columns
  const tableColumns = useMemo(() => {
    const filtered = columns.filter(
      (c) => !(/aqi/i.test(c) && (/category/i.test(c) || /µg/i.test(c))),
    );
    return filtered.map((c) => ({
      title: c,
      dataIndex: c,
      key: c,
      ellipsis: true,
      ...(c === "AQI" && {
        sorter: (a, b) => (a["AQI"] ?? 0) - (b["AQI"] ?? 0),
      }),
      render: (v) => {
        if (c === "Status") {
          const t = statusTint(v);
          const txt = v == null ? "" : String(v);
          if (!txt) return "";
          return t ? <Tag color={t}>{txt}</Tag> : <Tag>{txt}</Tag>;
        }
        if (c === "AQI" && (v == null || v === "")) return "";
        if (c.toLowerCase().includes("rolling average") && typeof v === "number") return v.toFixed(2);
        return v == null ? "" : String(v);
      },
    }));
  }, [columns]);

  // Export
  const handleExport = useCallback(() => {
    if (!filteredData.length) return;
    const visibleCols = columns.filter(
      (c) => !(/aqi/i.test(c) && (/category/i.test(c) || /µg/i.test(c))),
    );
    const now = new Date();
    const ts = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}${String(now.getDate()).padStart(2, "0")}`;
    const filename = `${provinceLabel.replace(/\s+/g, "_")}_${pollutantLabel}_${ts}.csv`;
    exportToCsv(visibleCols, filteredData, filename);
    message.success(`Exported ${filteredData.length.toLocaleString()} records`);
  }, [filteredData, columns, provinceLabel, pollutantLabel]);

  // Email sharing
  const handleEmailShare = useCallback(async () => {
    if (!emailTo || !filteredData.length) return;
    setEmailSending(true);
    try {
      const base = getApiBase();
      const visibleCols = columns.filter(
        (c) => !(/aqi/i.test(c) && (/category/i.test(c) || /µg/i.test(c))),
      );
      const res = await fetch(`${base}/api/share-email`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          to: emailTo,
          province: provinceLabel,
          pollutant: pollutantLabel,
          columns: visibleCols,
          rows: filteredData.slice(0, 500), // limit to 500 rows for email
          totalRows: filteredData.length,
          filters: {
            dateRange: filters.dateRange
              ? [filters.dateRange[0]?.format("YYYY-MM-DD"), filters.dateRange[1]?.format("YYYY-MM-DD")]
              : null,
            statuses: filters.statuses,
            aqiRange: filters.aqiRange,
          },
        }),
      });
      if (!res.ok) throw new Error("Failed to send email");
      message.success(`Report sent to ${emailTo}`);
      setEmailModalOpen(false);
      setEmailTo("");
    } catch (e) {
      message.error(e.message || "Failed to send email");
    } finally {
      setEmailSending(false);
    }
  }, [emailTo, filteredData, columns, provinceLabel, pollutantLabel, filters]);

  const { RangePicker } = DatePicker;

  return (
    <Modal
      title={null}
      open={open}
      onCancel={onClose}
      footer={null}
      width="95vw"
      style={{ top: 20, maxWidth: 1200 }}
      centered={false}
      destroyOnClose
      className="kiosk-tabular-modal"
    >
      <div className="kiosk-modal-header">
        <div>
          <h2 style={{ margin: 0, fontSize: 18 }}>
            📊 Tabular Results — {provinceLabel}
          </h2>
          <p style={{ margin: "4px 0 0", opacity: 0.6, fontSize: 12 }}>
            {pollutantLabel} data from Google Sheets
          </p>
        </div>
        <Space size="small" wrap>
          {station?.merged && (
            <Segmented
              size="small"
              value={activePollutant}
              onChange={setActivePollutant}
              options={[
                { value: "pm10", label: "PM10" },
                { value: "pm25", label: "PM2.5" },
              ]}
            />
          )}
          <Button
            icon={<FilterOutlined />}
            size="small"
            onClick={() => setShowFilters((v) => !v)}
            type={activeFilterCount > 0 ? "primary" : "default"}
            ghost={activeFilterCount > 0}
          >
            Filters{activeFilterCount > 0 ? ` (${activeFilterCount})` : ""}
          </Button>
          <Button
            icon={<ReloadOutlined />}
            size="small"
            onClick={activeTabular.retry}
            loading={activeTabular.loading}
          />
          <Button
            icon={<DownloadOutlined />}
            size="small"
            onClick={handleExport}
            disabled={activeTabular.loading || !filteredData.length}
          >
            Export
          </Button>
          <Button
            icon={<MailOutlined />}
            size="small"
            onClick={() => setEmailModalOpen(true)}
            disabled={activeTabular.loading || !filteredData.length}
          >
            Email
          </Button>
        </Space>
      </div>

      {/* Filters */}
      {showFilters && (
        <div style={{
          marginBottom: 12,
          padding: "10px 14px",
          background: token.colorFillAlter,
          borderRadius: 8,
          border: `1px solid ${token.colorBorderSecondary}`,
        }}>
          <Space wrap size="middle" style={{ width: "100%" }}>
            <div>
              <div style={{ fontSize: 11, fontWeight: 600, marginBottom: 2 }}>Date Range</div>
              <RangePicker
                size="small"
                value={filters.dateRange}
                onChange={(v) => setFilters((f) => ({ ...f, dateRange: v }))}
                allowClear
                style={{ width: 250 }}
              />
            </div>
            <div>
              <div style={{ fontSize: 11, fontWeight: 600, marginBottom: 2 }}>Status</div>
              <Select
                mode="multiple"
                placeholder="All"
                size="small"
                style={{ minWidth: 180 }}
                value={filters.statuses}
                onChange={(v) => setFilters((f) => ({ ...f, statuses: v }))}
                allowClear
                maxTagCount={2}
                options={STATUS_OPTIONS.map((o) => ({
                  label: <Tag color={o.color}>{o.value}</Tag>,
                  value: o.value,
                }))}
              />
            </div>
            <div>
              <div style={{ fontSize: 11, fontWeight: 600, marginBottom: 2 }}>
                AQI Range ({filters.aqiRange[0]}–{filters.aqiRange[1]})
              </div>
              <Slider
                range
                min={0}
                max={500}
                value={filters.aqiRange}
                onChange={(v) => setFilters((f) => ({ ...f, aqiRange: v }))}
                style={{ width: 180 }}
              />
            </div>
            <div>
              <div style={{ fontSize: 11, fontWeight: 600, marginBottom: 2 }}>Concentration</div>
              <Space.Compact>
                <Input
                  placeholder="Search…"
                  size="small"
                  value={filters.concentrationSearch}
                  onChange={(e) => setFilters((f) => ({ ...f, concentrationSearch: e.target.value }))}
                  allowClear
                  style={{ width: 120 }}
                />
                <Button icon={<ClearOutlined />} size="small" onClick={clearFilters} title="Clear all" />
              </Space.Compact>
            </div>
          </Space>
        </div>
      )}

      {/* Summary */}
      <div style={{ marginBottom: 6, fontSize: 12, opacity: 0.6 }}>
        Showing {filteredData.length.toLocaleString()} of {dataSource.length.toLocaleString()} records
        {activeFilterCount > 0 && (
          <> · <a onClick={clearFilters} style={{ fontSize: 12 }}>Clear filters</a></>
        )}
        {activeTabular?.fetchedAt && (
          <span style={{ float: "right" }}>
            Updated {new Date(activeTabular.fetchedAt).toLocaleTimeString()}
          </span>
        )}
      </div>

      {/* Table */}
      {activeTabular.loading ? (
        <div style={{ padding: "48px 0", textAlign: "center" }}>
          <Spin size="large" />
          <div style={{ marginTop: 12, opacity: 0.6 }}>Loading data…</div>
        </div>
      ) : (
        <Table
          size="small"
          rowKey="__key"
          columns={tableColumns}
          dataSource={filteredData}
          pagination={{
            pageSize: 25,
            showSizeChanger: true,
            pageSizeOptions: ["25", "50", "100"],
            showTotal: (total, range) => `${range[0]}-${range[1]} of ${total}`,
          }}
          scroll={{ x: "max-content", y: "55vh" }}
        />
      )}

      {/* Email sharing sub-modal */}
      <Modal
        title="📧 Share via Email"
        open={emailModalOpen}
        onCancel={() => setEmailModalOpen(false)}
        onOk={handleEmailShare}
        confirmLoading={emailSending}
        okText="Send Report"
        okButtonProps={{ disabled: !emailTo || !filteredData.length, icon: <TbSend size={14} /> }}
        width={420}
      >
        <p style={{ marginBottom: 12, opacity: 0.7, fontSize: 13 }}>
          Send a summary report of <strong>{filteredData.length.toLocaleString()}</strong> records
          ({provinceLabel} — {pollutantLabel}) to an email address.
        </p>
        <Input
          placeholder="recipient@example.com"
          prefix={<MailOutlined />}
          value={emailTo}
          onChange={(e) => setEmailTo(e.target.value)}
          onPressEnter={handleEmailShare}
        />
        <p style={{ marginTop: 8, fontSize: 11, opacity: 0.5 }}>
          The report includes up to 500 rows with current filters applied.
          Sent from embr3.aqimonitoring@gmail.com.
        </p>
      </Modal>
    </Modal>
  );
}

/* ══════════════════════════════════════════════════════════════════
   Kiosk Map Modal 
   Embedded Google Maps with station markers (no redirect)
   ══════════════════════════════════════════════════════════════════ */
function KioskMapModal({ open, onClose, dark }) {
  const [focusStation, setFocusStation] = useState(null);

  const mapSrc = useMemo(() => {
    if (focusStation) {
      return `https://www.google.com/maps?q=${focusStation.lat},${focusStation.lon}&z=15&output=embed`;
    }
    return "https://www.google.com/maps?q=15.0,120.7&z=8&output=embed";
  }, [focusStation]);

  return (
    <Modal
      title={null}
      open={open}
      onCancel={onClose}
      footer={null}
      width="95vw"
      style={{ top: 20, maxWidth: 1100 }}
      centered={false}
      destroyOnClose
      className="kiosk-map-modal"
    >
      <div className="kiosk-modal-header" style={{ marginBottom: 12 }}>
        <h2 style={{ margin: 0, fontSize: 18 }}>
          🗺️ Station Network Map
        </h2>
        <p style={{ margin: "4px 0 0", opacity: 0.6, fontSize: 12 }}>
          EMB Region III Air Quality Monitoring Stations
        </p>
      </div>
      <div style={{ display: "flex", gap: 12, height: "65vh" }}>
        {/* Map iframe */}
        <div style={{ flex: 1, borderRadius: 10, overflow: "hidden", border: "1px solid var(--aqm-border, #d9d9d9)" }}>
          <iframe
            key={mapSrc}
            src={mapSrc}
            style={{ width: "100%", height: "100%", border: 0 }}
            allowFullScreen
            loading="lazy"
            referrerPolicy="no-referrer-when-downgrade"
            title="Google Maps – Station Network"
          />
        </div>
        {/* Station list sidebar */}
        <div style={{
          width: 260,
          overflowY: "auto",
          display: "flex",
          flexDirection: "column",
          gap: 8,
        }}>
          {STATIONS.map((s) => (
            <div
              key={s.key}
              role="button"
              tabIndex={0}
              onClick={() => setFocusStation((prev) => (prev?.key === s.key ? null : s))}
              onKeyDown={(e) => e.key === "Enter" && setFocusStation((prev) => (prev?.key === s.key ? null : s))}
              style={{
                padding: "10px 12px",
                borderRadius: 8,
                cursor: "pointer",
                background: focusStation?.key === s.key
                  ? "var(--aqm-accent-bg, #1677ff15)"
                  : "var(--aqm-card-bg, #fafafa)",
                border: focusStation?.key === s.key
                  ? "1px solid var(--aqm-accent, #1677ff)"
                  : "1px solid var(--aqm-border, #f0f0f0)",
                transition: "all 0.2s",
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 2 }}>
                <TbMapPin size={14} style={{ color: "var(--aqm-accent, #1677ff)" }} />
                <strong style={{ fontSize: 13 }}>{s.name}</strong>
              </div>
              <div style={{ fontSize: 11, opacity: 0.6, marginBottom: 4 }}>{s.address}</div>
              <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <Tag color="blue" style={{ margin: 0, fontSize: 10 }}>{s.pollutantLabel}</Tag>
                <span style={{ fontSize: 10, opacity: 0.5 }}>
                  {s.lat.toFixed(3)}, {s.lon.toFixed(3)}
                </span>
              </div>
              {focusStation?.key === s.key && (
                <div style={{ marginTop: 6, display: "flex", gap: 6 }}>
                  <a
                    href={`https://www.google.com/maps?q=${s.lat},${s.lon}&z=15`}
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={(e) => e.stopPropagation()}
                    style={{ fontSize: 11, display: "flex", alignItems: "center", gap: 3 }}
                  >
                    <TbExternalLink size={12} /> Google Maps
                  </a>
                </div>
              )}
            </div>
          ))}

          {/* EMB Region 3 contact card */}
          <div style={{
            marginTop: 8,
            padding: "10px 12px",
            borderRadius: 8,
            background: "var(--aqm-card-bg, #fafafa)",
            border: "1px solid var(--aqm-border, #f0f0f0)",
            fontSize: 11,
          }}>
            <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 6, fontWeight: 600, fontSize: 12 }}>
              <TbBuildingSkyscraper size={14} />
              EMB Region 3
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 3 }}>
              <TbPhone size={12} />
              (045) 963-3623
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 3 }}>
              <TbMail size={12} />
              <a href="mailto:emb_region3@emb.gov.ph" style={{ fontSize: 11 }}>emb_region3@emb.gov.ph</a>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <TbWorld size={12} />
              <a href="https://r3.emb.gov.ph" target="_blank" rel="noopener noreferrer" style={{ fontSize: 11 }}>r3.emb.gov.ph</a>
            </div>
          </div>
        </div>
      </div>
    </Modal>
  );
}

/* ── Wrapper with providers ────────────────────────────────────── */
export default function KioskPage() {
  // Detect dark mode at wrapper level for ConfigProvider
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

  // Set document title
  useEffect(() => {
    document.title = `EMBR3 Air Quality Monitoring – Kiosk (${new Date().getFullYear()})`;
  }, []);

  return (
    <ConfigProvider
      theme={{
        algorithm: dark ? theme.darkAlgorithm : theme.defaultAlgorithm,
      }}
    >
      <AqiProvider>
        <KioskContent />
      </AqiProvider>
    </ConfigProvider>
  );
}
