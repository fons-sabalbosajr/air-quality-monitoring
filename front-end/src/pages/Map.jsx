import { useEffect, useMemo, useRef, useState } from "react";
import { getApiBase } from "../util/apiBase";
import { useApiEndpoint } from "../util/apiClient";
import { Card, Skeleton, Alert, Descriptions, Tag, Select } from "antd";
import {
  MapContainer,
  TileLayer,
  Marker,
  Popup,
  useMap,
  ZoomControl,
  LayersControl,
} from "react-leaflet";
import L from "leaflet";
import Globe from "globe.gl";
import * as THREE from "three";

function useDarkTheme() {
  const [dark, setDark] = useState(() =>
    typeof document !== "undefined"
      ? document.documentElement.classList.contains("dark")
      : false
  );
  useEffect(() => {
    if (typeof document === "undefined") return;
    const el = document.documentElement;
    const obs = new MutationObserver(() => {
      setDark(el.classList.contains("dark"));
    });
    obs.observe(el, { attributes: true, attributeFilter: ["class"] });
    return () => obs.disconnect();
  }, []);
  return dark;
}
function useStationMeta() {
  return useApiEndpoint('/api/station/meta', {
    refreshMs: 600000,
    retries: 2,
    timeoutMs: 10000,
    cacheTtlMs: 600000,
  });
}

function useStationCurrent() {
  return useApiEndpoint('/api/station/current', {
    refreshMs: 300000,
    retries: 2,
    timeoutMs: 10000,
    cacheTtlMs: 20000,
  });
}

