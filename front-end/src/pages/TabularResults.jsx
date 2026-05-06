import { useEffect, useMemo, useState, useCallback, useRef } from "react";
import { useParams, Navigate } from "react-router-dom";
import {
  Alert,
  Button,
  Card,
  Col,
  DatePicker,
  Input,
  Modal,
  Progress,
  Row,
  Select,
  Slider,
  Space,
  Table,
  Tabs,
  Tag,
  Typography,
  theme,
  message,
} from "antd";
import {
  MailOutlined,
  FilterOutlined,
  ClearOutlined,
  ReloadOutlined,
} from "@ant-design/icons";
import { useApiEndpoint } from "../util/apiClient";
import "./TabularResults.css";

const { RangePicker } = DatePicker;
const { Text } = Typography;

/* ─── Province / Pollutant config ─── */
const PROVINCES = [
  { key: "meycauayan", label: "Meycauayan", pollutants: ["pm10", "pm25"] },
  { key: "zambales", label: "Zambales", pollutants: ["pm10", "pm25"] },
  { key: "clark", label: "Clark", pollutants: ["pm10"] },
  { key: "san-fernando", label: "San Fernando", pollutants: ["pm10"] },
];

function titleForPollutant(p) {
  if (p === "pm25") return "PM2.5";
  return "PM10";
}

/* ─── Status colour mapping ─── */
const STATUS_OPTIONS = [
  { value: "Good", color: "#52c41a" },
  { value: "Fair", color: "#d4b106" },
  { value: "Unhealthy for Sensitive Groups", color: "#fa8c16" },
  { value: "Very Unhealthy", color: "#f5222d" },
  { value: "Acutely Unhealthy", color: "#722ed1" },
  { value: "Emergency", color: "#a8071a" },
];

function statusTint(status) {
  const s = String(status || "").toLowerCase();
  if (!s) return null;
  if (s.includes("collecting") || s.includes("waiting")) return null;
  const found = STATUS_OPTIONS.find((o) =>
    s.includes(o.value.toLowerCase().split(" ")[0]),
  );
  return found?.color ?? null;
}

