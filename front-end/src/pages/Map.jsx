import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import STATIONS, { getUniqueLocations, getStationPhoto, bgEmbPhoto } from "../config/stations";
import { Modal, Select, Tag, Segmented } from "antd";
import {
  TbMapPin,
  TbPhone,
  TbMail,
  TbWorld,
  TbBuildingSkyscraper,
  TbCurrentLocation,
  TbInfoCircle,
  TbMap2,
  TbBrandFacebook,
  TbExternalLink,
} from "react-icons/tb";
import Globe from "globe.gl";
import * as THREE from "three";
import "./Map.css";

/* ── Theme hook ─────────────────────────────────────────────────────── */
function useDarkTheme() {
  const [dark, setDark] = useState(() =>
    typeof document !== "undefined"
      ? document.documentElement.classList.contains("dark")
      : false,
  );
  useEffect(() => {
    if (typeof document === "undefined") return;
    const el = document.documentElement;
    const obs = new MutationObserver(() =>
      setDark(el.classList.contains("dark")),
    );
    obs.observe(el, { attributes: true, attributeFilter: ["class"] });
    return () => obs.disconnect();
  }, []);
  return dark;
}

/* ── Weather hook (batch all stations) ──────────────────────────────── */
function useMultiWeather(stations) {
  const [wx, setWx] = useState({});
  useEffect(() => {
    let cancelled = false;
    async function fetchAll() {
      const results = {};
      await Promise.allSettled(
        stations.map(async (s) => {
          try {
            const url = `https://api.open-meteo.com/v1/forecast?latitude=${s.lat}&longitude=${s.lon}&current_weather=true&forecast_days=1&timezone=auto`;
            const r = await fetch(url);
            const j = await r.json();
            results[s.key] = { data: j, error: null };
          } catch {
            results[s.key] = { data: null, error: "Unavailable" };
          }
        }),
      );
      if (!cancelled) setWx(results);
    }
    fetchAll();
    const id = setInterval(fetchAll, 300_000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [stations.length]);
  return wx;
}

function codeToCondition(code) {
  if (code === 0) return { label: "Clear", emoji: "☀️" };
  if ([1, 2].includes(code)) return { label: "Partly cloudy", emoji: "⛅" };
  if (code === 3) return { label: "Overcast", emoji: "☁️" };
  if ([45, 48].includes(code)) return { label: "Fog", emoji: "🌫️" };
  if ([61, 63, 65, 80, 81, 82].includes(code))
    return { label: "Rain", emoji: "🌧️" };
  if ([71, 73, 75, 77, 85, 86].includes(code))
    return { label: "Snow", emoji: "❄️" };
  if ([95, 96, 99].includes(code)) return { label: "Storm", emoji: "⛈️" };
  return { label: "—", emoji: "🌡️" };
}

/* ── Station descriptions ───────────────────────────────────────────── */
const STATION_DESCRIPTIONS = {
  "meycauayan-pm10":
    "The Meycauayan Air Quality Monitoring Station monitors PM10 particulate matter in Meycauayan, Bulacan. Located in a highly urbanized area near industrial zones, this station helps track air quality impacts from manufacturing and vehicular emissions in the region.",
  "meycauayan-pm25":
    "The Meycauayan PM2.5 Monitoring Station measures fine particulate matter in Meycauayan, Bulacan. PM2.5 particles are especially harmful as they penetrate deep into the respiratory system, making this station critical for health impact assessment in the industrialized area.",
  "zambales-pm10":
    "The Zambales PM10 Monitoring Station is situated in Santa Cruz, Zambales. This coastal station monitors coarse particulate matter, providing critical data on air quality influenced by natural sea salt aerosols and nearby mining activities.",
  "zambales-pm25":
    "The Zambales PM2.5 Monitoring Station measures fine particulate matter at Santa Cruz, Zambales. PM2.5 particles pose significant health risks as they can penetrate deep into the lungs, making this monitoring especially important for community health assessment.",
  "clark-pm10":
    "The Clark Air Quality Monitoring Station operates within the Clark Freeport Zone in Pampanga. This station tracks PM10 levels in a rapidly developing economic zone, monitoring the air quality impact of commercial, industrial, and aviation activities.",
  "san-fernando-pm10":
    "The San Fernando AQMS monitors PM10 levels in San Fernando, Pampanga — the provincial capital. Situated in a densely populated urban center, it tracks particulate pollution from transportation corridors and commercial activities.",
};

/* ── Main Map Page ──────────────────────────────────────────────────── */
export default function MapPage() {
  const allStations = getUniqueLocations();
  const isDark = useDarkTheme();
  const wxData = useMultiWeather(STATIONS);

  const [globeBase, setGlobeBase] = useState("satellite");
  const [viewMode, setViewMode] = useState("globe");
  const [modalStation, setModalStation] = useState(null);
  const openModal = useCallback((s) => setModalStation(s), []);
  const closeModal = useCallback(() => setModalStation(null), []);

  const globeRef = useRef(null);
  const flyToStation = useCallback((s) => {
    const globe = globeRef.current;
    if (globe) {
      try {
        globe.pointOfView({ lat: s.lat, lng: s.lon, altitude: 0.25 }, 1200);
      } catch {}
    }
  }, []);

  const skyBg = isDark
    ? "linear-gradient(180deg, #0f172a 0%, #1e293b 40%, #0f172a 100%)"
    : "linear-gradient(180deg, #56ccf2 0%, #87ceeb 30%, #b6e3f4 60%, #e0f7fa 100%)";

  return (
    <div className="map-page" style={{ background: skyBg }}>
      {/* Hero Globe Section */}
      <div className="map-globe-hero">
        {/* Title bar overlay */}
        <div className="map-title-bar">
          <div className="map-title-left">
            <TbMap2 size={22} />
            <h2 className="map-title">Station Network</h2>
          </div>
          <div className="map-title-controls">
            <Segmented
              size="small"
              value={viewMode}
              onChange={setViewMode}
              options={[
                { value: "globe", label: "🌍 Globe" },
                { value: "map", label: "🗺️ Map" },
              ]}
            />
            {viewMode === "globe" && (
              <Select
                size="small"
                value={globeBase}
                onChange={setGlobeBase}
                style={{ width: 150 }}
                popupMatchSelectWidth={false}
                options={[
                  { value: "auto", label: "Auto (theme)" },
                  { value: "streets", label: "Streets" },
                  { value: "dark", label: "Dark" },
                  { value: "satellite", label: "Satellite" },
                ]}
              />
            )}
          </div>
        </div>

        {/* Globe or Map */}
        {viewMode === "globe" ? (
          <GlobeView
            allStations={allStations}
            baseMode={globeBase}
            isDark={isDark}
            onStationClick={openModal}
            globeRef={globeRef}
          />
        ) : (
          <FlatMapView
            allStations={allStations}
            onStationClick={openModal}
          />
        )}

        {/* Floating station cards (globe mode only) */}
        {viewMode === "globe" && (
        <div className="map-floating-cards">
          {STATIONS.map((s) => {
            const w = wxData[s.key];
            const temp = w?.data?.current_weather?.temperature;
            const code = w?.data?.current_weather?.weathercode;
            const cond = code != null ? codeToCondition(code) : null;
            return (
              <div
                key={s.key}
                className="map-station-card"
                onClick={() => openModal(s)}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => e.key === "Enter" && openModal(s)}
              >
                <div className="map-station-card-icon">
                  <TbMapPin size={18} />
                </div>
                <div className="map-station-card-body">
                  <div className="map-station-card-name">{s.name}</div>
                  <div className="map-station-card-addr">{s.address}</div>
                  <div className="map-station-card-meta">
                    <Tag color="blue" style={{ margin: 0, fontSize: 10 }}>
                      {s.pollutantLabel}
                    </Tag>
                    {temp != null && (
                      <span className="map-station-card-wx">
                        {cond?.emoji} {Math.round(temp)}°C
                      </span>
                    )}
                  </div>
                </div>
                <div className="map-station-card-coords">
                  <TbCurrentLocation size={12} />
                  <span>
                    {s.lat.toFixed(3)}, {s.lon.toFixed(3)}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
        )}
      </div>

      {/* Contact Info Card */}
      <div className="map-contact-section">
        <div className="map-contact-card">
          <div className="map-contact-header">
            <TbBuildingSkyscraper size={24} />
            <div>
              <h3 className="map-contact-title">EMB Region 3 Office</h3>
              <p className="map-contact-subtitle">
                Environmental Management Bureau – Central Luzon
              </p>
            </div>
          </div>
          <div className="map-contact-grid">
            <div className="map-contact-item">
              <TbMapPin size={16} />
              <span>Masinop cor. Matalino St., Diosdado Macapagal Government Center, Maimpis, City of San Fernando, Pampanga</span>
            </div>
            <div className="map-contact-item">
              <TbPhone size={16} />
              <div>
                <div>(045) 963-3623 (Trunk Line)</div>
                <div style={{ fontSize: 12, opacity: 0.7 }}>ORD: local 102 · EMED: local 115/117 · CPD: local 114/106</div>
              </div>
            </div>
            <div className="map-contact-item">
              <TbMail size={16} />
              <div>
                <a href="mailto:emb_region3@emb.gov.ph">emb_region3@emb.gov.ph</a>
                <div style={{ fontSize: 12, opacity: 0.7 }}>Action Center: <a href="mailto:r3actioncenter@emb.gov.ph">r3actioncenter@emb.gov.ph</a></div>
              </div>
            </div>
            <div className="map-contact-item">
              <TbWorld size={16} />
              <a href="https://r3.emb.gov.ph" target="_blank" rel="noopener noreferrer">r3.emb.gov.ph</a>
            </div>
            <div className="map-contact-item">
              <TbBrandFacebook size={16} />
              <a href="https://www.facebook.com/EMBRegion3" target="_blank" rel="noopener noreferrer">facebook.com/EMBRegion3</a>
            </div>
            <div className="map-contact-item">
              <TbInfoCircle size={16} />
              <span>ISO 9001:2015 & ISO 14001:2015 Certified</span>
            </div>
          </div>
        </div>
      </div>

      {/* CTA Card */}
      <div className="map-cta-section">
        <div
          className="map-cta-card"
          style={{ backgroundImage: `url(${bgEmbPhoto})`, backgroundSize: "cover", backgroundPosition: "center" }}
        >
          <div className="map-cta-photo-overlay" />
          <div className="map-cta-bg-shapes">
            <div className="map-cta-shape map-cta-shape-1" />
            <div className="map-cta-shape map-cta-shape-2" />
            <div className="map-cta-shape map-cta-shape-3" />
          </div>
          <div className="map-cta-content">
            <TbBuildingSkyscraper size={32} className="map-cta-icon" />
            <h3 className="map-cta-title">Environmental Management Bureau – Region 3</h3>
            <p className="map-cta-desc">
              Protecting the environment of Central Luzon through monitoring, enforcement, and public awareness.
              Visit the official website to learn more about programs, permits, and environmental compliance.
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
            </div>
          </div>
        </div>
      </div>

      {/* Station Detail Modal */}
      <Modal
        title={null}
        open={!!modalStation}
        onCancel={closeModal}
        footer={null}
        width={520}
        centered
        className="map-station-modal"
      >
        {modalStation && (
          <StationDetail
            station={modalStation}
            wxData={wxData[modalStation.key]}
            onFlyTo={() => {
              flyToStation(modalStation);
              closeModal();
            }}
          />
        )}
      </Modal>
    </div>
  );
}

/* ── Station Detail (modal content) ─────────────────────────────────── */
function StationDetail({ station, wxData, onFlyTo }) {
  const temp = wxData?.data?.current_weather?.temperature;
  const wind = wxData?.data?.current_weather?.windspeed;
  const code = wxData?.data?.current_weather?.weathercode;
  const cond = code != null ? codeToCondition(code) : null;
  const desc =
    STATION_DESCRIPTIONS[station.key] ||
    "No additional description available for this station.";
  const photo = getStationPhoto(station.province || station.key);

  return (
    <div className="station-detail">
      {/* Station photo banner */}
      {photo && (
        <div
          className="station-detail-photo"
          style={{ backgroundImage: `url(${photo})` }}
        >
          <div className="station-detail-photo-overlay" />
        </div>
      )}

      <div className="station-detail-header">
        <div className="station-detail-icon">
          <TbMapPin size={28} />
        </div>
        <div>
          <h3 className="station-detail-name">{station.name}</h3>
          <p className="station-detail-addr">{station.address}</p>
        </div>
      </div>

      <p className="station-detail-desc">{desc}</p>

      <div className="station-detail-grid">
        <div className="station-detail-stat">
          <span className="station-detail-stat-label">Pollutant</span>
          <span className="station-detail-stat-value">
            {station.pollutantLabel}
          </span>
        </div>
        <div className="station-detail-stat">
          <span className="station-detail-stat-label">Latitude</span>
          <span className="station-detail-stat-value">
            {station.lat.toFixed(5)}
          </span>
        </div>
        <div className="station-detail-stat">
          <span className="station-detail-stat-label">Longitude</span>
          <span className="station-detail-stat-value">
            {station.lon.toFixed(5)}
          </span>
        </div>
        <div className="station-detail-stat">
          <span className="station-detail-stat-label">Temperature</span>
          <span className="station-detail-stat-value">
            {temp != null ? `${Math.round(temp)}°C` : "—"}
          </span>
        </div>
        <div className="station-detail-stat">
          <span className="station-detail-stat-label">Wind</span>
          <span className="station-detail-stat-value">
            {wind != null ? `${Math.round(wind)} km/h` : "—"}
          </span>
        </div>
        <div className="station-detail-stat">
          <span className="station-detail-stat-label">Condition</span>
          <span className="station-detail-stat-value">
            {cond ? `${cond.emoji} ${cond.label}` : "—"}
          </span>
        </div>
      </div>

      <div className="station-detail-actions">
        <button className="station-detail-fly-btn" onClick={onFlyTo}>
          <TbCurrentLocation size={16} />
          Fly to Station
        </button>
        <a
          className="station-detail-gmaps-link"
          href={`https://www.google.com/maps?q=${station.lat},${station.lon}&z=15`}
          target="_blank"
          rel="noopener noreferrer"
        >
          <TbMap2 size={14} /> View on Google Maps
        </a>
        <a
          className="station-detail-osm-link"
          href={`https://www.openstreetmap.org/?mlat=${station.lat}&mlon=${station.lon}#map=15/${station.lat}/${station.lon}`}
          target="_blank"
          rel="noopener noreferrer"
        >
          <TbMap2 size={14} /> OpenStreetMap
        </a>
      </div>
    </div>
  );
}

/* ── Flat Map View (2D Google Maps, lightweight) ──────────────────── */
function FlatMapView({ allStations, onStationClick }) {
  const [focusStation, setFocusStation] = useState(null);

  const mapSrc = useMemo(() => {
    if (focusStation) {
      return `https://www.google.com/maps?q=${focusStation.lat},${focusStation.lon}&z=15&output=embed`;
    }
    return "https://www.google.com/maps?q=15.0,120.7&z=8&output=embed";
  }, [focusStation]);

  const handleStationClick = useCallback((s) => {
    setFocusStation((prev) => (prev?.key === s.key ? null : s));
  }, []);

  return (
    <div className="flat-map-container">
      <iframe
        key={mapSrc}
        className="flat-map-iframe"
        src={mapSrc}
        allowFullScreen
        loading="lazy"
        referrerPolicy="no-referrer-when-downgrade"
        title="Google Maps – Station Network"
      />
      <div className="flat-map-sidebar">
        <div className="flat-map-sidebar-title">
          <TbMapPin size={16} />
          Monitoring Stations
        </div>
        {STATIONS.map((s) => (
          <div
            key={s.key}
            className={`flat-map-station-item${focusStation?.key === s.key ? " active" : ""}`}
            onClick={() => handleStationClick(s)}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => e.key === "Enter" && handleStationClick(s)}
          >
            <div className="flat-map-station-pin">
              <TbMapPin size={14} />
            </div>
            <div className="flat-map-station-info">
              <div className="flat-map-station-name">{s.name}</div>
              <div className="flat-map-station-addr">{s.address}</div>
              <Tag color="blue" style={{ margin: "4px 0 0", fontSize: 10 }}>{s.pollutantLabel}</Tag>
            </div>
            <div className="flat-map-station-btns">
              <button
                className="flat-map-btn"
                onClick={(e) => { e.stopPropagation(); onStationClick(s); }}
                title="Station details"
              >
                <TbInfoCircle size={14} />
              </button>
              <a
                className="flat-map-btn"
                href={`https://www.google.com/maps?q=${s.lat},${s.lon}&z=15`}
                target="_blank"
                rel="noopener noreferrer"
                onClick={(e) => e.stopPropagation()}
                title="Open in Google Maps"
              >
                <TbMap2 size={14} />
              </a>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ── Globe View (3D, full-height) ───────────────────────────────────── */
function GlobeView({
  allStations,
  baseMode,
  isDark,
  onStationClick,
  globeRef,
}) {
  const containerRef = useRef(null);
  const globeElRef = useRef(null); // dedicated wrapper for Globe.gl DOM
  const mapRef = useRef(null);
  const distanceRef = useRef({ raf: null });
  const [globeLoading, setGlobeLoading] = useState(true);
  const [hiResLoading, setHiResLoading] = useState(false);
  const [hiResReady, setHiResReady] = useState(false);
  const [altitudeKm, setAltitudeKm] = useState(null);
  const [fallback, setFallback] = useState(false);

  useEffect(() => {
    if (!containerRef.current || fallback) return;
    try {
      const canvas = document.createElement("canvas");
      const gl =
        canvas.getContext("webgl") || canvas.getContext("experimental-webgl");
      if (!gl) {
        setFallback(true);
        return;
      }
    } catch {
      setFallback(true);
      return;
    }

    const container = containerRef.current;
    // Use a dedicated wrapper div so Globe.gl's DOM stays outside React's tree
    let wrapper = globeElRef.current;
    if (!wrapper) {
      wrapper = document.createElement("div");
      wrapper.style.cssText =
        "width:100%;height:100%;position:absolute;inset:0";
      container.appendChild(wrapper);
      globeElRef.current = wrapper;
    }
    const globe = Globe({ animateIn: true })(wrapper)
      .backgroundColor("rgba(0,0,0,0)")
      .showAtmosphere(true)
      .atmosphereColor(isDark ? "#93c5fd" : "#60a5fa")
      .atmosphereAltitude(0.18);

    try {
      const renderer = globe.renderer();
      if (renderer)
        renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    } catch {}

    const resolved =
      baseMode === "auto" ? (isDark ? "dark" : "streets") : baseMode;
    const dayLow =
      "https://unpkg.com/three-globe/example/img/earth-blue-marble.jpg";
    const nightLow =
      "https://unpkg.com/three-globe/example/img/earth-night.jpg";
    // Use the same textures for hi-res (the dead 8k CDN links are gone)
    const dayHi =
      "https://unpkg.com/three-globe@2.41.12/example/img/earth-blue-marble.jpg";
    const nightHi =
      "https://unpkg.com/three-globe@2.41.12/example/img/earth-night.jpg";
    const low = resolved === "dark" ? nightLow : dayLow;
    const hi = resolved === "dark" ? nightHi : dayHi;

    try {
      const lowImg = new Image();
      lowImg.crossOrigin = "anonymous";
      lowImg.onload = () => {
        try {
          globe.globeImageUrl(low);
        } catch {}
        setGlobeLoading(false);
        const hiImg = new Image();
        hiImg.crossOrigin = "anonymous";
        setHiResLoading(true);
        hiImg.onload = () => {
          try {
            globe.globeImageUrl(hi);
            const mat = globe.globeMaterial?.();
            const tex = mat?.map;
            const ren = globe.renderer?.();
            const maxAniso = ren ? ren.capabilities.getMaxAnisotropy() : 8;
            if (tex) {
              tex.anisotropy = Math.min(maxAniso, 16);
              tex.generateMipmaps = true;
              tex.magFilter = THREE.LinearFilter;
              tex.minFilter = THREE.LinearMipmapLinearFilter;
              tex.needsUpdate = true;
              if (mat) mat.needsUpdate = true;
            }
            setHiResReady(true);
          } catch {}
          setHiResLoading(false);
        };
        hiImg.onerror = () => setHiResLoading(false);
        hiImg.src = hi;
      };
      lowImg.onerror = () => {
        try {
          globe.globeImageUrl(dayLow);
        } catch {}
        setGlobeLoading(false);
      };
      lowImg.src = low;
    } catch {
      try {
        globe.globeImageUrl(dayLow);
      } catch {}
      setGlobeLoading(false);
    }

    // Controls
    try {
      const controls = globe.controls();
      controls.enableDamping = true;
      controls.dampingFactor = 0.08;
      controls.enableZoom = true;
      controls.zoomSpeed = 0.8;
      if ("zoomToCursor" in controls) controls.zoomToCursor = true;
      controls.enablePan = true;
      controls.minDistance = 101;
      controls.maxDistance = 1600;
      controls.rotateSpeed = 0.6;
    } catch {}

    // Resize
    function resize() {
      try {
        globe.width(container.clientWidth || 800);
        globe.height(container.clientHeight || 600);
      } catch {}
    }
    resize();
    const ro = new ResizeObserver(resize);
    try {
      ro.observe(container);
    } catch {}

    // Station markers with labels and pulse
    const markerData = allStations.map((s) => ({
      lat: s.lat,
      lng: s.lon,
      name: s.name,
      key: s.key,
      address: s.address,
    }));
    if (markerData.length) {
      globe
        .htmlElementsData(markerData)
        .htmlElement((d) => {
          const wrapper = document.createElement("div");
          wrapper.className = "globe-marker-wrapper";
          wrapper.innerHTML = `
            <div class="globe-marker-label">${d.name}</div>
            <div class="globe-marker-pin">
              <svg viewBox="0 0 24 24" width="28" height="28">
                <path d="M12 2C8.134 2 5 5.134 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.866-3.134-7-7-7z" fill="#1677ff"/>
                <circle cx="12" cy="9" r="3" fill="#ffffff"/>
              </svg>
            </div>
            <div class="globe-marker-pulse"></div>
          `;
          wrapper.style.cursor = "pointer";
          wrapper.style.pointerEvents = "auto";
          wrapper.addEventListener("click", (e) => {
            e.stopPropagation();
            const station = allStations.find((s) => s.key === d.key);
            if (station && onStationClick) onStationClick(station);
          });
          return wrapper;
        })
        .htmlLat((d) => d.lat)
        .htmlLng((d) => d.lng)
        .htmlAltitude(0.012);
    }

    // Camera: Philippines overview
    try {
      globe.pointOfView({ lat: 14.5, lng: 121.0, altitude: 0.8 }, 1500);
    } catch {}

    // Altitude tracker
    function tick() {
      try {
        const camera = globe.camera();
        if (camera) {
          const distUnits = camera.position.length();
          const altKm = (Math.max(0, distUnits - 100) / 100) * 6371;
          setAltitudeKm((prev) =>
            prev == null || Math.abs(prev - altKm) > 0.05 ? altKm : prev,
          );
        }
      } catch {}
      distanceRef.current.raf = requestAnimationFrame(tick);
    }
    distanceRef.current.raf = requestAnimationFrame(tick);

    mapRef.current = globe;
    if (globeRef) globeRef.current = globe;

    return () => {
      try {
        if (distanceRef.current.raf)
          cancelAnimationFrame(distanceRef.current.raf);
        if (ro) ro.disconnect();
        // Clean Globe.gl's wrapper without touching React-managed children
        const w = globeElRef.current;
        if (w) {
          while (w.firstChild) w.removeChild(w.firstChild);
          if (w.parentNode) w.parentNode.removeChild(w);
          globeElRef.current = null;
        }
      } catch {}
      mapRef.current = null;
      if (globeRef) globeRef.current = null;
    };
  }, [baseMode, isDark, fallback, allStations]);

  if (fallback) {
    return (
      <div className="globe-fallback">
        <TbInfoCircle size={32} />
        <p>
          WebGL is not supported in your browser. The 3D globe requires WebGL to
          render.
        </p>
      </div>
    );
  }

  return (
    <div className="globe-container" ref={containerRef}>
      {(globeLoading || (hiResLoading && !hiResReady)) && (
        <div className="globe-loading-overlay">
          <div className="globe-spinner" />
          <div>{globeLoading ? "Loading globe…" : "Enhancing detail…"}</div>
        </div>
      )}
      {altitudeKm != null && (
        <div className="globe-altitude-badge">
          <strong>Altitude:</strong>{" "}
          {altitudeKm < 1
            ? `${(altitudeKm * 1000).toFixed(0)} m`
            : `${altitudeKm.toFixed(1)} km`}
        </div>
      )}
    </div>
  );
}
