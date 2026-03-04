import { useEffect, useState, useMemo } from "react";
import { Skeleton, Spin, Button, Tooltip, Tag } from "antd";
import {
  WiThermometer,
  WiHumidity,
  WiBarometer,
  WiStrongWind,
  WiDaySunny,
  WiCloudy,
  WiRain,
  WiSnow,
  WiFog,
  WiThunderstorm,
  WiDayCloudyHigh,
  WiWindDeg,
  WiHot,
  WiCloud,
} from "react-icons/wi";
import { TbRefresh, TbMapPin, TbClock, TbUvIndex } from "react-icons/tb";
import AqiCategoryMeter from "./AqiCategoryMeter";

/* ── AQI colour bands (Philippine NAAQGV-style, PM10) ─────────────── */
const AQI_BANDS = [
  {
    name: "GOOD", min: 0, max: 50, color: "#34d399", textColor: "#065f46",
    heroText: "#1a3a4a", heroTextSub: "rgba(20,60,80,0.65)",
    sky: "linear-gradient(180deg, #56ccf2 0%, #87ceeb 40%, #b6e3f4 70%, #e0f7fa 100%)",
    skyDark: "linear-gradient(180deg, #1a4a6b 0%, #2d6a8f 40%, #3d8ab0 70%, #1a4a6b 100%)",
    cloudColor: "rgba(255,255,255,0.92)", face: "😊",
    cityColor: "#1a6b4a", cityColorDark: "#0d3d2b",
  },
  {
    name: "FAIR", min: 51, max: 100, color: "#fbbf24", textColor: "#78350f",
    heroText: "#3d2a00", heroTextSub: "rgba(60,40,0,0.6)",
    sky: "linear-gradient(180deg, #87ceeb 0%, #fde68a 40%, #fef3c7 70%, #fffbeb 100%)",
    skyDark: "linear-gradient(180deg, #3d5a6b 0%, #6b5a1a 40%, #8b7a2a 70%, #3d4a1a 100%)",
    cloudColor: "rgba(255,255,255,0.85)", face: "🙂",
    cityColor: "#6b5a1a", cityColorDark: "#3d3400",
  },
  {
    name: "UNHEALTHY FOR SENSITIVE GROUPS", min: 101, max: 150, color: "#fb923c", textColor: "#7c2d12",
    heroText: "#ffffff", heroTextSub: "rgba(255,255,255,0.7)",
    sky: "linear-gradient(180deg, #d4976a 0%, #e8a87c 30%, #f0c4a0 60%, #fde8d0 100%)",
    skyDark: "linear-gradient(180deg, #5c3a20 0%, #6b4a2a 30%, #7a5a3a 60%, #4a3020 100%)",
    cloudColor: "rgba(255,245,235,0.75)", face: "😷",
    cityColor: "#7c4a1a", cityColorDark: "#4a2a0a",
  },
  {
    name: "VERY UNHEALTHY", min: 151, max: 200, color: "#f87171", textColor: "#7f1d1d",
    heroText: "#ffffff", heroTextSub: "rgba(255,255,255,0.7)",
    sky: "linear-gradient(180deg, #c0392b 0%, #d35c5c 30%, #e88080 60%, #f8b4b4 100%)",
    skyDark: "linear-gradient(180deg, #5c1a1a 0%, #7a2a2a 30%, #8b3a3a 60%, #4a1010 100%)",
    cloudColor: "rgba(255,230,230,0.6)", face: "🤢",
    cityColor: "#6b1a1a", cityColorDark: "#3d0a0a",
  },
  {
    name: "ACUTELY UNHEALTHY", min: 201, max: 300, color: "#a78bfa", textColor: "#3b0764",
    heroText: "#ffffff", heroTextSub: "rgba(255,255,255,0.7)",
    sky: "linear-gradient(180deg, #5b2c6f 0%, #7d3c98 30%, #a569bd 60%, #d2b4de 100%)",
    skyDark: "linear-gradient(180deg, #2a0845 0%, #3c1361 30%, #4a1a7a 60%, #1a0530 100%)",
    cloudColor: "rgba(220,210,240,0.5)", face: "😨",
    cityColor: "#3b0764", cityColorDark: "#1a0330",
  },
  {
    name: "EMERGENCY", min: 301, max: 999, color: "#fb7185", textColor: "#4c0519",
    heroText: "#ffffff", heroTextSub: "rgba(255,255,255,0.7)",
    sky: "linear-gradient(180deg, #4a0000 0%, #6b1a1a 25%, #8b2a2a 50%, #5c1010 100%)",
    skyDark: "linear-gradient(180deg, #2a0000 0%, #4a0a0a 25%, #5c1414 50%, #2a0000 100%)",
    cloudColor: "rgba(180,140,140,0.35)", face: "☠️",
    cityColor: "#2a0000", cityColorDark: "#1a0000",
  },
];

