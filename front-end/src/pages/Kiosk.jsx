import { useEffect, useState, useMemo, useCallback, useRef } from "react";
import {
  ConfigProvider,
  theme,
  Spin,
  Modal,
  Table,
  Tag,
  Button,
  Space,
  Segmented,
  message,
} from "antd";
import {
  ReloadOutlined,
  MailOutlined,
} from "@ant-design/icons";
import dayjs from "dayjs";
import {
  TbLayoutDashboard,
  TbTable,
  TbMap2,
  TbMapPin,
  TbArrowRight,
  TbArrowLeft,
  TbPlayerPause,
  TbPlayerPlay,
  TbInfoCircle,
  TbPhone,
  TbMail,
  TbWorld,
  TbBuildingSkyscraper,
  TbExternalLink,
  TbSun,
  TbMoon,
  TbEye,
  TbBrandFacebook,
  TbBrandInstagram,
  TbBrandX,
  TbBrandYoutube,
} from "react-icons/tb";
import { AqiProvider, useAqi } from "../context/AqiContext";
import STATIONS, { getStationPhoto, getUniqueLocations, bgEmbPhoto } from "../config/stations";
import useTabularData, { prefetchTabularData } from "../hooks/useTabularData";
import useStationWeather, { prefetchStationWeather } from "../hooks/useStationWeather";
import AqiHeroCard from "../components/AqiHeroCard";
import HourlyWeatherCard, { prefetchHourlyWeather } from "../components/HourlyWeatherCard";
import WindMapCard from "../components/WindMapCard";
import ConnectionErrorCard from "../components/ConnectionErrorCard";
import embLogo from "../assets/emblogo.svg";
import artaVideo from "../assets/ARTA.mp4";
import "./Kiosk.css";

/* ── Kiosk-specific stations: merge multi-pollutant provinces into one ── */
const KIOSK_STATIONS = (() => {
  const merged = [];
  const provinceAdded = new Set();
  for (const s of STATIONS) {
    // Check if this province has multiple pollutants
    const siblings = STATIONS.filter((o) => o.province === s.province);
    if (siblings.length > 1) {
      if (!provinceAdded.has(s.province)) {
        const labels = siblings.map((o) => o.pollutantLabel);
        merged.push({
          key: `${s.province}-merged`,
          province: s.province,
          pollutant: siblings[0].pollutant, // primary fetch
          pollutantLabel: labels.join(" & "),
          name: s.name.replace(/\s*\(.*?\)\s*$/, "") || s.name,
          address: s.address,
          lat: s.lat,
          lon: s.lon,
          merged: true,
          pollutants: siblings.map((o) => o.pollutant),
        });
        provinceAdded.add(s.province);
      }
    } else {
      merged.push({ ...s, merged: false });
    }
  }
  merged.sort((a, b) => a.name.localeCompare(b.name));
  return merged;
})();

const CYCLE_INTERVAL = 25000; // 25 seconds per station (longer to allow AQI data to load)
const TRANSITION_MS = 300;

function getNextRotationState(currentState, isArtaDisplayEnabled) {
  if (!isArtaDisplayEnabled) {
    return {
      stationIdx: (currentState.stationIdx + 1) % KIOSK_STATIONS.length,
      showCommercialBreak: false,
    };
  }

  if (currentState.showCommercialBreak) {
    return {
      stationIdx: (currentState.stationIdx + 1) % KIOSK_STATIONS.length,
      showCommercialBreak: false,
    };
  }

  return {
    stationIdx: currentState.stationIdx,
    showCommercialBreak: true,
  };
}

function getPreviousRotationState(currentState, isArtaDisplayEnabled) {
  if (!isArtaDisplayEnabled) {
    return {
      stationIdx: (currentState.stationIdx - 1 + KIOSK_STATIONS.length) % KIOSK_STATIONS.length,
      showCommercialBreak: false,
    };
  }

  if (currentState.showCommercialBreak) {
    return {
      stationIdx: currentState.stationIdx,
      showCommercialBreak: false,
    };
  }

  return {
    stationIdx: (currentState.stationIdx - 1 + KIOSK_STATIONS.length) % KIOSK_STATIONS.length,
    showCommercialBreak: true,
  };
}

