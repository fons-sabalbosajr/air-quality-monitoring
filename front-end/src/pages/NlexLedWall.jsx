/**
 * NlexLedWall – 960 × 1536 px portrait LED wall display
 * Route: /nlex
 *
 * Features:
 *  - Custom SVG arc gauge with gradient and tick marks
 *  - Per-card "As of" timestamps
 *  - Weather background from device's geolocation (browser API)
 *  - Day/night aware, all weather scenarios
 *  - Organized footer with icons
 *  - Poppins font
 */
import { useEffect, useState, useRef } from "react";
import { ConfigProvider } from "antd";
import {
  TbMapPin,
  TbWorld,
  TbCurrentLocation,
  TbSun,
  TbMoon,
  TbCloud,
  TbCloudRain,
  TbCloudSnow,
  TbCloudStorm,
  TbTools,
  TbPhone,
  TbMail,
  TbCircleCheckFilled,
} from "react-icons/tb";
import useLatestAqi from "../hooks/useLatestAqi";
import embLogo from "../assets/emblogo.svg";
import bpLogo from "../assets/bplogo.svg";
import {
  NlexSettingsProvider,
  useNlexSettings,
} from "../context/NlexSettingsContext";
import "./NlexLedWall.css";

/* ═══════════════════════════════════════════════════════════════
   AQI BANDS
   ═══════════════════════════════════════════════════════════════ */
const BANDS = [
  {
    id: "good",
    name: "GOOD",
    legendLabel: "GOOD",
    short: "Good",
    min: 0,
    max: 50,
    color: "#16a34a",
    emoji: "😊",
    desc: "Air is clean. Safe for everyone.",
  },
  {
    id: "fair",
    name: "FAIR",
    legendLabel: "FAIR",
    short: "Fair",
    min: 50,
    max: 100,
    color: "#ca8a04",
    emoji: "😐",
    desc: "Acceptable. Sensitive groups take caution.",
  },
  {
    id: "usg",
    name: "UNHEALTHY FOR SENSITIVE GROUPS",
    legendLabel: "UNHEALTHY (S.G.)",
    short: "Sensitive",
    min: 100,
    max: 150,
    color: "#ea580c",
    emoji: "😷",
    desc: "Unhealthy for children, elderly & sick. Limit outdoor activity.",
  },
  {
    id: "vu",
    name: "VERY UNHEALTHY",
    legendLabel: "VERY UNHEALTHY",
    short: "Very Unhealthy",
    min: 150,
    max: 200,
    color: "#dc2626",
    emoji: "😰",
    desc: "Wear a mask. Everyone may feel health effects.",
  },
  {
    id: "au",
    name: "ACUTELY UNHEALTHY",
    legendLabel: "ACUTELY UNHEALTHY",
    short: "Acutely",
    min: 200,
    max: 300,
    color: "#7c3aed",
    emoji: "😱",
    desc: "Health hazard for all. Avoid outdoor exposure.",
  },
  {
    id: "emergency",
    name: "EMERGENCY",
    legendLabel: "EMERGENCY",
    short: "Emergency",
    min: 300,
    max: 500,
    color: "#9f1239",
    emoji: "☠️",
    desc: "Stay indoors. Air is dangerous for everyone.",
  },
];
const AQI_MAX = 500;

function getBand(v) {
  const n = Number(v);
  if (!isFinite(n) || n < 0) return BANDS[0];
  return BANDS.find((b) => n >= b.min && n < b.max) ?? BANDS[BANDS.length - 1];
}

function getWeatherIcon(code, isDay) {
  if (code == null) return null;
  if ([95, 96, 99].includes(code)) return TbCloudStorm;
  if ([71, 73, 75, 77, 85, 86].includes(code)) return TbCloudSnow;
  if ([51, 53, 55, 61, 63, 65, 66, 67, 80, 81, 82].includes(code))
    return TbCloudRain;
  if ([45, 48, 3, 1, 2].includes(code)) return TbCloud;
  return isDay ? TbSun : TbMoon;
}

/* ═══════════════════════════════════════════════════════════════
   GEOLOCATION HOOK  (browser native)
   ═══════════════════════════════════════════════════════════════ */
function useDeviceLocation() {
  const [loc, setLoc] = useState(null); // { lat, lon }
  const [name, setName] = useState(null); // reverse-geocoded place name
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!navigator.geolocation) {
      setError("Geolocation not supported");
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const { latitude: lat, longitude: lon } = pos.coords;
        setLoc({ lat, lon });

        // Reverse-geocode via Open-Meteo (no key needed)
        fetch(
          `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lon}&format=json`,
        )
          .then((r) => r.json())
          .then((json) => {
            const addr = json.address ?? {};
            const city =
              addr.city ||
              addr.municipality ||
              addr.town ||
              addr.village ||
              addr.county ||
              "";
            const province = addr.state || "";
            setName(
              city && province
                ? `${city}, ${province}`
                : city || province || json.display_name || "",
            );
          })
          .catch(() => setName(null));
      },
      (err) => setError(err.message),
      { enableHighAccuracy: false, timeout: 10000, maximumAge: 600000 },
    );
  }, []);

  return { loc, name, error };
}

/* ═══════════════════════════════════════════════════════════════
   WEATHER FETCH (Open-Meteo)
   ═══════════════════════════════════════════════════════════════ */