function useStationWeather(lat, lon) {
  const [state, setState] = useState({
    loading: true,
    error: null,
    data: null,
  });
  useEffect(() => {
    let cancelled = false;
    async function run() {
      if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
        setState({ loading: false, error: null, data: null });
        return;
      }
      try {
        const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current_weather=true&daily=temperature_2m_max,temperature_2m_min&forecast_days=1&timezone=auto`;
        const r = await fetch(url);
        const j = await r.json();
        if (!cancelled) setState({ loading: false, error: null, data: j });
      } catch (e) {
        if (!cancelled)
          setState({
            loading: false,
            error: "Weather unavailable",
            data: null,
          });
      }
    }
    run();
    const id = setInterval(run, 300_000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [lat, lon]);
  return state;
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

function makePinIcon() {
  const html = `
    <div style="position:relative; width:24px; height:24px; transform: translate(-50%, -100%);">
      <svg viewBox="0 0 24 24" width="24" height="24" style="filter: drop-shadow(0 1px 2px rgba(0,0,0,0.4))">
        <path d="M12 2C8.134 2 5 5.134 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.866-3.134-7-7-7z" fill="#1677ff"/>
        <circle cx="12" cy="9" r="3" fill="#ffffff"/>
      </svg>
    </div>`;
  return L.divIcon({
    html,
    className: "aqm-pin",
    iconSize: [24, 24],
    iconAnchor: [12, 24],
    popupAnchor: [0, -24],
  });
}

export default function MapPage() {
  const meta = useStationMeta();
  const current = useStationCurrent();
  const lat = meta.data?.latitude ?? current.data?.latitude;
  const lon = meta.data?.longitude ?? current.data?.longitude;
  const name = meta.data?.name || "Station";
  const address = meta.data?.address || null;
  const online = current.data?.online ?? null;
  const wx = useStationWeather(lat, lon);

  const hasPoint = Number.isFinite(lat) && Number.isFinite(lon);
  const center = useMemo(() => {
    if (hasPoint) return [lat, lon];
    return [14.5995, 120.9842]; // fallback: Manila
  }, [hasPoint, lat, lon]);
  const leafletZoom = hasPoint ? 15 : 13;

  const pin = useMemo(() => makePinIcon(), []);
  // We proxy OWM tiles through the server now; front-end no longer needs the API key.
  const apiBase = getApiBase();
  const owmKey = true; // proxy hides actual key; keep truthy to show overlays

  // Draggable overlay card state for Leaflet map
  const overlayRef = useRef(null);
  const containerRef = useRef(null);
  const [overlayPos, setOverlayPos] = useState({ left: 12, top: 12 });
  function onOverlayMouseDown(e) {
    e.preventDefault();
    const c = containerRef.current;
    const t = overlayRef.current;
    if (!c || !t) return;
    const startX = e.clientX;
    const startY = e.clientY;
  const startLeft = overlayPos.left;
  const startTop = overlayPos.top;
    const cw = c.clientWidth || 0;
    const ch = c.clientHeight || 0;
    const tw = t.clientWidth || 0;
    const th = t.clientHeight || 0;
    const minLeft = 8,
      minTop = 8;
    const maxLeft = Math.max(minLeft, cw - tw - 8);
    const maxTop = Math.max(minTop, ch - th - 8);
    function move(ev) {
      const dx = ev.clientX - startX;
      const dy = ev.clientY - startY;
      let nl = startLeft + dx;
      let nt = startTop + dy;
      nl = Math.min(Math.max(nl, minLeft), maxLeft);
      nt = Math.min(Math.max(nt, minTop), maxTop);
      setOverlayPos({ left: nl, top: nt });
    }
    function up() {
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", up);
    }
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
  }

  // Draggable overlay card state for Globe map
  const globeOverlayRef = useRef(null);
  const globeOverlayContentRef = useRef(null);
  const globeContainerRef = useRef(null);
  const [globeOverlayPos, setGlobeOverlayPos] = useState({ left: 12, top: 12 });
  function onGlobeOverlayMouseDown(e) {
    e.preventDefault();
    const c = globeContainerRef.current;
    const t = globeOverlayContentRef.current;
    if (!c || !t) return;
    const startX = e.clientX;
    const startY = e.clientY;
    const startLeft = globeOverlayPos.left;
    const startTop = globeOverlayPos.top;
    const cw = c.clientWidth || 0;
    const ch = c.clientHeight || 0;
    const tw = t.clientWidth || 0;
    const th = t.clientHeight || 0;
    const minLeft = 8,
      minTop = 8;
    const maxLeft = Math.max(minLeft, cw - tw - 8);
    const maxTop = Math.max(minTop, ch - th - 8);
    function move(ev) {
      const dx = ev.clientX - startX;
      const dy = ev.clientY - startY;
      let nl = startLeft + dx;
      let nt = startTop + dy;
      nl = Math.min(Math.max(nl, minLeft), maxLeft);
      nt = Math.min(Math.max(nt, minTop), maxTop);
      setGlobeOverlayPos({ left: nl, top: nt });
    }
    function up() {
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", up);
    }
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
  }

  // Globe basemap selector (auto -> theme, or force a specific one)
  const [globeBase, setGlobeBase] = useState("satellite"); // default to satellite for Google Earth-like look

  return (
    <div className="space-y-4">
      <h2 className="text-xl font-semibold">Station Map</h2>

      <Card
        size="small"
        title={
          <span style={{ color: "var(--aqm-muted)" }}>Station Details</span>
        }
        style={{
          background: "var(--aqm-panel-bg)",
          border: "1px solid var(--aqm-panel-border)",
        }}
        styles={{
          header: {
            background: "var(--aqm-panel-bg)",
            borderBottom: "1px solid var(--aqm-panel-border)",
          },
        }}
      >
        {meta.loading && (
          <Skeleton active paragraph={{ rows: 2 }} title={{ width: 200 }} />
        )}
        {meta.error && (
          <Alert
            type="error"
            message="Failed to load station details"
            description={meta.error}
            showIcon
          />
        )}
        {!meta.loading && !meta.error && (
          <Descriptions
            column={1}
            size="small"
            styles={{ label: { width: 160 } }}
          >
            <Descriptions.Item label="Name">{name}</Descriptions.Item>
            {address && (
              <Descriptions.Item label="Address">{address}</Descriptions.Item>
            )}
            {Number.isFinite(lat) && Number.isFinite(lon) && (
              <Descriptions.Item label="Coordinates">
                {lat.toFixed(5)}, {lon.toFixed(5)}{" "}
                <a
                  href={`https://www.openstreetmap.org/?mlat=${lat}&mlon=${lon}#map=15/${lat}/${lon}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  Open in OpenStreetMap
                </a>
              </Descriptions.Item>
            )}
            {online != null && (
              <Descriptions.Item label="Status">
                {online ? (
                  <Tag color="green">Online</Tag>
                ) : (
                  <Tag color="red">Offline</Tag>
                )}
              </Descriptions.Item>
            )}
          </Descriptions>
        )}
      </Card>

      {/* Vertical stack: Map (70%) then 3D Globe (30%) */}
      {/* One-line layout: 2D map (70%) left, 3D globe (30%) right */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "7fr 3fr",
          gap: 12,
          width: "100%",
          alignItems: "stretch",
        }}
      >
        <div style={{ minWidth: 0 }}>
          <Card
            size="small"
            title={<span style={{ color: "var(--aqm-muted)" }}>Map</span>}
            style={{
              background: "var(--aqm-panel-bg)",
              border: "1px solid var(--aqm-panel-border)",
            }}
            styles={{
              header: {
                background: "var(--aqm-panel-bg)",
                borderBottom: "1px solid var(--aqm-panel-border)",
              },
              body: { padding: 0 },
            }}
          >
            <div
              ref={containerRef}
              className="aqm-map"
              style={{ height: 460, width: "100%", position: "relative" }}
            >
              {/* Floating station card */}
              <div
                ref={overlayRef}
                onMouseDown={onOverlayMouseDown}
                style={{
                  position: "absolute",
                  left: overlayPos.left,
                  top: overlayPos.top,
                  cursor: "move",
                  zIndex: 1000,
                  background: "var(--aqm-panel-bg)",
                  border: "1px solid var(--aqm-panel-border)",
                  borderRadius: 10,
                  padding: 10,
                  boxShadow: "0 6px 16px var(--aqm-panel-shadow)",
                  maxWidth: 320,
                  userSelect: "none",
                }}
              >
                <div style={{ fontWeight: 700, marginBottom: 4 }}>{name}</div>
                {address && (
                  <div
                    style={{
                      fontSize: 12,
                      color: "var(--aqm-muted)",
                      marginBottom: 6,
                    }}
                  >
                    {address}
                  </div>
                )}
                <div style={{ fontSize: 12 }}>
                  {(() => {
                    if (wx.loading) return "Loading weather…";
                    if (wx.error) return wx.error;
                    const temp = Math.round(
                      wx.data?.current_weather?.temperature ??
                        current.data?.temperature_2m ??
                        NaN
                    );
                    const wind = Math.round(
                      wx.data?.current_weather?.windspeed ??
                        current.data?.windspeed_10m ??
                        NaN
                    );
                    const code = wx.data?.current_weather?.weathercode ?? null;
                    const cond = codeToCondition(code);
                    const parts = [];
                    if (Number.isFinite(temp)) parts.push(`${temp}°C`);
                    if (cond?.label && code != null) parts.push(cond.label);
                    if (Number.isFinite(wind)) parts.push(`Wind ${wind} km/h`);
                    return parts.length
                      ? parts.join(" · ")
                      : "Weather unavailable";
                  })()}
                </div>
              </div>

              <MapContainer
                center={center}
                zoom={leafletZoom}
                style={{ height: "100%", width: "100%" }}
                scrollWheelZoom
                zoomControl={false}
              >
                <LayersControl position="topright">
                  <LayersControl.BaseLayer checked name="OSM">
                    <TileLayer
                      attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
                      url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                    />
                  </LayersControl.BaseLayer>
                  {owmKey ? (
                    <>
                      <LayersControl.Overlay name="Clouds">
                        <TileLayer
                          attribution="Weather layers © OpenWeatherMap"
                          url={`${apiBase}/api/tiles/owm/clouds_new/{z}/{x}/{y}.png`}
                          opacity={0.7}
                        />
                      </LayersControl.Overlay>
                      <LayersControl.Overlay name="Precipitation">
                        <TileLayer
                          attribution="Weather layers © OpenWeatherMap"
                          url={`${apiBase}/api/tiles/owm/precipitation_new/{z}/{x}/{y}.png`}
                          opacity={0.7}
                        />
                      </LayersControl.Overlay>
                      <LayersControl.Overlay name="Rain">
                        <TileLayer
                          attribution="Weather layers © OpenWeatherMap"
                          url={`${apiBase}/api/tiles/owm/rain_new/{z}/{x}/{y}.png`}
                          opacity={0.7}
                        />
                      </LayersControl.Overlay>
                      <LayersControl.Overlay name="Wind">
                        <TileLayer
                          attribution="Weather layers © OpenWeatherMap"
                          url={`${apiBase}/api/tiles/owm/wind_new/{z}/{x}/{y}.png`}
                          opacity={0.7}
                        />
                      </LayersControl.Overlay>
                      <LayersControl.Overlay name="Temperature">
                        <TileLayer
                          attribution="Weather layers © OpenWeatherMap"
                          url={`${apiBase}/api/tiles/owm/temp_new/{z}/{x}/{y}.png`}
                          opacity={0.6}
                        />
                      </LayersControl.Overlay>
                      <LayersControl.Overlay name="Pressure">
                        <TileLayer
                          attribution="Weather layers © OpenWeatherMap"
                          url={`${apiBase}/api/tiles/owm/pressure_new/{z}/{x}/{y}.png`}
                          opacity={0.6}
                        />
                      </LayersControl.Overlay>
                    </>
                  ) : (
                    <LayersControl.Overlay name="Weather (API key needed)">
                      <TileLayer
                        url="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8+B8AAucB9UuWRvcAAAAASUVORK5CYII="
                        opacity={0}
                      />
                    </LayersControl.Overlay>
                  )}
                </LayersControl>
                <ZoomControl position="topright" />
                {hasPoint && (
                  <Marker position={[lat, lon]} icon={pin}>
                    <Popup>
                      <div style={{ minWidth: 200 }}>
                        <div style={{ fontWeight: 600 }}>{name}</div>
                        {address && (
                          <div
                            style={{ fontSize: 12, color: "var(--aqm-muted)" }}
                          >
                            {address}
                          </div>
                        )}
                        <div style={{ fontSize: 12, marginTop: 6 }}>
                          Lat/Lon: {lat.toFixed(5)}, {lon.toFixed(5)}
                        </div>
                        {online != null && (
                          <div style={{ fontSize: 12 }}>
                            Status: {online ? "Online" : "Offline"}
                          </div>
                        )}
                      </div>
                    </Popup>
                  </Marker>
                )}
                {hasPoint && (
                  <SetViewOnStation position={[lat, lon]} zoom={15} />
                )}
              </MapContainer>
              <style>
                {`
                  .aqm-map .leaflet-top.leaflet-right .leaflet-control-layers {
                    margin-top: 48px;
                    margin-right: 10px;
                  }
                `}
              </style>
              {!owmKey && (
                <div
                  style={{
                    position: "absolute",
                    right: 8,
                    top: 8,
                    background: "rgba(0,0,0,0.55)",
                    color: "#fff",
                    padding: "6px 8px",
                    borderRadius: 6,
                    fontSize: 11,
                    lineHeight: 1.2,
                  }}
                  title="Set VITE_OWM_API_KEY in your .env to enable weather overlays"
                >
                  Weather overlays unavailable. Add VITE_OWM_API_KEY to enable.
                </div>
              )}
            </div>
          </Card>
        </div>
        <div style={{ minWidth: 0 }}>
          <Card
            size="small"
            title={<span style={{ color: "var(--aqm-muted)" }}>3D Globe</span>}
            extra={
              <Select
                size="small"
                value={globeBase}
                onChange={setGlobeBase}
                style={{ width: 160 }}
                options={[
                  { value: "auto", label: "Auto (by theme)" },
                  { value: "streets", label: "Streets (OSM)" },
                  { value: "dark", label: "Dark (Esri)" },
                  { value: "satellite", label: "Satellite (Esri)" },
                ]}
              />
            }
            style={{
              background: "var(--aqm-panel-bg)",
              border: "1px solid var(--aqm-panel-border)",
            }}
            styles={{
              header: {
                background: "var(--aqm-panel-bg)",
                borderBottom: "1px solid var(--aqm-panel-border)",
              },
              body: { padding: 0 },
            }}
          >
            <div
              ref={globeContainerRef}
              style={{
                height: 460,
                width: "100%",
                position: "relative",
                overflow: "hidden",
              }}
            >
              {/* Floating station details card on Globe (content is wheel-transparent) */}
              <div
                ref={globeOverlayContentRef}
                style={{
                  position: "absolute",
                  left: globeOverlayPos.left,
                  top: globeOverlayPos.top,
                  zIndex: 1000,
                  background: "var(--aqm-panel-bg)",
                  border: "1px solid var(--aqm-panel-border)",
                  borderRadius: 10,
                  padding: 10,
                  boxShadow: "0 6px 16px var(--aqm-panel-shadow)",
                  maxWidth: 320,
                  userSelect: "none",
                  pointerEvents: "none",
                }}
              >
                <div style={{ fontWeight: 700, marginBottom: 4 }}>{name}</div>
                {address && (
                  <div
                    style={{
                      fontSize: 12,
                      color: "var(--aqm-muted)",
                      marginBottom: 6,
                    }}
                  >
                    {address}
                  </div>
                )}
                <div style={{ fontSize: 12 }}>
                  {(() => {
                    if (wx.loading) return "Loading weather…";
                    if (wx.error) return wx.error;
                    const temp = Math.round(
                      wx.data?.current_weather?.temperature ??
                        current.data?.temperature_2m ??
                        NaN
                    );
                    const wind = Math.round(
                      wx.data?.current_weather?.windspeed ??
                        current.data?.windspeed_10m ??
                        NaN
                    );
                    const code = wx.data?.current_weather?.weathercode ?? null;
                    const cond = codeToCondition(code);
                    const parts = [];
                    if (Number.isFinite(temp)) parts.push(`${temp}°C`);
                    if (cond?.label && code != null) parts.push(cond.label);
                    if (Number.isFinite(wind)) parts.push(`Wind ${wind} km/h`);
                    return parts.length
                      ? parts.join(" · ")
                      : "Weather unavailable";
                  })()}
                </div>
              </div>
              {/* Drag handle (small grip) that doesn't block wheel outside of it) */}
              <div
                ref={globeOverlayRef}
                onMouseDown={onGlobeOverlayMouseDown}
                style={{
                  position: "absolute",
                  left: globeOverlayPos.left + 8,
                  top: globeOverlayPos.top - 10,
                  zIndex: 1001,
                  width: 64,
                  height: 20,
                  borderRadius: 10,
                  background: "var(--aqm-panel-bg)",
                  border: "1px solid var(--aqm-panel-border)",
                  boxShadow: "0 2px 6px var(--aqm-panel-shadow)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  cursor: "grab",
                  pointerEvents: "auto",
                  userSelect: "none",
                }}
                title="Drag to move"
              >
                <div
                  style={{
                    width: 28,
                    height: 4,
                    borderRadius: 2,
                    background: "var(--aqm-muted)",
                  }}
                />
              </div>
              <GlobeMap
                center={center}
                point={
                  Number.isFinite(lat) && Number.isFinite(lon)
                    ? [lon, lat]
                    : null
                }
                name={name}
                baseMode={globeBase}
              />
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}

