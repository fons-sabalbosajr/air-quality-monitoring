import { useMemo } from "react";

/* ── AQI Category bands (Philippine NAAQGV breakpoints) ────────── */
const BANDS = [
  { name: "Good",                           min: 0,   max: 50,  color: "#34d399" },
  { name: "Fair",                           min: 51,  max: 100, color: "#fbbf24" },
  { name: "Unhealthy for Sensitive Groups", min: 101, max: 150, color: "#fb923c" },
  { name: "Very Unhealthy",                 min: 151, max: 200, color: "#f87171" },
  { name: "Acutely Unhealthy",              min: 201, max: 300, color: "#a78bfa" },
  { name: "Emergency",                      min: 301, max: 500, color: "#fb7185" },
];

const TOTAL_MAX = 500;

/**
 * AqiCategoryMeter – a horizontal bar showing all AQI categories
 * with a pointer/marker indicating the current reading.
 *
 * Props:
 *   value     – numeric AQI value (nullable)
 *   category  – string label (optional, derived from value if omitted)
 *   loading   – boolean
 */
export default function AqiCategoryMeter({ value, category, loading, label }) {
  const numericVal = value != null ? Number(value) : null;
  const clamped = numericVal != null && isFinite(numericVal)
    ? Math.max(0, Math.min(numericVal, TOTAL_MAX))
    : null;

  // Pointer position as percentage
  const pct = clamped != null ? (clamped / TOTAL_MAX) * 100 : null;

  // Active band
  const activeBand = useMemo(() => {
    if (clamped == null) return null;
    return BANDS.find((b) => clamped >= b.min && clamped <= b.max) || BANDS[BANDS.length - 1];
  }, [clamped]);

  return (
    <div className="aqi-meter-container">
      <div className="aqi-meter-title">
        <span className="aqi-meter-label">{label ? `AQI Category (${label})` : "AQI Category"}</span>
        {activeBand && (
          <span className="aqi-meter-active-band" style={{ color: activeBand.color }}>
            {activeBand.name}
          </span>
        )}
      </div>

      {/* Meter bar */}
      <div className="aqi-meter-bar-wrap">
        <div className="aqi-meter-bar">
          {BANDS.map((band) => {
            const width = ((band.max - band.min + 1) / TOTAL_MAX) * 100;
            const isActive = activeBand && band.name === activeBand.name;
            return (
              <div
                key={band.name}
                className={`aqi-meter-segment${isActive ? " aqi-meter-segment--active" : ""}`}
                style={{
                  width: `${width}%`,
                  background: band.color,
                  opacity: isActive ? 1 : 0.4,
                }}
                title={`${band.name} (${band.min}–${band.max})`}
              />
            );
          })}
        </div>

        {/* Pointer / marker */}
        {pct != null && (
          <div
            className="aqi-meter-pointer"
            style={{ left: `${pct}%` }}
          >
            <div className="aqi-meter-pointer-line" style={{ background: activeBand?.color || "#fff" }} />
            <div
              className="aqi-meter-pointer-value"
              style={{
                background: activeBand?.color || "#64748b",
                color: "#fff",
              }}
            >
              {Math.round(numericVal)}
            </div>
          </div>
        )}
      </div>

      {/* Band labels underneath */}
      <div className="aqi-meter-labels">
        {BANDS.map((band) => {
          const width = ((band.max - band.min + 1) / TOTAL_MAX) * 100;
          return (
            <div key={band.name} className="aqi-meter-band-label" style={{ width: `${width}%` }}>
              <span className="aqi-meter-range">{band.min}–{band.max}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