function getBand(val) {
  const n = Number(val);
  if (!isFinite(n) || n < 0) return AQI_BANDS[0];
  return AQI_BANDS.find((b) => n >= b.min && n <= b.max) || AQI_BANDS[AQI_BANDS.length - 1];
}

function hexToRgba(hex, alpha) {
  let h = hex.replace("#", "");
  if (h.length === 3) h = h.split("").map((c) => c + c).join("");
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

/* weather icon mappings – returns { icon, animClass } */
function weatherIconData(code, size = 32) {
  if (code == null) return { icon: <WiDaySunny size={size} />, animClass: "wx-anim-sunny" };
  if (code === 0) return { icon: <WiDaySunny size={size} />, animClass: "wx-anim-sunny" };
  if ([1, 2].includes(code)) return { icon: <WiDayCloudyHigh size={size} />, animClass: "wx-anim-cloudy" };
  if (code === 3) return { icon: <WiCloudy size={size} />, animClass: "wx-anim-cloudy" };
  if ([45, 48].includes(code)) return { icon: <WiFog size={size} />, animClass: "wx-anim-fog" };
  if ([51, 53, 55, 56, 57, 61, 63, 65, 80, 81, 82].includes(code)) return { icon: <WiRain size={size} />, animClass: "wx-anim-rain" };
  if ([66, 67, 95, 96, 99].includes(code)) return { icon: <WiThunderstorm size={size} />, animClass: "wx-anim-storm" };
  if ([71, 73, 75, 77, 85, 86].includes(code)) return { icon: <WiSnow size={size} />, animClass: "wx-anim-snow" };
  return { icon: <WiDaySunny size={size} />, animClass: "wx-anim-sunny" };
}

function weatherLabel(code) {
  if (code == null) return "—";
  if (code === 0) return "Clear Sky";
  if ([1, 2].includes(code)) return "Partly Cloudy";
  if (code === 3) return "Overcast";
  if ([45, 48].includes(code)) return "Foggy";
  if ([51, 53, 55, 56, 57].includes(code)) return "Drizzle";
  if ([61, 63, 65, 80, 81, 82].includes(code)) return "Rainy";
  if ([66, 67, 95, 96, 99].includes(code)) return "Stormy";
  if ([71, 73, 75, 77, 85, 86].includes(code)) return "Snowy";
  return "—";
}

/**
 * Weather-accurate sky gradient based on Open-Meteo weather codes.
 * Returns a CSS linear-gradient for the hero card background.
 */
function weatherSky(code, isDark) {
  if (code === 0) {
    // Clear / Sunny
    return isDark
      ? "linear-gradient(180deg, #0b1228 0%, #0a2351 30%, #1a4a6b 60%, #2d6a8f 100%)"
      : "linear-gradient(180deg, #2196F3 0%, #64B5F6 30%, #90CAF9 60%, #BBDEFB 100%)";
  }
  if ([1, 2].includes(code)) {
    // Partly Cloudy
    return isDark
      ? "linear-gradient(180deg, #0f1b2d 0%, #1a3250 30%, #2a4a6a 60%, #3d6080 100%)"
      : "linear-gradient(180deg, #5c9fd4 0%, #87CEEB 30%, #a8d8ea 60%, #cde8f5 100%)";
  }
  if (code === 3) {
    // Overcast
    return isDark
      ? "linear-gradient(180deg, #1a1f28 0%, #2a3040 30%, #3a4050 60%, #4a5060 100%)"
      : "linear-gradient(180deg, #90a4ae 0%, #b0bec5 30%, #cfd8dc 60%, #eceff1 100%)";
  }
  if ([45, 48].includes(code)) {
    // Fog / Mist
    return isDark
      ? "linear-gradient(180deg, #2a2f38 0%, #353b45 30%, #454b55 60%, #555b65 100%)"
      : "linear-gradient(180deg, #bdc3c7 0%, #d5d8dc 30%, #e8eaed 60%, #f4f5f6 100%)";
  }
  if ([51, 53, 55, 56, 57].includes(code)) {
    // Drizzle
    return isDark
      ? "linear-gradient(180deg, #0f1520 0%, #1a2a40 30%, #2a3a55 60%, #3a4a65 100%)"
      : "linear-gradient(180deg, #78909c 0%, #90a4ae 30%, #b0bec5 60%, #cfd8dc 100%)";
  }
  if ([61, 63, 65, 80, 81, 82].includes(code)) {
    // Rain
    return isDark
      ? "linear-gradient(180deg, #0d1520 0%, #1a2535 30%, #253545 60%, #354555 100%)"
      : "linear-gradient(180deg, #607d8b 0%, #78909c 30%, #90a4ae 60%, #b0bec5 100%)";
  }
  if ([66, 67, 95, 96, 99].includes(code)) {
    // Storm / Thunder
    return isDark
      ? "linear-gradient(180deg, #0a0a15 0%, #151525 30%, #252535 60%, #353540 100%)"
      : "linear-gradient(180deg, #455a64 0%, #546e7a 30%, #607d8b 60%, #78909c 100%)";
  }
  if ([71, 73, 75, 77, 85, 86].includes(code)) {
    // Snow
    return isDark
      ? "linear-gradient(180deg, #1a2030 0%, #2a3040 30%, #3a4555 60%, #4a5a70 100%)"
      : "linear-gradient(180deg, #cfd8dc 0%, #e0e8ed 30%, #eceff1 60%, #f5f7f8 100%)";
  }
  // Fallback – clear
  return isDark
    ? "linear-gradient(180deg, #0b1228 0%, #0a2351 30%, #1a4a6b 60%, #2d6a8f 100%)"
    : "linear-gradient(180deg, #2196F3 0%, #64B5F6 30%, #90CAF9 60%, #BBDEFB 100%)";
}

/* ── Cityscape SVG silhouette ──────────────────────────────────────── */
function CityscapeSilhouette({ color = "#1a1a2e" }) {
  return (
    <svg
      className="hero-cityscape"
      viewBox="0 0 1200 200"
      preserveAspectRatio="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path
        d={`M0,200 L0,160 L30,160 L30,130 L50,130 L50,110 L60,110 L60,80
            L80,80 L80,110 L100,110 L100,90 L110,90 L110,60 L120,55 L130,60
            L130,90 L150,90 L150,130 L170,130 L170,100 L180,100 L180,70
            L200,70 L200,100 L220,100 L220,140 L240,140 L240,110 L250,110
            L250,50 L260,45 L270,50 L270,80 L280,80 L280,110 L300,110
            L300,130 L320,130 L320,95 L330,95 L330,65 L340,60 L350,65
            L350,95 L370,95 L370,120 L390,120 L390,145 L410,145 L410,100
            L420,100 L420,75 L430,70 L440,75 L440,100 L460,100 L460,135
            L480,135 L480,155 L500,155 L500,120 L510,120 L510,85 L520,80
            L530,85 L530,100 L540,100 L540,70 L550,65 L560,70 L560,100
            L580,100 L580,130 L600,130 L600,150 L620,150 L620,110
            L630,110 L630,80 L640,75 L650,80 L650,110 L670,110 L670,90
            L680,85 L690,90 L690,120 L700,120 L700,145 L720,145 L720,105
            L730,105 L730,55 L740,50 L750,55 L750,80 L760,80 L760,105
            L780,105 L780,135 L800,135 L800,160 L820,160 L820,120
            L830,120 L830,90 L840,85 L850,90 L850,120 L870,120 L870,95
            L880,90 L890,95 L890,130 L910,130 L910,155 L930,155 L930,110
            L940,110 L940,75 L950,70 L960,75 L960,110 L980,110 L980,140
            L1000,140 L1000,100 L1010,100 L1010,60 L1020,55 L1030,60
            L1030,100 L1050,100 L1050,130 L1070,130 L1070,150 L1090,150
            L1090,115 L1100,110 L1110,115 L1110,140 L1130,140 L1130,160
            L1150,160 L1150,135 L1160,130 L1170,135 L1170,155 L1200,155
            L1200,200 Z`}
        fill={color}
        opacity="0.25"
      />
      <path
        d={`M0,200 L0,175 L60,175 L60,155 L80,155 L80,135 L100,135
            L100,155 L140,155 L140,170 L180,170 L180,145 L200,145
            L200,125 L220,125 L220,145 L260,145 L260,165 L300,165
            L300,150 L320,150 L320,130 L340,130 L340,150 L380,150
            L380,170 L420,170 L420,145 L440,145 L440,125 L460,125
            L460,145 L500,145 L500,165 L540,165 L540,155 L560,155
            L560,135 L580,135 L580,155 L620,155 L620,170 L660,170
            L660,150 L680,150 L680,130 L700,130 L700,150 L740,150
            L740,170 L780,170 L780,155 L800,155 L800,140 L820,140
            L820,160 L860,160 L860,175 L900,175 L900,150 L920,150
            L920,135 L940,135 L940,155 L980,155 L980,170 L1020,170
            L1020,145 L1040,145 L1040,130 L1060,130 L1060,150 L1100,150
            L1100,165 L1140,165 L1140,175 L1200,175 L1200,200 Z`}
        fill={color}
        opacity="0.4"
      />
    </svg>
  );
}

/**
 * AQI Hero Card – aqi.in-inspired scenic banner with animated clouds,
 * cityscape silhouette, sky gradient based on air quality status.
 */
export default function AqiHeroCard({
  aqiValue,
  aqiCategory,
  aqiTime,
  aqiLoading,
  aqiError,
  aqiRefreshing,
  onRetry,
  retrying,
  stationName,
  stationAddress,
  pollutantLabel = "PM10",
  temperature,
  humidity,
  pressure,
  windSpeed,
  windDirection,
  weatherCode,
  apparentTemperature,
  uvIndex,
  cloudCover,
  weatherLoading,
  weatherError,
  dark = false,
  hideWeather = false,
  /* ── Secondary pollutant (optional) ── */
  aqiValue2,
  aqiCategory2,
  aqiTime2,
  aqiLoading2,
  pollutantLabel2,
  /* ── Fallback (when EMBR3 data is outdated) ── */
  isFallback = false,
  fallbackSource = "",
  /* ── Stale indicator (>7 days old) ── */
  isStale = false,
  isStale2 = false,
}) {
  // If fallback is active, override the display value/category/time
  const displayValue = isFallback ? aqiValue : aqiValue;
  const band = getBand(displayValue);
  const roundedVal = isFinite(Number(displayValue)) ? Math.round(Number(displayValue)) : null;
  const sevIdx = AQI_BANDS.indexOf(band);

  const hasDual = pollutantLabel2 != null;
  const band2 = hasDual ? getBand(aqiValue2) : null;
  const roundedVal2 = hasDual && isFinite(Number(aqiValue2)) ? Math.round(Number(aqiValue2)) : null;

  // Use weather-based sky background when weather data is available,
  // otherwise fall back to the AQI-band sky
  const skyBg = useMemo(() => {
    if (weatherCode != null) return weatherSky(weatherCode, dark);
    return dark ? band.skyDark : band.sky;
  }, [weatherCode, dark, band]);

  const cityColor = dark ? band.cityColorDark : band.cityColor;
  const heroText = dark ? "#ffffff" : band.heroText;
  const heroTextSub = dark ? "rgba(255,255,255,0.7)" : band.heroTextSub;

  return (
    <div
      className="aqi-hero-card"
      style={{
        "--aqi-cloud-color": band.cloudColor,
        "--aqi-accent": band.color,
        "--aqi-text": band.textColor || "#fff",
        "--hero-text": heroText,
        "--hero-text-sub": heroTextSub,
        background: skyBg,
        ...((isStale && (!hasDual || isStale2)) ? { pointerEvents: "none", userSelect: "none" } : {}),
      }}
    >
      {/* ── Live badge (top-left) ── */}
      {aqiTime && (
        <span className={`aqi-live-badge aqi-live-badge--topleft${isStale ? " aqi-live-badge--stale" : isFallback ? " aqi-live-badge--fallback" : ""}`}>
          <span className={`aqi-live-dot${isStale ? " aqi-live-dot--stale" : isFallback ? " aqi-live-dot--warn" : ""}`} />
          {isStale ? "Outdated" : isFallback ? "Alternate" : "Live"}
        </span>
      )}

      {/* ── Animated clouds ── */}
      <div className="hero-clouds-layer">
        <div className="hero-cloud hero-cloud-1" />
        <div className="hero-cloud hero-cloud-2" />
        <div className="hero-cloud hero-cloud-3" />
        <div className="hero-cloud hero-cloud-4" />
        <div className="hero-cloud hero-cloud-5" />
      </div>

      {/* ── Cityscape silhouette ── */}
      <CityscapeSilhouette color={cityColor} />

      {/* ── Stale-data watermark (covers the entire card) ── */}
      {isStale && (
        <div className="aqi-hero-watermark">
          <div className="aqi-hero-watermark-text">
            No available latest data for this station
          </div>
          <div className="aqi-hero-watermark-sub">
            Data is still being analyzed for display
          </div>
        </div>
      )}

      {/* ── Content overlay ── */}
      <div className="aqi-hero-content">
        {/* LEFT: Gauge + Status */}
        <div className="aqi-hero-left">
          {aqiLoading ? (
            <Skeleton.Avatar active size={140} shape="circle" />
          ) : aqiError ? (
            <div className="aqi-hero-error">
              <div style={{ fontSize: 14, marginBottom: 10, color: "#fff" }}>Unable to load AQI</div>
              {onRetry && (
                <Button size="small" onClick={onRetry} loading={retrying} ghost>
                  Retry
                </Button>
              )}
            </div>
          ) : hasDual ? (
            /* ── Dual gauge layout (PM10 + PM2.5 side by side) ── */
            <div className="aqi-hero-dual-gauges">
              {/* Primary gauge */}
              <div className="aqi-hero-dual-col" style={isStale ? { filter: "blur(4px) grayscale(0.7)", opacity: 0.45, pointerEvents: "none", userSelect: "none", position: "relative" } : undefined}>
                <div className="aqi-hero-gauge-wrap aqi-hero-gauge-wrap--sm">
                  <div
                    className="aqi-hero-gauge aqi-hero-gauge--sm"
                    style={{
                      "--gauge-color": band.color,
                      "--gauge-glow": hexToRgba(band.color, 0.5),
                    }}
                  >
                    <span className="aqi-hero-face aqi-face-bounce" style={{ fontSize: 22 }}>{band.face}</span>
                    <span className="aqi-hero-value" style={{ fontSize: 28 }}>{roundedVal ?? "—"}</span>
                    <span className="aqi-hero-unit" style={{ fontSize: 8 }}>µg/Ncm</span>
                  </div>
                </div>
                <div className="aqi-hero-dual-label">{pollutantLabel}</div>
                <Tag color={band.color} className="aqi-hero-status-tag">{band.name}</Tag>
                {isStale && (
                  <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", filter: "none", opacity: 1, pointerEvents: "none" }}>
                    <span style={{ fontSize: 10, color: "#fff", background: "rgba(0,0,0,0.55)", borderRadius: 6, padding: "3px 8px", fontWeight: 600, whiteSpace: "nowrap" }}>No Data</span>
                  </div>
                )}
              </div>

              {/* Secondary gauge */}
              <div className="aqi-hero-dual-col" style={isStale2 ? { filter: "blur(4px) grayscale(0.7)", opacity: 0.45, pointerEvents: "none", userSelect: "none", position: "relative" } : undefined}>
                {aqiLoading2 ? (
                  <Skeleton.Avatar active size={90} shape="circle" />
                ) : (
                  <>
                    <div className="aqi-hero-gauge-wrap aqi-hero-gauge-wrap--sm">
                      <div
                        className="aqi-hero-gauge aqi-hero-gauge--sm"
                        style={{
                          "--gauge-color": band2.color,
                          "--gauge-glow": hexToRgba(band2.color, 0.5),
                        }}
                      >
                        <span className="aqi-hero-face aqi-face-bounce" style={{ fontSize: 22 }}>{band2.face}</span>
                        <span className="aqi-hero-value" style={{ fontSize: 28 }}>{roundedVal2 ?? "—"}</span>
                        <span className="aqi-hero-unit" style={{ fontSize: 8 }}>µg/Ncm</span>
                      </div>
                    </div>
                    <div className="aqi-hero-dual-label">{pollutantLabel2}</div>
                    <Tag color={band2.color} className="aqi-hero-status-tag">{band2.name}</Tag>
                  </>
                )}
                {isStale2 && (
                  <div style={{
                    position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center",
                    filter: "none", opacity: 1, pointerEvents: "none",
                  }}>
                    <span style={{ fontSize: 10, color: "#fff", background: "rgba(0,0,0,0.55)", borderRadius: 6, padding: "3px 8px", fontWeight: 600, whiteSpace: "nowrap" }}>No Data</span>
                  </div>
                )}
              </div>
            </div>
          ) : (
            <>
              {/* Glowing circular gauge */}
              <div className="aqi-hero-gauge-wrap" style={isStale ? { position: "relative" } : undefined}>
                <div
                  className="aqi-hero-gauge"
                  style={{
                    "--gauge-color": isStale ? "#9ca3af" : band.color,
                    "--gauge-glow": isStale ? "rgba(156,163,175,0.3)" : hexToRgba(band.color, 0.5),
                    ...(isStale ? { filter: "grayscale(0.8)", opacity: 0.5 } : {}),
                  }}
                >
                  <span className="aqi-hero-face aqi-face-bounce">{isStale ? "—" : band.face}</span>
                  <span className="aqi-hero-value">{isStale ? "—" : (roundedVal ?? "—")}</span>
                  <span className="aqi-hero-unit">{isStale ? "" : "µg/Ncm"}</span>
                </div>
                {/* Pulsing ring */}
                {!isStale && sevIdx >= 1 && <div className="aqi-hero-pulse-ring" />}
                {isStale && (
                  <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", pointerEvents: "none", zIndex: 2 }}>
                    <span style={{ fontSize: 11, color: "#fff", background: "rgba(0,0,0,0.55)", borderRadius: 8, padding: "4px 12px", fontWeight: 600, whiteSpace: "nowrap", textAlign: "center", lineHeight: 1.3 }}>No latest data<br/>available</span>
                  </div>
                )}
              </div>

              {/* Status label */}
              <Tag color={isStale ? "#9ca3af" : band.color} className="aqi-hero-status-tag aqi-hero-status-tag--lg">{isStale ? "No Data" : band.name}</Tag>
            </>
          )}
          {aqiRefreshing && <Spin size="small" className="aqi-hero-spinner" />}
        </div>

        {/* RIGHT: Station & Weather */}
        <div className="aqi-hero-right">
          {/* Station info */}
          {!hideWeather && (
          <div className="aqi-hero-station-block">
            <div className="aqi-hero-station-name">
              <TbMapPin size={18} style={{ flexShrink: 0 }} />
              <span>{stationName || "Station"}</span>
            </div>
            {stationAddress && (
              <div className="aqi-hero-station-addr">{stationAddress}</div>
            )}
          </div>
          )}

          {/* Weather panel (glass effect) */}
          {!hideWeather && (
          <div className="aqi-hero-weather-glass">
            {weatherLoading ? (
              <Skeleton.Input active style={{ width: 200, height: 32 }} />
            ) : weatherError ? (
              <div style={{ fontSize: 12, opacity: 0.7 }}>Weather unavailable</div>
            ) : (
              <>
                <div className="aqi-hero-wx-top">
                  <div className={`aqi-hero-wx-icon ${weatherIconData(weatherCode, 48).animClass}`}>
                    {weatherIconData(weatherCode, 48).icon}
                  </div>
                  <div className="aqi-hero-wx-temp-block">
                    <span className="aqi-hero-wx-temp">
                      {temperature != null ? `${Math.round(temperature)}°` : "—"}
                    </span>
                    <span className="aqi-hero-wx-condition">
                      {weatherLabel(weatherCode)}
                    </span>
                  </div>
                </div>
                <div className="aqi-hero-wx-grid">
                  <Tooltip title="Humidity">
                    <div className="aqi-hero-wx-stat">
                      <WiHumidity size={22} />
                      <span>{humidity != null ? `${Math.round(humidity)}%` : "—"}</span>
                    </div>
                  </Tooltip>
                  <Tooltip title="Atmospheric Pressure">
                    <div className="aqi-hero-wx-stat">
                      <WiBarometer size={22} />
                      <span>{pressure != null ? `${Math.round(pressure)} hPa` : "—"}</span>
                    </div>
                  </Tooltip>
                  <Tooltip title="Wind Speed">
                    <div className="aqi-hero-wx-stat">
                      <WiStrongWind size={22} />
                      <span>{windSpeed != null ? `${Math.round(windSpeed)} km/h` : "—"}</span>
                    </div>
                  </Tooltip>
                  {windDirection != null && (
                    <Tooltip title="Wind Direction">
                      <div className="aqi-hero-wx-stat">
                        <WiWindDeg size={22} style={{ transform: `rotate(${windDirection}deg)` }} />
                        <span>{Math.round(windDirection)}°</span>
                      </div>
                    </Tooltip>
                  )}
                  {apparentTemperature != null && (
                    <Tooltip title="Feels Like">
                      <div className="aqi-hero-wx-stat">
                        <WiHot size={22} />
                        <span>{Math.round(apparentTemperature)}°</span>
                      </div>
                    </Tooltip>
                  )}
                  {cloudCover != null && (
                    <Tooltip title="Cloud Cover">
                      <div className="aqi-hero-wx-stat">
                        <WiCloud size={22} />
                        <span>{Math.round(cloudCover)}%</span>
                      </div>
                    </Tooltip>
                  )}
                </div>
              </>
            )}
          </div>
          )}

          {/* Updated time */}
          {aqiTime && (
            <div className="aqi-hero-time">
              <TbClock size={13} />
              <span>Updated {new Date(aqiTime).toLocaleString()}</span>
            </div>
          )}

          {/* Fallback source notice – just the badge/pulse, no text */}

          {/* AQI Category Meter below Updated */}
          {!aqiLoading && !aqiError && roundedVal != null && !isStale && (
            <div className="aqi-hero-meter-wrap">
              <AqiCategoryMeter
                value={roundedVal}
                category={band.name}
                loading={false}
                label={pollutantLabel}
                value2={hasDual && !aqiLoading2 && roundedVal2 != null && !isStale2 ? roundedVal2 : undefined}
                label2={hasDual && !isStale2 ? pollutantLabel2 : undefined}
              />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