/* ── Inner content (needs AqiProvider context) ─────────────────── */
function KioskContent({ withArta = false }) {
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
  const [rotationState, setRotationState] = useState({
    stationIdx: 0,
    showCommercialBreak: false,
  });
  const [paused, setPaused] = useState(false);
  const timerRef = useRef(null);
  const transitionRef = useRef(null);
  const commercialVideoRef = useRef(null);
  const [transitioning, setTransitioning] = useState(false);
  const [commercialLoopCount, setCommercialLoopCount] = useState(0);
  const [commercialProgress, setCommercialProgress] = useState(0);

  const isArtaEnabled = withArta;
  const stationIdx = rotationState.stationIdx;
  const isCommercialBreak = isArtaEnabled && rotationState.showCommercialBreak;

  const station = KIOSK_STATIONS[stationIdx];

  const scrollStationIntoView = useCallback(() => {
    if (window.scrollY > 0) {
      window.scrollTo({ top: 0, behavior: "smooth" });
    }
  }, []);

  const transitionSequence = useCallback((nextView, { scrollToTop = true } = {}) => {
    window.clearTimeout(transitionRef.current);
    setTransitioning(true);
    transitionRef.current = window.setTimeout(() => {
      setRotationState((currentState) => {
        const nextState = typeof nextView === "function"
          ? nextView(currentState)
          : nextView;

        return {
          stationIdx: nextState.stationIdx,
          showCommercialBreak: isArtaEnabled ? Boolean(nextState.showCommercialBreak) : false,
        };
      });
      setTransitioning(false);
      if (scrollToTop) {
        scrollStationIntoView();
      }
    }, TRANSITION_MS);
  }, [isArtaEnabled, scrollStationIntoView]);

  useEffect(() => () => window.clearTimeout(transitionRef.current), []);

  useEffect(() => {
    for (const kioskStation of KIOSK_STATIONS) {
      prefetchTabularData(kioskStation.province, kioskStation.pollutant);
      kioskStation.pollutants?.forEach((pollutant) => {
        if (pollutant !== kioskStation.pollutant) {
          prefetchTabularData(kioskStation.province, pollutant);
        }
      });
      prefetchStationWeather(kioskStation.lat, kioskStation.lon);
      prefetchHourlyWeather(kioskStation.lat, kioskStation.lon);
    }
  }, []);

  // Auto-cycle effect
  useEffect(() => {
    if (paused || isCommercialBreak) return;
    timerRef.current = setInterval(() => {
      transitionSequence((currentState) => getNextRotationState(currentState, isArtaEnabled));
    }, CYCLE_INTERVAL);
    return () => clearInterval(timerRef.current);
  }, [isArtaEnabled, isCommercialBreak, paused, transitionSequence]);

  useEffect(() => {
    if (!isCommercialBreak) {
      setCommercialLoopCount(0);
      setCommercialProgress(0);
      return;
    }

    setCommercialLoopCount(0);
    setCommercialProgress(0);
    const video = commercialVideoRef.current;
    if (video) {
      video.currentTime = 0;
      const playPromise = video.play();
      if (playPromise && typeof playPromise.catch === "function") {
        playPromise.catch(() => {});
      }
    }
  }, [isCommercialBreak, stationIdx]);

  const handleCommercialMetadata = useCallback(() => {
    const video = commercialVideoRef.current;
    if (!video) return;
    if (!Number.isFinite(video.duration) || video.duration <= 0) {
      setCommercialProgress(0);
      return;
    }

    setCommercialProgress(0);
  }, []);

  const handleCommercialTimeUpdate = useCallback(() => {
    const video = commercialVideoRef.current;
    if (!video) return;
    if (!Number.isFinite(video.duration) || video.duration <= 0) return;

    const totalDuration = video.duration * 2;
    const completedDuration = commercialLoopCount * video.duration + video.currentTime;
    setCommercialProgress(Math.min(100, (completedDuration / totalDuration) * 100));
  }, [commercialLoopCount]);

  const handleCommercialVideoEnded = useCallback(() => {
    const video = commercialVideoRef.current;
    if (!video) return;

    if (commercialLoopCount < 1) {
      setCommercialLoopCount(1);
      setCommercialProgress(50);
      video.currentTime = 0;
      const playPromise = video.play();
      if (playPromise && typeof playPromise.catch === "function") {
        playPromise.catch(() => {});
      }
      return;
    }

    setCommercialProgress(100);
    transitionSequence((currentState) => getNextRotationState(currentState, true));
  }, [commercialLoopCount, transitionSequence]);

  const goNext = useCallback(() => {
    transitionSequence((currentState) => getNextRotationState(currentState, isArtaEnabled));
  }, [isArtaEnabled, transitionSequence]);

  const goPrev = useCallback(() => {
    transitionSequence((currentState) => getPreviousRotationState(currentState, isArtaEnabled));
  }, [isArtaEnabled, transitionSequence]);

  /** Navigate to a specific station by province key (from carousel click) */
  const goToStation = useCallback((province) => {
    const idx = KIOSK_STATIONS.findIndex(
      (s) => s.province === province,
    );
    if (idx >= 0 && idx !== stationIdx) {
      transitionSequence({ stationIdx: idx, showCommercialBreak: false });
    } else if (idx === stationIdx) {
      if (isCommercialBreak) {
        transitionSequence({ stationIdx: idx, showCommercialBreak: false });
      } else {
        scrollStationIntoView();
      }
    }
  }, [isCommercialBreak, scrollStationIntoView, stationIdx, transitionSequence]);

  // ── Data hooks ──
  const tabular = useTabularData(station.province, station.pollutant);
  // Secondary pollutant for merged stations (e.g. PM2.5)
  const secondaryPollutant = station.merged && station.pollutants?.length > 1
    ? station.pollutants.find((p) => p !== station.pollutant) || null
    : null;
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
    let isoTime = null;
    if (time) {
      const d = new Date(time);
      if (!isNaN(d.getTime())) isoTime = d.toISOString();
    }
    return {
      value: aqi != null ? Number(aqi) : null,
      category: status || null,
      time: isoTime,
    };
  }, [tabular.latest, tabular.dateCol]);

  // Detect stale data (>7 days old)
  const isStale = useMemo(() => {
    if (!latestAqi.time) return false;
    const latest = new Date(latestAqi.time);
    if (isNaN(latest.getTime())) return false;
    const diffDays = (Date.now() - latest.getTime()) / (1000 * 60 * 60 * 24);
    return diffDays > 7;
  }, [latestAqi.time]);

  // ── Derived AQI (secondary – PM2.5 for merged Zambales) ──
  const latestAqi2 = useMemo(() => {
    if (!station.merged) return null;
    const row = tabular2.latest;
    if (!row) return { value: null, category: null, time: null };
    const aqi = row["AQI"] ?? row["aqi"];
    const status = row["Status"] ?? row["status"];
    const dateCol = tabular2.dateCol;
    const time = dateCol ? row[dateCol] : null;
    let isoTime = null;
    if (time) {
      const d = new Date(time);
      if (!isNaN(d.getTime())) isoTime = d.toISOString();
    }
    return {
      value: aqi != null ? Number(aqi) : null,
      category: status || null,
      time: isoTime,
    };
  }, [station.merged, tabular2.latest, tabular2.dateCol]);

  // Detect stale secondary pollutant (PM2.5)
  const isStale2 = useMemo(() => {
    if (!station.merged || !latestAqi2) return false;
    if (latestAqi2.value == null && !latestAqi2.time) return true;
    if (!latestAqi2.time) return true;
    const latest = new Date(latestAqi2.time);
    if (isNaN(latest.getTime())) return true;
    const diffDays = (Date.now() - latest.getTime()) / (1000 * 60 * 60 * 24);
    return diffDays > 7;
  }, [station.merged, latestAqi2]);

  // Push to context
  useEffect(() => {
    try {
      setCategory && setCategory(latestAqi.category);
    } catch {}
  }, [latestAqi.category]);

  // ── Progress bar for auto-cycle ──
  const [progress, setProgress] = useState(0);
  useEffect(() => {
    if (paused || isCommercialBreak) return;
    setProgress(0);
    const step = 50; // ms
    const iv = setInterval(() => {
      setProgress((p) => {
        const next = p + (step / CYCLE_INTERVAL) * 100;
        return next >= 100 ? 100 : next;
      });
    }, step);
    return () => clearInterval(iv);
  }, [isCommercialBreak, paused, stationIdx]);

  // ── Station dots ──
  const stationDots = KIOSK_STATIONS.map((s, i) => (
    <button
      key={s.key}
      className={`kiosk-dot${i === stationIdx ? " kiosk-dot--active" : ""}`}
      onClick={() => transitionSequence({ stationIdx: i, showCommercialBreak: false })}
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

  // Toggle dark/light theme
  const toggleTheme = useCallback(() => {
    document.documentElement.classList.toggle("dark");
  }, []);

  return (
    <div className={`kiosk-page${isCommercialBreak ? " kiosk-page--commercial" : ""}`}>
      {/* ── Top Bar ── */}
      <header className="kiosk-header">
        <div className="kiosk-brand">
          <img src={embLogo} alt="EMB" className="kiosk-logo" />
          <div className="kiosk-brand-text">
            <span className="kiosk-brand-title">EMB Region III</span>
            <span className="kiosk-brand-sub">
              Air Quality Monitoring Dashboard
            </span>
          </div>
        </div>
        <div className="kiosk-header-right">
          <div className="kiosk-clock">
            <span className="kiosk-clock-time">{now.format("h:mm:ss A")}</span>
            <span className="kiosk-clock-date">
              {now.format("dddd, MMMM D, YYYY")}
            </span>
          </div>
          <button
            className="kiosk-theme-btn"
            onClick={toggleTheme}
            aria-label={dark ? "Switch to light theme" : "Switch to dark theme"}
            title={dark ? "Light mode" : "Dark mode"}
          >
            {dark ? <TbSun size={20} /> : <TbMoon size={20} />}
          </button>
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
          {isCommercialBreak ? (
            <div className="kiosk-station-label kiosk-station-label--commercial" aria-hidden="true" />
          ) : (
            <div className="kiosk-station-label">
              <TbMapPin size={14} />
              <div className="kiosk-station-info-col kiosk-station-info-col--centered">
                <span>{station.name}</span>
                <span className="kiosk-station-addr">{station.address}</span>
              </div>
            </div>
          )}
        </div>
        <button
          className="kiosk-nav-btn"
          onClick={goNext}
          aria-label="Next station"
        >
          <TbArrowRight size={18} />
        </button>
      </div>

      {/* ── Progress bar ── */}
      {!paused && !isCommercialBreak && (
        <div className="kiosk-progress-track">
          <div
            className="kiosk-progress-bar"
            style={{ width: `${progress}%` }}
          />
        </div>
      )}

      {/* ── Main Content (card-like fade transition) ── */}
      <main className={`kiosk-main${transitioning ? " kiosk-main--fade" : ""}`}>
        {isCommercialBreak ? (
          <section className="kiosk-section kiosk-arta-stage-section">
            <div className="kiosk-arta-break-card kiosk-arta-break-card--stage">
              <div className="kiosk-arta-progress-panel" aria-label="ARTA commercial progress">
                <div className="kiosk-arta-progress-track">
                  <div
                    className="kiosk-arta-progress-fill"
                    style={{ width: `${commercialProgress}%` }}
                  />
                </div>
              </div>
              <div className="kiosk-arta-video-frame kiosk-arta-video-frame--stage">
                <video
                  ref={commercialVideoRef}
                  className="kiosk-arta-video"
                  autoPlay
                  muted
                  playsInline
                  preload="metadata"
                  controls={false}
                  onLoadedMetadata={handleCommercialMetadata}
                  onTimeUpdate={handleCommercialTimeUpdate}
                  onEnded={handleCommercialVideoEnded}
                >
                  <source src={artaVideo} type="video/mp4" />
                </video>
              </div>
              <div className="kiosk-arta-bulletin-panel">
                <h4 className="kiosk-arta-bulletin-title">Anti-Red Tape Authority</h4>
                <div className="kiosk-arta-bulletin-row">
                  <a
                    className="kiosk-arta-info-chip"
                    href="https://arta.gov.ph/"
                    target="_blank"
                    rel="noopener noreferrer"
                    title="Visit ARTA website"
                  >
                    <TbWorld size={15} />
                    <span>arta.gov.ph</span>
                  </a>
                  <a
                    className="kiosk-arta-info-chip"
                    href="mailto:complaints@arta.gov.ph"
                    title="Email complaints@arta.gov.ph"
                  >
                    <TbMail size={15} />
                    <span>complaints@arta.gov.ph</span>
                  </a>
                  <a
                    className="kiosk-arta-info-chip"
                    href="mailto:info@arta.gov.ph"
                    title="Email info@arta.gov.ph"
                  >
                    <TbMail size={15} />
                    <span>info@arta.gov.ph</span>
                  </a>
                </div>
                <div className="kiosk-arta-social-row">
                  <a className="kiosk-arta-social-link" href="https://facebook.com/artagovph" target="_blank" rel="noopener noreferrer" title="Facebook"><TbBrandFacebook size={17} /></a>
                  <a className="kiosk-arta-social-link" href="https://instagram.com/artagovph" target="_blank" rel="noopener noreferrer" title="Instagram"><TbBrandInstagram size={17} /></a>
                  <a className="kiosk-arta-social-link" href="https://x.com/artagovph" target="_blank" rel="noopener noreferrer" title="X"><TbBrandX size={17} /></a>
                  <a className="kiosk-arta-social-link" href="https://www.youtube.com/channel/UChQr6Tl3lqcKfMd4ANNN75w" target="_blank" rel="noopener noreferrer" title="YouTube"><TbBrandYoutube size={17} /></a>
                </div>
              </div>
            </div>
          </section>
        ) : (
          <>
            {/* Connection / API Error */}
            {(tabular.error || weather.error) && (
              <section className="kiosk-section" style={{ padding: 0 }}>
                <ConnectionErrorCard
                  error={tabular.error || weather.error}
                  onRetry={tabular.retry}
                  retrying={tabular.loading}
                  compact
                />
              </section>
            )}

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
                pollutantLabel={station.merged ? (station.pollutant === "pm10" ? "PM10" : station.pollutant === "pm25" ? "PM2.5" : station.pollutant.toUpperCase()) : station.pollutantLabel}
                isFallback={false}
                fallbackSource={""}
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
                pollutantLabel2={station.merged && secondaryPollutant ? (secondaryPollutant === "pm25" ? "PM2.5" : secondaryPollutant === "pm10" ? "PM10" : secondaryPollutant.toUpperCase()) : undefined}
                isStale={isStale}
                isStale2={isStale2}
                stationPhoto={getStationPhoto(station.province || station.key)}
              />
            </section>

            {/* Hourly Weather Forecast */}
            <section className="kiosk-section">
              <HourlyWeatherCard
                key={`hourly-${station.province || station.key}`}
                latitude={station.lat}
                longitude={station.lon}
              />
            </section>

            {/* Wind Map + Station Details (side-by-side) */}
            <div className="kiosk-wind-station-row">
              <section className="kiosk-section kiosk-station-detail-card">
                <div
                  className="kiosk-station-photo"
                  style={{
                    backgroundImage: `url(${getStationPhoto(station.province || station.key) || ""})`,
                  }}
                >
                  <div className="kiosk-station-photo-overlay" />
                  <div className="kiosk-station-photo-content">
                    <h3 className="kiosk-station-photo-name">{station.name}</h3>
                    <p className="kiosk-station-photo-addr">
                      <TbMapPin size={14} />
                      {station.address}
                    </p>
                  </div>
                </div>
                <div className="kiosk-station-info-body">
                  <div className="kiosk-station-info-grid">
                    <div className="kiosk-station-info-item">
                      <span className="kiosk-station-info-label">Pollutant</span>
                      <span className="kiosk-station-info-value">{station.pollutantLabel}</span>
                    </div>
                    <div className="kiosk-station-info-item">
                      <span className="kiosk-station-info-label">Latitude</span>
                      <span className="kiosk-station-info-value">{station.lat.toFixed(4)}</span>
                    </div>
                    <div className="kiosk-station-info-item">
                      <span className="kiosk-station-info-label">Longitude</span>
                      <span className="kiosk-station-info-value">{station.lon.toFixed(4)}</span>
                    </div>
                    <div className="kiosk-station-info-item">
                      <span className="kiosk-station-info-label">Province</span>
                      <span className="kiosk-station-info-value" style={{ textTransform: "capitalize" }}>
                        {(station.province || "").replace(/-/g, " ")}
                      </span>
                    </div>
                  </div>
                  <a
                    className="kiosk-station-gmaps-link"
                    href={`https://www.google.com/maps?q=${station.lat},${station.lon}&z=15`}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    <TbMap2 size={14} /> View on Google Maps
                  </a>
                </div>
              </section>

              <section className="kiosk-section">
                <WindMapCard
                  key={`wind-${station.province || station.key}`}
                  latitude={station.lat}
                  longitude={station.lon}
                  stationName={station.name}
                />
              </section>
            </div>

            {/* AQMS Stations Carousel */}
            <section className="kiosk-section">
              <div className="kiosk-stations-carousel">
                <div className="kiosk-carousel-header">
                  <TbMapPin size={20} />
                  <div>
                    <h3 className="kiosk-carousel-title">Air Quality Monitoring Stations</h3>
                    <p className="kiosk-carousel-subtitle">Select a station to view its air quality data</p>
                  </div>
                </div>
                <div className="kiosk-carousel-track-wrap">
                  <div className="kiosk-carousel-track">
                    {getUniqueLocations().map((s) => {
                      const photo = getStationPhoto(s.province || s.key);
                      const isActive = (station.province || station.key).replace(/-(pm10|pm25|merged)$/, "") === s.province;
                      const pollutants = STATIONS.filter((st) => st.province === s.province);
                      return (
                        <div
                          key={s.key}
                          className={`kiosk-carousel-card${isActive ? " kiosk-carousel-card--active" : ""}`}
                          onClick={() => goToStation(s.province)}
                          role="button"
                          tabIndex={0}
                          onKeyDown={(e) => e.key === "Enter" && goToStation(s.province)}
                        >
                          <div
                            className="kiosk-carousel-card-photo"
                            style={{ backgroundImage: photo ? `url(${photo})` : "none" }}
                          >
                            <div className="kiosk-carousel-card-overlay" />
                            {isActive && (
                              <div className="kiosk-carousel-card-live">
                                <span className="kiosk-carousel-live-dot" />
                                Viewing
                              </div>
                            )}
                          </div>
                          <div className="kiosk-carousel-card-body">
                            <h4 className="kiosk-carousel-card-name">
                              {s.name.replace(/\s*\(.*?\)\s*$/, "") || s.name}
                            </h4>
                            <p className="kiosk-carousel-card-addr">
                              <TbMapPin size={11} /> {s.address}
                            </p>
                            <div className="kiosk-carousel-card-meta">
                              <span className="kiosk-carousel-card-pollutant">
                                {pollutants.map((st) => st.pollutantLabel).join(" & ")}
                              </span>
                              <span className="kiosk-carousel-card-coords">
                                {s.lat.toFixed(2)}°N, {s.lon.toFixed(2)}°E
                              </span>
                            </div>
                            <div className="kiosk-carousel-card-cta">
                              {isActive ? "Currently Viewing" : "View Station"}
                              <TbArrowRight size={13} />
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            </section>

            {/* EMB Region 3 Air Quality Updates – YouTube Videos */}
            <section className="kiosk-section">
              <div className="kiosk-newsletter-card">
                <div className="kiosk-newsletter-header">
                  <TbBrandYoutube size={20} />
                  <h3 className="kiosk-newsletter-title">EMB Region 3 Air Quality Monitoring Updates</h3>
                </div>
                <div className="kiosk-videos-grid">
                  <div className="kiosk-video-tile">
                    <div className="kiosk-newsletter-video-wrap">
                      <iframe
                        className="kiosk-newsletter-video"
                        src="https://www.youtube.com/embed/s0twOwHkiok"
                        title="EMB Region 3 Air Quality Update 1"
                        allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                        allowFullScreen
                        frameBorder="0"
                        loading="lazy"
                      />
                    </div>
                  </div>
                  <div className="kiosk-video-tile">
                    <div className="kiosk-newsletter-video-wrap">
                      <iframe
                        className="kiosk-newsletter-video"
                        src="https://www.youtube.com/embed/emoJvMhCSNk"
                        title="EMB Region 3 Air Quality Update 2"
                        allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                        allowFullScreen
                        frameBorder="0"
                        loading="lazy"
                      />
                    </div>
                  </div>
                </div>
                <p className="kiosk-newsletter-desc">
                  Stay informed with the latest Air Quality updates from EMB Region 3 — monitoring, environmental programs, and community initiatives.
                </p>
              </div>
            </section>

            {/* EMBR3 Combined Agency Card – Contact + CTA */}
            <section className="kiosk-section">
              <div className="kiosk-agency-combined-card">
                <div
                  className="kiosk-agency-cta-banner"
                  style={{ backgroundImage: `url(${bgEmbPhoto})` }}
                >
                  <div className="kiosk-cta-photo-overlay" />
                  <div className="map-cta-bg-shapes">
                    <div className="map-cta-shape map-cta-shape-1" />
                    <div className="map-cta-shape map-cta-shape-2" />
                    <div className="map-cta-shape map-cta-shape-3" />
                  </div>
                  <div className="kiosk-agency-cta-inner">
                    <TbBuildingSkyscraper size={28} className="map-cta-icon" />
                    <h3 className="kiosk-agency-cta-title">Environmental Management Bureau – Region 3</h3>
                    <p className="kiosk-agency-cta-desc">
                      Protecting the environment of Central Luzon through monitoring, enforcement, and public awareness.
                    </p>
                    <div className="map-cta-buttons">
                      <a
                        className="map-cta-btn map-cta-btn-primary"
                        href="https://r3.emb.gov.ph"
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        <TbExternalLink size={16} /> Visit Website
                      </a>
                      <a
                        className="map-cta-btn map-cta-btn-secondary"
                        href="https://www.facebook.com/EMBRegion3"
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        <TbBrandFacebook size={16} /> Follow on Facebook
                      </a>
                      <a
                        className="map-cta-btn map-cta-btn-secondary"
                        href="mailto:emb_region3@emb.gov.ph"
                      >
                        <TbMail size={16} /> Email Us
                      </a>
                    </div>
                  </div>
                </div>

                <div className="kiosk-agency-contact-body">
                  <div className="kiosk-agency-contact-head">
                    <img src={embLogo} alt="EMB Logo" className="kiosk-contact-logo" />
                    <div>
                      <h4 className="kiosk-contact-title">EMB Region 3 Office</h4>
                      <p className="kiosk-contact-subtitle">Environmental Management Bureau – Central Luzon</p>
                    </div>
                  </div>
                  <div className="kiosk-contact-grid">
                    <div className="kiosk-contact-item">
                      <TbMapPin size={16} />
                      <span>Masinop cor. Matalino St., Diosdado Macapagal Government Center, Maimpis, City of San Fernando, Pampanga</span>
                    </div>
                    <div className="kiosk-contact-item">
                      <TbPhone size={16} />
                      <div>
                        <div>(045) 963-3623 (Trunk Line)</div>
                        <div style={{ fontSize: 11, opacity: 0.7 }}>ORD: local 102 · EMED: local 115/117 · CPD: local 114/106</div>
                      </div>
                    </div>
                    <div className="kiosk-contact-item">
                      <TbMail size={16} />
                      <div>
                        <a href="mailto:emb_region3@emb.gov.ph">emb_region3@emb.gov.ph</a>
                        <div style={{ fontSize: 11, opacity: 0.7 }}>Records: <a href="mailto:recordsr3@emb.gov.ph">recordsr3@emb.gov.ph</a></div>
                      </div>
                    </div>
                    <div className="kiosk-contact-item">
                      <TbWorld size={16} />
                      <a href="https://r3.emb.gov.ph" target="_blank" rel="noopener noreferrer">r3.emb.gov.ph</a>
                    </div>
                    <div className="kiosk-contact-item">
                      <TbInfoCircle size={16} />
                      <span>ISO 9001:2015 & ISO 14001:2015 Certified</span>
                    </div>
                  </div>
                </div>
              </div>
            </section>
          </>
        )}
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
        <button
          className="kiosk-bottom-btn kiosk-bottom-btn--playpause"
          onClick={() => setPaused((p) => !p)}
          aria-label={paused ? "Resume" : "Pause"}
        >
          {paused ? <TbPlayerPlay size={22} /> : <TbPlayerPause size={22} />}
          <span>{paused ? "Play" : "Pause"}</span>
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

  // Data request modal state
  const [requestOpen, setRequestOpen] = useState(false);

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

  // Table columns
  const tableColumns = useMemo(() => {
    const filtered = columns.filter(
      (c) => !(/aqi/i.test(c) && (/category/i.test(c) || /µg/i.test(c))),
    );
    return filtered.map((c) => {
      // Assign compact column widths
      let width;
      if (c === "AQI") width = 70;
      else if (c === "Status") width = 100;
      else if (/date|time/i.test(c)) width = 130;
      else if (/concentration/i.test(c)) width = 110;
      else if (/rolling average/i.test(c)) width = 110;
      else width = 100;

      return {
        title: c,
        dataIndex: c,
        key: c,
        ellipsis: true,
        width,
      ...(c === "AQI" && {
        sorter: (a, b) => (a["AQI"] ?? 0) - (b["AQI"] ?? 0),
      }),
      render: (v, row) => {
        if (c === "Status") {
          const t = statusTint(v);
          const txt = v == null ? "" : String(v);
          if (!txt) return "";
          return t ? <Tag color={t}>{txt}</Tag> : <Tag>{txt}</Tag>;
        }
        if (c === "AQI") {
          if (v == null || v === "") return "";
          const statusVal = row["Status"];
          const t = statusTint(statusVal);
          return t
            ? <Tag color={t} style={{ fontWeight: 700 }}>{typeof v === "number" ? Math.round(v) : v}</Tag>
            : <span style={{ fontWeight: 600 }}>{typeof v === "number" ? Math.round(v) : v}</span>;
        }
        if (c.toLowerCase().includes("rolling average") && typeof v === "number") return v.toFixed(2);
        return v == null ? "" : String(v);
      },
    };
    });
  }, [columns]);

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
            icon={<ReloadOutlined />}
            size="small"
            onClick={activeTabular.retry}
            loading={activeTabular.loading}
          />
          <Button
            icon={<MailOutlined />}
            size="small"
            onClick={() => setRequestOpen(true)}
          >
            Request Data
          </Button>
        </Space>
      </div>

      {/* Summary */}
      <div style={{ marginBottom: 6, fontSize: 12, opacity: 0.6 }}>
        Showing {dataSource.length.toLocaleString()} records
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
        <div style={{ position: "relative" }}>
          <Table
            size="small"
            rowKey="__key"
            columns={tableColumns}
            dataSource={dataSource.slice(0, 20)}
            pagination={false}
            scroll={{ x: 600 }}
          />
          {dataSource.length > 20 && (
            <div className="kiosk-tabular-blur-overlay">
              <div className="kiosk-tabular-blur-content">
                <div style={{ fontSize: 32, marginBottom: 8 }}>🔒</div>
                <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 4 }}>
                  Data Access Restricted
                </div>
                <div style={{ fontSize: 13, opacity: 0.7, marginBottom: 16, maxWidth: 340, textAlign: "center" }}>
                  Only the first 20 records are shown. To access the full dataset
                  ({dataSource.length.toLocaleString()} records), please submit a
                  formal request to the EMB Region 3 Records Unit.
                </div>
                <Button
                  type="primary"
                  icon={<MailOutlined />}
                  size="large"
                  onClick={() => setRequestOpen(true)}
                >
                  Request Full Data
                </Button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Data Request Modal */}
      <Modal
        title="📋 Request Air Quality Data"
        open={requestOpen}
        onCancel={() => setRequestOpen(false)}
        footer={[
          <Button key="close" onClick={() => setRequestOpen(false)}>
            Close
          </Button>,
          <Button
            key="email"
            type="primary"
            onClick={() => {
              window.location.href = `mailto:recordsr3@emb.gov.ph?subject=${encodeURIComponent(
                `Air Quality Monitoring Data Request - ${provinceLabel} ${pollutantLabel}`,
              )}&body=${encodeURIComponent(
                `Good day,\n\nI would like to request air quality monitoring data for the following:\n\n` +
                `Station: ${provinceLabel}\n` +
                `Pollutant: ${pollutantLabel}\n` +
                `Records available: ${dataSource.length}\n\n` +
                `Please process my request at your earliest convenience.\n\nThank you.`,
              )}`;
              message.success("Opening email client...");
            }}
          >
            Send Request via Email
          </Button>,
        ]}
        width={420}
      >
        <div style={{ lineHeight: 1.8, fontSize: 14 }}>
          <p style={{ marginBottom: 12 }}>
            To obtain air quality monitoring data, please submit a request to the
            <strong> EMB Region 3 Records Unit</strong>.
          </p>
          <div style={{
            background: token.colorFillAlter,
            borderRadius: 10,
            padding: "14px 18px",
            marginBottom: 14,
            border: `1px solid ${token.colorBorderSecondary}`,
          }}>
            <div style={{ fontWeight: 600, marginBottom: 6 }}>📧 Records Unit Email</div>
            <a href="mailto:recordsr3@emb.gov.ph" style={{ fontSize: 16, fontWeight: 700, color: token.colorLink }}>
              recordsr3@emb.gov.ph
            </a>
          </div>
          <div style={{
            background: token.colorFillAlter,
            borderRadius: 10,
            padding: "14px 18px",
            border: `1px solid ${token.colorBorderSecondary}`,
          }}>
            <div style={{ fontWeight: 600, marginBottom: 6 }}>📍 Current Station</div>
            <div>{provinceLabel} — {pollutantLabel}</div>
            <div style={{ marginTop: 4, fontSize: 12, opacity: 0.7 }}>
              {dataSource.length.toLocaleString()} records available
            </div>
          </div>
          <p style={{ marginTop: 14, fontSize: 12, opacity: 0.6 }}>
            Click <strong>"Send Request via Email"</strong> to open your email client
            with a pre-filled request template.
          </p>
        </div>
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
      <div className="kiosk-map-layout">
        {/* Map iframe with floating card */}
        <div className="kiosk-map-iframe-wrap">
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
        <div className="kiosk-map-station-list">
          {STATIONS.map((s) => (
            <div
              key={s.key}
              role="button"
              tabIndex={0}
              onClick={() => setFocusStation((prev) => (prev?.key === s.key ? null : s))}
              onKeyDown={(e) => e.key === "Enter" && setFocusStation((prev) => (prev?.key === s.key ? null : s))}
              className={`kiosk-map-stn-card${focusStation?.key === s.key ? " kiosk-map-stn-card--active" : ""}`}
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
                  <a
                    href={`https://www.google.com/maps?q=${s.lat},${s.lon}&layer=c&cbll=${s.lat},${s.lon}&cbp=12,0,0,0,0`}
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={(e) => e.stopPropagation()}
                    style={{ fontSize: 11, display: "flex", alignItems: "center", gap: 3 }}
                  >
                    <TbEye size={12} /> Street View
                  </a>
                </div>
              )}
            </div>
          ))}

          {/* EMB Region 3 contact card */}
          <div className="kiosk-map-stn-card kiosk-map-contact-card">
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
export default function KioskPage({ withArta = false }) {
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
        <KioskContent withArta={withArta} />
      </AqiProvider>
    </ConfigProvider>
  );
}
