import { useState, useMemo, useCallback } from "react";
import { Select, Tooltip, Button, Dropdown, message, Modal, Table, Tag } from "antd";
import dayjs from "dayjs";
import { TbCalendar, TbDownload, TbFileTypeCsv, TbChevronLeft, TbChevronRight } from "react-icons/tb";
import STATIONS, { getMergedStations } from "../config/stations";

/* ── AQI colour bands ─────────────────────────────────────────────── */
const BANDS = [
  { name: "Good",                          min: 0,   max: 50,  color: "#34d399", bg: "#d1fae5" },
  { name: "Fair",                          min: 51,  max: 100, color: "#fbbf24", bg: "#fef3c7" },
  { name: "Unhealthy for Sensitive Groups", min: 101, max: 150, color: "#fb923c", bg: "#ffedd5" },
  { name: "Very Unhealthy",               min: 151, max: 200, color: "#f87171", bg: "#fee2e2" },
  { name: "Acutely Unhealthy",            min: 201, max: 300, color: "#a78bfa", bg: "#ede9fe" },
  { name: "Emergency",                    min: 301, max: 999, color: "#fb7185", bg: "#fce7f3" },
];

function getBand(val) {
  const n = Number(val);
  if (!isFinite(n) || n < 0) return null;
  return BANDS.find((b) => n >= b.min && n <= b.max) || BANDS[BANDS.length - 1];
}

/* Short status label for tile display */
function shortStatus(status) {
  if (!status) return null;
  const s = status.toLowerCase();
  if (s.includes("good")) return "Good";
  if (s.includes("fair")) return "Fair";
  if (s.includes("sensitive")) return "USG";
  if (s.includes("very")) return "V.Unh.";
  if (s.includes("acutely")) return "Acute";
  if (s.includes("emergency")) return "Emerg.";
  if (s.includes("unhealthy")) return "Unhlthy";
  return status.length > 7 ? status.slice(0, 6) + "." : status;
}

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/**
 * Air Quality Calendar – renders a month grid showing daily average AQI
 * coloured by category, similar to aqi.in calendar.
 *
 * @param {Array} data - Array of { t, y, conc, status } (daily data)
 * @param {number} year - Year to display
 */
