import { useState, useEffect, lazy, Suspense } from "react";
import {
  Layout,
  Menu,
  theme,
  ConfigProvider,
  Switch,
  Tooltip,
  Button,
  Modal,
  Descriptions,
  Spin,
  Drawer,
  Grid,
} from "antd";
import { Routes, Route, useLocation, useNavigate, Navigate } from "react-router-dom";
import {
  DashboardOutlined,
  TableOutlined,
  EnvironmentOutlined,
  BulbOutlined,
  BulbFilled,
  GlobalOutlined,
  FacebookFilled,
  MailOutlined,
  CaretDownOutlined,
  CaretRightOutlined,
  MenuOutlined,
  CloseOutlined,
} from "@ant-design/icons";

const { useBreakpoint } = Grid;
import "./App.css";
// Route-level code splitting via React.lazy
const DashboardPage = lazy(() => import("./pages/Dashboard"));
const TabularResultsPage = lazy(() => import("./pages/TabularResults"));
const ChartsPage = lazy(() => import("./pages/Charts"));
const MapPage = lazy(() => import("./pages/Map"));
const KioskPage = lazy(() => import("./pages/Kiosk"));
import embLogo from "./assets/emblogo.svg";
import PageLoadingSkeleton from "./components/PageLoadingSkeleton";
import { AqiProvider, useAqi } from "./context/AqiContext";
import { getApiBase } from "./util/apiBase";

const AQI_CATEGORIES = [
  {
    name: "GOOD",
    color: "#52c41a",
    range: "0 – 50.99 µg/Ncm",
    desc:
      "Satisfactory air. Minimal to no risk for the public, great for outdoor plans.",
  },
  {
    name: "FAIR",
    color: "#d4b106",
    range: "51 – 100.99 µg/Ncm",
    desc:
      "Sensitive groups should pace activities. The air has a slight haze but remains manageable.",
  },
  {
    name: "UNHEALTHY FOR SENSITIVE GROUPS",
    color: "#fa8c16",
    range: "101 – 150.99 µg/Ncm",
    desc:
      "People with respiratory or heart conditions, children, and the elderly may experience health effects. General public is less likely to be affected.",
  },
  {
    name: "VERY UNHEALTHY",
    color: "#f5222d",
    range: "151 – 200.99 µg/Ncm",
    desc:
      "Air masks and indoor shelter recommended—air can trigger symptoms quickly.",
  },
  {
    name: "ACUTELY UNHEALTHY",
    color: "#722ed1",
    range: "201 – 300.99 µg/Ncm",
    desc:
      "Emergency visibility: the air can feel heavy and irritate lungs within minutes.",
  },
  {
    name: "EMERGENCY",
    color: "#a8071a",
    range: "301 – 400.99 µg/Ncm",
    desc:
      "Everyone should stay indoors. This is the kind of air you can see and almost taste.",
  },
];