/* ─── Data-fetching hook with simulated progress ─── */
function useTabularWithProgress(provinceKey, pollutantKey) {
  const q = useApiEndpoint(`/api/tabular/${provinceKey}/${pollutantKey}`, {
    refreshMs: 300000,
    retries: 2,
    timeoutMs: 60000,
    cacheTtlMs: 60000,
    enabled: !!provinceKey && !!pollutantKey,
  });

  const [progress, setProgress] = useState(0);
  const timerRef = useRef(null);

  useEffect(() => {
    if (q.loading) {
      setProgress(0);
      let pct = 0;
      timerRef.current = setInterval(() => {
        // Ease-out curve: fast start, slow approach to 90%
        pct += (90 - pct) * 0.08;
        setProgress(Math.min(Math.round(pct), 90));
      }, 200);
    } else {
      if (timerRef.current) clearInterval(timerRef.current);
      setProgress(q.error ? 0 : 100);
    }
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [q.loading, q.error]);

  return { ...q, progress };
}

/* ─── Parse date string back to Date for filter comparison ─── */
function parseFormattedDate(s) {
  if (!s) return null;
  // "MM/DD/YYYY H:MM AM/PM"  e.g. "03/04/2026 2:00 PM"
  const m2 = String(s).match(
    /^(\d{1,2})\/(\d{1,2})\/(\d{4})\s+(\d{1,2}):(\d{2})\s*(AM|PM)$/i,
  );
  if (m2) {
    let h = Number(m2[4]);
    const ampm = m2[6].toUpperCase();
    if (ampm === "PM" && h < 12) h += 12;
    if (ampm === "AM" && h === 12) h = 0;
    return new Date(Number(m2[3]), Number(m2[1]) - 1, Number(m2[2]), h, Number(m2[5]));
  }
  // Fallback: try native Date parsing
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d;
}

/* ═══════════════════ TabularTable Component ═══════════════════ */
function TabularTable({ provinceKey, pollutantKey }) {
  const { token } = theme.useToken();
  const q = useTabularWithProgress(provinceKey, pollutantKey);

  /* ── Raw columns / data ── */
  const columns = useMemo(() => {
    const cols = Array.isArray(q.data?.columns) ? q.data.columns : [];
    if (!cols.length && Array.isArray(q.data?.rows) && q.data.rows.length)
      return Object.keys(q.data.rows[0] || {});
    return cols;
  }, [q.data]);

  const dataSource = useMemo(() => {
    const rows = Array.isArray(q.data?.rows) ? q.data.rows : [];
    return rows.map((r, idx) => ({ __key: idx, ...r }));
  }, [q.data]);

  /* ── Filter state ── */
  const [filters, setFilters] = useState({
    dateRange: null, // [dayjs, dayjs]
    statuses: [], // string[]
    aqiRange: [0, 500],
    concentrationSearch: "",
  });

  const clearFilters = useCallback(() => {
    setFilters({
      dateRange: null,
      statuses: [],
      aqiRange: [0, 500],
      concentrationSearch: "",
    });
  }, []);

  /* ── Derive min/max from data for slider bounds ── */
  const aqiBounds = useMemo(() => {
    let min = Infinity,
      max = -Infinity;
    for (const r of dataSource) {
      const v = r["AQI"];
      if (v != null && typeof v === "number") {
        if (v < min) min = v;
        if (v > max) max = v;
      }
    }
    return { min: isFinite(min) ? min : 0, max: isFinite(max) ? max : 500 };
  }, [dataSource]);

  /* ── Apply filters ── */
  const filteredData = useMemo(() => {
    const dateKey = columns.find((c) => /date|time/i.test(c));
    return dataSource.filter((row) => {
      // Date range filter
      if (
        filters.dateRange &&
        filters.dateRange[0] &&
        filters.dateRange[1] &&
        dateKey
      ) {
        const d = parseFormattedDate(row[dateKey]);
        if (d) {
          const start = filters.dateRange[0].startOf("day").toDate();
          const end = filters.dateRange[1].endOf("day").toDate();
          if (d < start || d > end) return false;
        }
      }
      // Status filter
      if (filters.statuses.length > 0) {
        const rs = String(row["Status"] || "");
        if (!filters.statuses.some((s) => rs === s)) return false;
      }
      // AQI range filter
      if (filters.aqiRange[0] > 0 || filters.aqiRange[1] < 500) {
        const a = row["AQI"];
        if (a != null && typeof a === "number") {
          if (a < filters.aqiRange[0] || a > filters.aqiRange[1]) return false;
        }
      }
      // Concentration search
      if (filters.concentrationSearch) {
        const concKey = columns.find((c) => /concentration/i.test(c));
        if (concKey) {
          const val = String(row[concKey] ?? "");
          if (!val.includes(filters.concentrationSearch)) return false;
        }
      }
      return true;
    });
  }, [dataSource, columns, filters]);

  /* ── Determine active filter count for badge ── */
  const activeFilterCount = useMemo(() => {
    let n = 0;
    if (filters.dateRange && filters.dateRange[0]) n++;
    if (filters.statuses.length) n++;
    if (filters.aqiRange[0] > 0 || filters.aqiRange[1] < 500) n++;
    if (filters.concentrationSearch) n++;
    return n;
  }, [filters]);

  /* ── Table columns (AQI & Category excluded) ── */
  const tableColumns = useMemo(() => {
    const filtered = columns.filter(
      (c) => !(/aqi/i.test(c) && (/category/i.test(c) || /µg/i.test(c))),
    );
    return filtered.map((c) => ({
      title: c,
      dataIndex: c,
      key: c,
      ellipsis: true,
      ...(c === "Status" && {
        filters: STATUS_OPTIONS.map((o) => ({ text: o.value, value: o.value })),
        onFilter: (val, record) => record["Status"] === val,
      }),
      ...(c === "AQI" && {
        sorter: (a, b) => (a["AQI"] ?? 0) - (b["AQI"] ?? 0),
      }),
      render: (v, row) => {
        if (c === "Status") {
          const t = statusTint(v);
          const txt = v == null ? "" : String(v);
          if (!txt) return "";
          return t ? <Tag color={t}>{txt}</Tag> : <Tag>{txt}</Tag>;
        }
        if (c === "AQI") {
          if (v == null || v === "") return "";
          const statusVal = row["Status"];
          const t = statusTint(statusVal);
          return t
            ? <Tag color={t} style={{ fontWeight: 700 }}>{typeof v === "number" ? Math.round(v) : v}</Tag>
            : <span style={{ fontWeight: 600 }}>{typeof v === "number" ? Math.round(v) : v}</span>;
        }
        if (
          c.toLowerCase().includes("rolling average") &&
          typeof v === "number"
        )
          return new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 }).format(v);
        return v == null ? "" : String(v);
      },
    }));
  }, [columns]);

  const provinceLabel =
    PROVINCES.find((p) => p.key === provinceKey)?.label || provinceKey;
  const pollutantLabel = titleForPollutant(pollutantKey);

  /* ── Data request modal ── */
  const [requestOpen, setRequestOpen] = useState(false);

  /* ── Filter panel visibility ── */
  const [showFilters, setShowFilters] = useState(false);

  /* ═══ Render ═══ */
  return (
    <Card
      title={`${provinceLabel} — ${pollutantLabel}`}
      bordered
      className="aqm-tabular-card"
      extra={
        <Space wrap size="small">
          <Button
            icon={<FilterOutlined />}
            onClick={() => setShowFilters((v) => !v)}
            type={activeFilterCount > 0 ? "primary" : "default"}
            ghost={activeFilterCount > 0}
          >
            Filters{activeFilterCount > 0 ? ` (${activeFilterCount})` : ""}
          </Button>
          <Button
            icon={<ReloadOutlined />}
            onClick={q.retry}
            loading={q.loading}
          />
          <Button
            icon={<MailOutlined />}
            onClick={() => setRequestOpen(true)}
          >
            Request Data
          </Button>
        </Space>
      }
    >
      {/* ── Data Request Modal ── */}
      <Modal
        title="📋 Request Air Quality Data"
        open={requestOpen}
        onCancel={() => setRequestOpen(false)}
        width="min(500px, 95vw)"
        footer={[
          <Button key="close" onClick={() => setRequestOpen(false)}>
            Close
          </Button>,
          <Button
            key="email"
            type="primary"
            icon={<MailOutlined />}
            onClick={() => {
              window.location.href =
                `mailto:recordsr3@emb.gov.ph?subject=${encodeURIComponent(
                  `Air Quality Data Request — ${provinceLabel} (${pollutantLabel})`
                )}&body=${encodeURIComponent(
                  `Good day,\n\nI would like to request air quality monitoring data for the following:\n\n` +
                  `Station: ${provinceLabel}\n` +
                  `Pollutant: ${pollutantLabel}\n` +
                  `Records available: ${dataSource.length}\n\n` +
                  `Please process my request at your earliest convenience.\n\nThank you.`
                )}`;
              message.success("Opening email client...");
            }}
          >
            Send Request via Email
          </Button>,
        ]}
      >
        <div style={{ lineHeight: 1.8, fontSize: 14 }}>
          <p style={{ marginBottom: 12 }}>
            To obtain air quality monitoring data, please submit a request to the
            <strong> EMB Region 3 Records Unit</strong>.
          </p>

          <div style={{
            background: token.colorFillAlter,
            borderRadius: 10,
            padding: "14px 18px",
            marginBottom: 14,
            border: `1px solid ${token.colorBorderSecondary}`,
          }}>
            <div style={{ fontWeight: 600, marginBottom: 6 }}>📧 Records Unit Email</div>
            <a
              href="mailto:recordsr3@emb.gov.ph"
              style={{ fontSize: 16, fontWeight: 700, color: token.colorLink }}
            >
              recordsr3@emb.gov.ph
            </a>
          </div>

          <div style={{
            background: token.colorFillAlter,
            borderRadius: 10,
            padding: "14px 18px",
            border: `1px solid ${token.colorBorderSecondary}`,
          }}>
            <div style={{ fontWeight: 600, marginBottom: 6 }}>📍 Current Station</div>
            <div>{provinceLabel} — {pollutantLabel}</div>
            <div style={{ marginTop: 4, fontSize: 12, opacity: 0.7 }}>
              {dataSource.length.toLocaleString()} records available
            </div>
          </div>

          <p style={{ marginTop: 14, fontSize: 12, opacity: 0.6 }}>
            Click <strong>"Send Request via Email"</strong> to open your email client
            with a pre-filled request template.
          </p>
        </div>
      </Modal>

      {/* ── Loading indicator with percentage ── */}
      {q.loading && (
        <div style={{ padding: "32px 24px", textAlign: "center" }}>
          <Progress
            type="circle"
            percent={q.progress}
            size={80}
            strokeColor={{ "0%": "#1677ff", "100%": "#52c41a" }}
          />
          <div style={{ marginTop: 12 }}>
            <Text type="secondary">
              {q.progress < 30
                ? "Connecting to Google Sheets..."
                : q.progress < 70
                  ? "Downloading data from all worksheets..."
                  : q.progress < 95
                    ? "Computing AQI and rolling averages..."
                    : "Finalizing..."}
            </Text>
          </div>
        </div>
      )}

      {/* ── Error ── */}
      {!q.loading && q.error && (
        <Alert
          type="error"
          message="Failed to load tabular data"
          description={q.error}
          showIcon
          action={
            <Button onClick={q.retry} size="small">
              Retry
            </Button>
          }
        />
      )}

      {/* ── Data loaded ── */}
      {!q.loading && !q.error && (
        <>
          {/* ── Filter bar ── */}
          {showFilters && (
            <Card
              size="small"
              style={{
                marginBottom: 16,
                background: token.colorFillAlter,
                borderColor: token.colorBorderSecondary,
              }}
              bodyStyle={{ padding: "12px 16px" }}
            >
              <Row gutter={[12, 12]} align="middle">
                <Col xs={24} sm={12} md={6}>
                  <Text
                    strong
                    style={{ display: "block", marginBottom: 4, fontSize: 12 }}
                  >
                    Date Range
                  </Text>
                  <RangePicker
                    style={{ width: "100%" }}
                    value={filters.dateRange}
                    onChange={(v) =>
                      setFilters((f) => ({ ...f, dateRange: v }))
                    }
                    allowClear
                    size="small"
                  />
                </Col>
                <Col xs={24} sm={12} md={6}>
                  <Text
                    strong
                    style={{ display: "block", marginBottom: 4, fontSize: 12 }}
                  >
                    Status
                  </Text>
                  <Select
                    mode="multiple"
                    placeholder="All statuses"
                    style={{ width: "100%" }}
                    value={filters.statuses}
                    onChange={(v) => setFilters((f) => ({ ...f, statuses: v }))}
                    allowClear
                    size="small"
                    maxTagCount="responsive"
                    options={STATUS_OPTIONS.map((o) => ({
                      label: <Tag color={o.color}>{o.value}</Tag>,
                      value: o.value,
                    }))}
                  />
                </Col>
                <Col xs={24} sm={12} md={6}>
                  <Text
                    strong
                    style={{ display: "block", marginBottom: 4, fontSize: 12 }}
                  >
                    AQI Range ({filters.aqiRange[0]}–{filters.aqiRange[1]})
                  </Text>
                  <Slider
                    range
                    min={aqiBounds.min}
                    max={Math.max(aqiBounds.max, 500)}
                    value={filters.aqiRange}
                    onChange={(v) => setFilters((f) => ({ ...f, aqiRange: v }))}
                    tooltip={{ formatter: (v) => `AQI ${v}` }}
                  />
                </Col>
                <Col xs={24} sm={12} md={6}>
                  <Text
                    strong
                    style={{ display: "block", marginBottom: 4, fontSize: 12 }}
                  >
                    Concentration
                  </Text>
                  <Space.Compact style={{ width: "100%" }}>
                    <Input
                      placeholder="Search value..."
                      value={filters.concentrationSearch}
                      onChange={(e) =>
                        setFilters((f) => ({
                          ...f,
                          concentrationSearch: e.target.value,
                        }))
                      }
                      allowClear
                      size="small"
                    />
                    <Button
                      icon={<ClearOutlined />}
                      size="small"
                      onClick={clearFilters}
                      title="Clear all filters"
                    />
                  </Space.Compact>
                </Col>
              </Row>
            </Card>
          )}

          {/* ── Summary ── */}
          <div
            style={{
              marginBottom: 8,
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
            }}
          >
            <Text type="secondary" style={{ fontSize: 12 }}>
              Showing {filteredData.length.toLocaleString()} of{" "}
              {dataSource.length.toLocaleString()} records
              {activeFilterCount > 0 && (
                <>
                  {" "}
                  &middot;{" "}
                  <a onClick={clearFilters} style={{ fontSize: 12 }}>
                    Clear filters
                  </a>
                </>
              )}
            </Text>
            {q.data?.fetchedAt && (
              <Text type="secondary" style={{ fontSize: 11 }}>
                Updated {new Date(q.data.fetchedAt).toLocaleTimeString()}
              </Text>
            )}
          </div>

          {/* ── Table ── */}
          <Table
            size="small"
            rowKey="__key"
            columns={tableColumns}
            dataSource={filteredData}
            pagination={{
              pageSize: 25,
              showSizeChanger: true,
              pageSizeOptions: ["25", "50", "100", "250"],
              showTotal: (total, range) =>
                `${range[0]}-${range[1]} of ${total}`,
            }}
            scroll={{ x: "max-content" }}
          />
        </>
      )}
    </Card>
  );
}