export default function AqiCalendar({
  data = [],
  loading,
  error,
  year: yearProp,
  stationFilter,
  onStationChange,
  stations = [],
  rawRows = [],
  dateCol = null,
  label,
  data2,
  rawRows2,
  dateCol2,
  label2,
}) {
  const currentYear = dayjs().year();
  const [year, setYear] = useState(yearProp || currentYear);
  const [selectedMonth, setSelectedMonth] = useState(dayjs().month());
  const [selectedDay, setSelectedDay] = useState(null);
  const [dayStatusFilter, setDayStatusFilter] = useState("all"); // 0-indexed

  const hasDual = Array.isArray(data2) && data2.length > 0;

  // Build a lookup: "YYYY-MM-DD" -> { aqi, conc, status, count }
  const lookup = useMemo(() => {
    const map = {};
    if (!Array.isArray(data)) return map;
    for (const row of data) {
      try {
        const d = dayjs(row.t);
        const key = d.format("YYYY-MM-DD");
        const v = Number(row.y);
        if (isFinite(v)) {
          if (!map[key]) map[key] = { sum: 0, count: 0, concSum: 0, concCount: 0, status: null };
          map[key].sum += v;
          map[key].count += 1;
          // Keep the latest status for the day
          if (row.status) map[key].status = row.status;
          // Accumulate concentration
          if (row.conc != null && isFinite(row.conc)) {
            map[key].concSum += row.conc;
            map[key].concCount += 1;
          }
        }
      } catch {}
    }
    // Compute averages
    const result = {};
    for (const [k, v] of Object.entries(map)) {
      result[k] = {
        aqi: Math.round(v.sum / v.count),
        conc: v.concCount > 0 ? Math.round(v.concSum / v.concCount) : null,
        status: v.status,
        readings: v.count,
      };
    }
    return result;
  }, [data]);

  // Secondary lookup for data2 (PM2.5)
  const lookup2 = useMemo(() => {
    if (!hasDual) return {};
    const map = {};
    for (const row of data2) {
      try {
        const d = dayjs(row.t);
        const key = d.format("YYYY-MM-DD");
        const v = Number(row.y);
        if (isFinite(v)) {
          if (!map[key]) map[key] = { sum: 0, count: 0, concSum: 0, concCount: 0, status: null };
          map[key].sum += v;
          map[key].count += 1;
          if (row.status) map[key].status = row.status;
          if (row.conc != null && isFinite(row.conc)) {
            map[key].concSum += row.conc;
            map[key].concCount += 1;
          }
        }
      } catch {}
    }
    const result = {};
    for (const [k, v] of Object.entries(map)) {
      result[k] = {
        aqi: Math.round(v.sum / v.count),
        conc: v.concCount > 0 ? Math.round(v.concSum / v.concCount) : null,
        status: v.status,
        readings: v.count,
      };
    }
    return result;
  }, [data2, hasDual]);

  // Month navigation
  const goPrevMonth = useCallback(() => {
    if (selectedMonth === 0) {
      setSelectedMonth(11);
      setYear((y) => y - 1);
    } else {
      setSelectedMonth((m) => m - 1);
    }
  }, [selectedMonth]);

  const goNextMonth = useCallback(() => {
    if (selectedMonth === 11) {
      setSelectedMonth(0);
      setYear((y) => y + 1);
    } else {
      setSelectedMonth((m) => m + 1);
    }
  }, [selectedMonth]);

  // Generate month grid
  const monthGrid = useMemo(() => {
    const firstDay = dayjs().year(year).month(selectedMonth).startOf("month");
    const daysInMonth = firstDay.daysInMonth();
    const startDow = firstDay.day(); // 0=Sun

    const cells = [];
    // Leading empty cells
    for (let i = 0; i < startDow; i++) cells.push({ empty: true, key: `e${i}` });
    // Day cells
    for (let d = 1; d <= daysInMonth; d++) {
      const dateKey = firstDay.date(d).format("YYYY-MM-DD");
      const info = lookup[dateKey] ?? null;
      const info2 = hasDual ? (lookup2[dateKey] ?? null) : null;
      cells.push({ day: d, dateKey, info, info2, key: dateKey });
    }
    return cells;
  }, [year, selectedMonth, lookup, lookup2, hasDual]);

  // Monthly summary stats
  const monthStats = useMemo(() => {
    const firstDay = dayjs().year(year).month(selectedMonth).startOf("month");
    const daysInMonth = firstDay.daysInMonth();
    let totalAqi = 0, aqiCount = 0, maxAqi = 0, minAqi = Infinity;
    let goodDays = 0, fairDays = 0, unhealthyDays = 0;
    for (let d = 1; d <= daysInMonth; d++) {
      const key = firstDay.date(d).format("YYYY-MM-DD");
      const info = lookup[key];
      if (info) {
        totalAqi += info.aqi;
        aqiCount++;
        if (info.aqi > maxAqi) maxAqi = info.aqi;
        if (info.aqi < minAqi) minAqi = info.aqi;
        if (info.aqi <= 50) goodDays++;
        else if (info.aqi <= 100) fairDays++;
        else unhealthyDays++;
      }
    }
    return {
      avgAqi: aqiCount > 0 ? Math.round(totalAqi / aqiCount) : null,
      maxAqi: aqiCount > 0 ? maxAqi : null,
      minAqi: aqiCount > 0 ? minAqi : null,
      daysWithData: aqiCount,
      totalDays: daysInMonth,
      goodDays, fairDays, unhealthyDays,
    };
  }, [year, selectedMonth, lookup]);

  // Export calendar month as CSV
  const exportCalendarCSV = useCallback(() => {
    const firstDay = dayjs().year(year).month(selectedMonth).startOf("month");
    const daysInMonth = firstDay.daysInMonth();
    const rows = [["Date", "AQI", "Concentration", "Status", "Readings"]];
    for (let d = 1; d <= daysInMonth; d++) {
      const dateKey = firstDay.date(d).format("YYYY-MM-DD");
      const info = lookup[dateKey];
      rows.push([
        dateKey,
        info?.aqi ?? "",
        info?.conc ?? "",
        info?.status ?? "",
        info?.readings ?? "",
      ]);
    }
    const csv = rows.map((r) => r.join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `AQI_Calendar_${MONTH_NAMES[selectedMonth]}_${year}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
    message.success("Calendar exported");
  }, [year, selectedMonth, lookup]);

  // Available years
  const yearOptions = useMemo(() => {
    const years = new Set();
    years.add(currentYear);
    if (Array.isArray(data)) {
      for (const row of data) {
        try { years.add(dayjs(row.t).year()); } catch {}
      }
    }
    return [...years].sort((a, b) => b - a).map((y) => ({ label: String(y), value: y }));
  }, [data, currentYear]);

  /* ── Day detail modal data ─────────────────────────────────────── */
  const selectedDayInfo = selectedDay ? lookup[selectedDay] : null;
  const selectedDayBand = selectedDayInfo ? getBand(selectedDayInfo.aqi) : null;

  const rawColumns = useMemo(() => {
    if (!rawRows.length) return [];
    return Object.keys(rawRows[0]);
  }, [rawRows]);

  const dayReadings = useMemo(() => {
    if (!selectedDay || !rawRows?.length || !dateCol) return [];
    const target = dayjs(selectedDay).format("YYYY-MM-DD");
    return rawRows
      .filter((r) => {
        try {
          const rd = dayjs(r[dateCol]);
          return rd.isValid() && rd.format("YYYY-MM-DD") === target;
        } catch { return false; }
      })
      .reverse();
  }, [selectedDay, rawRows, dateCol]);

  const filteredDayReadings = useMemo(() => {
    if (dayStatusFilter === "all") return dayReadings;
    return dayReadings.filter((r) => {
      const st = (r["Status"] ?? r["status"] ?? "").toLowerCase();
      return st.includes(dayStatusFilter.toLowerCase());
    });
  }, [dayReadings, dayStatusFilter]);

  const dayTableColumns = useMemo(() => {
    if (!rawColumns.length) return [];
    return rawColumns.map((col) => ({
      title: col,
      dataIndex: col,
      key: col,
      width: col.toLowerCase().includes("date") || col.toLowerCase().includes("time") ? 180 : 110,
      render: (v) => {
        if (v == null) return "—";
        const cl = col.toLowerCase();
        if (cl === "status") {
          const b = getBand(Number(v)) || null;
          const statusBand = BANDS.find((band) => band.name.toLowerCase() === String(v).toLowerCase());
          const bandColor = statusBand?.color || b?.color || "var(--aqm-text)";
          const bandBg = statusBand?.bg || b?.bg || "transparent";
          return <Tag style={{ fontSize: 11, margin: 0, color: bandColor, borderColor: bandColor, background: bandBg }}>{v}</Tag>;
        }
        // Limit decimals to 2 for numeric columns
        const num = Number(v);
        if (isFinite(num) && String(v).includes(".") && !cl.includes("date") && !cl.includes("time")) {
          return num.toFixed(2);
        }
        return String(v);
      },
    }));
  }, [rawColumns]);

  const dayStatusOptions = useMemo(() => {
    const s = new Set(dayReadings.map((r) => r["Status"] ?? r["status"] ?? "").filter(Boolean));
    return [{ label: "All statuses", value: "all" }, ...[...s].map((v) => ({ label: v, value: v }))];
  }, [dayReadings]);

  const exportDayCSV = useCallback(() => {
    if (!filteredDayReadings.length) return;
    const keys = rawColumns;
    const csvRows = [keys.join(",")];
    for (const r of filteredDayReadings) {
      csvRows.push(keys.map((k) => {
        const v = r[k];
        if (v == null) return "";
        const s = String(v);
        return s.includes(",") ? `"${s}"` : s;
      }).join(","));
    }
    const blob = new Blob([csvRows.join("\n")], { type: "text/csv" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `AQI_Readings_${selectedDay}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
    message.success("Day readings exported as CSV");
  }, [filteredDayReadings, rawColumns, selectedDay]);

  const exportDayJSON = useCallback(() => {
    if (!filteredDayReadings.length) return;
    const blob = new Blob([JSON.stringify(filteredDayReadings, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `AQI_Readings_${selectedDay}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
    message.success("Day readings exported as JSON");
  }, [filteredDayReadings, selectedDay]);

  return (
    <div className="dashboard-section aqi-calendar-section">
      <div className="section-header">
        <div className="section-header-icon">
          <TbCalendar size={22} />
        </div>
        <div>
          <h3 className="section-title">Air Quality Calendar {year}</h3>
          <p className="section-subtitle">Daily AQI averages colored by category</p>
        </div>
        <div className="section-header-actions">
          <Select
            size="small"
            value={year}
            onChange={setYear}
            style={{ width: 80 }}
            options={yearOptions}
          />
          <Select
            size="small"
            value={selectedMonth}
            onChange={setSelectedMonth}
            style={{ width: 120 }}
            options={MONTH_NAMES.map((m, i) => ({ label: m, value: i }))}
          />
          {stations.length > 1 && (
            <Select
              size="small"
              value={stationFilter}
              onChange={onStationChange}
              style={{ width: 200 }}
              popupMatchSelectWidth={false}
              options={stations.map((key) => {
                const merged = getMergedStations();
                const sm = merged.find((st) => st.key === key);
                const s = sm || STATIONS.find((st) => st.key === key);
                return { label: s ? s.name : key, value: key };
              })}
            />
          )}
          <Tooltip title="Export calendar as CSV">
            <Button
              size="small"
              icon={<TbDownload size={14} />}
              onClick={exportCalendarCSV}
              style={{ borderRadius: 8 }}
            />
          </Tooltip>
        </div>
      </div>

      {/* Legend */}
      <div className="aqi-cal-legend">
        {BANDS.map((b) => (
          <span key={b.name} className="aqi-cal-legend-item">
            <span className="aqi-cal-legend-swatch" style={{ background: b.color }} />
            <span className="aqi-cal-legend-label">{b.name}</span>
          </span>
        ))}
        <span className="aqi-cal-legend-item">
          <span className="aqi-cal-legend-swatch" style={{ background: "#e5e7eb" }} />
          <span className="aqi-cal-legend-label">No data</span>
        </span>
      </div>

      {loading ? (
        <div className="section-empty">Loading…</div>
      ) : error ? (
        <div className="section-empty">{error}</div>
      ) : (
        <>
          {/* Month header with navigation arrows */}
          <div className="aqi-cal-month-nav">
            <button className="aqi-cal-nav-btn" onClick={goPrevMonth} aria-label="Previous month">
              <TbChevronLeft size={18} />
            </button>
            <div className="aqi-cal-month-title">
              {MONTH_NAMES[selectedMonth]} {year}
            </div>
            <button className="aqi-cal-nav-btn" onClick={goNextMonth} aria-label="Next month">
              <TbChevronRight size={18} />
            </button>
          </div>

          {/* Monthly summary strip */}
          {monthStats.avgAqi != null && (
            <div className="aqi-cal-summary">
              <div className="aqi-cal-summary-item">
                <span className="aqi-cal-summary-label">Avg AQI</span>
                <span className="aqi-cal-summary-value" style={{ color: getBand(monthStats.avgAqi)?.color }}>
                  {monthStats.avgAqi}
                </span>
              </div>
              <div className="aqi-cal-summary-item">
                <span className="aqi-cal-summary-label">Max</span>
                <span className="aqi-cal-summary-value" style={{ color: getBand(monthStats.maxAqi)?.color }}>
                  {monthStats.maxAqi}
                </span>
              </div>
              <div className="aqi-cal-summary-item">
                <span className="aqi-cal-summary-label">Min</span>
                <span className="aqi-cal-summary-value" style={{ color: getBand(monthStats.minAqi)?.color }}>
                  {monthStats.minAqi}
                </span>
              </div>
              <div className="aqi-cal-summary-item">
                <span className="aqi-cal-summary-label">Good</span>
                <span className="aqi-cal-summary-value" style={{ color: "#34d399" }}>
                  {monthStats.goodDays}d
                </span>
              </div>
              <div className="aqi-cal-summary-item">
                <span className="aqi-cal-summary-label">Fair</span>
                <span className="aqi-cal-summary-value" style={{ color: "#fbbf24" }}>
                  {monthStats.fairDays}d
                </span>
              </div>
              <div className="aqi-cal-summary-item">
                <span className="aqi-cal-summary-label">Unhealthy</span>
                <span className="aqi-cal-summary-value" style={{ color: "#fb923c" }}>
                  {monthStats.unhealthyDays}d
                </span>
              </div>
              <div className="aqi-cal-summary-item">
                <span className="aqi-cal-summary-label">Data</span>
                <span className="aqi-cal-summary-value">
                  {monthStats.daysWithData}/{monthStats.totalDays}
                </span>
              </div>
            </div>
          )}

          {/* Weekday headers */}
          <div className="aqi-cal-grid aqi-cal-weekdays">
            {WEEKDAYS.map((w) => (
              <div key={w} className="aqi-cal-wday">{w}</div>
            ))}
          </div>

          {/* Day cells */}
          <div className="aqi-cal-grid">
            {monthGrid.map((cell) => {
              if (cell.empty) return <div key={cell.key} className="aqi-cal-cell empty" />;
              const val = cell.info?.aqi ?? null;
              const band = val != null ? getBand(val) : null;
              const val2 = cell.info2?.aqi ?? null;
              const band2 = val2 != null ? getBand(val2) : null;
              // Use primary band for cell background; if only secondary, use that
              const activeBand = band || band2;
              const bg = activeBand ? activeBand.bg : "#f3f4f6";
              const borderColor = activeBand ? activeBand.color : "#e5e7eb";
              const textColor = activeBand ? activeBand.color : "var(--aqm-muted)";
              const hasAny = val != null || val2 != null;
              return (
                <Tooltip
                  key={cell.key}
                  title={
                    <div>
                      <div style={{ fontWeight: 600 }}>{dayjs(cell.dateKey).format("MMM D, YYYY")}</div>
                      {val != null ? (
                        <div style={{ marginTop: 2 }}>
                          <div style={{ fontSize: 11, fontWeight: 600, opacity: 0.7 }}>{label || "PM10"}</div>
                          <div>AQI: <strong style={{ color: band?.color }}>{val}</strong></div>
                          {cell.info?.conc != null && <div>Conc: <strong>{cell.info.conc}</strong> µg/Ncm</div>}
                          <div style={{ color: band?.color }}>{band?.name}</div>
                        </div>
                      ) : null}
                      {val2 != null ? (
                        <div style={{ marginTop: 4, borderTop: val != null ? "1px solid rgba(255,255,255,0.2)" : undefined, paddingTop: val != null ? 4 : 0 }}>
                          <div style={{ fontSize: 11, fontWeight: 600, opacity: 0.7 }}>{label2 || "PM2.5"}</div>
                          <div>AQI: <strong style={{ color: band2?.color }}>{val2}</strong></div>
                          {cell.info2?.conc != null && <div>Conc: <strong>{cell.info2.conc}</strong> µg/Ncm</div>}
                          <div style={{ color: band2?.color }}>{band2?.name}</div>
                        </div>
                      ) : null}
                      {!hasAny && <div>No data</div>}
                    </div>
                  }
                >
                  <div
                    className={`aqi-cal-cell${hasAny ? " has-data" : ""}${hasDual ? " aqi-cal-cell--dual" : ""}`}
                    style={{
                      background: bg,
                      borderColor,
                      color: textColor,
                      cursor: hasAny ? "pointer" : "default",
                    }}
                    onClick={() => hasAny && setSelectedDay(cell.dateKey)}
                  >
                    <span className="aqi-cal-day">{cell.day}</span>
                    {hasDual ? (
                      /* Dual layout: two AQI values stacked with labels */
                      <>
                        {val != null && (
                          <span className="aqi-cal-dual-row">
                            <span className="aqi-cal-dual-lbl" style={{ color: band?.color }}>{label || "PM10"}</span>
                            <span className="aqi-cal-dual-val" style={{ color: band?.color }}>{val}</span>
                          </span>
                        )}
                        {val2 != null && (
                          <span className="aqi-cal-dual-row">
                            <span className="aqi-cal-dual-lbl" style={{ color: band2?.color }}>{label2 || "PM2.5"}</span>
                            <span className="aqi-cal-dual-val" style={{ color: band2?.color }}>{val2}</span>
                          </span>
                        )}
                      </>
                    ) : (
                      /* Single layout */
                      <>
                        {val != null && (
                          <>
                            <span className="aqi-cal-val">{val}</span>
                            {cell.info?.status && (
                              <span className="aqi-cal-status">{shortStatus(cell.info.status)}</span>
                            )}
                            {cell.info?.conc != null && (
                              <span className="aqi-cal-conc">{cell.info.conc}</span>
                            )}
                          </>
                        )}
                      </>
                    )}
                  </div>
                </Tooltip>
              );
            })}
          </div>
        </>
      )}

      {/* Day Detail Modal */}
      <Modal
        title={null}
        open={!!selectedDay}
        onCancel={() => { setSelectedDay(null); setDayStatusFilter("all"); }}
        footer={null}
        width={720}
        centered
        className="aqi-day-modal"
        destroyOnHidden
      >
        {selectedDay && (
          <div className="aqi-day-content">
            <div className="aqi-day-header">
              <div
                className="aqi-day-header-icon"
                style={{ background: selectedDayBand?.bg || "#f3f4f6", color: selectedDayBand?.color || "#9ca3af" }}
              >
                <TbCalendar size={24} />
              </div>
              <div className="aqi-day-header-text">
                <h3>{dayjs(selectedDay).format("MMMM D, YYYY")}</h3>
                <p>{selectedDayBand?.name || "No AQI data"}{selectedDayInfo ? ` • ${selectedDayInfo.readings} reading${selectedDayInfo.readings !== 1 ? "s" : ""}` : ""}</p>
              </div>
            </div>

            {selectedDayInfo && (
              <div className="aqi-day-summary">
                <div className="aqi-day-stat">
                  <span className="aqi-day-stat-label">AQI</span>
                  <span className="aqi-day-stat-value" style={{ color: selectedDayBand?.color }}>{selectedDayInfo.aqi}</span>
                </div>
                <div className="aqi-day-stat">
                  <span className="aqi-day-stat-label">Status</span>
                  <span className="aqi-day-stat-value" style={{ color: selectedDayBand?.color, fontSize: 13 }}>{selectedDayBand?.name}</span>
                </div>
                <div className="aqi-day-stat">
                  <span className="aqi-day-stat-label">Concentration</span>
                  <span className="aqi-day-stat-value">{selectedDayInfo.conc != null ? `${selectedDayInfo.conc} µg/Ncm` : "—"}</span>
                </div>
                <div className="aqi-day-stat">
                  <span className="aqi-day-stat-label">Readings</span>
                  <span className="aqi-day-stat-value">{selectedDayInfo.readings}</span>
                </div>
              </div>
            )}

            <div className="aqi-day-toolbar">
              <Select
                size="small"
                value={dayStatusFilter}
                onChange={setDayStatusFilter}
                style={{ width: 160 }}
                options={dayStatusOptions}
                placeholder="Filter by status"
              />
              <span style={{ flex: 1 }} />
              <span style={{ fontSize: 11, color: "var(--aqm-muted)" }}>
                {filteredDayReadings.length} of {dayReadings.length} readings
              </span>
              <Tooltip title="Export as CSV">
                <Button size="small" icon={<TbFileTypeCsv size={14} />} onClick={exportDayCSV} disabled={!filteredDayReadings.length} />
              </Tooltip>
              <Tooltip title="Export as JSON">
                <Button size="small" icon={<TbDownload size={14} />} onClick={exportDayJSON} disabled={!filteredDayReadings.length} />
              </Tooltip>
            </div>

            {filteredDayReadings.length > 0 ? (
              <div className="aqi-day-table-wrap">
                <Table
                  size="small"
                  dataSource={filteredDayReadings.map((r, i) => ({ ...r, _key: i }))}
                  columns={dayTableColumns}
                  rowKey="_key"
                  pagination={filteredDayReadings.length > 20 ? { pageSize: 20, size: "small" } : false}
                  scroll={{ x: "max-content" }}
                  bordered
                />
              </div>
            ) : (
              <div className="aqi-day-empty">
                {dayReadings.length === 0
                  ? "No raw readings available for this day."
                  : "No readings match the current filter."}
              </div>
            )}
          </div>
        )}
      </Modal>
    </div>
  );
}
