import { useState, useEffect } from "react";
import { Layout, Menu, theme, ConfigProvider, Switch } from "antd";
import { Routes, Route, useLocation, useNavigate } from "react-router-dom";
import {
  DashboardOutlined,
  AreaChartOutlined,
  EnvironmentOutlined,
  SettingOutlined,
  BulbOutlined,
  BulbFilled,
} from "@ant-design/icons";
import "./App.css";
import DashboardPage from "./pages/Dashboard";
import ChartsPage from "./pages/Charts";
import MapPage from "./pages/Map";
import SettingsPage from "./pages/Settings";
import embLogo from "./assets/emblogo.svg";
import WeatherBadge from "./components/WeatherBadge";

function ThemedLayout({
  dark,
  setDark,
  collapsed,
  setCollapsed,
  selectedKeys,
  navigate,
  items,
}) {
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

  return (
    <Layout style={{ minHeight: "100vh", background: colorBgLayout }}>
      <Sider
        theme={dark ? "dark" : "light"}
        collapsible
        collapsed={collapsed}
        onCollapse={setCollapsed}
        breakpoint="lg"
        style={{ background: siderBgResolved }}
        className={weatherCode != null ? "weather-animated" : undefined}
      >
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
              <span
                style={{
                  fontWeight: 700,
                  fontSize: 14,
                  whiteSpace: "normal", // allow wrapping instead of ellipsis
                  lineHeight: 1.1,
                }}
              >
                EMBR3 Air Quality
              </span>
              <span
                style={{
                  fontSize: 12,
                  color: colorTextSecondary,
                  whiteSpace: "nowrap",
                }}
              >
                Monitoring {currentYear}
              </span>
            </div>
          )}
        </div>
        <Menu
          theme={dark ? "dark" : "light"}
          mode="inline"
          selectedKeys={selectedKeys}
          items={items}
          style={{ background: "transparent", borderInlineEnd: "none" }}
          onClick={({ key }) => navigate(key)}
        />
      </Sider>
      <Layout style={{ background: colorBgLayout }}>
        <Header
          style={{
            padding: 0,
            background: headerBgResolved,
            position: "relative",
            overflow: "hidden",
          }}
          className={weatherCode != null ? "weather-animated" : undefined}
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
            className="flex items-center justify-end px-4 h-16"
            style={{ position: "relative", zIndex: 2 }}
          >
            <div className="flex items-center gap-3">
              <WeatherBadge />
              <Switch
                checked={dark}
                onChange={(v) => setDark(v)}
                checkedChildren={<BulbFilled />}
                unCheckedChildren={<BulbOutlined />}
                aria-label="Toggle dark mode"
              />
            </div>
          </div>
        </Header>
        <Content style={{ margin: "16px" }}>
          <div
            style={{
              padding: 24,
              minHeight: 360,
              background: colorBgContainer,
              borderRadius: borderRadiusLG,
              color: colorText,
            }}
          >
            <Routes>
              <Route path="/" element={<DashboardPage />} />
              <Route path="/station/clark" element={<DashboardPage />} />
              {/* Charts route can remain accessible directly if needed */}
              <Route path="/charts" element={<ChartsPage />} />
              <Route path="/map" element={<MapPage />} />
              <Route path="/settings" element={<SettingsPage />} />
            </Routes>
          </div>
        </Content>
        <Footer
          style={{
            textAlign: "center",
            background: colorBgLayout,
            color: colorTextSecondary,
          }}
        >
          EMBR3 Air Quality Monitoring © {new Date().getFullYear()}
        </Footer>
      </Layout>
    </Layout>
  );
}

//

function App() {
  const [collapsed, setCollapsed] = useState(false);
  const [dark, setDark] = useState(() => {
    try {
      const saved = localStorage.getItem("aqm-theme");
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
      localStorage.setItem("aqm-theme", dark ? "dark" : "light");
    } catch {}
  }, [dark]);
  // tokens are consumed inside ThemedLayout under ConfigProvider

  const items = [
    {
      key: "stations",
      icon: <DashboardOutlined />,
      label: "Stations",
      children: [{ key: "/station/clark", label: "Clark Station" }],
    },
    { key: "/map", icon: <EnvironmentOutlined />, label: "Map" },
    { key: "/settings", icon: <SettingOutlined />, label: "Settings" },
  ];

  const selectedKey =
    ["/station/clark", "/map", "/settings", "/"]
      .sort((a, b) => b.length - a.length)
      .find(
        (k) =>
          location.pathname === k ||
          (k !== "/" && location.pathname.startsWith(k))
      ) || "/";
  const selectedKeys = [selectedKey];

  // Set dynamic document title to requested app name with current year
  useEffect(() => {
    const y = new Date().getFullYear();
    document.title = `EMBR3 Air Quality Monitoring (${y})`;
  }, []);

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
      <ThemedLayout
        dark={dark}
        setDark={setDark}
        collapsed={collapsed}
        setCollapsed={setCollapsed}
        selectedKeys={selectedKeys}
        navigate={navigate}
        items={items}
      />
    </ConfigProvider>
  );
}

export default App;