function useLocationWeather(loc) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const lastKey = useRef(null);

  useEffect(() => {
    if (!loc) return;
    const key = `${loc.lat}:${loc.lon}`;
    if (key === lastKey.current) return;
    lastKey.current = key;

    setLoading(true);
    const params = new URLSearchParams({
      latitude: String(loc.lat),
      longitude: String(loc.lon),
      current: [
        "temperature_2m",
        "relative_humidity_2m",
        "weather_code",
        "cloud_cover",
        "wind_speed_10m",
        "is_day",
      ].join(","),
      timezone: "auto",
    });
    fetch(`https://api.open-meteo.com/v1/forecast?${params}`)
      .then((r) => r.json())
      .then((json) => {
        const c = json.current ?? {};
        setData({
          weatherCode: c.weather_code ?? null,
          cloudCover: c.cloud_cover ?? 0,
          isDay: c.is_day ?? 1,
          temperature: c.temperature_2m ?? null,
          humidity: c.relative_humidity_2m ?? null,
          windSpeed: c.wind_speed_10m ?? null,
        });
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [loc]);

  return { data, loading };
}

/* ═══════════════════════════════════════════════════════════════
   WEATHER THEME  (day/night aware, all scenarios)
   ═══════════════════════════════════════════════════════════════ */
function getWeatherTheme(code, isDay, cloudCover) {
  const night = !isDay;

  if (code == null) {
    return night
      ? {
          grad: "linear-gradient(180deg,#050810 0%,#0a0f1e 100%)",
          type: "nightClear",
        }
      : {
          grad: "linear-gradient(180deg,#4a9fd4 0%,#82c4e8 100%)",
          type: "clear",
        };
  }

  // Thunder / storm
  if ([95, 96, 99].includes(code)) {
    return night
      ? {
          grad: "linear-gradient(180deg,#060409 0%,#0e0614 55%,#100818 100%)",
          type: "thunderNight",
        }
      : {
          grad: "linear-gradient(180deg,#1a1428 0%,#2a1d3c 50%,#1c1430 100%)",
          type: "thunder",
        };
  }

  // After-storm / post-rain (drizzle codes end)
  if ([51, 53].includes(code)) {
    return night
      ? {
          grad: "linear-gradient(180deg,#0a0e18 0%,#141e2a 100%)",
          type: "rainLightNight",
        }
      : {
          grad: "linear-gradient(180deg,#2d4a6e 0%,#3d6080 55%,#2e4d60 100%)",
          type: "rainLight",
        };
  }

  // Heavy rain / showers
  if ([55, 61, 63, 65, 66, 67, 80, 81, 82].includes(code)) {
    return night
      ? {
          grad: "linear-gradient(180deg,#050810 0%,#090d18 55%,#060a14 100%)",
          type: "rainHeavyNight",
        }
      : {
          grad: "linear-gradient(180deg,#14243a 0%,#1e3350 55%,#162840 100%)",
          type: "rainHeavy",
        };
  }

  // Snow
  if ([71, 73, 75, 77, 85, 86].includes(code)) {
    return night
      ? {
          grad: "linear-gradient(180deg,#0e1220 0%,#1a2038 100%)",
          type: "snowNight",
        }
      : {
          grad: "linear-gradient(180deg,#c8dff2 0%,#ddeefa 55%,#e8f4fc 100%)",
          type: "snow",
        };
  }

  // Fog
  if ([45, 48].includes(code)) {
    return night
      ? {
          grad: "linear-gradient(180deg,#0c1018 0%,#141a24 100%)",
          type: "fogNight",
        }
      : {
          grad: "linear-gradient(180deg,#b8c8d8 0%,#ccd9e4 55%,#d4e0ea 100%)",
          type: "fog",
        };
  }

  // Overcast
  if (code === 3) {
    return night
      ? {
          grad: "linear-gradient(180deg,#080c14 0%,#0e1422 100%)",
          type: "overcastNight",
        }
      : {
          grad: "linear-gradient(180deg,#6e8ca8 0%,#8aa4bc 55%,#9ab4c8 100%)",
          type: "overcast",
        };
  }

  // Partly cloudy
  if ([1, 2].includes(code) || cloudCover > 30) {
    return night
      ? {
          grad: "linear-gradient(180deg,#060c1a 0%,#0e1830 55%,#101c36 100%)",
          type: "partlyCloudyNight",
        }
      : {
          grad: "linear-gradient(180deg,#3a8ec8 0%,#5aaee0 45%,#70bee8 100%)",
          type: "partlyCloudy",
        };
  }

  // Clear sky
  if (code === 0) {
    return night
      ? {
          grad: "linear-gradient(180deg,#020510 0%,#040a1e 55%,#060e28 100%)",
          type: "nightClear",
        }
      : {
          grad: "linear-gradient(180deg,#1a7bc4 0%,#4aa8e4 40%,#74c0ef 100%)",
          type: "clear",
        };
  }

  return night
    ? {
        grad: "linear-gradient(180deg,#060c1a 0%,#0e1830 100%)",
        type: "nightClear",
      }
    : {
        grad: "linear-gradient(180deg,#3a8ec8 0%,#5aaee0 100%)",
        type: "clear",
      };
}

/* ═══════════════════════════════════════════════════════════════
   CLOUD DEFINITIONS
   ═══════════════════════════════════════════════════════════════ */
const CLOUD_DEFS = [
  {
    top: "3%",
    left: "-8%",
    w: 560,
    h: 200,
    op: 0.82,
    dur: "22s",
    delay: "0s",
    alt: false,
  },
  {
    top: "14%",
    left: "42%",
    w: 420,
    h: 155,
    op: 0.65,
    dur: "30s",
    delay: "-11s",
    alt: true,
  },
  {
    top: "30%",
    left: "-5%",
    w: 340,
    h: 125,
    op: 0.55,
    dur: "36s",
    delay: "-5s",
    alt: false,
  },
  {
    top: "48%",
    left: "50%",
    w: 460,
    h: 170,
    op: 0.72,
    dur: "26s",
    delay: "-19s",
    alt: true,
  },
  {
    top: "63%",
    left: "3%",
    w: 380,
    h: 140,
    op: 0.58,
    dur: "32s",
    delay: "-4s",
    alt: false,
  },
  {
    top: "78%",
    left: "44%",
    w: 320,
    h: 120,
    op: 0.48,
    dur: "22s",
    delay: "-15s",
    alt: true,
  },
  {
    top: "88%",
    left: "10%",
    w: 500,
    h: 185,
    op: 0.68,
    dur: "28s",
    delay: "-8s",
    alt: false,
  },
];

/* Stars for night scenes */
const STAR_DEFS = Array.from({ length: 60 }, (_, i) => ({
  id: i,
  left: `${(i * 1.618 * 17) % 100}%`,
  top: `${(i * 1.618 * 13) % 70}%`,
  size: 1 + (i % 3),
  dur: `${2 + (i % 4)}s`,
  delay: `${-(i * 0.35) % 4}s`,
  opacity: 0.4 + (i % 4) * 0.15,
}));

const SNOW_PARTICLES = Array.from({ length: 32 }, (_, i) => ({
  id: i,
  left: `${(i * 3.7) % 100}%`,
  size: 2 + (i % 4),
  dur: `${9 + (i % 8)}s`,
  delay: `${-(i * 0.65)}s`,
  opacity: 0.5 + (i % 3) * 0.15,
}));

/* Rainbow (after storm / post rain light) */
function RainbowLayer({ show }) {
  if (!show) return null;
  return (
    <div
      className="nlex-rainbow"
      style={{
        position: "absolute",
        bottom: "10%",
        left: "50%",
        transform: "translateX(-50%)",
        width: "140%",
        height: 340,
        pointerEvents: "none",
        background:
          "radial-gradient(ellipse at 50% 110%, " +
          "rgba(255,0,0,0.06) 0%, rgba(255,0,0,0.06) 15%, " +
          "rgba(255,165,0,0.07) 19%, " +
          "rgba(255,255,0,0.07) 23%, " +
          "rgba(0,200,80,0.07) 27%, " +
          "rgba(0,100,255,0.07) 31%, " +
          "rgba(130,0,255,0.06) 35%, " +
          "transparent 39%)",
        opacity: 0.85,
      }}
    />
  );
}

/* ═══════════════════════════════════════════════════════════════
   WEATHER LAYER COMPONENTS
   ═══════════════════════════════════════════════════════════════ */
function CloudLayer({ show, cloudCover, night, sunnyClear = false }) {
  if (!show) return null;
  const coverage = sunnyClear
    ? Math.max(cloudCover ?? 0, 42)
    : (cloudCover ?? 65);
  const mult = Math.min(1.2, coverage / 75);
  const tint = night
    ? "rgba(40,55,90,0.28)"
    : sunnyClear
      ? "rgba(255,255,255,0.34)"
      : "rgba(200,225,255,0.22)";
  return (
    <div className={`nlex-clouds-layer${sunnyClear ? " sunny-clear" : ""}`}>
      {CLOUD_DEFS.map((c, i) => (
        <div
          key={i}
          className={`nlex-cloud-shape${c.alt ? " alt" : ""}${
            sunnyClear ? " sunny-clear" : ""
          }`}
          style={{
            top: c.top,
            left: c.left,
            width: c.w,
            height: c.h,
            opacity: Math.min(1, c.op * mult),
            animationDuration: c.dur,
            animationDelay: c.delay,
            background: `radial-gradient(ellipse at 38% 42%, ${tint} 0%, transparent 70%)`,
          }}
        />
      ))}
    </div>
  );
}

function StarLayer({ show }) {
  if (!show) return null;
  return (
    <div className="nlex-stars-layer">
      {STAR_DEFS.map((s) => (
        <div
          key={s.id}
          className="nlex-star"
          style={{
            left: s.left,
            top: s.top,
            width: s.size,
            height: s.size,
            animationDuration: s.dur,
            animationDelay: s.delay,
            opacity: s.opacity,
          }}
        />
      ))}
    </div>
  );
}

function RainLayer({ show, heavy }) {
  if (!show) return null;
  return (
    <div className="nlex-rain-layer">
      <div className={`nlex-rain-canvas${heavy ? " heavy" : ""}`} />
    </div>
  );
}

function SnowLayer({ show }) {
  if (!show) return null;
  return (
    <div className="nlex-snow-layer">
      {SNOW_PARTICLES.map((p) => (
        <div
          key={p.id}
          className="nlex-snow-particle"
          style={{
            left: p.left,
            width: p.size,
            height: p.size,
            animationDuration: p.dur,
            animationDelay: p.delay,
            opacity: p.opacity,
          }}
        />
      ))}
    </div>
  );
}

function FogLayer({ show }) {
  if (!show) return null;
  return (
    <div className="nlex-fog-layer">
      <div
        className="nlex-fog-shape"
        style={{
          width: 860,
          height: 240,
          top: "18%",
          left: "-8%",
          animationDelay: "0s",
          animationDuration: "14s",
        }}
      />
      <div
        className="nlex-fog-shape"
        style={{
          width: 740,
          height: 200,
          top: "48%",
          left: "12%",
          animationDelay: "-7s",
          animationDuration: "19s",
        }}
      />
      <div
        className="nlex-fog-shape"
        style={{
          width: 660,
          height: 180,
          top: "73%",
          left: "-4%",
          animationDelay: "-3s",
          animationDuration: "23s",
        }}
      />
    </div>
  );
}

function LightningLayer({ show }) {
  if (!show) return null;
  return <div className="nlex-lightning" />;
}

/* Sun glow for clear day */
function SunLayer({ show, emphasized = false }) {
  if (!show) return null;
  return (
    <div
      className={`nlex-sun${emphasized ? " emphasized" : ""}`}
      style={{
        position: "absolute",
        top: emphasized ? "4%" : "6%",
        right: emphasized ? "9%" : "12%",
        width: emphasized ? 190 : 120,
        height: emphasized ? 190 : 120,
        borderRadius: "50%",
        background:
          emphasized
            ? "radial-gradient(circle, rgba(255,246,160,0.96) 0%, rgba(255,218,75,0.64) 32%, rgba(255,178,35,0.22) 62%, transparent 78%)"
            : "radial-gradient(circle, rgba(255,230,100,0.55) 0%, rgba(255,200,50,0.18) 50%, transparent 70%)",
        boxShadow: emphasized
          ? "0 0 120px 52px rgba(255,222,72,0.34), 0 0 240px 96px rgba(255,187,64,0.16)"
          : "0 0 80px 30px rgba(255,220,60,0.18)",
        animation: emphasized
          ? "nlex-sun-pulse-strong 7s ease-in-out infinite alternate"
          : "nlex-sun-pulse 8s ease-in-out infinite alternate",
        pointerEvents: "none",
      }}
    />
  );
}

/* Moon for night */
function MoonLayer({ show }) {
  if (!show) return null;
  return (
    <div
      className="nlex-moon"
      style={{
        position: "absolute",
        top: "5%",
        right: "10%",
        width: 70,
        height: 70,
        borderRadius: "50%",
        background:
          "radial-gradient(circle at 38% 38%, rgba(220,230,255,0.55) 0%, rgba(180,200,240,0.2) 60%, transparent 80%)",
        boxShadow: "0 0 40px 12px rgba(180,200,255,0.12)",
        pointerEvents: "none",
      }}
    />
  );
}

/* ═══════════════════════════════════════════════════════════════
   CITY / MOUNTAIN SILHOUETTE BACKGROUND
   ═══════════════════════════════════════════════════════════════ */
function CityScapeLayer({ isNight }) {
  const farMtnFill = isNight ? "rgba(16,26,62,0.55)" : "rgba(90,118,175,0.16)";
  const midHillFill = isNight ? "rgba(12,20,52,0.68)" : "rgba(60,92,148,0.22)";
  const farBldgFill = isNight ? "rgba(10,17,46,0.76)" : "rgba(42,65,112,0.20)";
  const nearBldgFill = isNight ? "rgba(7,13,38,0.92)" : "rgba(28,48,88,0.36)";
  const antennaClr = isNight
    ? "rgba(140,160,220,0.55)"
    : "rgba(60,90,150,0.30)";
  const litWin = "rgba(255,218,95,0.78)";
  const dimWin = "rgba(160,195,255,0.20)";

  // Near buildings: [x, width, height_from_bottom]  total width = 960
  const nearBldgs = [
    [0, 58, 178],
    [58, 40, 144],
    [98, 70, 218],
    [168, 46, 164],
    [214, 54, 194],
    [268, 36, 148],
    [304, 49, 248],
    [353, 50, 168],
    [403, 40, 134],
    [443, 65, 198],
    [508, 55, 174],
    [563, 45, 243],
    [608, 50, 158],
    [658, 60, 184],
    [718, 40, 144],
    [758, 55, 208],
    [813, 45, 174],
    [858, 50, 152],
    [908, 52, 188],
  ];

  const buildingWindows = (bx, bw, bh) => {
    const wW = 4,
      wH = 3,
      hGap = 8,
      vGap = 9,
      margin = 6;
    const cols = Math.max(1, Math.floor((bw - 2 * margin) / (wW + hGap)));
    const rows = Math.min(14, Math.floor((bh - 22) / (wH + vGap)));
    const wins = [];
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const lit = (r * 5 + c * 3 + bx) % 7 !== 0;
        wins.push(
          <rect
            key={`w${bx}-${r}-${c}`}
            x={bx + margin + c * (wW + hGap)}
            y={500 - bh + 14 + r * (wH + vGap)}
            width={wW}
            height={wH}
            fill={lit ? litWin : dimWin}
            rx={0.5}
          />,
        );
      }
    }
    return wins;
  };

  return (
    <div className="nlex-cityscape-wrap" aria-hidden="true">
      <svg
        width="100%"
        height="100%"
        viewBox="0 0 960 500"
        preserveAspectRatio="xMidYMax slice"
      >
        {/* Far mountain range */}
        <path
          className="nlex-cityscape-mtn-far"
          d="M0,500 L0,318 C55,238 110,285 170,248 C230,211 285,145 350,182 C415,219 465,152 530,125 C595,98 640,145 700,118 C760,91 815,128 875,105 C920,88 945,100 960,108 L960,500 Z"
          fill={farMtnFill}
        />
        {/* Mid rolling hills */}
        <path
          className="nlex-cityscape-hill"
          d="M0,500 L0,400 C70,348 150,378 230,355 C310,332 390,368 470,342 C550,316 630,348 710,322 C790,296 870,328 960,310 L960,500 Z"
          fill={midHillFill}
        />
        {/* Far buildings silhouette */}
        <path
          d="M0,500 V382 H48 V362 H88 V378 H130 V348 H172 V372 H210 V354 H250 V370 H292 V344 H332 V362 H372 V348 H412 V374 H452 V346 H492 V369 H532 V352 H574 V365 H616 V344 H658 V376 H697 V356 H740 V370 H782 V347 H824 V374 H862 V360 H904 V376 H940 V386 H960 V500 Z"
          fill={farBldgFill}
        />
        {/* Near foreground buildings */}
        <path
          d="M0,500 V322 H58 V356 H98 V282 H168 V336 H214 V306 H268 V352 H304 V252 H353 V332 H403 V366 H443 V302 H508 V326 H563 V257 H608 V342 H658 V316 H718 V356 H758 V292 H813 V326 H858 V348 H908 V312 H960 V500 Z"
          fill={nearBldgFill}
        />
        {/* Tower antennas */}
        <line
          x1={328}
          y1={252}
          x2={328}
          y2={220}
          stroke={antennaClr}
          strokeWidth={1.5}
        />
        <line
          x1={322}
          y1={232}
          x2={328}
          y2={220}
          stroke={antennaClr}
          strokeWidth={1}
        />
        <line
          x1={334}
          y1={232}
          x2={328}
          y2={220}
          stroke={antennaClr}
          strokeWidth={1}
        />
        <line
          x1={585}
          y1={257}
          x2={585}
          y2={226}
          stroke={antennaClr}
          strokeWidth={1.5}
        />
        {/* Night: lit windows */}
        {isNight &&
          nearBldgs.flatMap(([bx, bw, bh]) => buildingWindows(bx, bw, bh))}
        {/* Night: blinking antenna warning lights */}
        {isNight && (
          <>
            <circle
              cx={328}
              cy={219}
              r={2.5}
              fill="rgba(255,65,65,0.92)"
              className="nlex-antenna-blink"
            />
            <circle
              cx={585}
              cy={225}
              r={2.5}
              fill="rgba(255,65,65,0.92)"
              className="nlex-antenna-blink"
              style={{ animationDelay: "0.9s" }}
            />
          </>
        )}
      </svg>
    </div>
  );
}

