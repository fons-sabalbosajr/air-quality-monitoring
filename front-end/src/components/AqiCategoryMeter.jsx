import { useMemo } from "react";
import { Tag, Tooltip } from "antd";

/* ── AQI Category bands (Philippine NAAQGV breakpoints) ────────── */
const BANDS = [
  {
    name: "Good",
    min: 0,
    max: 50,
    color: "#34d399",
    desc: "Air quality is satisfactory; little or no health risk.",
  },
  {
    name: "Fair",
    min: 51,
    max: 100,
    color: "#fbbf24",
    desc: "Air quality is acceptable; moderate health concern for sensitive individuals.",
  },
  {
    name: "Unhealthy for Sensitive Groups",
    min: 101,
    max: 150,
    color: "#fb923c",
    desc: "Members of sensitive groups may experience health effects; general public is less likely to be affected.",
  },
  {
    name: "Very Unhealthy",
    min: 151,
    max: 200,
    color: "#f87171",
    desc: "Health alert — everyone may begin to experience health effects.",
  },
  {
    name: "Acutely Unhealthy",
    min: 201,
    max: 300,
    color: "#a78bfa",
    desc: "Health warning of emergency conditions; entire population is likely to be affected.",
  },
  {
    name: "Emergency",
    min: 301,
    max: 500,
    color: "#fb7185",
    desc: "Serious health effects for everyone; emergency conditions.",
  },
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
/** Helper: compute pointer info for a given value */
function usePointerInfo(value) {
  const numericVal = value != null ? Number(value) : null;
  const clamped =
    numericVal != null && isFinite(numericVal)
      ? Math.max(0, Math.min(numericVal, TOTAL_MAX))
      : null;
  const pct = clamped != null ? (clamped / TOTAL_MAX) * 100 : null;
  const activeBand = useMemo(() => {
    if (clamped == null) return null;
    return (
      BANDS.find((b) => clamped >= b.min && clamped <= b.max) ||
      BANDS[BANDS.length - 1]
    );
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
      <div className="aqi-meter-bar-wrap">
        <div className="aqi-meter-bar">
          {BANDS.map((band) => {
            const width = ((band.max - band.min + 1) / TOTAL_MAX) * 100;
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

        {/* Primary pointer (PM10 – value ABOVE the line) */}
        {p1.pct != null && (
          <div
            className={`aqi-meter-pointer${hasDual ? " aqi-meter-pointer--above" : ""}`}
            style={{ left: `${p1.pct}%` }}
          >
            {hasDual && (
              <div
                className="aqi-meter-pointer-value aqi-meter-pointer-value--top"
                style={{
                  background: p1.activeBand?.color || "#64748b",
                  color: "#fff",
                }}
              >
                {Math.round(p1.numericVal)}
              </div>
            )}
            <div
              className="aqi-meter-pointer-line"
              style={{ background: p1.activeBand?.color || "#fff" }}
            />
            {!hasDual && (
              <div
                className="aqi-meter-pointer-value"
                style={{
                  background: p1.activeBand?.color || "#64748b",
                  color: "#fff",
                }}
              >
                {Math.round(p1.numericVal)}
              </div>
            )}
          </div>
        )}

        {/* Secondary pointer (PM2.5 – value BELOW the line) */}
        {hasDual && p2.pct != null && (
          <div
            className="aqi-meter-pointer aqi-meter-pointer--below"
            style={{ left: `${p2.pct}%` }}
          >
            <div
              className="aqi-meter-pointer-line"
              style={{ background: p2.activeBand?.color || "#fff" }}
            />
            <div
              className="aqi-meter-pointer-value"
              style={{
                background: p2.activeBand?.color || "#64748b",
                color: "#fff",
              }}
            >
              {Math.round(p2.numericVal)}
            </div>
          </div>
        )}
      </div>

      {/* Band labels underneath */}
      <div className="aqi-meter-labels">
        {BANDS.map((band) => {
          const width = ((band.max - band.min + 1) / TOTAL_MAX) * 100;
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
