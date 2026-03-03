import { useEffect, useState, useCallback } from "react";
import { Spin, Tooltip, Skeleton, Popover } from "antd";
import { GiMolecule, GiGasMask } from "react-icons/gi";
import { TbAtom2Filled, TbInfoCircle } from "react-icons/tb";
import { WiSmoke } from "react-icons/wi";
import { MdOutlineAir } from "react-icons/md";

/**
 * Open-Meteo Air Quality API (free, no key required, CORS-friendly).
 * Returns CO, O3, NO2, SO2 and more pollutants.
 */

const POLLUTANTS = [
  {
    key: "carbon_monoxide",
    label: "Carbon Monoxide",
    short: "CO",
    unit: "µg/m³",
    icon: <WiSmoke size={30} />,
    color: "#8b5cf6",
    gradient: "linear-gradient(135deg, #8b5cf620, #8b5cf608)",
    info: {
      what: "A colorless, odorless gas produced by incomplete combustion of fossil fuels, biomass, and organic matter.",
      sources: "Vehicle exhaust, industrial processes, cooking stoves, wildfires, and tobacco smoke.",
      health: "Reduces oxygen delivery to organs. High exposure can cause headaches, dizziness, confusion, and at extreme levels can be fatal.",
      guideline: "WHO 24-hr guideline: 4 mg/m³ (4,000 µg/m³).",
    },
    thresholds: [
      { max: 4400, label: "Good", color: "#34d399", bg: "#34d39915" },
      { max: 9400, label: "Fair", color: "#fbbf24", bg: "#fbbf2415" },
      { max: 12400, label: "Unhealthy (SG)", color: "#fb923c", bg: "#fb923c15" },
      { max: 15400, label: "Unhealthy", color: "#f87171", bg: "#f8717115" },
      { max: 30400, label: "Very Unhealthy", color: "#a78bfa", bg: "#a78bfa15" },
      { max: Infinity, label: "Hazardous", color: "#fb7185", bg: "#fb718515" },
    ],
  },
  {
    key: "ozone",
    label: "Ozone",
    short: "O₃",
    unit: "µg/m³",
    icon: <MdOutlineAir size={28} />,
    color: "#0ea5e9",
    gradient: "linear-gradient(135deg, #0ea5e920, #0ea5e908)",
    info: {
      what: "A reactive gas formed when sunlight triggers chemical reactions between nitrogen oxides (NOₓ) and volatile organic compounds (VOCs).",
      sources: "Not emitted directly — formed from vehicle emissions, industrial pollutants, and chemical solvents reacting with sunlight.",
      health: "Irritates airways, worsens asthma and chronic lung diseases, reduces lung function. Long-term exposure linked to respiratory mortality.",
      guideline: "WHO 8-hr guideline: 100 µg/m³.",
    },
    thresholds: [
      { max: 54, label: "Good", color: "#34d399", bg: "#34d39915" },
      { max: 100, label: "Fair", color: "#fbbf24", bg: "#fbbf2415" },
      { max: 164, label: "Unhealthy (SG)", color: "#fb923c", bg: "#fb923c15" },
      { max: 204, label: "Unhealthy", color: "#f87171", bg: "#f8717115" },
      { max: 404, label: "Very Unhealthy", color: "#a78bfa", bg: "#a78bfa15" },
      { max: Infinity, label: "Hazardous", color: "#fb7185", bg: "#fb718515" },
    ],
  },
  {
    key: "nitrogen_dioxide",
    label: "Nitrogen Dioxide",
    short: "NO₂",
    unit: "µg/m³",
    icon: <TbAtom2Filled size={26} />,
    color: "#f97316",
    gradient: "linear-gradient(135deg, #f9731620, #f9731608)",
    info: {
      what: "A reddish-brown gas with a pungent odor, a major component of urban air pollution.",
      sources: "Motor vehicle exhaust, power plants, industrial boilers, and off-road equipment combustion.",
      health: "Inflames airways, aggravates asthma and bronchitis. Prolonged exposure increases susceptibility to respiratory infections.",
      guideline: "WHO 24-hr guideline: 25 µg/m³.",
    },
    thresholds: [
      { max: 40, label: "Good", color: "#34d399", bg: "#34d39915" },
      { max: 70, label: "Fair", color: "#fbbf24", bg: "#fbbf2415" },
      { max: 150, label: "Unhealthy (SG)", color: "#fb923c", bg: "#fb923c15" },
      { max: 200, label: "Unhealthy", color: "#f87171", bg: "#f8717115" },
      { max: 400, label: "Very Unhealthy", color: "#a78bfa", bg: "#a78bfa15" },
      { max: Infinity, label: "Hazardous", color: "#fb7185", bg: "#fb718515" },
    ],
  },
  {
    key: "sulphur_dioxide",
    label: "Sulfur Dioxide",
    short: "SO₂",
    unit: "µg/m³",
    icon: <GiMolecule size={26} />,
    color: "#ef4444",
    gradient: "linear-gradient(135deg, #ef444420, #ef444408)",
    info: {
      what: "A colorless gas with a sharp, irritating smell produced by burning sulfur-containing fuels.",
      sources: "Coal and oil-fired power plants, metal smelting, petroleum refining, and volcanic activity.",
      health: "Irritates the nose, throat, and airways. Worsens asthma and can cause difficulty breathing, especially during physical activity.",
      guideline: "WHO 24-hr guideline: 40 µg/m³.",
    },
    thresholds: [
      { max: 20, label: "Good", color: "#34d399", bg: "#34d39915" },
      { max: 80, label: "Fair", color: "#fbbf24", bg: "#fbbf2415" },
      { max: 250, label: "Unhealthy (SG)", color: "#fb923c", bg: "#fb923c15" },
      { max: 350, label: "Unhealthy", color: "#f87171", bg: "#f8717115" },
      { max: 500, label: "Very Unhealthy", color: "#a78bfa", bg: "#a78bfa15" },
      { max: Infinity, label: "Hazardous", color: "#fb7185", bg: "#fb718515" },
    ],
  },
];

