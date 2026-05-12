import { useMemo } from "react";
import { Tag, Tooltip } from "antd";
import { AQI_COLORS } from "../utils/aqiPalette";
import "./AqiCategoryMeter.css";

/* ── AQI Category bands (Philippine NAAQGV breakpoints) ────────── */
const BANDS = [
  {
    name: "Good",
    min: 0,
    max: 50,
    color: AQI_COLORS.good,
    desc: "Air quality is satisfactory; little or no health risk.",
  },
  {
    name: "Fair",
    min: 51,
    max: 100,
    color: AQI_COLORS.fair,
    desc: "Air quality is acceptable; moderate health concern for sensitive individuals.",
  },
  {
    name: "Unhealthy for Sensitive Groups",
    min: 101,
    max: 150,
    color: AQI_COLORS.usg,
    desc: "Members of sensitive groups may experience health effects; general public is less likely to be affected.",
  },
  {
    name: "Very Unhealthy",
    min: 151,
    max: 200,
    color: AQI_COLORS.vu,
    desc: "Health alert — everyone may begin to experience health effects.",
  },
  {
    name: "Acutely Unhealthy",
    min: 201,
    max: 300,
    color: AQI_COLORS.au,
    desc: "Health warning of emergency conditions; entire population is likely to be affected.",
  },
  {
    name: "Emergency",
    min: 301,
    max: 500,
    color: AQI_COLORS.emergency,
    desc: "Serious health effects for everyone; emergency conditions.",
  },
];

const TOTAL_MAX = 500;

/* Pre-compute each band's proportional width (%) and cumulative start (%) */
const BAND_WIDTHS = BANDS.map(
  (b) => ((b.max - b.min + 1) / (TOTAL_MAX + 1)) * 100
);
const BAND_STARTS = BAND_WIDTHS.reduce(
  (acc, w, i) => { acc.push(i === 0 ? 0 : acc[i - 1] + BAND_WIDTHS[i - 1]); return acc; },
  []
);

/**
 * AqiCategoryMeter – a horizontal bar showing all AQI categories
 * with a pointer/marker indicating the current reading.
 *
 * Props:
 *   value     – numeric AQI value (nullable)
 *   category  – string label (optional, derived from value if omitted)
 *   loading   – boolean
 */
/** Helper: compute pointer info for a given value.
 *  Uses band-relative mapping so the pointer sits correctly within
 *  each band’s proportional visual width.
 */
function usePointerInfo(value) {
  const numericVal = value != null ? Number(value) : null;
  const clamped =
    numericVal != null && isFinite(numericVal)
      ? Math.max(0, Math.min(numericVal, TOTAL_MAX))
      : null;

  const activeBand = useMemo(() => {
    if (clamped == null) return null;
    return (
      BANDS.find((b) => clamped >= b.min && clamped <= b.max) ||
      BANDS[BANDS.length - 1]
    );
  }, [clamped]);

  // Band-relative percentage using proportional widths
  const pct = useMemo(() => {
    if (clamped == null) return null;
    const bandIdx = BANDS.findIndex((b) => clamped >= b.min && clamped <= b.max);
    const idx = bandIdx >= 0 ? bandIdx : BANDS.length - 1;
    const band = BANDS[idx];
    const ratio = (clamped - band.min) / (band.max - band.min + 1);
    return BAND_STARTS[idx] + ratio * BAND_WIDTHS[idx];
  }, [clamped]);

  return { numericVal, clamped, pct, activeBand };
}

/**
 * AqiCategoryMeter – a horizontal bar showing all AQI categories
 * with pointer(s) indicating the current reading.
 *
 * Props:
 *   value      – numeric AQI value (nullable)
 *   category   – string label (optional)
 *   loading    – boolean
 *   label      – string, e.g. "PM10"
 *   value2     – optional second AQI value (for merged dual display)
 *   label2     – optional second label, e.g. "PM2.5"
 */