function SetViewOnStation({ position, zoom }) {
  const map = useMap();
  useEffect(() => {
    if (!position || !Array.isArray(position)) return;
    try {
      map.flyTo(position, zoom ?? 15, { duration: 1.2 });
    } catch {}
  }, [map, position?.[0], position?.[1], zoom]);
  return null;
}

function GlobeMap({ center, point, name, baseMode = "auto" }) {
  const ref = useRef(null);
  const mapRef = useRef(null);
  const isDark = useDarkTheme();
  const [fallback, setFallback] = useState(false);
  const [altitudeKm, setAltitudeKm] = useState(null);
  const [distanceKm, setDistanceKm] = useState(null);
  const distanceRef = useRef({ raf: null });
  const [globeLoading, setGlobeLoading] = useState(true);
  const [hiResLoading, setHiResLoading] = useState(false);
  const [hiResReady, setHiResReady] = useState(false);

  useEffect(() => {
    if (!ref.current || fallback) return;
    // Check WebGL support for globe.gl (uses Three.js)
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

    const container = ref.current;
    const globe = Globe({ animateIn: true })(container)
      .backgroundColor("rgba(0,0,0,0)")
      .showAtmosphere(true)
      .atmosphereColor(isDark ? "#93c5fd" : "#60a5fa")
      .atmosphereAltitude(0.18);

    // Improve sharpness when zoomed by increasing renderer pixel ratio (capped for perf)
    try {
      const renderer = globe.renderer();
      if (renderer)
        renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    } catch {}

    const resolved =
      baseMode === "auto" ? (isDark ? "dark" : "streets") : baseMode;
    // Progressive textures: load fast low-res first, then swap to hi-res for crisp zoom
    const dayLow =
      "https://unpkg.com/three-globe/example/img/earth-blue-marble.jpg"; // ~2k
    const nightLow =
      "https://unpkg.com/three-globe/example/img/earth-night.jpg";
    const satLow = dayLow;
    const dayHi =
      "https://cdn.jsdelivr.net/gh/ajnasz/earth-reverse-geo@master/8k_earth_daymap.jpg"; // 8k
    const nightHi =
      "https://cdn.jsdelivr.net/gh/ajnasz/earth-reverse-geo@master/8k_earth_nightmap.jpg";
    const satHi = dayHi; // placeholder
    const low =
      resolved === "satellite"
        ? satLow
        : resolved === "dark"
        ? nightLow
        : dayLow;
    const hi =
      resolved === "satellite" ? satHi : resolved === "dark" ? nightHi : dayHi;

    // Load low-res first
    try {
      const lowImg = new Image();
      lowImg.crossOrigin = "anonymous";
      lowImg.onload = () => {
        try {
          globe.globeImageUrl(low);
        } catch {}
        setGlobeLoading(false);
        // Then load hi-res and swap when ready
        const hiImg = new Image();
        hiImg.crossOrigin = "anonymous";
        setHiResLoading(true);
        hiImg.onload = () => {
          try {
            globe.globeImageUrl(hi);
            // Improve texture sharpness: anisotropy + mipmaps
            const mat = globe.globeMaterial && globe.globeMaterial();
            const tex = mat?.map;
            const renderer = globe.renderer && globe.renderer();
            const maxAniso = renderer
              ? renderer.capabilities.getMaxAnisotropy()
              : 8;
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
        hiImg.onerror = () => {
          setHiResLoading(false); /* keep low-res */
        };
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

    // Camera & controls
    try {
      const controls = globe.controls();
      controls.enableDamping = true;
      controls.dampingFactor = 0.08;
      // Allow zooming and make it feel responsive
      controls.enableZoom = true;
      controls.zoomSpeed = 0.8;
      // Zoom towards cursor position if supported by current three version
      if ("zoomToCursor" in controls) controls.zoomToCursor = true;
      // Panning can stay enabled (right mouse / two finger)
      controls.enablePan = true;
      // three-globe uses a globe radius of ~100 world units.
      // Set minDistance just above 100 to approximate ~100m above surface.
      controls.minDistance = 101; // ~100m above surface equivalent
      controls.maxDistance = 1600;
      controls.rotateSpeed = 0.6;
    } catch {}

    // Size
    function resize() {
      try {
        const w = container.clientWidth || 800;
        const h = container.clientHeight || 480;
        globe.width(w);
        globe.height(h);
      } catch {}
    }
    resize();
    const ro = new ResizeObserver(resize);
    try {
      ro.observe(container);
    } catch {}

    // Station marker as HTML element pinned to lat/lng
    if (Array.isArray(point)) {
      const data = [{ lat: point[1], lng: point[0], name }];
      globe
        .htmlElementsData(data)
        .htmlElement((d) => {
          const div = document.createElement("div");
          div.style.width = "18px";
          div.style.height = "18px";
          div.style.transform = "translate(-50%, -100%)";
          div.style.filter = "drop-shadow(0 1px 2px rgba(0,0,0,0.4))";
          div.innerHTML =
            '<svg viewBox="0 0 24 24" width="18" height="18"><path d="M12 2C8.134 2 5 5.134 5  9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.866-3.134-7-7-7z" fill="#1677ff"/><circle cx="12" cy="9" r="3" fill="#ffffff"/></svg>';
          div.title = d.name;
          return div;
        })
        .htmlLat((d) => d.lat)
        .htmlLng((d) => d.lng)
        .htmlAltitude(0.01);
    }

    // Focus camera on the Philippines at ~900 km altitude above surface.
    // altitude parameter here is distance ratio (camera distance / globe radius).
    // Desired altitudeKm = 900 => ratio = 1 + (900 / 6371) ≈ 1.1413
    try {
      globe.pointOfView({ lat: 12.8797, lng: 121.774, altitude: 1.1413 }, 1200);
    } catch {}

    // Track distance / altitude
    function tick() {
      try {
        const camera = globe.camera();
        if (camera) {
          const distUnits = camera.position.length(); // distance from (0,0,0)
          const radiusUnits = 100; // internal globe radius
          const altitudeUnits = Math.max(0, distUnits - radiusUnits);
          const earthRadiusKm = 6371;
          const distKm = (distUnits / radiusUnits) * earthRadiusKm;
          const altKm = (altitudeUnits / radiusUnits) * earthRadiusKm;
          // Avoid excessive re-renders: only update if change > 0.5% or every ~10 frames
          setAltitudeKm((prev) =>
            prev == null || Math.abs(prev - altKm) > 0.05 ? altKm : prev
          );
          setDistanceKm((prev) =>
            prev == null || Math.abs(prev - distKm) > 1 ? distKm : prev
          );
        }
      } catch {}
      distanceRef.current.raf = requestAnimationFrame(tick);
    }
    distanceRef.current.raf = requestAnimationFrame(tick);

    mapRef.current = globe;

    return () => {
      try {
        if (distanceRef.current.raf)
          cancelAnimationFrame(distanceRef.current.raf);
        if (ro) ro.disconnect();
        while (container.firstChild)
          container.removeChild(container.firstChild);
      } catch {}
      mapRef.current = null;
    };
  }, [center, point, name, baseMode, isDark, fallback]);

  // Update textures/mode on theme or basemap change
  useEffect(() => {
    const globe = mapRef.current;
    if (!globe || fallback) return;
    try {
      setGlobeLoading(true);
      setHiResLoading(false);
      setHiResReady(false);
      const resolved =
        baseMode === "auto" ? (isDark ? "dark" : "streets") : baseMode;
      const dayLow =
        "https://unpkg.com/three-globe/example/img/earth-blue-marble.jpg";
      const nightLow =
        "https://unpkg.com/three-globe/example/img/earth-night.jpg";
      const satLow = dayLow;
      const dayHi =
        "https://cdn.jsdelivr.net/gh/ajnasz/earth-reverse-geo@master/8k_earth_daymap.jpg";
      const nightHi =
        "https://cdn.jsdelivr.net/gh/ajnasz/earth-reverse-geo@master/8k_earth_nightmap.jpg";
      const satHi = dayHi;
      const low =
        resolved === "satellite"
          ? satLow
          : resolved === "dark"
          ? nightLow
          : dayLow;
      const hi =
        resolved === "satellite"
          ? satHi
          : resolved === "dark"
          ? nightHi
          : dayHi;

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
            const mat = globe.globeMaterial && globe.globeMaterial();
            const tex = mat?.map;
            const renderer = globe.renderer && globe.renderer();
            const maxAniso = renderer
              ? renderer.capabilities.getMaxAnisotropy()
              : 8;
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
        hiImg.onerror = () => {
          setHiResLoading(false); /* keep low-res */
        };
        hiImg.src = hi;
      };
      lowImg.onerror = () => {
        try {
          globe.globeImageUrl(dayLow);
        } catch {}
        setGlobeLoading(false);
      };
      lowImg.src = low;
      globe.atmosphereColor(isDark ? "#93c5fd" : "#60a5fa");
    } catch {}
  }, [isDark, baseMode, fallback]);

  if (fallback) {
    // Fallback to Leaflet-based satellite globe-like map
    const hasPoint = Array.isArray(point);
    const centerLL = hasPoint
      ? [point[1], point[0]]
      : [center[0] ?? 14.5995, center[1] ?? 120.9842];
    const z = hasPoint ? 5 : 3;
    // Choose tiles based on baseMode/theme
    const mode = baseMode === "auto" ? (isDark ? "dark" : "streets") : baseMode;
    const tiles =
      mode === "satellite"
        ? "https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"
        : mode === "dark"
        ? "https://services.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}"
        : "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png";
    const attrib =
      mode === "satellite"
        ? "Imagery © Esri & the GIS User Community"
        : mode === "dark"
        ? "Tiles © Esri — Esri, HERE, Garmin, GEBCO, NOAA NGDC, and other contributors"
        : "© OpenStreetMap contributors";
    return (
      <MapContainer
        center={centerLL}
        zoom={z}
        style={{ height: "100%", width: "100%" }}
        scrollWheelZoom
        zoomControl={false}
      >
        <TileLayer attribution={attrib} url={tiles} />
        <ZoomControl position="topright" />
        {hasPoint && (
          <Marker position={[point[1], point[0]]} icon={makePinIcon()}>
            <Popup>
              <div style={{ minWidth: 180 }}>
                <div style={{ fontWeight: 600 }}>{name}</div>
                <div style={{ fontSize: 12, color: "var(--aqm-muted)" }}>
                  {point[1].toFixed(5)}, {point[0].toFixed(5)}
                </div>
              </div>
            </Popup>
          </Marker>
        )}
      </MapContainer>
    );
  }
  return (
    <div style={{ height: "100%", width: "100%", position: "relative" }}>
      <div style={{ height: "100%", width: "100%" }} ref={ref} />
      {(globeLoading || (hiResLoading && !hiResReady)) && (
        <div
          style={{
            position: "absolute",
            inset: 0,
            display: "flex",
            flexDirection: "column",
            gap: 6,
            alignItems: "center",
            justifyContent: "center",
            background: "rgba(0,0,0,0.25)",
            backdropFilter: "blur(2px)",
            color: "#fff",
            fontSize: 12,
          }}
        >
          <div
            style={{
              width: 28,
              height: 28,
              borderRadius: "50%",
              border: "3px solid rgba(255,255,255,0.35)",
              borderTopColor: "#fff",
              animation: "aqm-spin 0.9s linear infinite",
            }}
          />
          <div>{globeLoading ? "Loading globe…" : "Enhancing detail…"}</div>
          <style>
            {
              "@keyframes aqm-spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }"
            }
          </style>
        </div>
      )}
      <div
        style={{
          position: "absolute",
          left: 8,
          bottom: 8,
          background: "rgba(0,0,0,0.45)",
          color: "#fff",
          fontSize: 11,
          padding: "4px 8px",
          borderRadius: 6,
          pointerEvents: "none",
          lineHeight: 1.3,
        }}
      >
        {altitudeKm != null && distanceKm != null ? (
          <>
            <div>
              <strong>Altitude:</strong>{" "}
              {altitudeKm < 1
                ? `${(altitudeKm * 1000).toFixed(0)} m`
                : `${altitudeKm.toFixed(2)} km`}
            </div>
            <div>
              <strong>Distance:</strong> {distanceKm.toFixed(0)} km (from globe
              center)
            </div>
            {hiResLoading && !hiResReady && (
              <div style={{ marginTop: 2 }}>Detail: upgrading…</div>
            )}
          </>
        ) : (
          "Measuring…"
        )}
      </div>
    </div>
  );
}