function classify(pollutant, value) {
  if (value == null || !isFinite(value)) return { label: "—", color: "var(--aqm-muted)", bg: "transparent" };
  const t = pollutant.thresholds.find((th) => value <= th.max);
  return t || { label: "—", color: "var(--aqm-muted)", bg: "transparent" };
}

/* Simple progress bar width based on threshold position */
function getProgress(pollutant, value) {
  if (value == null || !isFinite(value)) return 0;
  const ths = pollutant.thresholds;
  const maxVal = ths[ths.length - 2]?.max || 500;
  return Math.min(100, Math.max(2, (value / maxVal) * 100));
}

export default function PollutantsCard({ latitude, longitude }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const fetchData = useCallback(async () => {
    if (!latitude || !longitude) {
      setError("Station coordinates unavailable");
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({
        latitude: String(latitude),
        longitude: String(longitude),
        current: "carbon_monoxide,ozone,nitrogen_dioxide,sulphur_dioxide,pm10,pm2_5,us_aqi",
        timezone: "auto",
      });
      const res = await fetch(`https://air-quality-api.open-meteo.com/v1/air-quality?${params}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      setData(json.current || json.current_weather || null);
    } catch (e) {
      setError(e.message || "Failed to fetch air quality data");
    } finally {
      setLoading(false);
    }
  }, [latitude, longitude]);

  useEffect(() => {
    fetchData();
    const iv = setInterval(fetchData, 600_000);
    return () => clearInterval(iv);
  }, [fetchData]);

  return (
    <div className="pollutants-section">
      <div className="section-header">
        <div className="section-header-icon">
          <GiGasMask size={22} />
        </div>
        <div>
          <h3 className="section-title">Major Air Pollutants</h3>
          <p className="section-subtitle">Real-time pollutant concentrations from Open-Meteo</p>
        </div>
      </div>

      {loading ? (
        <div className="pollutants-grid">
          {POLLUTANTS.map((p) => (
            <div key={p.key} className="pollutant-card-skeleton">
              <Skeleton active paragraph={{ rows: 2 }} title={false} />
            </div>
          ))}
        </div>
      ) : error ? (
        <div className="pollutants-error">{error}</div>
      ) : (
        <div className="pollutants-grid">
          {POLLUTANTS.map((p) => {
            const val = data?.[p.key];
            const cls = classify(p, val);
            const progress = getProgress(p, val);
            return (
              <Tooltip
                key={p.key}
                title={
                  <div>
                    <div style={{ fontWeight: 600 }}>{p.label} ({p.short})</div>
                    <div>{val != null ? `${val.toFixed(1)} ${p.unit}` : "—"}</div>
                    <div style={{ color: cls.color, fontWeight: 500 }}>{cls.label}</div>
                  </div>
                }
              >
                <div className="pollutant-card">
                  <div className="pollutant-card-header">
                    <div className="pollutant-icon-circle" style={{ color: p.color, background: `${p.color}15` }}>
                      {p.icon}
                    </div>
                    <div className="pollutant-name-group">
                      <span className="pollutant-short">{p.short}</span>
                      <span className="pollutant-label">{p.label}</span>
                    </div>
                    {p.info && (
                      <Popover
                        title={
                          <span style={{ fontWeight: 700, fontSize: 14 }}>
                            {p.label} ({p.short})
                          </span>
                        }
                        content={
                          <div className="pollutant-info-popover">
                            <div className="pollutant-info-row">
                              <span className="pollutant-info-heading">What is it?</span>
                              <span>{p.info.what}</span>
                            </div>
                            <div className="pollutant-info-row">
                              <span className="pollutant-info-heading">Sources</span>
                              <span>{p.info.sources}</span>
                            </div>
                            <div className="pollutant-info-row">
                              <span className="pollutant-info-heading">Health Effects</span>
                              <span>{p.info.health}</span>
                            </div>
                            <div className="pollutant-info-row">
                              <span className="pollutant-info-heading">Guideline</span>
                              <span>{p.info.guideline}</span>
                            </div>
                          </div>
                        }
                        trigger="click"
                        placement="topRight"
                        overlayStyle={{ maxWidth: 340 }}
                      >
                        <button
                          className="pollutant-info-btn"
                          style={{ color: p.color }}
                          onClick={(e) => e.stopPropagation()}
                          aria-label={`Info about ${p.label}`}
                        >
                          <TbInfoCircle size={16} />
                        </button>
                      </Popover>
                    )}
                  </div>
                  <div className="pollutant-card-body">
                    <div className="pollutant-value-row">
                      <span className="pollutant-big-value" style={{ color: cls.color?.startsWith("var") ? undefined : cls.color }}>
                        {val != null ? val.toFixed(1) : "—"}
                      </span>
                      <span className="pollutant-unit-label">{p.unit}</span>
                    </div>
                    {/* Progress bar */}
                    <div className="pollutant-progress-track">
                      <div
                        className="pollutant-progress-fill"
                        style={{
                          width: `${progress}%`,
                          background: cls.color?.startsWith("var") ? "#888" : cls.color,
                        }}
                      />
                    </div>
                    <div className="pollutant-status-tag" style={{
                      color: cls.color?.startsWith("var") ? undefined : cls.color,
                      background: cls.bg || "transparent",
                    }}>
                      {cls.label}
                    </div>
                  </div>
                </div>
              </Tooltip>
            );
          })}
        </div>
      )}
    </div>
  );
}