export default function AqiCategoryMeter({
  value,
  category,
  loading,
  label,
  value2,
  label2,
}) {
  const p1 = usePointerInfo(value);
  const p2 = usePointerInfo(value2);
  const hasDual = value2 != null && label2 != null;

  // Determine which bands are active (highlight both if dual)
  const activeBandNames = useMemo(() => {
    const names = new Set();
    if (p1.activeBand) names.add(p1.activeBand.name);
    if (hasDual && p2.activeBand) names.add(p2.activeBand.name);
    return names;
  }, [p1.activeBand, p2.activeBand, hasDual]);

  const titleLabel = hasDual
    ? `AQI Category (${label} / ${label2})`
    : label
      ? `AQI Category (${label})`
      : "AQI Category";

  return (
    <div className="aqi-meter-container">
      <div className="aqi-meter-title">
        <span className="aqi-meter-label">{titleLabel}</span>
        {hasDual ? (
          <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
            {p1.activeBand && (
              <Tag
                color={p1.activeBand.color}
                style={{ fontSize: 11, fontWeight: 600, margin: 0 }}
              >
                {label}: {p1.activeBand.name}
              </Tag>
            )}
            {p2.activeBand && (
              <Tag
                color={p2.activeBand.color}
                style={{ fontSize: 11, fontWeight: 600, margin: 0 }}
              >
                {label2}: {p2.activeBand.name}
              </Tag>
            )}
          </div>
        ) : (
          p1.activeBand && (
            <Tag
              color={p1.activeBand.color}
              style={{ fontSize: 12, fontWeight: 600, margin: 0 }}
            >
              {p1.activeBand.name}
            </Tag>
          )
        )}
      </div>

      {/* Meter bar */}
      <div className={`aqi-meter-bar-wrap${hasDual ? " aqi-meter-bar-wrap--dual" : ""}`}>
        <div className="aqi-meter-bar">
          {BANDS.map((band, i) => {
            const width = BAND_WIDTHS[i];
            const isActive = activeBandNames.has(band.name);
            return (
              <Tooltip
                key={band.name}
                title={
                  <>
                    <strong>
                      {band.name} ({band.min}–{band.max})
                    </strong>
                    <br />
                    {band.desc}
                  </>
                }
              >
                <div
                  className={`aqi-meter-segment${isActive ? " aqi-meter-segment--active" : ""}`}
                  style={{
                    width: `${width}%`,
                    background: band.color,
                    opacity: isActive ? 1 : 0.4,
                    cursor: "help",
                  }}
                />
              </Tooltip>
            );
          })}
        </div>

        {/* Primary pointer (PM10 – above in dual, below in single) */}
        {p1.pct != null && (
          <div
            className={`aqi-meter-pointer${hasDual ? " aqi-meter-pointer--above" : ""}`}
            style={{
              left: `${p1.pct}%`,
              "--_badge-bg": p1.activeBand?.color || "#64748b",
            }}
          >
            <div
              className={`aqi-meter-pointer-value${hasDual ? " aqi-meter-pointer-value--top" : ""}`}
              style={{
                background: p1.activeBand?.color || "#64748b",
                color: "#fff",
              }}
            >
              {hasDual && <span className="aqi-meter-pointer-label">{label}</span>}
              <span className="aqi-meter-pointer-number">{Math.round(p1.numericVal)}</span>
            </div>
          </div>
        )}

        {/* Secondary pointer (PM2.5 – below in dual) */}
        {hasDual && p2.pct != null && (
          <div
            className={`aqi-meter-pointer aqi-meter-pointer--below${p1.pct == null ? " aqi-meter-pointer--below-solo" : ""}`}
            style={{
              left: `${p2.pct}%`,
              "--_badge-bg": p2.activeBand?.color || "#64748b",
            }}
          >
            <div
              className="aqi-meter-pointer-value"
              style={{
                background: p2.activeBand?.color || "#64748b",
                color: "#fff",
              }}
            >
              <span className="aqi-meter-pointer-label">{label2}</span>
              <span className="aqi-meter-pointer-number">{Math.round(p2.numericVal)}</span>
            </div>
          </div>
        )}
      </div>

      {/* Band labels underneath */}
      <div className="aqi-meter-labels">
        {BANDS.map((band, i) => {
          const width = BAND_WIDTHS[i];
          return (
            <div
              key={band.name}
              className="aqi-meter-band-label"
              style={{ width: `${width}%` }}
            >
              <Tooltip
                title={
                  <>
                    <strong>{band.name}</strong>
                    <br />
                    {band.desc}
                  </>
                }
              >
                <Tag
                  color={band.color}
                  style={{
                    fontSize: 9,
                    fontWeight: 700,
                    margin: 0,
                    padding: "0 4px",
                    lineHeight: "16px",
                    borderRadius: 4,
                    cursor: "help",
                  }}
                >
                  {band.min}–{band.max}
                </Tag>
              </Tooltip>
            </div>
          );
        })}
      </div>
    </div>
  );
}