function ThemedLayout({
  dark,
  setDark,
  collapsed,
  setCollapsed,
  selectedKeys,
  navigate,
  items,
}) {
  const { category: currentAqiCategory } = useAqi() || {};
  const aqiCat = (currentAqiCategory || "").toUpperCase();
  const [aqiExpanded, setAqiExpanded] = useState(true);
  const { Header, Sider, Content, Footer } = Layout;
  const {
    token: {
      colorBgContainer,
      colorBgLayout,
      colorBgElevated,
      colorText,
      colorTextSecondary,
      borderRadiusLG,
    },
  } = theme.useToken();
  const currentYear = new Date().getFullYear();

  // ── Responsive breakpoint detection ──
  const screens = useBreakpoint();
  const isMobile = !screens.md;   // < 768px
  const isTablet = screens.md && !screens.lg; // 768–991
  const [drawerOpen, setDrawerOpen] = useState(false);

  // Close drawer on route change
  const locationObj = useLocation();
  useEffect(() => {
    setDrawerOpen(false);
  }, [locationObj.pathname]);

  // On mobile, force collapsed false in drawer mode
  const effectiveCollapsed = isMobile ? false : collapsed;

  // Light theme custom brand colors (soft, not pure white)
  const headerBg = dark ? colorBgElevated : "#f7f9fc"; // subtle light header
  const siderBg = dark
    ? "linear-gradient(to bottom, #0a1e3f 0%, #0e5135 100%)" // dark blue to green gradient
    : "linear-gradient(to bottom, #e0f2fe 0%, #bae6fd 100%)"; // sky-like gradient in light theme
  const brandBg = "transparent"; // let gradient show through brand area

  // Simple weather fetch for header theming (separate from badge for now)
  const [weatherCode, setWeatherCode] = useState(null);
  const [weatherWind, setWeatherWind] = useState(null);
  useEffect(() => {
    let cancelled = false;
    let lat = null;
    let lon = null;
    let timer;

    async function fetchHeaderWeather() {
      if (lat == null || lon == null) return;
      try {
        const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current_weather=true&timezone=auto`;
        const res = await fetch(url);
        const data = await res.json();
        const code = data?.current_weather?.weathercode ?? null;
        const wind = data?.current_weather?.windspeed ?? null;
        if (!cancelled) {
          setWeatherCode(code);
          setWeatherWind(wind);
        }
      } catch {}
    }

    navigator.geolocation.getCurrentPosition(
      (pos) => {
        lat = pos.coords.latitude;
        lon = pos.coords.longitude;
        setGeoPos({ lat, lon });
        fetchHeaderWeather();
        timer = setInterval(fetchHeaderWeather, 120000); // refresh every 2 minutes
      },
      () => {}
    );

    return () => {
      cancelled = true;
      if (timer) clearInterval(timer);
    };
  }, []);

  function weatherGradient(code, isDark) {
    // Map Open-Meteo codes to animated gradient backgrounds
    // Fallbacks are tuned for readability and aesthetics
    if (code === 0) {
      // Clear
      return isDark
        ? "linear-gradient(120deg, #0b1228, #0a1e3f, #083d77)"
        : "linear-gradient(120deg, #fff7cc, #ffe08a, #ffd166)";
    }
    if (code === 1 || code === 2) {
      // Partly cloudy
      return isDark
        ? "linear-gradient(120deg, #0a1e3f, #142850, #27496d)"
        : "linear-gradient(120deg, #e0f2fe, #cfe8ff, #b9e6ff)";
    }
    if (code === 3) {
      // Overcast
      return isDark
        ? "linear-gradient(120deg, #1f2937, #111827, #0b1220)"
        : "linear-gradient(120deg, #cfd4da, #bfc6ce, #aeb6bf)";
    }
    if ([61, 63, 65, 80, 81, 82].includes(code)) {
      // Rain
      return isDark
        ? "linear-gradient(120deg, #0f172a, #1e3a5f, #334e68)"
        : "linear-gradient(120deg, #9ec5fe, #7fb3ff, #6da9ff)";
    }
    if ([95, 96, 99].includes(code)) {
      // Storm
      return isDark
        ? "linear-gradient(120deg, #1e183a, #261b47, #2f1e58)"
        : "linear-gradient(120deg, #c9b6ff, #b79dff, #a384ff)";
    }
    if ([45, 48].includes(code)) {
      // Fog
      return isDark
        ? "linear-gradient(120deg, #2b3440, #212a33, #1a222a)"
        : "linear-gradient(120deg, #e6ebef, #dfe5ea, #d6dde3)";
    }
    if ([71, 73, 75, 77, 85, 86].includes(code)) {
      // Snow
      return isDark
        ? "linear-gradient(120deg, #0f1b2b, #1c2b3a, #2a3a4a)"
        : "linear-gradient(120deg, #eef6ff, #d9ecff, #cfe7ff)";
    }
    // Default fallback
    return isDark
      ? "linear-gradient(120deg, #0a1e3f, #0e5135)"
      : "linear-gradient(120deg, #e0f2fe, #bae6fd)";
  }

  const headerAnimatedBg =
    weatherCode != null ? weatherGradient(weatherCode, dark) : headerBg;
  const siderBgResolved =
    weatherCode != null ? weatherGradient(weatherCode, dark) : siderBg;

  function weatherEffect(code, wind) {
    if (code == null) return null;
    if ([61, 63, 65, 80, 81, 82].includes(code)) return "rain";
    if ([71, 73, 75, 77, 85, 86].includes(code)) return "snow";
    if ([45, 48].includes(code)) return "fog";
    if ([95, 96, 99].includes(code)) return "rain"; // storm -> rain visual fallback
    if ([1, 2, 3].includes(code)) return "clouds";
    if (typeof wind === "number" && wind >= 25) return "wind";
    return null;
  }
  const headerEffect = weatherEffect(weatherCode, weatherWind);
  const headerBgResolved = headerAnimatedBg;
  const isStorm = [95, 96, 99].includes(weatherCode);

  const [weatherOpen, setWeatherOpen] = useState(false);
  const [weatherLoading, setWeatherLoading] = useState(false);
  const [weatherData, setWeatherData] = useState(null);
  const [weatherError, setWeatherError] = useState(null);
  const [geoPos, setGeoPos] = useState(null);
  const [weatherForecast, setWeatherForecast] = useState([]);

  // Header location label — fetched once from reverse geocode
  const [headerLocation, setHeaderLocation] = useState(null);
  useEffect(() => {
    if (!geoPos?.lat || !geoPos?.lon) return;
    let cancelled = false;
    (async () => {
      try {
        const rgUrl = new URL(
          `/api/reverse-geocode?lat=${encodeURIComponent(geoPos.lat)}&lon=${encodeURIComponent(geoPos.lon)}`,
          getApiBase()
        ).toString();
        const rg = await fetch(rgUrl);
        if (rg.ok) {
          const j = await rg.json();
          if (!cancelled) {
            setHeaderLocation(j.display || j.name || `${geoPos.lat.toFixed(2)}, ${geoPos.lon.toFixed(2)}`);
          }
        }
      } catch {}
    })();
    return () => { cancelled = true; };
  }, [geoPos?.lat, geoPos?.lon]);

  function codeToLabel(code) {
    if (code === 0) return { label: "Clear", icon: "sunny" };
    if ([1, 2].includes(code))
      return { label: "Partly cloudy", icon: "partly_cloudy_day" };
    if (code === 3) return { label: "Overcast", icon: "cloud" };
    if ([45, 48].includes(code)) return { label: "Fog", icon: "foggy" };
    if ([51, 53, 55, 56, 57].includes(code))
      return { label: "Drizzle", icon: "rainy" };
    if ([61, 63, 65, 80, 81, 82].includes(code))
      return { label: "Rain", icon: "rainy" };
    if ([66, 67, 95, 96, 99].includes(code))
      return { label: "Storm", icon: "thunderstorm" };
    if ([71, 73, 75, 77, 85, 86].includes(code))
      return { label: "Snow", icon: "snowing" };
    return { label: "—", icon: "thermostat" };
  }

  function degToCompass(deg) {
    if (typeof deg !== "number" || !isFinite(deg)) return "—";
    const dirs = [
      "N",
      "NNE",
      "NE",
      "ENE",
      "E",
      "ESE",
      "SE",
      "SSE",
      "S",
      "SSW",
      "SW",
      "WSW",
      "W",
      "WNW",
      "NW",
      "NNW",
    ];
    const ix = Math.round((deg % 360) / 22.5) % 16;
    return dirs[ix];
  }

  function modalWeatherEffect(code, wind) {
    if (code == null) return null;
    if ([61, 63, 65, 80, 81, 82].includes(code)) return "rain";
    if ([71, 73, 75, 77, 85, 86].includes(code)) return "snow";
    if ([45, 48].includes(code)) return "fog";
    if ([95, 96, 99].includes(code)) return "storm";
    if ([1, 2, 3].includes(code)) return "clouds";
    if (typeof wind === "number" && wind >= 25) return "wind";
    return null;
  }

  async function openWeatherDetails() {
    setWeatherOpen(true);
    setWeatherLoading(true);
    setWeatherError(null);
    try {
      const runWithCoords = async (latitude, longitude) => {
        try {
          const params = new URLSearchParams();
          params.set("latitude", latitude);
          params.set("longitude", longitude);
          params.set("timezone", "auto");
          params.set("forecast_days", "5");
          params.set(
            "current",
            "temperature_2m,apparent_temperature,relative_humidity_2m,pressure_msl,wind_speed_10m,wind_direction_10m,weather_code"
          );
          params.set(
            "daily",
            "weather_code,temperature_2m_max,temperature_2m_min,sunrise,sunset"
          );
          const wUrl = `https://api.open-meteo.com/v1/forecast?${params.toString()}`;
          const wr = await fetch(wUrl);
          if (!wr.ok) throw new Error("weather fetch failed");
          const wj = await wr.json();
          const cur = wj?.current || wj?.current_weather || {};
          const daily = wj?.daily || {};
          const tmax = Array.isArray(daily.temperature_2m_max)
            ? daily.temperature_2m_max[0]
            : null;
          const tmin = Array.isArray(daily.temperature_2m_min)
            ? daily.temperature_2m_min[0]
            : null;
          const sunrise = Array.isArray(daily.sunrise)
            ? daily.sunrise[0]
            : null;
          const sunset = Array.isArray(daily.sunset) ? daily.sunset[0] : null;
          const curTemp = cur.temperature_2m ?? cur.temperature ?? null;
          const curApparent = cur.apparent_temperature ?? null;
          const curHumidity = cur.relative_humidity_2m ?? null;
          const curPressure = cur.pressure_msl ?? null;
          const curWindSpd = cur.wind_speed_10m ?? cur.windspeed ?? null;
          const curWindDir =
            cur.wind_direction_10m ?? cur.winddirection ?? null;
          const curCode = cur.weather_code ?? cur.weathercode ?? null;
          const curTime = cur.time ?? null;
          const fLen = Math.min(5, (daily.time || []).length || 0);
          const fc = [];
          for (let i = 0; i < fLen; i++) {
            fc.push({
              date: daily.time?.[i] || null,
              tmax: daily.temperature_2m_max?.[i] ?? null,
              tmin: daily.temperature_2m_min?.[i] ?? null,
              code: daily.weather_code?.[i] ?? null,
            });
          }
          setWeatherForecast(fc);
          // Reverse geocoding via backend proxy to avoid client-side CORS issues
          let place = null;
          try {
            const rgUrl = new URL(`/api/reverse-geocode?lat=${encodeURIComponent(latitude)}&lon=${encodeURIComponent(longitude)}`, getApiBase()).toString();
            const rg = await fetch(rgUrl);
            if (rg.ok) {
              const j = await rg.json();
              place = { name: j.name || null, region: j.region || null, display: j.display || null };
            }
          } catch {}

          setWeatherData({
            location:
              place?.display ||
              (typeof latitude === "number" && typeof longitude === "number"
                ? `${latitude.toFixed(4)}, ${longitude.toFixed(4)}`
                : null),
            latitude,
            longitude,
            temperature: curTemp,
            apparent: curApparent,
            humidity: curHumidity,
            pressure: curPressure,
            windspeed: curWindSpd,
            winddirection: curWindDir,
            weathercode: curCode,
            tmax: tmax ?? null,
            tmin: tmin ?? null,
            sunrise: sunrise || null,
            sunset: sunset || null,
            time: curTime,
          });
        } catch {
          setWeatherData(null);
          setWeatherError("Unable to fetch weather data.");
          setWeatherForecast([]);
        }
      };

      if (
        geoPos &&
        typeof geoPos.lat === "number" &&
        typeof geoPos.lon === "number"
      ) {
        await runWithCoords(geoPos.lat, geoPos.lon);
      } else {
        await new Promise((resolve) => {
          navigator.geolocation.getCurrentPosition(
            async (pos) => {
              const { latitude, longitude } = pos.coords;
              await runWithCoords(latitude, longitude);
              resolve();
            },
            (err) => {
              setWeatherError(
                err && err.code === err.PERMISSION_DENIED
                  ? "Location permission denied. Use HTTPS or allow access."
                  : err && err.code === err.TIMEOUT
                  ? "Timed out acquiring location. Try again."
                  : "Unable to determine your location."
              );
              resolve();
            },
            {
              enableHighAccuracy: false,
              timeout: 20000,
              maximumAge: 5 * 60 * 1000,
            }
          );
        });
      }
    } finally {
      setWeatherLoading(false);
    }
  }

  function renderCategoryTooltip(cat) {
    return (
      <div style={{ maxWidth: 220 }}>
        <div style={{ fontWeight: 600, color: cat.color, marginBottom: 4 }}>
          {cat.name}
        </div>
        <div style={{ fontSize: 12, marginBottom: 6 }}>{cat.desc}</div>
        <div style={{ fontSize: 11, color: "var(--aqm-muted)" }}>{cat.range}</div>
      </div>
    );
  }

  return (
    <Layout style={{ minHeight: "100vh", background: colorBgLayout }} className="aqm-app-layout">
      {/* Desktop/Tablet: standard collapsible Sider */}
      {!isMobile && (
        <Sider
          theme={dark ? "dark" : "light"}
          collapsible
          collapsed={collapsed}
          onCollapse={setCollapsed}
          breakpoint="lg"
          style={{ background: siderBgResolved, position: "relative" }}
          className={weatherCode != null ? "weather-animated" : undefined}
        >
          <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
            <div
              className="flex items-center h-16 font-semibold"
              style={{
                background: brandBg,
                color: colorText,
                justifyContent: collapsed ? "center" : "flex-start",
                paddingLeft: collapsed ? 0 : 30,
                paddingRight: collapsed ? 0 : 10,
                gap: collapsed ? 0 : 6,
              }}
            >
              <img src={embLogo} alt="EMB Logo" width={30} height={30} />
              {!collapsed && (
                <div className="flex flex-col leading-tight min-w-0">
                  <span style={{ fontWeight: 700, fontSize: 14, whiteSpace: "normal", lineHeight: 1.1 }}>
                    EMBR3 Air Quality
                  </span>
                  <span style={{ fontSize: 12, color: colorTextSecondary, whiteSpace: "nowrap" }}>
                    Monitoring {currentYear}
                  </span>
                </div>
              )}
            </div>
            <div style={{ flex: 1, overflowY: "auto" }}>
              <Menu
                theme={dark ? "dark" : "light"}
                mode="inline"
                selectedKeys={selectedKeys}
                items={items}
                style={{ background: "transparent", borderInlineEnd: "none" }}
                onClick={({ key }) => {
                  if (typeof key === 'string' && key.startsWith('/')) navigate(key);
                }}
              />
            {!collapsed ? (
              <>
                <div
                  className="aqm-sider-card"
                  role="note"
                  aria-label="AQI Categories and guidance"
                >
                  <div
                    className="aqm-sider-card-title"
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      gap: 8,
                    }}
                  >
                    <span>AQI Categories</span>
                    <Button
                      size="small"
                      type="text"
                      aria-label={
                        aqiExpanded
                          ? "Collapse AQI categories"
                          : "Expand AQI categories"
                      }
                      aria-expanded={aqiExpanded}
                      onClick={() => setAqiExpanded((v) => !v)}
                      icon={aqiExpanded ? <CaretDownOutlined /> : <CaretRightOutlined />}
                    />
                  </div>
                  {aqiExpanded ? (
                    <div className="aqm-sider-card-items">
                      {AQI_CATEGORIES.map((cat) => {
                        const active =
                          cat.name === "UNHEALTHY FOR SENSITIVE GROUPS"
                            ? aqiCat === cat.name
                            : aqiCat.includes(cat.name);
                        return (
                          <Tooltip
                            key={cat.name}
                            placement="right"
                            title={renderCategoryTooltip(cat)}
                          >
                            <div className="aqm-sider-item" style={{ cursor: "pointer" }}>
                              <span
                                className={`aqm-sider-dot${active ? " aqi-dot-pulse" : ""}`}
                                style={{
                                  background: cat.color,
                                  boxShadow: `0 0 0 2px var(--aqm-panel-bg), 0 0 10px ${cat.color}66`,
                                  ...(active
                                    ? {
                                        "--dot-glow": `${cat.color}cc`,
                                        "--dot-glow-strong": cat.color,
                                        "--dot-pulse-duration": "2.8s",
                                      }
                                    : {}),
                                }}
                              />
                              <div className="aqm-sider-text">
                                <div className="aqm-sider-name">{cat.name}</div>
                                <div className="aqm-sider-desc">{cat.desc}</div>
                                <div style={{ fontSize: 11, color: "var(--aqm-muted)" }}>{cat.range}</div>
                              </div>
                            </div>
                          </Tooltip>
                        );
                      })}
                    </div>
                  ) : (
                    <div
                      style={{
                        display: "flex",
                        flexWrap: "wrap",
                        gap: 8,
                        paddingTop: 8,
                      }}
                    >
                      {AQI_CATEGORIES.map((cat) => {
                        const active =
                          cat.name === "UNHEALTHY FOR SENSITIVE GROUPS"
                            ? aqiCat === cat.name
                            : aqiCat.includes(cat.name);
                        return (
                          <Tooltip
                            key={cat.name}
                            placement="right"
                            title={renderCategoryTooltip(cat)}
                          >
                            <div
                              style={{
                                border: `1px solid ${cat.color}`,
                                borderRadius: 999,
                                padding: "4px 10px",
                                fontSize: 11,
                                fontWeight: 600,
                                color: active
                                  ? "var(--aqm-panel-bg)"
                                  : cat.color,
                                background: active ? cat.color : "transparent",
                                transition: "all 0.2s ease",
                                cursor: "pointer",
                              }}
                            >
                              {cat.name}
                            </div>
                          </Tooltip>
                        );
                      })}
                    </div>
                  )}
                </div>
                <div
                  className="aqm-sider-card"
                  role="note"
                  aria-label="Contact information and more resources"
                >
                  <div className="aqm-sider-card-title">Contact / More Information</div>
                  <div className="aqm-sider-contact-links">
                    <a
                      href="http://r3.emb.gov.ph/"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="aqm-sider-contact-link website-icon"
                      aria-label="Visit EMB Region 3 Official Website"
                    >
                      <GlobalOutlined /> <span>EMB Region 3 Official</span>
                    </a>
                    <a
                      href="https://www.facebook.com/EMB3Official"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="aqm-sider-contact-link facebook-icon"
                      aria-label="Open EMB Region III Facebook page"
                    >
                      <FacebookFilled /> <span>Facebook</span>
                    </a>
                    <a
                      href="mailto:r3emed@emb.gov.ph"
                      className="aqm-sider-contact-link mail-icon"
                      aria-label="Send email to EMED environmental monitoring division"
                    >
                      <MailOutlined /> <span>Email (EMED)</span>
                    </a>
                  </div>
                </div>
              </>
            ) : (
              <>
                <div className="aqm-sider-tiles" aria-label="AQI legend">
                  {AQI_CATEGORIES.map((cat) => (
                    <Tooltip
                      key={cat.name}
                      placement="right"
                      title={
                        <div style={{ maxWidth: 260 }}>
                          <div style={{ fontWeight: 700, marginBottom: 4, color: cat.color }}>
                            {cat.name}
                          </div>
                          <div style={{ fontSize: 12, lineHeight: 1.3, marginBottom: 6 }}>
                            {cat.desc}
                          </div>
                          <div style={{ fontSize: 11, color: "var(--aqm-muted)" }}>{cat.range}</div>
                        </div>
                      }
                    >
                      <div
                        className="aqm-sider-mini"
                        style={{ background: cat.color }}
                        aria-label={cat.name}
                      />
                    </Tooltip>
                  ))}
                </div>
                {/* Collapsed contact icons */}
                <div
                  className="aqm-sider-contacts-collapsed"
                  aria-label="Quick access contact links"
                >
                  <Tooltip title="EMB Region 3 Official" placement="right">
                    <a
                      href="http://r3.emb.gov.ph/"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="aqm-sider-contact-btn website-icon"
                      aria-label="Visit EMB Region 3 Official Website"
                    >
                      <GlobalOutlined />
                    </a>
                  </Tooltip>
                  <Tooltip title="Facebook" placement="right">
                    <a
                      href="https://www.facebook.com/EMB3Official"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="aqm-sider-contact-btn facebook-icon"
                      aria-label="Open EMB Region III Facebook page"
                    >
                      <FacebookFilled />
                    </a>
                  </Tooltip>
                  <Tooltip title="Email (EMED)" placement="right">
                    <a
                      href="mailto:r3emed@emb.gov.ph"
                      className="aqm-sider-contact-btn mail-icon"
                      aria-label="Send email to EMED environmental monitoring division"
                    >
                      <MailOutlined />
                    </a>
                  </Tooltip>
                </div>
              </>
            )}
          </div>
        </div>
      </Sider>
      )}

      {/* Mobile: Drawer-based navigation */}
      {isMobile && (
        <Drawer
          placement="left"
          open={drawerOpen}
          onClose={() => setDrawerOpen(false)}
          width={280}
          styles={{ body: { padding: 0, background: siderBgResolved }, header: { background: siderBgResolved, borderBottom: 'none' } }}
          title={
            <div className="flex items-center gap-2" style={{ color: colorText }}>
              <img src={embLogo} alt="EMB Logo" width={28} height={28} />
              <div className="flex flex-col leading-tight">
                <span style={{ fontWeight: 700, fontSize: 13, lineHeight: 1.1 }}>EMBR3 Air Quality</span>
                <span style={{ fontSize: 11, color: colorTextSecondary }}>Monitoring {currentYear}</span>
              </div>
            </div>
          }
          closeIcon={<CloseOutlined style={{ color: colorText }} />}
        >
          <div style={{ display: "flex", flexDirection: "column", height: "100%", overflowY: "auto" }}>
            <Menu
              theme={dark ? "dark" : "light"}
              mode="inline"
              selectedKeys={selectedKeys}
              items={items}
              style={{ background: "transparent", borderInlineEnd: "none" }}
              onClick={({ key }) => {
                if (typeof key === 'string' && key.startsWith('/')) {
                  navigate(key);
                  setDrawerOpen(false);
                }
              }}
            />
            <div
              className="aqm-sider-card"
              role="note"
              aria-label="AQI Categories mobile"
            >
              <div className="aqm-sider-card-title">AQI Categories</div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8, paddingTop: 8 }}>
                {AQI_CATEGORIES.map((cat) => {
                  const active = cat.name === "UNHEALTHY FOR SENSITIVE GROUPS" ? aqiCat === cat.name : aqiCat.includes(cat.name);
                  return (
                    <Tooltip key={cat.name} placement="right" title={renderCategoryTooltip(cat)}>
                      <div
                        style={{
                          border: `1px solid ${cat.color}`,
                          borderRadius: 999,
                          padding: "4px 10px",
                          fontSize: 11,
                          fontWeight: 600,
                          color: active ? "var(--aqm-panel-bg)" : cat.color,
                          background: active ? cat.color : "transparent",
                          transition: "all 0.2s ease",
                          cursor: "pointer",
                        }}
                      >
                        {cat.name}
                      </div>
                    </Tooltip>
                  );
                })}
              </div>
            </div>
            <div className="aqm-sider-card" role="note" aria-label="Contact information mobile">
              <div className="aqm-sider-card-title">Contact / Info</div>
              <div className="aqm-footer-links" style={{ display: "flex", flexDirection: "column", gap: 8, fontSize: 12 }}>
                <a href="http://r3.emb.gov.ph/" target="_blank" rel="noopener noreferrer" className="aqm-footer-link website-icon"><GlobalOutlined /> EMB Region 3 Official</a>
                <a href="https://www.facebook.com/EMB3Official" target="_blank" rel="noopener noreferrer" className="aqm-footer-link facebook-icon"><FacebookFilled /> Facebook</a>
                <a href="mailto:r3emed@emb.gov.ph" className="aqm-footer-link mail-icon"><MailOutlined /> Email (EMED)</a>
              </div>
            </div>
          </div>
        </Drawer>
      )}

      <Layout style={{ background: colorBgLayout }}>
        <Header
          style={{
            padding: 0,
            background: headerBgResolved,
            position: "relative",
            overflow: "hidden",
          }}
          className={`${weatherCode != null ? "weather-animated" : ""} aqm-header`}
        >
          {/* Background layers first: stars and moon (behind values and overlays) */}
          {headerEffect === "stars" && (
            <div className="weather-layer weather-stars" />
          )}
          {headerEffect === "stars" && (
            <div className="weather-layer weather-moon" />
          )}

          {/* Weather visuals split across left, center, right segments */}
          <div className="weather-segment left">
            {headerEffect === "clouds" && (
              <div className="weather-layer weather-clouds">
                <div className="cloud" />
                <div className="cloud" />
                <div className="cloud" />
              </div>
            )}
            {headerEffect === "fog" && (
              <div className="weather-layer weather-clouds">
                <div className="cloud" />
                <div className="cloud" />
              </div>
            )}
            {headerEffect === "rain" && (
              <div className="weather-layer weather-rain" />
            )}
            {isStorm && (
              <div className="weather-layer weather-lightning">
                <div className="flash" />
                <div className="bolt" />
                <div className="bolt" />
              </div>
            )}
            {headerEffect === "snow" && (
              <div className="weather-layer weather-snow">
                <div className="flake" />
                <div className="flake" />
                <div className="flake" />
                <div className="flake" />
                <div className="flake" />
                <div className="flake" />
              </div>
            )}
            {headerEffect === "wind" && (
              <div className="weather-layer weather-wind" />
            )}
            {headerEffect === "fog" && (
              <div className="weather-layer weather-fog" />
            )}
          </div>

          <div className="weather-segment center">
            {headerEffect === "clouds" && (
              <div className="weather-layer weather-clouds">
                <div className="cloud" />
                <div className="cloud" />
                <div className="cloud" />
              </div>
            )}
            {headerEffect === "fog" && (
              <div className="weather-layer weather-clouds">
                <div className="cloud" />
                <div className="cloud" />
              </div>
            )}
            {headerEffect === "rain" && (
              <div className="weather-layer weather-rain" />
            )}
            {isStorm && (
              <div className="weather-layer weather-lightning">
                <div className="flash" />
                <div className="bolt" />
                <div className="bolt" />
              </div>
            )}
            {headerEffect === "snow" && (
              <div className="weather-layer weather-snow">
                <div className="flake" />
                <div className="flake" />
                <div className="flake" />
                <div className="flake" />
                <div className="flake" />
                <div className="flake" />
              </div>
            )}
            {headerEffect === "wind" && (
              <div className="weather-layer weather-wind" />
            )}
            {headerEffect === "fog" && (
              <div className="weather-layer weather-fog" />
            )}
          </div>

          <div className="weather-segment right">
            {headerEffect === "clouds" && (
              <div className="weather-layer weather-clouds">
                <div className="cloud" />
                <div className="cloud" />
                <div className="cloud" />
              </div>
            )}
            {headerEffect === "fog" && (
              <div className="weather-layer weather-clouds">
                <div className="cloud" />
                <div className="cloud" />
              </div>
            )}
            {headerEffect === "rain" && (
              <div className="weather-layer weather-rain" />
            )}
            {isStorm && (
              <div className="weather-layer weather-lightning">
                <div className="flash" />
                <div className="bolt" />
                <div className="bolt" />
              </div>
            )}
            {headerEffect === "snow" && (
              <div className="weather-layer weather-snow">
                <div className="flake" />
                <div className="flake" />
                <div className="flake" />
                <div className="flake" />
                <div className="flake" />
                <div className="flake" />
              </div>
            )}
            {headerEffect === "wind" && (
              <div className="weather-layer weather-wind" />
            )}
            {headerEffect === "fog" && (
              <div className="weather-layer weather-fog" />
            )}
          </div>

          <div
            className="flex items-center justify-between px-4 h-16 aqm-header-bar"
            style={{ position: "relative", zIndex: 2 }}
          >
            {/* Mobile hamburger */}
            {isMobile ? (
              <Button
                type="text"
                icon={<MenuOutlined style={{ fontSize: 20, color: dark ? '#fff' : '#1a1a2e' }} />}
                onClick={() => setDrawerOpen(true)}
                aria-label="Open navigation menu"
                className="aqm-hamburger-btn"
              />
            ) : <div />}
            {/* Centered title — shown on mobile & tablet */}
            {(isMobile || isTablet) && (
              <div className="aqm-mobile-title">
                <img src={embLogo} alt="EMB" className="aqm-mobile-title-logo" />
                <span className="aqm-mobile-title-text">EMBR3 Air Quality</span>
              </div>
            )}
            <div className="flex items-center gap-3">
              {headerLocation && (
                <span className="aqm-header-location">
                  <EnvironmentOutlined className="aqm-header-location-icon" />
                  <span className="aqm-header-location-text">{headerLocation}</span>
                </span>
              )}
              <Switch
                checked={dark}
                onChange={(v) => setDark(v)}
                checkedChildren={<BulbFilled />}
                unCheckedChildren={<BulbOutlined />}
                aria-label="Toggle dark mode"
              />
            </div>
          </div>
          <Modal
            title="Current Location Weather"
            open={weatherOpen}
            onCancel={() => setWeatherOpen(false)}
            footer={null}
          >
            {weatherLoading ? (
              <div
                style={{
                  display: "flex",
                  justifyContent: "center",
                  padding: "24px 0",
                }}
              >
                <Spin />
              </div>
            ) : weatherError ? (
              <div>{weatherError}</div>
            ) : weatherData ? (
              <>
                <div className="wm-header">
                  {(() => {
                    const eff = modalWeatherEffect(
                      weatherData.weathercode,
                      weatherData.windspeed
                    );
                    if (!eff) return null;
                    return (
                      <div className="wm-anim">
                        {eff === "clouds" && (
                          <div className="weather-layer weather-clouds">
                            <div className="cloud" />
                            <div className="cloud" />
                            <div className="cloud" />
                          </div>
                        )}
                        {eff === "fog" && (
                          <div className="weather-layer weather-clouds">
                            <div className="cloud" />
                            <div className="cloud" />
                          </div>
                        )}
                        {(eff === "rain" || eff === "storm") && (
                          <div className="weather-layer weather-rain" />
                        )}
                        {eff === "storm" && (
                          <div className="weather-layer weather-lightning">
                            <div className="flash" />
                            <div className="bolt" />
                            <div className="bolt" />
                          </div>
                        )}
                        {eff === "snow" && (
                          <div className="weather-layer weather-snow">
                            <div className="flake" />
                            <div className="flake" />
                            <div className="flake" />
                            <div className="flake" />
                            <div className="flake" />
                            <div className="flake" />
                          </div>
                        )}
                        {eff === "wind" && (
                          <div className="weather-layer weather-wind" />
                        )}
                        {eff === "fog" && (
                          <div className="weather-layer weather-fog" />
                        )}
                      </div>
                    );
                  })()}
                  <div className="wm-header-inner">
                    <div className="wm-row">
                      <span className="wm-temp">
                        {weatherData.temperature != null
                          ? `${Math.round(weatherData.temperature)}°C`
                          : "—"}
                      </span>
                      <span className="wm-cond">
                        {codeToLabel(weatherData.weathercode).label}
                      </span>
                    </div>
                    {weatherData.location && (
                      <div style={{ fontSize: 12, opacity: 0.9, marginTop: 4 }}>
                        {weatherData.location}
                      </div>
                    )}
                  </div>
                </div>

                <Descriptions column={1} size="small" bordered>
                  <Descriptions.Item label="Coordinates">
                    {weatherData.latitude?.toFixed
                      ? weatherData.latitude.toFixed(5)
                      : weatherData.latitude}
                    ,{" "}
                    {weatherData.longitude?.toFixed
                      ? weatherData.longitude.toFixed(5)
                      : weatherData.longitude}
                  </Descriptions.Item>
                  <Descriptions.Item label="High / Low">
                    {weatherData.tmax != null || weatherData.tmin != null
                      ? `${
                          weatherData.tmax != null
                            ? Math.round(weatherData.tmax)
                            : "—"
                        }° / ${
                          weatherData.tmin != null
                            ? Math.round(weatherData.tmin)
                            : "—"
                        }°`
                      : "—"}
                  </Descriptions.Item>
                  <Descriptions.Item label="Wind">
                    {weatherData.windspeed != null
                      ? `${Math.round(weatherData.windspeed)} km/h`
                      : "—"}
                    {weatherData.winddirection != null
                      ? ` · ${degToCompass(
                          Math.round(weatherData.winddirection)
                        )}`
                      : ""}
                  </Descriptions.Item>
                  {weatherData.time && (
                    <Descriptions.Item label="As of">
                      {new Date(weatherData.time).toLocaleString()}
                    </Descriptions.Item>
                  )}
                </Descriptions>

                <div className="wm-metrics" style={{ marginTop: 12 }}>
                  <div className="wm-metric">
                    <div className="wm-metric-label">Pressure</div>
                    <div className="wm-metric-value">
                      {weatherData.pressure != null
                        ? `${Math.round(weatherData.pressure)} hPa`
                        : "—"}
                    </div>
                  </div>
                  <div className="wm-metric">
                    <div className="wm-metric-label">Feels Like</div>
                    <div className="wm-metric-value wm-feels">
                      {weatherData.apparent != null
                        ? `${Math.round(weatherData.apparent)}°C`
                        : "—"}
                    </div>
                  </div>
                  <div className="wm-metric">
                    <div className="wm-metric-label">Humidity</div>
                    <div className="wm-metric-value">
                      {weatherData.humidity != null
                        ? `${Math.round(weatherData.humidity)}%`
                        : "—"}
                    </div>
                  </div>
                  <div className="wm-metric">
                    <div className="wm-metric-label">Wind</div>
                    <div className="wm-metric-value">
                      {weatherData.windspeed != null
                        ? `${Math.round(weatherData.windspeed)} km/h`
                        : "—"}
                      {weatherData.winddirection != null && (
                        <span
                          style={{
                            marginLeft: 8,
                            display: "inline-flex",
                            alignItems: "center",
                            gap: 4,
                          }}
                        >
                          <span
                            className="material-symbols-rounded"
                            style={{
                              fontVariationSettings:
                                "'FILL' 1, 'wght' 400, 'opsz' 24",
                              transform: `rotate(${Math.round(
                                weatherData.winddirection
                              )}deg)`,
                            }}
                          >
                            north
                          </span>
                          {degToCompass(Math.round(weatherData.winddirection))}
                        </span>
                      )}
                    </div>
                  </div>
                </div>

                {(weatherData.sunrise || weatherData.sunset) && (
                  <div className="wm-sunrow" style={{ marginTop: 12 }}>
                    {weatherData.sunrise && (
                      <div className="wm-sun">
                        <span
                          className="material-symbols-rounded wm-sun-icon"
                          style={{
                            fontVariationSettings:
                              "'FILL' 1, 'wght' 400, 'opsz' 24",
                          }}
                        >
                          wb_sunny
                        </span>
                        <div className="wm-sun-label">Sunrise</div>
                        <div className="wm-sun-time">
                          {new Date(weatherData.sunrise).toLocaleTimeString(
                            [],
                            { hour: "numeric", minute: "2-digit" }
                          )}
                        </div>
                      </div>
                    )}
                    {weatherData.sunset && (
                      <div className="wm-sun">
                        <span
                          className="material-symbols-rounded wm-sun-icon"
                          style={{
                            fontVariationSettings:
                              "'FILL' 1, 'wght' 400, 'opsz' 24",
                          }}
                        >
                          nights_stay
                        </span>
                        <div className="wm-sun-label">Sunset</div>
                        <div className="wm-sun-time">
                          {new Date(weatherData.sunset).toLocaleTimeString([], {
                            hour: "numeric",
                            minute: "2-digit",
                          })}
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {Array.isArray(weatherForecast) &&
                  weatherForecast.length > 0 && (
                    <div style={{ marginTop: 12 }}>
                      <div
                        style={{
                          fontWeight: 700,
                          fontSize: 12,
                          marginBottom: 6,
                          color: "var(--aqm-muted, #64748b)",
                        }}
                      >
                        5-Day Forecast
                      </div>
                      <div className="wm-forecast">
                        {weatherForecast.map((d, idx) => {
                          const dt = d.date ? new Date(d.date) : null;
                          const day = dt
                            ? dt.toLocaleDateString(undefined, {
                                weekday: "short",
                              })
                            : `Day ${idx + 1}`;
                          const info = codeToLabel(d.code);
                          const bg = weatherGradient(d.code, dark);
                          return (
                            <div
                              key={idx}
                              className="wm-day"
                              style={{
                                background: bg,
                                borderColor: dark
                                  ? "rgba(255,255,255,0.08)"
                                  : "rgba(0,0,0,0.06)",
                                color: dark ? "#ffffff" : undefined,
                              }}
                            >
                              <div className="wm-day-name">{day}</div>
                              <span
                                className="material-symbols-rounded wm-day-icon"
                                style={{
                                  fontVariationSettings:
                                    "'FILL' 1, 'wght' 400, 'opsz' 24",
                                }}
                              >
                                {info.icon}
                              </span>
                              <div className="wm-day-temp">
                                {d.tmax != null ? Math.round(d.tmax) : "—"}° /{" "}
                                {d.tmin != null ? Math.round(d.tmin) : "—"}°
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}
              </>
            ) : (
              <div>Unable to load weather details.</div>
            )}
          </Modal>
        </Header>
        <Content style={{ margin: isMobile ? "8px" : "16px" }} className="aqm-content">
          <div
            style={{
              padding: isMobile ? 12 : isTablet ? 16 : 24,
              minHeight: 360,
              background: colorBgContainer,
              borderRadius: borderRadiusLG,
              color: colorText,
            }}
          >
            <Suspense
              fallback={<PageLoadingSkeleton sections={4} />}
            >
              <Routes>
                <Route path="/" element={<KioskPage />} />
                <Route path="/embr3-latestaqi" element={<Navigate to="/" replace />} />
                <Route path="/admin" element={<Navigate to="/admin/overview" replace />} />
                <Route path="/admin/overview" element={<DashboardPage />} />
                <Route path="/admin/tabular" element={<Navigate to="/admin/tabular/meycauayan" replace />} />
                <Route path="/admin/tabular/:province" element={<TabularResultsPage />} />
                <Route path="/admin/charts" element={<ChartsPage />} />
                <Route path="/admin/map" element={<MapPage />} />
                {/* Legacy routes redirect to /admin */}
                <Route path="/overview" element={<Navigate to="/admin/overview" replace />} />
                <Route path="/tabular/*" element={<Navigate to="/admin/tabular/meycauayan" replace />} />
                <Route path="/charts" element={<Navigate to="/admin/charts" replace />} />
                <Route path="/map" element={<Navigate to="/admin/map" replace />} />
              </Routes>
            </Suspense>
          </div>
        </Content>
        <Footer
          style={{
            background: colorBgLayout,
            color: colorTextSecondary,
            padding: isMobile ? "12px 16px" : "16px 24px",
          }}
          className="aqm-footer"
        >
          <div className="aqm-footer-inner">
            <div className="aqm-footer-copy">
              Environmental Management Bureau Region III Air Quality Monitoring
              © {new Date().getFullYear()}
            </div>
            <div className="aqm-footer-links">
              <a
                href="http://r3.emb.gov.ph/"
                target="_blank"
                rel="noopener noreferrer"
                className="aqm-footer-link website-icon"
                aria-label="Visit EMB Region 3 Official Website"
              >
                <GlobalOutlined /> <span>EMB Region 3 Official</span>
              </a>
              <a
                href="https://www.facebook.com/EMB3Official"
                target="_blank"
                rel="noopener noreferrer"
                className="aqm-footer-link facebook-icon"
                aria-label="Open EMB Region III Facebook page"
              >
                <FacebookFilled /> <span>Facebook</span>
              </a>
              <a
                href="mailto:r3emed@emb.gov.ph"
                className="aqm-footer-link mail-icon"
                aria-label="Send email to EMED environmental monitoring division"
              >
                <MailOutlined /> <span>Email (EMED)</span>
              </a>
            </div>
          </div>
        </Footer>
      </Layout>
    </Layout>
  );
}

//

import { secureStorage } from './utils/secureStorage';

function App() {
  const [collapsed, setCollapsed] = useState(false);
  const [dark, setDark] = useState(() => {
    try {
      const saved = secureStorage.getItem("aqm-theme");
      if (saved === "dark") return true;
      if (saved === "light") return false;
      return (
        window.matchMedia &&
        window.matchMedia("(prefers-color-scheme: dark)").matches
      );
    } catch {
      return false;
    }
  });
  const location = useLocation();
  const navigate = useNavigate();
  useEffect(() => {
    const root = document.documentElement;
    if (dark) {
      root.classList.add("dark");
    } else {
      root.classList.remove("dark");
    }
    try {
      secureStorage.setItem("aqm-theme", dark ? "dark" : "light");
    } catch {}
  }, [dark]);
  // tokens are consumed inside ThemedLayout under ConfigProvider

  const provinces = [
    { key: 'meycauayan', label: 'Meycauayan' },
    { key: 'zambales', label: 'Zambales' },
    { key: 'clark', label: 'Clark' },
    { key: 'san-fernando', label: 'San Fernando' },
  ];

  const items = [
    { key: "/admin/overview", icon: <DashboardOutlined />, label: "Overview" },
    {
      key: "tabular",
      icon: <TableOutlined />,
      label: "Tabular Results",
      children: provinces.map((p) => ({
        key: `/admin/tabular/${p.key}`,
        label: p.label,
      })),
    },
    { key: "/admin/map", icon: <EnvironmentOutlined />, label: "Map" },
  ];

  const selectableKeys = [
    '/admin/overview',
    ...provinces.map((p) => `/admin/tabular/${p.key}`),
    '/admin/tabular',
    '/admin/map',
    '/admin',
    '/',
  ];

  const selectedKey =
    selectableKeys
      .sort((a, b) => b.length - a.length)
      .find(
        (k) =>
          location.pathname === k ||
          (k !== "/" && location.pathname.startsWith(k))
      ) || "/admin/overview";
  const selectedKeys = [selectedKey];

  // Set dynamic document title to requested app name with current year
  useEffect(() => {
    const y = new Date().getFullYear();
    document.title = `EMBR3 Air Quality Monitoring (${y})`;
  }, []);

  // ── Kiosk route renders outside the main layout ──
  if (location.pathname === "/" || location.pathname === "/embr3-latestaqi") {
    return (
      <Suspense
        fallback={
          <div style={{
            display: "flex",
            flexDirection: "column",
            justifyContent: "center",
            alignItems: "center",
            height: "100vh",
            background: "var(--aqm-bg, #f0f2f5)",
            padding: 32,
          }}>
            <PageLoadingSkeleton sections={3} compact />
          </div>
        }
      >
        <KioskPage />
      </Suspense>
    );
  }

  return (
    <ConfigProvider
      theme={{
        algorithm: dark ? theme.darkAlgorithm : theme.defaultAlgorithm,
        components: {
          Layout: dark
            ? {}
            : {
                headerBg: "#f7f9fc",
                siderBg: "#f3f6fb",
              },
          Menu: dark
            ? {
                itemHeight: 36,
                itemBorderRadius: 8,
                itemPaddingInline: 12,
                fontSize: 13,
              }
            : {
                itemHeight: 36,
                itemBorderRadius: 8,
                itemPaddingInline: 12,
                fontSize: 13,
                itemSelectedBg: "#e6f4ff",
                itemSelectedColor: "#1677ff",
                itemHoverBg: "#f0f7ff",
                itemColor: "#334155",
              },
        },
      }}
    >
      <AqiProvider>
        <ThemedLayout
          dark={dark}
          setDark={setDark}
          collapsed={collapsed}
          setCollapsed={setCollapsed}
          selectedKeys={selectedKeys}
          navigate={navigate}
          items={items}
        />
      </AqiProvider>
    </ConfigProvider>
  );
}

export default App;