function WeatherBackground({ weatherData }) {
  const code = weatherData?.weatherCode ?? null;
  const cloudCover = weatherData?.cloudCover ?? 0;
  const isDay = weatherData?.isDay ?? 1;
  const wt = getWeatherTheme(code, isDay, cloudCover);
  const night = !isDay;

  const type = wt.type;
  const showStars =
    night &&
    ["nightClear", "partlyCloudyNight", "fogNight", "overcastNight"].includes(
      type,
    );
  const showMoon =
    night && !["thunderNight", "rainHeavyNight", "snowNight"].includes(type);
  const showSun = !night && ["clear", "partlyCloudy"].includes(type);
  const sunnyClear = !night && type === "clear";
  const showClouds =
    sunnyClear ||
    [
      "partlyCloudy",
      "partlyCloudyNight",
      "overcast",
      "overcastNight",
      "rain",
      "rainLight",
      "rainLightNight",
      "rainHeavy",
      "rainHeavyNight",
      "thunder",
      "thunderNight",
      "fog",
      "fogNight",
      "snow",
      "snowNight",
    ].includes(type) || cloudCover > 25;
  const showRain = type.startsWith("rain") || type.startsWith("thunder");
  const showRainHeavy = [
    "rainHeavy",
    "rainHeavyNight",
    "thunder",
    "thunderNight",
  ].includes(type);
  const showSnow = type.startsWith("snow");
  const showFog = type.startsWith("fog");
  const showLightning = type.startsWith("thunder");
  const showRainbow = ["rainLight", "rainLightNight"].includes(type);

  return (
    <div className="nlex-weather-bg" style={{ background: wt.grad }}>
      <CityScapeLayer isNight={night} />
      <StarLayer show={showStars} />
      <MoonLayer show={showMoon} />
      <SunLayer show={showSun} emphasized={sunnyClear} />
      <CloudLayer
        show={showClouds}
        cloudCover={cloudCover}
        night={night}
        sunnyClear={sunnyClear}
      />
      <RainLayer show={showRain} heavy={showRainHeavy} />
      <SnowLayer show={showSnow} />
      <FogLayer show={showFog} />
      <LightningLayer show={showLightning} />
      <RainbowLayer show={showRainbow} />
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════
   ANIMATED AQI VALUE HOOK
   Smoothly interpolates from previous AQI to new value over ~1 second.
   ═══════════════════════════════════════════════════════════════ */
function useAnimatedAqi(targetAqi, duration = 1000) {
  const [val, setVal] = useState(targetAqi);
  const rafRef = useRef(null);
  const prevRef = useRef(targetAqi);
  useEffect(() => {
    if (targetAqi == null) {
      setVal(null);
      prevRef.current = null;
      return;
    }
    const from = prevRef.current ?? targetAqi;
    const to = targetAqi;
    if (from === to) return;
    const t0 = performance.now();
    function step(now) {
      const t = Math.min(1, (now - t0) / duration);
      const eased = 1 - (1 - t) ** 3; // cubic ease-out
      setVal(from + (to - from) * eased);
      if (t < 1) {
        rafRef.current = requestAnimationFrame(step);
      } else {
        prevRef.current = to;
      }
    }
    rafRef.current = requestAnimationFrame(step);
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [targetAqi, duration]);
  return val;
}

/* Animated counter display — smoothly counts to new AQI value */
function AnimatedNumber({ value }) {
  const anim = useAnimatedAqi(value);
  if (value == null) return "—";
  return <>{Math.round(anim ?? value)}</>;
}

/* ═══════════════════════════════════════════════════════════════
   CUSTOM SVG ARC GAUGE
   A full semi-D gauge with:
     • multi-band colored arc (gradient per sector)
     • needle indicator
     • AQI value centered
     • tick marks at band boundaries
   ═══════════════════════════════════════════════════════════════ */
const GAUGE_GAP = 75; // degrees of gap at the bottom
const GAUGE_ARC = 360 - GAUGE_GAP; // 285°

function polarToXY(cx, cy, r, angleDeg) {
  const rad = ((angleDeg - 90) * Math.PI) / 180;
  return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) };
}

function arcPath(cx, cy, r, startDeg, endDeg) {
  const s = polarToXY(cx, cy, r, startDeg);
  const e = polarToXY(cx, cy, r, endDeg);
  const large = endDeg - startDeg > 180 ? 1 : 0;
  return `M ${s.x} ${s.y} A ${r} ${r} 0 ${large} 1 ${e.x} ${e.y}`;
}

/* band sectors – each gets a colored arc segment */
function GaugeBandArcs({ cx, cy, r, sw, isNight }) {
  const startBase = -(GAUGE_ARC / 2); // −142.5° from top (i.e. 360−142.5 = 217.5° in standard)
  const trackOpacity = isNight ? 0.42 : 0.28;

  return (
    <>
      {BANDS.map((b) => {
        const fromFrac = b.min / AQI_MAX;
        const toFrac = Math.min(b.max, AQI_MAX) / AQI_MAX;
        const from = startBase + fromFrac * GAUGE_ARC;
        const to = startBase + toFrac * GAUGE_ARC;
        return (
          <path
            key={b.id}
            d={arcPath(cx, cy, r, from, to)}
            fill="none"
            stroke={b.color}
            strokeWidth={sw}
            strokeLinecap="butt"
            opacity={trackOpacity}
          />
        );
      })}
    </>
  );
}

/* Active filled arc up to current value */
function GaugeActiveArc({ cx, cy, r, sw, pct, color }) {
  const startBase = -(GAUGE_ARC / 2);
  const endDeg = startBase + pct * GAUGE_ARC;
  if (pct <= 0) return null;
  return (
    <path
      d={arcPath(cx, cy, r, startBase, endDeg)}
      fill="none"
      stroke={color}
      strokeWidth={sw}
      strokeLinecap="round"
      opacity={0.95}
    />
  );
}

/* Tick marks at band boundary values */
function GaugeTicks({ cx, cy, r, sw, isCarousel }) {
  const startBase = -(GAUGE_ARC / 2);
  const tickVals = [0, 50, 100, 150, 200, 300, 500];
  const lblR = r + sw / 2 + (isCarousel ? 22 : 18);

  return (
    <>
      {tickVals.map((v) => {
        const frac = v / AQI_MAX;
        const deg = startBase + frac * GAUGE_ARC;
        const lp = polarToXY(cx, cy, lblR, deg);
        const band = getBand(v === 500 ? 499 : v);
        const fs = isCarousel ? (r > 150 ? 19 : 14) : (r > 100 ? 12 : 9);
        return (
          <text
            key={v}
            x={lp.x}
            y={lp.y}
            textAnchor="middle"
            dominantBaseline="central"
            fill={band.color}
            fontSize={fs}
            fontWeight="700"
            fontFamily="'Poppins',sans-serif"
            opacity={0.92}
          >
            {v}
          </text>
        );
      })}
    </>
  );
}

/* Needle */
function GaugeNeedle({ cx, cy, r, pct, isNight }) {
  const startBase = -(GAUGE_ARC / 2);
  const deg = startBase + pct * GAUGE_ARC;
  const tip = polarToXY(cx, cy, r - 14, deg);
  const base1 = polarToXY(cx, cy, 7, deg + 90);
  const base2 = polarToXY(cx, cy, 7, deg - 90);
  const needleFill = isNight ? "rgba(220,232,255,0.90)" : "rgba(30,40,80,0.85)";
  const hubFill = isNight ? "rgba(200,220,255,0.95)" : "rgba(30,40,80,0.90)";
  const dotFill = isNight ? "rgba(30,40,80,0.80)" : "rgba(255,255,255,0.60)";
  return (
    <g>
      <polygon
        points={`${tip.x},${tip.y} ${base1.x},${base1.y} ${base2.x},${base2.y}`}
        fill={needleFill}
      />
      <circle cx={cx} cy={cy} r={7} fill={hubFill} />
      <circle cx={cx} cy={cy} r={3.5} fill={dotFill} />
    </g>
  );
}

/* ── Gauge loading: sweeping arc animation ─────────────────── */
function GaugeLoadingArc({ cx, cy, r, sw }) {
  const startBase = -(GAUGE_ARC / 2);
  const totalArc = (GAUGE_ARC / 360) * 2 * Math.PI * r;
  const dashLen = totalArc * 0.3;
  return (
    <path
      d={arcPath(cx, cy, r, startBase, startBase + GAUGE_ARC)}
      fill="none"
      stroke="rgba(148,163,184,0.60)"
      strokeWidth={sw}
      strokeLinecap="round"
      strokeDasharray={`${dashLen.toFixed(1)} ${totalArc.toFixed(1)}`}
      className="nlex-gauge-loading-arc"
      style={{ "--arc-total": `-${(totalArc + dashLen).toFixed(1)}` }}
    />
  );
}

function SvgGauge({ aqi, loading, size, isNight, showEmoji = false, showAqiInside = false, hideNeedle = false, swOverride, isCarousel = false }) {
  const animAqi = useAnimatedAqi(aqi);
  const sw = swOverride ?? (size >= 260 ? 13 : 10);
  const cx = size / 2;
  const cy = size / 2;
  const r = size / 2 - sw / 2 - 28;

  const band = animAqi != null ? getBand(animAqi) : BANDS[0];
  const pct =
    animAqi != null ? Math.min(1, Math.max(0, Number(animAqi) / AQI_MAX)) : 0;
  const emojiFontSize = size >= 260 ? 76 : 54;
  const aqiInsideFontSize = isCarousel ? Math.round(r * 0.78) : Math.round(r * 0.60);

  return (
    <svg width={size} height={size} style={{ overflow: "visible" }}>
      <GaugeBandArcs cx={cx} cy={cy} r={r} sw={sw} isNight={isNight} />
      {loading ? (
        <GaugeLoadingArc cx={cx} cy={cy} r={r} sw={sw} />
      ) : (
        <GaugeActiveArc
          cx={cx}
          cy={cy}
          r={r}
          sw={sw}
          pct={pct}
          color={band.color}
        />
      )}
      <GaugeTicks cx={cx} cy={cy} r={r} sw={sw} isCarousel={isCarousel} />
      {showEmoji && !loading && (
        <text
          x={cx}
          y={cy}
          textAnchor="middle"
          dominantBaseline="central"
          fontSize={emojiFontSize}
          className="nlex-gauge-emoji"
          style={{ transformOrigin: `${cx}px ${cy}px` }}
        >
          {band.emoji}
        </text>
      )}
      {showAqiInside && !loading && (
        <>
          <text
            x={cx}
            y={cy - aqiInsideFontSize * 0.18}
            textAnchor="middle"
            dominantBaseline="central"
            fontSize={aqiInsideFontSize}
            fontFamily="'Poppins',sans-serif"
            fontWeight="800"
            fill={band.color}
            className="nlex-gauge-aqi-inside"
          >
            {animAqi != null ? Math.round(animAqi) : "—"}
          </text>
          <text
            x={cx}
            y={cy + aqiInsideFontSize * 0.52}
            textAnchor="middle"
            dominantBaseline="central"
            fontSize={Math.round(aqiInsideFontSize * 0.28)}
            fontFamily="'Poppins',sans-serif"
            fontWeight="700"
            fill={band.color}
            opacity={0.70}
            letterSpacing="3"
          >
            AQI
          </text>
        </>
      )}
      {!hideNeedle && !loading && (
        <GaugeNeedle cx={cx} cy={cy} r={r} pct={pct} isNight={isNight} />
      )}
    </svg>
  );
}

/* ═══════════════════════════════════════════════════════════════
   CAROUSEL AQI SCALE REFERENCE
   Compact 6-band color bar shown at the bottom of each carousel tile.
   ═══════════════════════════════════════════════════════════════ */
function CarouselAqiScale({ isNight }) {
  return (
    <div className="nlex-carousel-aqi-scale">
      <div className="nlex-carousel-aqi-scale-title" style={{ color: isNight ? "rgba(200,220,255,0.65)" : "rgba(30,50,100,0.55)" }}>
        AQI Scale Reference
      </div>
      <div className="nlex-carousel-aqi-scale-bands">
        {BANDS.map((b) => (
          <div key={b.id} className="nlex-carousel-aqi-scale-band" style={{ background: b.color }}>
            <span className="nlex-carousel-aqi-scale-short">{b.short}</span>
            <span className="nlex-carousel-aqi-scale-range">
              {b.min}&ndash;{b.max >= AQI_MAX ? "500+" : b.max}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════
   DATA HELPERS
   ═══════════════════════════════════════════════════════════════ */
function extractAqi(latest) {
  if (!latest) return null;
  const v = Number(latest["AQI"] ?? latest["aqi"]);
  return isFinite(v) && v > 0 ? v : null;
}

function extractTimestamp(latest, dateCol, fetchedAt) {
  if (latest && dateCol && latest[dateCol]) {
    const d = new Date(latest[dateCol]);
    if (!isNaN(d.getTime())) return d;
  }
  if (fetchedAt) {
    const d = new Date(fetchedAt);
    if (!isNaN(d.getTime())) return d;
  }
  return null;
}

function fmtDateTime(d) {
  if (!d) return null;
  const mo = [
    "Jan",
    "Feb",
    "Mar",
    "Apr",
    "May",
    "Jun",
    "Jul",
    "Aug",
    "Sep",
    "Oct",
    "Nov",
    "Dec",
  ][d.getMonth()];
  let h = d.getHours();
  const ampm = h >= 12 ? "PM" : "AM";
  h = h % 12 || 12;
  const m = String(d.getMinutes()).padStart(2, "0");
  return `${mo} ${d.getDate()}, ${d.getFullYear()} · ${h}:${m} ${ampm}`;
}

function fmtClock(d) {
  let h = d.getHours();
  const ampm = h >= 12 ? "PM" : "AM";
  h = h % 12 || 12;
  const m = String(d.getMinutes()).padStart(2, "0");
  const s = String(d.getSeconds()).padStart(2, "0");
  return `${h}:${m}:${s} ${ampm}`;
}

function fmtDate(d) {
  const MONTHS = [
    "January",
    "February",
    "March",
    "April",
    "May",
    "June",
    "July",
    "August",
    "September",
    "October",
    "November",
    "December",
  ];
  const day = String(d.getDate()).padStart(2, "0");
  return `${MONTHS[d.getMonth()]} ${day}, ${d.getFullYear()}`;
}

function fmtTime(d) {
  let h = d.getHours();
  const ampm = h >= 12 ? "PM" : "AM";
  h = h % 12 || 12;
  const m = String(d.getMinutes()).padStart(2, "0");
  return `${h}:${m} ${ampm}`;
}

/* ═══════════════════════════════════════════════════════════════
   STATION TILE
   ═══════════════════════════════════════════════════════════════ */
/* Station definitions — order determines spotlight index */
const STATION_DEFS = [
  {
    key: "clark",
    label: "Clark Air Quality Index",
    address: "Clark Freeport Zone, Pampanga",
  },
  {
    key: "san-fernando",
    label: "San Fernando Air Quality Index",
    address: "San Fernando, Pampanga",
  },
  {
    key: "meycauayan",
    label: "Meycauayan Air Quality Index",
    address: "Meycauayan, Bulacan",
  },
  { key: "zambales", label: "Zambales Air Quality Index", address: "Santa Cruz, Zambales" },
];

function StationTile({
  label,
  address,
  pollutants,
  isNight,
  spotlit,
  dimmed,
  solo,
  gridStyle,
  hideGauge,
  isCarousel,
}) {
  const firstWithData = pollutants.find((p) => p.aqi != null);
  const dominantBand = firstWithData ? getBand(firstWithData.aqi) : null;
  const isDual = pollutants.length > 1;

  const pollutantDates = pollutants.map((p) =>
    extractTimestamp(p.latest, p.dateCol, p.fetchedAt),
  );
  const dates = pollutantDates.filter(Boolean);
  const asOfDate = dates.length
    ? new Date(Math.max(...dates.map((d) => d.getTime())))
    : null;

  // Dual tiles keep 200; solo (or dual with one pollutant hidden) gets a larger gauge
  const gaugeSize = isDual ? 200 : 320;

  const tileClass = [
    "nlex-tile",
    isCarousel ? "nlex-tile-carousel" : "",
    isCarousel && isDual ? "nlex-carousel-tile-dual" : "",
    isCarousel && !isDual ? "nlex-carousel-tile-solo" : "",
    isNight ? "nlex-tile-night" : "nlex-tile-day",
    spotlit ? "nlex-tile-spotlit" : "",
    dimmed ? "nlex-tile-dimmed" : "",
  ]
    .filter(Boolean)
    .join(" ");

  const headerBase = isNight ? "rgba(8,14,40,0.92)" : "rgba(255,255,255,0.97)";

  const tileBg = dominantBand
    ? isNight
      ? `linear-gradient(150deg, rgba(5,9,24,0.90) 0%, ${dominantBand.color}28 55%, ${dominantBand.color}45 100%)`
      : `linear-gradient(150deg, rgba(255,255,255,0.90) 0%, ${dominantBand.color}15 55%, ${dominantBand.color}2e 100%)`
    : undefined;
  const tileBorder = dominantBand
    ? `1.5px solid ${dominantBand.color}50`
    : undefined;

  /* ── Carousel + gauge visible: fully redesigned layout ──────── */
  if (isCarousel && !hideGauge) {
    return (
      <div
        className={tileClass}
        style={{
          ...(!spotlit && tileBg ? { background: tileBg } : {}),
          ...(tileBorder ? { border: tileBorder } : {}),
        }}
      >
        {/* Header: location icon + large station name + address */}
        <div className="nlex-tile-header nlex-carousel-header">
          {dominantBand && (
            <div
              className="nlex-tile-header-grad"
              style={{
                background: isNight
                  ? `linear-gradient(120deg, ${headerBase} 0%, ${dominantBand.color}28 45%, ${dominantBand.color}42 100%)`
                  : `linear-gradient(120deg, ${headerBase} 0%, ${dominantBand.color}20 45%, ${dominantBand.color}38 100%)`,
                backgroundSize: "200% 200%",
              }}
            />
          )}
          <div style={{ position: "relative", zIndex: 1 }}>
            <div className="nlex-carousel-station-name">
              <TbMapPin className="nlex-carousel-location-icon" />
              <span>{label}</span>
            </div>
            <div className="nlex-carousel-station-address">{address}</div>
          </div>
        </div>

        {/* Param columns — PM10 | PM2.5, each with gauge */}
        <div className="nlex-dual-params nlex-carousel-dual-params">
          {pollutants.map((p, pIdx) => {
            const band = p.aqi != null ? getBand(p.aqi) : null;
            const colClass = `nlex-carousel-param-col ${isDual ? "nlex-carousel-param-col--dual" : "nlex-carousel-param-col--solo"}`;
            const pDate = pollutantDates[pIdx];
            return (
              <div key={p.key} className={colClass}>
                {/* PM10 / PM2.5 label */}
                <div className="nlex-carousel-pollutant-label">{p.label}</div>

                {isDual ? (
                  /* Meycauayan/Zambales: two gauges, sized to fit dual columns */
                  <SvgGauge
                    aqi={p.aqi}
                    loading={p.loading}
                    size={330}
                    swOverride={20}
                    isNight={isNight}
                    showAqiInside={true}
                    hideNeedle={true}
                    isCarousel={true}
                  />
                ) : (
                  /* Clark/San Fernando: single gauge, enlarged for the full tile */
                  <SvgGauge
                    aqi={p.aqi}
                    loading={p.loading}
                    size={560}
                    swOverride={38}
                    isNight={isNight}
                    showAqiInside={true}
                    hideNeedle={true}
                    isCarousel={true}
                  />
                )}

                {/* Status badge — inverted: solid band color bg, white text */}
                <div
                  className="nlex-category-badge nlex-carousel-status-badge"
                  style={
                    band
                      ? {
                          background: band.color,
                          borderColor: band.color,
                          color: "#fff",
                        }
                      : {}
                  }
                >
                  <span
                    className="nlex-category-dot"
                    style={{ background: band ? "rgba(255,255,255,0.75)" : "#d1d5db" }}
                  />
                  {p.loading ? "Loading\u2026" : band ? `${band.emoji} ${band.short}` : "No Data"}
                </div>

                {/* Per-pollutant as-of date */}
                <div className="nlex-carousel-param-asof">
                  {pDate ? `As of ${fmtDateTime(pDate)}` : "Awaiting data\u2026"}
                </div>
              </div>
            );
          })}
        </div>

        {/* AQI status description — inverted background */}
        {(() => {
          const loaded = pollutants.filter((p) => p.aqi != null);
          if (!loaded.length) return null;
          const bands = loaded.map((p) => getBand(p.aqi));
          const allSame =
            bands.length > 1 && bands.every((b) => b.id === bands[0].id);
          if (allSame) {
            return (
              <div
                className="nlex-spotlight-desc nlex-carousel-desc-inverted"
                style={{ background: bands[0].color, borderColor: bands[0].color, color: "#fff" }}
              >
                {bands[0].desc}
              </div>
            );
          }
          return (
            <div className="nlex-spotlight-desc-multi">
              {loaded.map((p, i) => (
                <div
                  key={p.key}
                  className="nlex-spotlight-desc nlex-spotlight-desc-sm nlex-carousel-desc-inverted"
                  style={{ background: bands[i].color, borderColor: bands[i].color, color: "#fff" }}
                >
                  <span className="nlex-spotlight-desc-label">{p.label}:</span>{" "}
                  {bands[i].desc}
                </div>
              ))}
            </div>
          );
        })()}

        {/* AQI Scale Reference */}
        <CarouselAqiScale isNight={isNight} />

      </div>
    );
  }

  return (
    <div
      className={tileClass}
      style={{
        ...(!spotlit && tileBg ? { background: tileBg } : {}),
        ...(tileBorder ? { border: tileBorder } : {}),
        ...(gridStyle ?? {}),
      }}
    >
      {/* ── Station name header ── */}
      <div className="nlex-tile-header">
        {dominantBand && (
          <div
            className="nlex-tile-header-grad"
            style={{
              background: isNight
                ? `linear-gradient(120deg, ${headerBase} 0%, ${dominantBand.color}28 45%, ${dominantBand.color}42 100%)`
                : `linear-gradient(120deg, ${headerBase} 0%, ${dominantBand.color}20 45%, ${dominantBand.color}38 100%)`,
              backgroundSize: "200% 200%",
            }}
          />
        )}
        <div style={{ position: "relative", zIndex: 1 }}>
          <div className="nlex-station-name">{label}</div>
          <div className="nlex-station-address">{address}</div>
        </div>
      </div>

      {isDual ? (
        /* ── DUAL layout: each parameter is a self-contained centered column ── */
        <>
          <div className="nlex-dual-params">
            {pollutants.map((p, pIdx) => {
              const band = p.aqi != null ? getBand(p.aqi) : null;
              return (
                <div
                  key={p.key}
                  className={`nlex-param-col${hideGauge ? " no-gauge" : ""}`}
                >
                  <div className="nlex-pollutant-label">{p.label}</div>
                  {!hideGauge && (
                    <SvgGauge
                      aqi={p.aqi}
                      loading={p.loading}
                      size={gaugeSize}
                      isNight={isNight}
                      showAqiInside={true}
                      hideNeedle={true}
                    />
                  )}
                  {hideGauge && (
                    <div className="nlex-aqi-value-block no-gauge">
                      <span
                        className="nlex-aqi-label no-gauge"
                        style={{ color: band ? band.color : "#9ca3af" }}
                      >
                        AQI
                      </span>
                      <div
                        className="nlex-aqi-number no-gauge"
                        style={{ color: band ? band.color : "#9ca3af" }}
                      >
                        {p.loading ? (
                          <span className="nlex-aqi-loading">···</span>
                        ) : (
                          <AnimatedNumber value={p.aqi} />
                        )}
                      </div>
                    </div>
                  )}
                  {isCarousel && (
                  <div
                    className={`nlex-category-badge${hideGauge ? " no-gauge" : ""}`}
                    style={
                      band
                        ? {
                            background: band.color,
                            borderColor: band.color,
                            color: "#fff",
                          }
                        : {}
                    }
                  >
                    <span
                      className="nlex-category-dot"
                      style={{ background: band ? "rgba(255,255,255,0.75)" : "#d1d5db" }}
                    />
                    {p.loading ? "Loading…" : band ? `${band.emoji} ${band.short}` : "No Data"}
                  </div>
                  )}
                  {isCarousel && hideGauge && (
                    <div className="nlex-tile-asof-col no-gauge nlex-carousel-inline-asof">
                      <span>
                        {pollutantDates[pIdx]
                          ? `As of ${fmtDateTime(pollutantDates[pIdx])}`
                          : "Awaiting data…"}
                      </span>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
          {/* Spotlight description — single if both bands match, else one per pollutant */}
          {(solo || hideGauge || spotlit) &&
            (() => {
              const loaded = pollutants.filter((p) => p.aqi != null);
              if (!loaded.length) return null;
              const bands = loaded.map((p) => getBand(p.aqi));
              const allSame =
                bands.length > 1 && bands.every((b) => b.id === bands[0].id);
              if (allSame) {
                return (
                  <div
                    className={`nlex-spotlight-desc${hideGauge ? " no-gauge" : ""}`}
                    style={{
                      background: bands[0].color,
                      borderColor: bands[0].color,
                      color: "#fff",
                    }}
                  >
                    {bands[0].desc}
                  </div>
                );
              }
              return (
                <div className="nlex-spotlight-desc-multi">
                  {loaded.map((p, i) => (
                    <div
                      key={p.key}
                      className={`nlex-spotlight-desc nlex-spotlight-desc-sm${hideGauge ? " no-gauge" : ""}`}
                      style={{
                        background: bands[i].color,
                        borderColor: bands[i].color,
                        color: "#fff",
                      }}
                    >
                      <span className="nlex-spotlight-desc-label">
                        {p.label}:
                      </span>{" "}
                      {bands[i].desc}
                    </div>
                  ))}
                </div>
              );
            })()}
          {!isCarousel && (() => {
            const loaded = pollutants.filter((p) => p.aqi != null);
            const allSameBand = loaded.length > 0 && loaded.every(
              (p) => getBand(p.aqi).id === getBand(loaded[0].aqi).id
            );
            const toShow = allSameBand ? [loaded[0]] : pollutants;
            return (
              <div className="nlex-tile-badges">
                {toShow.map((p) => {
                  const band = p.aqi != null ? getBand(p.aqi) : null;
                  return (
                    <div
                      key={p.key}
                      className="nlex-category-badge"
                      style={
                        band
                          ? { background: band.color, borderColor: band.color, color: "#fff" }
                          : {}
                      }
                    >
                      <span
                        className="nlex-category-dot"
                        style={{ background: band ? "rgba(255,255,255,0.75)" : "#d1d5db" }}
                      />
                      {p.loading ? "Loading\u2026" : band ? `${band.emoji} ${band.short}` : "No Data"}
                    </div>
                  );
                })}
              </div>
            );
          })()}
        </>
      ) : (
        /* ── SINGLE layout ── */
        <>
          {!hideGauge && (
            <div
              className="nlex-gauges-row"
              style={{ animation: "nlex-fade-in 0.55s ease both" }}
            >
              {pollutants.map((p) => (
                <div key={p.key} className="nlex-gauge-wrap">
                  <div className="nlex-pollutant-label">{p.label}</div>
                  <SvgGauge
                    aqi={p.aqi}
                    loading={p.loading}
                    size={gaugeSize}
                    isNight={isNight}
                    showAqiInside={true}
                    hideNeedle={true}
                  />
                </div>
              ))}
            </div>
          )}

          {hideGauge && (
            <div
              className="nlex-aqi-value-row no-gauge"
              style={{ animation: "nlex-fade-in 0.55s ease both" }}
            >
              {pollutants.map((p) => {
                const band = p.aqi != null ? getBand(p.aqi) : null;
                return (
                  <div key={p.key} className="nlex-aqi-value-block no-gauge">
                    <div className="nlex-pollutant-label nlex-pollutant-label-nogauge">
                      {p.label}
                    </div>
                    <span
                      className="nlex-aqi-label no-gauge"
                      style={{ color: band ? band.color : "#9ca3af" }}
                    >
                      AQI
                    </span>
                    <div
                      className="nlex-aqi-number no-gauge"
                      style={{ color: band ? band.color : "#9ca3af" }}
                    >
                      {p.loading ? (
                        <span className="nlex-aqi-loading">···</span>
                      ) : (
                        <AnimatedNumber value={p.aqi} />
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          <div className={`nlex-tile-badges${hideGauge ? " no-gauge" : ""}`}>
            {pollutants.map((p) => {
              const band = p.aqi != null ? getBand(p.aqi) : null;
              return (
                <div
                  key={p.key}
                  className={`nlex-category-badge${hideGauge ? " no-gauge" : ""}`}
                  style={
                    band
                      ? {
                          background: band.color,
                          borderColor: band.color,
                          color: "#fff",
                        }
                      : {}
                  }
                >
                  <span
                    className="nlex-category-dot"
                    style={{ background: band ? "rgba(255,255,255,0.75)" : "#d1d5db" }}
                  />
                  {p.loading ? "Loading…" : band ? `${band.emoji} ${band.name}` : "No Data"}
                </div>
              );
            })}
          </div>
          {isCarousel && hideGauge && (
            <div className="nlex-tile-asof no-gauge nlex-carousel-inline-asof">
              {asOfDate ? `As of ${fmtDateTime(asOfDate)}` : "Awaiting data…"}
            </div>
          )}
          {(solo || hideGauge || spotlit) && firstWithData && dominantBand && (
            <div
              className={`nlex-spotlight-desc${hideGauge ? " no-gauge" : ""}`}
              style={{
                background: dominantBand.color,
                borderColor: dominantBand.color,
                color: "#fff",
              }}
            >
              {dominantBand.desc}
            </div>
          )}
        </>
      )}

      {isCarousel && hideGauge && <CarouselAqiScale isNight={isNight} />}

      {!(isCarousel && hideGauge) &&
        (isDual ? (
          <div className="nlex-tile-asof-dual">
            {pollutants.map((p, i) => (
              <div
                key={p.key}
                className={`nlex-tile-asof-col${hideGauge ? " no-gauge" : ""}`}
              >
                <span>
                  {pollutantDates[i]
                    ? `${fmtDateTime(pollutantDates[i])}`
                    : "Awaiting data…"}
                </span>
              </div>
            ))}
          </div>
        ) : (
          <div className={`nlex-tile-asof${hideGauge ? " no-gauge" : ""}`}>
            {asOfDate ? `As of ${fmtDateTime(asOfDate)}` : "Awaiting data…"}
          </div>
        ))}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════
   AQI BANDS SECTION CARD
   ═══════════════════════════════════════════════════════════════ */
function AqiLegend({ isNight }) {
  return (
    <div className={`nlex-bands-card${isNight ? " night" : ""}`}>
      <div className="nlex-bands-card-title">AQI Scale Reference</div>
      <div className="nlex-legend-row">
        {BANDS.map((b) => (
          <div
            key={b.id}
            className="nlex-legend-card"
            style={{
              background: `${b.color}1c`,
              borderColor: `${b.color}55`,
              color: b.color,
            }}
          >
            <span className="nlex-legend-dot" style={{ background: b.color }} />
            <div className="nlex-legend-card-content">
              <div className="nlex-legend-card-name">
                {b.legendLabel ?? b.name}
              </div>
              <div className="nlex-legend-card-range">
                {b.min}–{b.max === 500 ? "500" : b.max - 1}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════
   SPOTLIGHT ANIMATION
   Sequence: all-lit (2 s) → tile 0 (5 s) → … → tile N-1 (5 s) → all-lit (2 s) → repeat
   Returns:
     -1  = not started yet  (no highlight)
     -2  = all tiles lit    (no dimming)
     0…N = individual tile  (rest dimmed)
   ═══════════════════════════════════════════════════════════════ */
function useSpotlight(count, ms = 5000) {
  const [active, setActive] = useState(-1);
  // initial delay then kick off with "all" phase
  useEffect(() => {
    const init = setTimeout(() => setActive(-2), 2000);
    return () => clearTimeout(init);
  }, []);
  useEffect(() => {
    if (active === -1) return;
    if (active === -2) {
      // hold "all" for 5 s then start individual cycle at tile 0
      const id = setTimeout(() => setActive(0), ms);
      return () => clearTimeout(id);
    }
    // individual tile: advance to next, or wrap back to "all"
    const id = setTimeout(() => {
      setActive((p) => (p + 1 >= count ? -2 : p + 1));
    }, ms);
    return () => clearTimeout(id);
  }, [active, count, ms]);
  return active;
}

/* ═══════════════════════════════════════════════════════════════
   LIVE CLOCK
   ═══════════════════════════════════════════════════════════════ */
function useLiveClock() {
  const [now, setNow] = useState(new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);
  return now;
}

/* ═══════════════════════════════════════════════════════════════
   CAROUSEL HOOK
   Auto-advances through station cards one at a time.
   Returns the current visible index (0…count-1).
   ═══════════════════════════════════════════════════════════════ */
function useCarousel(count, ms = 5000) {
  const [active, setActive] = useState(0);
  useEffect(() => {
    if (count <= 1) return;
    const id = setTimeout(() => setActive((p) => (p + 1) % count), ms);
    return () => clearTimeout(id);
  }, [active, count, ms]);
  return active;
}

/* ═══════════════════════════════════════════════════════════════
   PAGE ROOT
   ═══════════════════════════════════════════════════════════════ */
export default function NlexLedWall() {
  return (
    <NlexSettingsProvider>
      <NlexLedWallInner />
    </NlexSettingsProvider>
  );
}

function NlexLedWallInner() {
  const { settings } = useNlexSettings();
  const clock = useLiveClock();

  // ── Maintenance-done notification ──
  const prevMaintenanceRef = useRef(settings.nlexMaintenance);
  const [showMaintenanceDone, setShowMaintenanceDone] = useState(false);
  const maintenanceDoneTimerRef = useRef(null);
  useEffect(() => {
    const prev = prevMaintenanceRef.current;
    const curr = settings.nlexMaintenance;
    prevMaintenanceRef.current = curr;
    if (prev === true && curr === false) {
      setShowMaintenanceDone(true);
      if (maintenanceDoneTimerRef.current)
        clearTimeout(maintenanceDoneTimerRef.current);
      maintenanceDoneTimerRef.current = setTimeout(
        () => setShowMaintenanceDone(false),
        20000,
      );
    }
    return () => {
      if (maintenanceDoneTimerRef.current)
        clearTimeout(maintenanceDoneTimerRef.current);
    };
  }, [settings.nlexMaintenance]);

  useEffect(() => {
    const prevBg = document.body.style.background;
    const prevOvf = document.body.style.overflow;
    document.body.style.background = "#000";
    document.body.style.margin = "0";
    document.body.style.overflow = "hidden";
    document.title = "EMB R3 — Air Quality Index | NLEX Display";
    return () => {
      document.body.style.background = prevBg;
      document.body.style.margin = "";
      document.body.style.overflow = prevOvf;
    };
  }, []);

  // Device geolocation for weather + location label
  const { loc, name: locName } = useDeviceLocation();
  const { data: weatherData } = useLocationWeather(loc);

  const isDay = weatherData?.isDay ?? 1;
  const themeOverride = settings.theme;
  const isNight =
    themeOverride === "dark"
      ? true
      : themeOverride === "light"
        ? false
        : !isDay;

  // Spotlight animation — cycles only through visible stations
  const SPEED_MS = { slow: 8000, normal: 5000, fast: 3000 };
  const visibleStations = STATION_DEFS.filter(
    (s) => settings.stationsVisible[s.key] !== false,
  );
  const visibleCount = visibleStations.length;
  const spotlightEnabled = settings.spotlightEnabled !== false;
  const spotlightRaw = useSpotlight(
    visibleCount,
    SPEED_MS[settings.spotlightSpeed] ?? 5000,
  );
  // -2 = all lit (no dimming); when disabled keep all tiles fully lit
  const spotlight = spotlightEnabled ? spotlightRaw : -2;

  const hideGauge = settings.showGaugeChart === false;
  const cardDisplayMode = settings.cardDisplayMode ?? "grid";

  // Carousel duration: dedicated setting (seconds → ms), fallback to spotlight speed
  const carouselDurationMs = settings.carouselDurationSec
    ? Number(settings.carouselDurationSec) * 1000
    : (SPEED_MS[settings.spotlightSpeed] ?? 5000);

  // Carousel uses its own separate visibility filter
  const carouselVisibleStations = STATION_DEFS.filter(
    (s) => (settings.carouselStationsVisible ?? {})[s.key] !== false,
  );
  const carouselCount = carouselVisibleStations.length;
  const carouselIndex = useCarousel(
    carouselCount,
    carouselDurationMs,
  );

  const clarkPm10 = useLatestAqi("clark", "pm10");
  const sfPm10    = useLatestAqi("san-fernando", "pm10");
  const meycPm10  = useLatestAqi("meycauayan", "pm10");
  const meycPm25  = useLatestAqi("meycauayan", "pm25");
  const zamPm10   = useLatestAqi("zambales", "pm10");
  const zamPm25   = useLatestAqi("zambales", "pm25");

  const textColor = isNight ? "rgba(225,235,255,0.92)" : "#1a2340";
  const subColor = isNight ? "rgba(190,215,255,0.82)" : "rgba(30,50,100,0.55)";
  const dividerGrad = isNight
    ? "linear-gradient(90deg,transparent,rgba(180,200,255,0.35) 20%,rgba(200,220,255,0.55) 50%,rgba(180,200,255,0.35) 80%,transparent)"
    : "linear-gradient(90deg,transparent,rgba(161,120,10,0.5) 20%,rgba(201,162,39,0.72) 50%,rgba(161,120,10,0.5) 80%,transparent)";

  // Adaptive scaling
  const [scale, setScale] = useState(1);
  useEffect(() => {
    function calcScale() {
      const s = Math.min(window.innerWidth / 960, window.innerHeight / 1536);
      setScale(Math.min(1, s));
    }
    calcScale();
    window.addEventListener("resize", calcScale);
    return () => window.removeEventListener("resize", calcScale);
  }, []);

  return (
    <ConfigProvider>
      <div className="nlex-page-root">
        <WeatherBackground weatherData={weatherData} />
        {/* Persistent animated background clouds */}
        <div className="nlex-bg-clouds" aria-hidden="true">
          <div className="nlex-bg-cloud nlex-bg-cloud-1" />
          <div className="nlex-bg-cloud nlex-bg-cloud-2" />
          <div className="nlex-bg-cloud nlex-bg-cloud-3" />
          <div className="nlex-bg-cloud nlex-bg-cloud-4" />
          <div className="nlex-bg-cloud nlex-bg-cloud-5" />
        </div>

        <div
          className="nlex-wall-scaler"
          style={{
            transform: `translate(-50%, -50%) scale(${scale})`,
          }}
        >
          <div className={`nlex-wall${isNight ? " night" : ""}`}>
            <div className="nlex-inner">
              {/* ── Header ── */}
              {settings.showHeader !== false && (
                <>
                  <header className="nlex-header">
                    <div className="nlex-logos-group">
                      <img src={embLogo} alt="EMB Logo" className="nlex-logo" />
                      <img
                        src={bpLogo}
                        alt="BAGONG PILIPINAS Logo"
                        className="nlex-logo nlex-logo-bp"
                      />
                    </div>
                    <div className="nlex-title-block">
                      <div
                        className="nlex-agency-label"
                        style={{
                          color: isNight
                            ? "rgba(180,210,255,0.7)"
                            : "rgba(161,120,10,0.9)",
                        }}
                      >
                        Department of Environment and Natural Resources
                      </div>
                      <div
                        className="nlex-agency-name"
                        style={{ color: textColor }}
                      >
                        Environmental Management Bureau
                      </div>
                      <div
                        className="nlex-agency-region"
                        style={{ color: subColor }}
                      >
                        Region III — Central Luzon
                      </div>
                    </div>
                  </header>

                  <hr
                    className="nlex-divider"
                    style={{ background: dividerGrad }}
                  />
                </>
              )}

              {/* ── Section title ── */}
              <div className="nlex-section-header">
                <div
                  className="nlex-section-line"
                  style={{
                    background: `linear-gradient(90deg,transparent,${isNight ? "rgba(180,200,255,0.15)" : "rgba(30,50,100,0.15)"})`,
                  }}
                />
                <div style={{ textAlign: "center" }}>
                  <div
                    className="nlex-section-title"
                    style={{ color: textColor }}
                  >
                    Air Quality Monitoring
                  </div>
                  {settings.showDateTime !== false && (
                    <div
                      className="nlex-section-datetime"
                      style={{ color: textColor }}
                    >
                      {fmtDate(clock)} &nbsp;·&nbsp; {fmtTime(clock)}
                    </div>
                  )}
                  {settings.showSubtitle !== false && (
                    <div
                      className="nlex-section-subtitle"
                      style={{
                        color: isNight ? "rgba(200,220,255,0.88)" : "#1a2340",
                      }}
                    >
                      Real-time Particulate Matter Monitor — PM10 / PM2.5
                    </div>
                  )}
                </div>
                <div
                  className="nlex-section-line right"
                  style={{
                    background: `linear-gradient(90deg,${isNight ? "rgba(180,200,255,0.15)" : "rgba(30,50,100,0.15)"},transparent)`,
                  }}
                />
              </div>

              {/* ── Dynamic station grid / carousel ── */}
              {(() => {
                // Build pollutant list per station key
                const pollVisible = settings.pollutantsVisible ?? {};
                function getPollutants(key) {
                  if (key === "clark") {
                    const all = [
                      pollVisible["clark_pm10"] !== false && {
                        key: "clark-pm10",
                        label: "PM10",
                        aqi: extractAqi(clarkPm10.latest),
                        loading: clarkPm10.loading && !clarkPm10.latest,
                        latest: clarkPm10.latest,
                        dateCol: clarkPm10.dateCol,
                        fetchedAt: clarkPm10.fetchedAt,
                      },
                    ];
                    return all.filter(Boolean);
                  }
                  if (key === "san-fernando") {
                    const all = [
                      pollVisible["san-fernando_pm10"] !== false && {
                        key: "sf-pm10",
                        label: "PM10",
                        aqi: extractAqi(sfPm10.latest),
                        loading: sfPm10.loading && !sfPm10.latest,
                        latest: sfPm10.latest,
                        dateCol: sfPm10.dateCol,
                        fetchedAt: sfPm10.fetchedAt,
                      },
                    ];
                    return all.filter(Boolean);
                  }
                  if (key === "meycauayan") {
                    const all = [
                      pollVisible["meycauayan_pm10"] !== false && {
                        key: "meyc-pm10",
                        label: "PM10",
                        aqi: extractAqi(meycPm10.latest),
                        loading: meycPm10.loading && !meycPm10.latest,
                        latest: meycPm10.latest,
                        dateCol: meycPm10.dateCol,
                        fetchedAt: meycPm10.fetchedAt,
                      },
                      pollVisible["meycauayan_pm25"] !== false && {
                        key: "meyc-pm25",
                        label: "PM2.5",
                        aqi: extractAqi(meycPm25.latest),
                        loading: meycPm25.loading && !meycPm25.latest,
                        latest: meycPm25.latest,
                        dateCol: meycPm25.dateCol,
                        fetchedAt: meycPm25.fetchedAt,
                      },
                    ];
                    return all.filter(Boolean);
                  }
                  if (key === "zambales") {
                    const all = [
                      pollVisible["zambales_pm10"] !== false && {
                        key: "zam-pm10",
                        label: "PM10",
                        aqi: extractAqi(zamPm10.latest),
                        loading: zamPm10.loading && !zamPm10.latest,
                        latest: zamPm10.latest,
                        dateCol: zamPm10.dateCol,
                        fetchedAt: zamPm10.fetchedAt,
                      },
                      pollVisible["zambales_pm25"] !== false && {
                        key: "zam-pm25",
                        label: "PM2.5",
                        aqi: extractAqi(zamPm25.latest),
                        loading: zamPm25.loading && !zamPm25.latest,
                        latest: zamPm25.latest,
                        dateCol: zamPm25.dateCol,
                        fetchedAt: zamPm25.fetchedAt,
                      },
                    ];
                    return all.filter(Boolean);
                  }
                  return [];
                }

                if (cardDisplayMode === "carousel") {
                  const st =
                    carouselVisibleStations[carouselIndex] ?? carouselVisibleStations[0];
                  if (!st) return null;
                  return (
                    <div
                      className="nlex-carousel-wrap"
                      key={`mode-carousel-${hideGauge ? 1 : 0}`}
                    >
                      <div
                        className="nlex-carousel-stage"
                        key={`carousel-${st.key}`}
                      >
                        <StationTile
                          label={st.label}
                          address={st.address}
                          isNight={isNight}
                          spotlit={true}
                          dimmed={false}
                          solo={true}
                          pollutants={getPollutants(st.key)}
                          hideGauge={hideGauge}
                          isCarousel={true}
                        />
                      </div>
                      {/* Pagination dots */}
                      {carouselCount > 1 && (
                        <div className="nlex-carousel-dots" aria-hidden="true">
                          {carouselVisibleStations.map((_, i) => (
                            <div
                              key={i}
                              className={`nlex-carousel-dot${i === carouselIndex ? " active" : ""}`}
                            />
                          ))}
                        </div>
                      )}
                    </div>
                  );
                }

                // Default: grid mode
                const gridStyle = {
                  gridTemplateColumns: visibleCount === 1 ? "1fr" : "1fr 1fr",
                };
                return (
                  <div
                    className="nlex-grid"
                    key={`mode-grid-${hideGauge ? 1 : 0}`}
                    style={gridStyle}
                  >
                    {visibleStations.map((st, i) => {
                      const isLast3 = visibleCount === 3 && i === 2;
                      return (
                        <StationTile
                          key={st.key}
                          label={st.label}
                          address={st.address}
                          isNight={isNight}
                          spotlit={spotlight === -2 || spotlight === i}
                          dimmed={spotlight >= 0 && spotlight !== i}
                          solo={spotlight === i}
                          pollutants={getPollutants(st.key)}
                          hideGauge={hideGauge}
                          gridStyle={
                            isLast3
                              ? {
                                  gridColumn: "span 2",
                                  maxWidth: "calc(50% - 7px)",
                                  justifySelf: "center",
                                }
                              : undefined
                          }
                        />
                      );
                    })}
                  </div>
                );
              })()}

              {settings.showAqiLegend !== false && (
                <AqiLegend isNight={isNight} />
              )}

              {/* ── Footer ── */}
              {settings.showFooter !== false && (
                <footer className={`nlex-footer${isNight ? " night" : ""}`}>
                  {/* Contact row – Address & Online only */}
                  <div className="nlex-footer-contacts">
                    <div className="nlex-footer-contact-card">
                      <span className="nlex-footer-icon-wrap">
                        <TbMapPin size={15} />
                      </span>
                      <div className="nlex-footer-contact-body">
                        <div className="nlex-footer-contact-label">
                          Office Address
                        </div>
                        <div className="nlex-footer-contact-value">
                          Masinop cor. Matalino St., Diosdado Macapagal
                          Gov&apos;t Center, Maimpis, City of San Fernando,
                          Pampanga
                        </div>
                      </div>
                    </div>
                    <div className="nlex-footer-contact-card">
                      <span className="nlex-footer-icon-wrap">
                        <TbWorld size={15} />
                      </span>
                      <div className="nlex-footer-contact-body">
                        <div className="nlex-footer-contact-label">
                          Contact Us
                        </div>
                        <div className="nlex-footer-contact-value">
                          r3.emb.gov.ph · facebook.com/EMBRegion3
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Bottom bar */}
                  <div className="nlex-footer-bottom">
                    <div className="nlex-footer-left">
                      {locName &&
                        (() => {
                          const WIcon = weatherData
                            ? getWeatherIcon(
                                weatherData.weatherCode,
                                weatherData.isDay ?? 1,
                              )
                            : null;
                          return (
                            <div className="nlex-footer-location">
                              <TbCurrentLocation
                                size={13}
                                style={{ flexShrink: 0 }}
                              />
                              {WIcon && (
                                <WIcon size={15} style={{ flexShrink: 0 }} />
                              )}
                              <span>{locName}</span>
                            </div>
                          );
                        })()}
                    </div>
                    <div className="nlex-footer-clock">{fmtClock(clock)}</div>
                  </div>
                </footer>
              )}
            </div>

            {/* ── Maintenance overlay ── */}
            {settings.nlexMaintenance && (
              <div className="nlex-maintenance-overlay" aria-live="polite">
                <div className="nlex-maintenance-box">
                  <div className="nlex-maintenance-logos">
                    <img
                      src={embLogo}
                      alt="EMB"
                      className="nlex-maintenance-emblogo"
                    />
                    <div className="nlex-maintenance-agency-name">
                      Environmental Management Bureau
                    </div>
                    <div className="nlex-maintenance-agency-sub">
                      Region III — Central Luzon
                    </div>
                  </div>

                  <div className="nlex-maintenance-icon-wrap">
                    <TbTools className="nlex-maintenance-spin-icon" />
                  </div>

                  <div className="nlex-maintenance-title">
                    Under Scheduled Maintenance
                  </div>
                  <div className="nlex-maintenance-subtitle">
                    NLEX Air Quality Monitoring Display
                  </div>

                  <div className="nlex-maintenance-msg">
                    {settings.nlexMaintenanceMsg ||
                      "The display is temporarily offline for scheduled maintenance. Service will resume shortly."}
                  </div>

                  <div className="nlex-maintenance-divider" />

                  <div className="nlex-maintenance-contacts">
                    <div className="nlex-maintenance-contact-row">
                      <TbMapPin size={16} className="nlex-mc-icon" />
                      <span>
                        Masinop cor. Matalino St., DMG Center, Maimpis, City of
                        San Fernando, Pampanga
                      </span>
                    </div>
                    <div className="nlex-maintenance-contact-row">
                      <TbPhone size={16} className="nlex-mc-icon" />
                      <span>(045) 963-3623</span>
                    </div>
                    <div className="nlex-maintenance-contact-row">
                      <TbMail size={16} className="nlex-mc-icon" />
                      <span>emb_region3@emb.gov.ph</span>
                    </div>
                    <div className="nlex-maintenance-contact-row">
                      <TbWorld size={16} className="nlex-mc-icon" />
                      <span>r3.emb.gov.ph</span>
                    </div>
                  </div>
                </div>
              </div>
            )}
            {/* ── Maintenance done notification ── */}
            {showMaintenanceDone && (
              <div className="nlex-maintenance-done-overlay" aria-live="polite">
                <div className="nlex-maintenance-done-box">
                  <div className="nlex-maintenance-done-icon-wrap">
                    <TbCircleCheckFilled className="nlex-maintenance-done-icon" />
                  </div>
                  <div className="nlex-maintenance-done-title">
                    Maintenance Complete
                  </div>
                  <div className="nlex-maintenance-done-subtitle">
                    NLEX Air Quality Monitoring Display
                  </div>
                  <div className="nlex-maintenance-done-msg">
                    {settings.nlexMaintenanceUpdateDesc ||
                      "The NLEX Air Quality display has been restored. All systems are now operational."}
                  </div>
                  <div className="nlex-maintenance-done-timer">
                    This notice will dismiss automatically
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </ConfigProvider>
  );
}