/* ═══════════════════ Page Wrapper ═══════════════════ */
export default function TabularResultsPage() {
  const params = useParams();
  const provinceKey = String(params.province || "").toLowerCase();

  const province = PROVINCES.find((p) => p.key === provinceKey) || null;
  const [activePollutant, setActivePollutant] = useState(() => {
    if (province?.pollutants?.length) return province.pollutants[0];
    return "pm10";
  });

  useEffect(() => {
    if (!province?.pollutants?.length) return;
    setActivePollutant((prev) =>
      province.pollutants.includes(prev) ? prev : province.pollutants[0],
    );
  }, [provinceKey, province?.pollutants]);

  if (!provinceKey) {
    return <Navigate to="/admin/tabular/meycauayan" replace />;
  }
  if (!province) {
    return (
      <Alert
        type="warning"
        message="Unknown province"
        description={provinceKey}
        showIcon
      />
    );
  }

  const pollutants = province.pollutants;
  if (pollutants.length > 1) {
    return (
      <Tabs
        activeKey={activePollutant}
        onChange={(k) => setActivePollutant(k)}
        items={pollutants.map((p) => ({
          key: p,
          label: titleForPollutant(p),
          children: (
            <TabularTable provinceKey={province.key} pollutantKey={p} />
          ),
        }))}
      />
    );
  }

  return (
    <TabularTable provinceKey={province.key} pollutantKey={pollutants[0]} />
  );
}
