/**
 * AdminTabularManage — CRUD + filtered CSV export + email send for tabular station data.
 * Route: /admin/tabular-manage/:province
 * Requires valid admin session token in sessionStorage.
 */
import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { useParams, useNavigate } from "react-router-dom";
import {
  Table, Button, Space, Modal, Form, Input, Popconfirm,
  Typography, Select, Tag, Alert, message,
  DatePicker, InputNumber,
} from "antd";
import {
  DownloadOutlined, PlusOutlined, EditOutlined, DeleteOutlined,
  ReloadOutlined, MailOutlined, FilterOutlined, SyncOutlined, CloudDownloadOutlined,
} from "@ant-design/icons";
import Swal from "sweetalert2";
import dayjs from "dayjs";
import { getApiBase } from "../util/apiBase";
import { secureSession } from "../utils/secureStorage";

const { Title, Text } = Typography;
const { Option } = Select;
const { RangePicker } = DatePicker;

const PROVINCE_OPTIONS = [
  { value: "clark",        label: "Clark" },
  { value: "san-fernando", label: "San Fernando" },
  { value: "meycauayan",   label: "Meycauayan" },
  { value: "zambales",     label: "Zambales" },
];

const POLLUTANT_OPTIONS = [
  { value: "pm10", label: "PM10" },
  { value: "pm25", label: "PM2.5" },
];

const STATUS_OPTIONS = [
  "Good", "Fair", "Unhealthy for Sensitive Groups",
  "Very Unhealthy", "Acutely Unhealthy", "Emergency",
  "Invalid", "For Validation",
];

const SESSION_KEY = "admin-pin-token";
const ADMIN_TABULAR_CACHE_TTL_MS = 30 * 1000;
const ADMIN_TABULAR_STORAGE_TTL_MS = 15 * 60 * 1000;
const ADMIN_TABULAR_CACHE_VERSION = 1;
const ADMIN_TABULAR_CACHE = new Map();
const ADMIN_TABULAR_ETAGS = new Map();

function getToken() {
  return sessionStorage.getItem(SESSION_KEY) || "";
}

function adminFetch(path, opts = {}) {
  const base = getApiBase();
  return fetch(`${base}${path}`, {
    headers: {
      "Content-Type": "application/json",
      "X-Admin-Token": getToken(),
      ...(opts.headers ?? {}),
    },
    ...opts,
  });
}

function getAdminCacheKey(province, pollutant) {
  return `${province || ""}:${pollutant || ""}`;
}

function getAdminStorageKey(cacheKey) {
  return `aqm_admin_tabular:${cacheKey}`;
}

function normalizeAdminTabularPayload(json) {
  const columns = (json.columns ?? []).filter((c) => c !== "_id");
  const rows = (json.rows ?? []).map((row, i) => ({
    ...row,
    _rowId: row._id ?? row["_id"] ?? `row-${i}`,
  }));
  return {
    columns,
    rows,
    totalRows: json.totalRows ?? rows.length,
    source: json.source ?? null,
    fetchedAt: json.fetchedAt ?? Date.now(),
    sheetSyncing: json.sheetSyncing ?? false,
    syncResult: json.syncResult ?? null,
  };
}

function readAdminTabularCache(province, pollutant) {
  const cacheKey = getAdminCacheKey(province, pollutant);
  const memory = ADMIN_TABULAR_CACHE.get(cacheKey);
  if (memory?.data) {
    return {
      ...memory,
      fresh: Date.now() - memory.cachedAt < ADMIN_TABULAR_CACHE_TTL_MS,
    };
  }
  try {
    const stored = secureSession.getJSON(getAdminStorageKey(cacheKey));
    if (!stored?.data || stored.version !== ADMIN_TABULAR_CACHE_VERSION) return null;
    if (Date.now() - stored.cachedAt > ADMIN_TABULAR_STORAGE_TTL_MS) {
      secureSession.removeItem(getAdminStorageKey(cacheKey));
      return null;
    }
    ADMIN_TABULAR_CACHE.set(cacheKey, { data: stored.data, cachedAt: stored.cachedAt });
    if (stored.etag) ADMIN_TABULAR_ETAGS.set(cacheKey, stored.etag);
    return {
      data: stored.data,
      cachedAt: stored.cachedAt,
      fresh: Date.now() - stored.cachedAt < ADMIN_TABULAR_CACHE_TTL_MS,
    };
  } catch {
    return null;
  }
}

function writeAdminTabularCache(province, pollutant, data, etag = null) {
  const cacheKey = getAdminCacheKey(province, pollutant);
  const cachedAt = Date.now();
  ADMIN_TABULAR_CACHE.set(cacheKey, { data, cachedAt });
  if (etag) ADMIN_TABULAR_ETAGS.set(cacheKey, etag);
  try {
    secureSession.setJSON(getAdminStorageKey(cacheKey), {
      version: ADMIN_TABULAR_CACHE_VERSION,
      cachedAt,
      etag: etag ?? ADMIN_TABULAR_ETAGS.get(cacheKey) ?? null,
      data,
    });
  } catch { /* best-effort */ }
}

function clearAdminTabularCache(province, pollutant) {
  const cacheKey = getAdminCacheKey(province, pollutant);
  ADMIN_TABULAR_CACHE.delete(cacheKey);
  ADMIN_TABULAR_ETAGS.delete(cacheKey);
  secureSession.removeItem(getAdminStorageKey(cacheKey));
}

function formatMaxDecimals(value, maximumFractionDigits = 2) {
  const n = Number(value);
  if (!isFinite(n)) return value ?? "—";
  return new Intl.NumberFormat("en-US", { maximumFractionDigits }).format(n);
}

async function requestAdminTabularData(province, pollutant, { force = false, signal } = {}) {
  const cacheKey = getAdminCacheKey(province, pollutant);
  const cached = readAdminTabularCache(province, pollutant);
  if (!force && cached?.fresh) return cached.data;

  const base = getApiBase();
  const headers = { Accept: "application/json" };
  const etag = ADMIN_TABULAR_ETAGS.get(cacheKey);
  if (etag) headers["If-None-Match"] = etag;

  const res = await fetch(`${base}/api/tabular/${province}/${pollutant}?limit=5000`, {
    signal,
    cache: "no-cache",
    headers,
  });

  if (res.status === 304 && cached?.data) {
    writeAdminTabularCache(province, pollutant, cached.data, etag);
    return cached.data;
  }
  if (!res.ok) throw new Error(await res.text());

  const json = await res.json();
  const data = normalizeAdminTabularPayload(json);
  writeAdminTabularCache(province, pollutant, data, res.headers.get("ETag"));
  return data;
}

/** Returns true if the row looks erratic / out-of-range */
function isErraticRow(row, columns) {
  const status = String(row["Status"] || "").toLowerCase();
  if (/^(invalid|for\s*validation)$/.test(status)) return true;

  const aqi = row["AQI"];
  if (aqi != null && aqi !== "") {
    const n = Number(aqi);
    if (isFinite(n) && (n < 0 || n > 500)) return true;
  }

  for (const col of columns) {
    if (col === "AQI" || col === "Status" || /date|time/i.test(col)) continue;
    const v = Number(row[col]);
    if (isFinite(v) && v < 0) return true;
  }

  return false;
}

/** Apply export filters to an array of rows */
function applyFilters(rows, filters, columns) {
  let result = [...rows];

  if (filters.dateRange?.[0] && filters.dateRange?.[1]) {
    const from = dayjs(filters.dateRange[0]).startOf("day");
    const to   = dayjs(filters.dateRange[1]).endOf("day");
    const dateCol = columns.find((c) => /date|time/i.test(c)) ?? null;
    if (dateCol) {
      result = result.filter((r) => {
        const d = dayjs(r[dateCol]);
        return d.isValid() && d.isAfter(from.subtract(1, "ms")) && d.isBefore(to.add(1, "ms"));
      });
    }
  }

  if (filters.statuses?.length) {
    result = result.filter((r) => filters.statuses.includes(r["Status"]));
  }

  if (filters.aqiMin != null || filters.aqiMax != null) {
    result = result.filter((r) => {
      const n = Number(r["AQI"]);
      if (!isFinite(n)) return true;
      if (filters.aqiMin != null && n < filters.aqiMin) return false;
      if (filters.aqiMax != null && n > filters.aqiMax) return false;
      return true;
    });
  }

  return result;
}

/** Build and trigger CSV download */
function downloadCsv(rows, columns, filename) {
  const safe = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const cols  = columns.filter((c) => c !== "_id");
  const csv   = [
    cols.map(safe).join(","),
    ...rows.map((r) => cols.map((c) => safe(r[c] ?? "")).join(",")),
  ].join("\r\n");
  const blob  = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url   = URL.createObjectURL(blob);
  const link  = document.createElement("a");
  link.href   = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

export default function AdminTabularManage() {
  const { province } = useParams();
  const navigate      = useNavigate();

  const [pollutant, setPollutant] = useState("pm10");
  const [rows, setRows]           = useState([]);
  const [columns, setColumns]     = useState([]);
  const [loading, setLoading]     = useState(false);
  const [totalRows, setTotalRows] = useState(0);

  // Controlled pagination
  const [pageSize, setPageSize] = useState(50);
  const [currentPage, setCurrentPage] = useState(1);

  // Abort in-flight fetches when province/pollutant changes or Refresh is clicked
  const fetchControllerRef = useRef(null);
  // Timer ref for auto-refresh when a background Sheets sync is in progress
  const autoRefreshTimerRef = useRef(null);

  // Erratic-row filter
  const [hideErratic, setHideErratic] = useState(false);

  // Source metadata (mongodb-backup / sheet / stale-cache / cache)
  const [dataSource, setDataSource] = useState(null);
  const [syncedAt, setSyncedAt]     = useState(null);
  const [sheetSyncing, setSheetSyncing] = useState(false);
  const [forceSyncing, setForceSyncing] = useState(false);

  // Add/Edit modal
  const [modalOpen, setModalOpen]   = useState(false);
  const [editingRow, setEditingRow] = useState(null);
  const [form]                      = Form.useForm();
  const [saving, setSaving]         = useState(false);

  // Export/Email modal
  const [exportModalOpen, setExportModalOpen] = useState(false);
  const [exportFilters, setExportFilters] = useState({
    dateRange: null,
    statuses: [],
    aqiMin: null,
    aqiMax: null,
  });
  const [emailRecipient, setEmailRecipient] = useState("");
  const [sending, setSending] = useState(false);

  // ── Fetch ─────────────────────────────────────────────────────
  const applyPayload = useCallback((payload) => {
    if (!payload) return;
    setColumns(payload.columns);
    setRows(payload.rows);
    setTotalRows(payload.totalRows);
    setDataSource(payload.source);
    setSyncedAt(payload.fetchedAt ? new Date(payload.fetchedAt) : null);
    setSheetSyncing(payload.sheetSyncing ?? false);
  }, []);

  const fetchData = useCallback(async ({ force = false } = {}) => {
    // Cancel any previous in-flight request and any pending auto-refresh
    if (fetchControllerRef.current) {
      fetchControllerRef.current.abort();
    }
    if (autoRefreshTimerRef.current) {
      clearTimeout(autoRefreshTimerRef.current);
      autoRefreshTimerRef.current = null;
    }
    const controller = new AbortController();
    fetchControllerRef.current = controller;

    setLoading(true);
    const cached = readAdminTabularCache(province, pollutant);
    if (!force && cached?.data) {
      applyPayload(cached.data);
      setLoading(false);
      if (cached.fresh) return;
    }

    setLoading(!cached?.data);
    setCurrentPage(1);
    try {
      const payload = await requestAdminTabularData(province, pollutant, {
        force,
        signal: controller.signal,
      });
      if (controller.signal.aborted) return; // superseded by a newer request
      applyPayload(payload);
      // If a background Sheets sync is in progress, auto-refresh once it's done
      if (payload.sheetSyncing && !autoRefreshTimerRef.current) {
        autoRefreshTimerRef.current = setTimeout(() => {
          autoRefreshTimerRef.current = null;
          fetchData({ force: true });
        }, 10000);
      }
    } catch (e) {
      if (e.name === "AbortError") return; // silently ignore cancelled requests
      message.error(`Failed to load data: ${e.message}`);
    } finally {
      if (!controller.signal.aborted) setLoading(false);
    }
  }, [applyPayload, province, pollutant]);

  useEffect(() => { fetchData(); }, [fetchData]);

  // ── Filtered rows preview ──────────────────────────────────────
  const filteredRows = useMemo(
    () => applyFilters(rows, exportFilters, columns),
    [rows, exportFilters, columns]
  );

  // Count erratic rows for the warning badge
  const erraticCount = useMemo(
    () => rows.filter((r) => isErraticRow(r, columns)).length,
    [rows, columns]
  );

  // Rows shown in the table (optionally hiding erratic)
  const displayRows = useMemo(
    () => hideErratic ? rows.filter((r) => !isErraticRow(r, columns)) : rows,
    [rows, columns, hideErratic]
  );

  // ── Add/Edit/Delete ────────────────────────────────────────────
  function handleAdd() { setEditingRow(null); form.resetFields(); setModalOpen(true); }

  const handleEdit = useCallback((row) => {
    setEditingRow(row);
    const vals = {};
    columns.forEach((c) => { vals[c] = row[c] ?? ""; });
    form.setFieldsValue(vals);
    setModalOpen(true);
  }, [columns, form]);

  async function handleSave() {
    let vals;
    try { vals = await form.validateFields(); } catch { return; }
    setSaving(true);
    try {
      if (editingRow) {
        const r = await adminFetch(
          `/api/tabular/${province}/${pollutant}/rows/${editingRow._rowId}`,
          { method: "PUT", body: JSON.stringify({ row: vals }) }
        );
        const data = await r.json();
        if (!r.ok) throw new Error(data.error ?? "Update failed");
        message.success("Row updated");
      } else {
        const r = await adminFetch(
          `/api/tabular/${province}/${pollutant}/rows`,
          { method: "POST", body: JSON.stringify({ row: vals }) }
        );
        const data = await r.json();
        if (!r.ok) throw new Error(data.error ?? "Add failed");
        message.success("Row added");
      }
      setModalOpen(false);
      clearAdminTabularCache(province, pollutant);
      fetchData({ force: true });
    } catch (e) {
      Swal.fire({ icon: "error", title: "Save Error", text: e.message, confirmButtonColor: "#1677ff" });
    } finally {
      setSaving(false);
    }
  }

  const handleDelete = useCallback(async (row) => {
    try {
      const r = await adminFetch(
        `/api/tabular/${province}/${pollutant}/rows/${row._rowId}`,
        { method: "DELETE" }
      );
      const data = await r.json();
      if (!r.ok) throw new Error(data.error ?? "Delete failed");
      message.success("Row deleted");
      clearAdminTabularCache(province, pollutant);
      fetchData({ force: true });
    } catch (e) {
      Swal.fire({ icon: "error", title: "Delete Error", text: e.message, confirmButtonColor: "#1677ff" });
    }
  }, [fetchData, pollutant, province]);

  // ── Force sync from Google Sheets (bypasses all caches + overwrites MongoDB) ──
  async function handleForceSync() {
    if (fetchControllerRef.current) fetchControllerRef.current.abort();
    const controller = new AbortController();
    fetchControllerRef.current = controller;

    setForceSyncing(true);
    setCurrentPage(1);
    try {
      const base = getApiBase();
      const r = await fetch(`${base}/api/tabular/${province}/${pollutant}/force-sync`, {
        method: "POST",
        headers: { "X-Admin-Token": getToken() },
        signal: controller.signal,
      });
      if (!r.ok) {
        const err = await r.json().catch(() => ({}));
        throw new Error(err.error ?? `HTTP ${r.status}`);
      }
      const json = await r.json();
      if (controller.signal.aborted) return;
      const payload = normalizeAdminTabularPayload({ ...json, source: json.source ?? "sheet", sheetSyncing: false });
      writeAdminTabularCache(province, pollutant, payload);
      applyPayload(payload);
      const label = json.syncResult?.updated
        ? `Synced ${json.syncResult.rowCount?.toLocaleString() ?? ""} rows from Google Sheets`
        : `Sheet data unchanged (${json.syncResult?.rowCount?.toLocaleString() ?? ""} rows)`;
      message.success(label);
    } catch (e) {
      if (e.name === "AbortError") return;
      Swal.fire({ icon: "error", title: "Force Sync Failed", text: e.message, confirmButtonColor: "#1677ff" });
    } finally {
      if (!controller.signal.aborted) setForceSyncing(false);
    }
  }

  // ── CSV download ───────────────────────────────────────────────
  async function handleDownloadCsv() {
    const toExport = applyFilters(rows, exportFilters, columns);
    const filename = `${province}-${pollutant}-${new Date().toISOString().slice(0, 10)}.csv`;
    downloadCsv(toExport, columns, filename);
    try {
      const base = getApiBase();
      await fetch(`${base}/api/export-log`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          province, pollutant, filters: exportFilters,
          totalRecords: rows.length, exportedRecords: toExport.length,
          filename, type: "csv_download",
        }),
      });
    } catch { /* non-critical */ }
    message.success(`Exported ${toExport.length} rows`);
    setExportModalOpen(false);
  }

  // ── Send email ─────────────────────────────────────────────────
  async function handleSendEmail() {
    const email = emailRecipient.trim();
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      message.error("Enter a valid email address");
      return;
    }
    const toSend = applyFilters(rows, exportFilters, columns);
    setSending(true);
    try {
      const base = getApiBase();
      const r = await fetch(`${base}/api/share-email`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          to: email,
          province,
          pollutant: pollutant.toUpperCase(),
          columns,
          rows: toSend,
          totalRows: toSend.length,
          filters: exportFilters,
        }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error ?? "Failed to send");
      message.success(`Report sent to ${email}`);
      setExportModalOpen(false);
      setEmailRecipient("");
    } catch (e) {
      Swal.fire({ icon: "error", title: "Email Error", text: e.message, confirmButtonColor: "#1677ff" });
    } finally {
      setSending(false);
    }
  }

  // ── Table columns ──────────────────────────────────────────────
  const tableColumns = useMemo(() => {
    const dataCols = columns.map((col) => {
      const isDateCol = /date|time/i.test(col);
      return {
        title: col,
        dataIndex: col,
        key: col,
        ellipsis: true,
        width: col === "Status" ? 200 : isDateCol ? 180 : 120,
        // Sort newest-first by default on the date column
        ...(isDateCol ? {
          sorter: (a, b) => dayjs(a[col]).valueOf() - dayjs(b[col]).valueOf(),
          defaultSortOrder: "descend",
        } : {}),
        render: (val) => {
          if (col === "Status" && val) {
            const color = {
              Good: "green", Fair: "gold",
              "Unhealthy for Sensitive Groups": "orange",
              "Very Unhealthy": "red",
              "Acutely Unhealthy": "purple",
              Emergency: "magenta",
              Invalid: "default",
              "For Validation": "default",
            }[val] ?? "default";
            return <Tag color={color}>{val}</Tag>;
          }
          if (col === "AQI") {
            if (val == null) return <span style={{ color: "#9ca3af" }}>—</span>;
            const n = Number(val);
            if (!isFinite(n)) return val;
            const aqiColor = n <= 50 ? "#16a34a" : n <= 100 ? "#ca8a04" : n <= 150 ? "#ea580c" : n <= 200 ? "#dc2626" : n <= 300 ? "#9333ea" : "#9b1c1c";
            return <span style={{ color: aqiColor, fontWeight: 700 }}>{n}</span>;
          }
          if (/rolling\s*avg(?:erage)?/i.test(col)) {
            return formatMaxDecimals(val, 2);
          }
          if (/concentration/i.test(col)) {
            const n = parseFloat(val);
            return isFinite(n) ? n.toFixed(2) : (val ?? "—");
          }
          return val ?? "—";
        },
      };
    });

    dataCols.push({
      title: "Actions",
      key: "_actions",
      fixed: "right",
      width: 120,
      render: (_, row) => (
        <Space size={4}>
          <Button size="small" icon={<EditOutlined />} onClick={() => handleEdit(row)} />
          <Popconfirm
            title="Delete this row?"
            description="This action cannot be undone."
            onConfirm={() => handleDelete(row)}
            okText="Delete"
            okButtonProps={{ danger: true }}
          >
            <Button size="small" icon={<DeleteOutlined />} danger />
          </Popconfirm>
        </Space>
      ),
    });

    return dataCols;
  }, [columns, handleDelete, handleEdit]);

  // Sum of all column widths — prevents Ant Design fixed-column misalignment
  const tableScrollX = useMemo(
    () => tableColumns.reduce((sum, col) => sum + (typeof col.width === "number" ? col.width : 120), 0),
    [tableColumns]
  );

  const hasFilters = exportFilters.dateRange || exportFilters.statuses?.length ||
    exportFilters.aqiMin != null || exportFilters.aqiMax != null;

  return (
    <div style={{ padding: "clamp(12px, 3vw, 24px)" }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", flexWrap: "wrap", gap: 12, marginBottom: 20 }}>
        <div>
          <Title level={4} style={{ margin: 0 }}>Tabular Data Manager</Title>
          <Text type="secondary">View, edit, and export station air quality records</Text>
        </div>
        <Space wrap>
          <Button icon={<FilterOutlined />} onClick={() => setExportModalOpen(true)}>
            Export / Email
          </Button>
          <Button icon={<ReloadOutlined />} onClick={() => fetchData({ force: true })} loading={loading}>Refresh</Button>
          <Button
            icon={forceSyncing ? <SyncOutlined spin /> : <CloudDownloadOutlined />}
            onClick={handleForceSync}
            loading={forceSyncing}
            title="Bypass all caches and fetch directly from Google Sheets, then overwrite MongoDB"
          >
            Force Sync from Sheets
          </Button>
          <Button type="primary" icon={<PlusOutlined />} onClick={handleAdd}>Add Row</Button>
        </Space>
      </div>

      {/* Station / pollutant selectors */}
      <Space style={{ marginBottom: 16 }} wrap size={[8, 8]}>
        <Select value={province} style={{ minWidth: 140, flex: "1 1 140px" }} onChange={(v) => navigate(`/admin/tabular-manage/${v}`)}>
          {PROVINCE_OPTIONS.map((p) => <Option key={p.value} value={p.value}>{p.label}</Option>)}
        </Select>
        <Select value={pollutant} style={{ minWidth: 100, flex: "1 1 100px" }} onChange={setPollutant}>
          {POLLUTANT_OPTIONS.map((p) => <Option key={p.value} value={p.value}>{p.label}</Option>)}
        </Select>
        <Text type="secondary">{totalRows.toLocaleString()} total rows</Text>
        {dataSource && (
          <Tag
            color={dataSource === "sheet" ? "green" : dataSource === "stale-cache" ? "orange" : dataSource === "cache" ? "blue" : "default"}
            icon={sheetSyncing ? <SyncOutlined spin /> : null}
          >
            {sheetSyncing ? "Syncing from Sheets…" : dataSource === "sheet" ? "Live from Sheets" : dataSource === "cache" ? "Cached" : dataSource === "stale-cache" ? "Stale cache" : "MongoDB backup"}
          </Tag>
        )}
        {syncedAt && (
          <Text type="secondary" style={{ fontSize: 12 }}>
            Last fetched: {syncedAt.toLocaleTimeString()}
          </Text>
        )}
      </Space>

      <Alert
        type="warning"
        showIcon
        message="Changes here modify the local backup only. They will be overwritten on the next Google Sheets sync."
        style={{ marginBottom: 8 }}
        closable
      />

      {erraticCount > 0 && (
        <Alert
          type="error"
          showIcon
          style={{ marginBottom: 16 }}
          message={
            <Space>
              <span><strong>{erraticCount}</strong> erratic / invalid row{erraticCount !== 1 ? "s" : ""} detected (out-of-range AQI or negative concentration values)</span>
              <Button
                size="small"
                danger={!hideErratic}
                onClick={() => setHideErratic((v) => !v)}
              >
                {hideErratic ? "Show all rows" : "Hide erratic rows"}
              </Button>
            </Space>
          }
        />
      )}

      {/* Table */}
      <Table
        dataSource={displayRows}
        columns={tableColumns}
        rowKey="_rowId"
        loading={loading}
        scroll={{ x: tableScrollX, y: 520 }}
        size="small"
        pagination={{
          current: currentPage,
          pageSize,
          showSizeChanger: true,
          pageSizeOptions: ["20", "50", "100", "200", "500"],
          onChange: (page, size) => { setCurrentPage(page); if (size !== pageSize) { setPageSize(size); setCurrentPage(1); } },
          onShowSizeChange: (_, size) => { setPageSize(size); setCurrentPage(1); },
          showTotal: (t, range) => `${range[0]}–${range[1]} of ${t} rows`,
          showQuickJumper: true,
        }}
        bordered
        rowClassName={(row) => isErraticRow(row, columns) ? "erratic-row" : ""}
      />

      {/* ── Export / Email Modal ──────────────────────────────────── */}
      <Modal
        open={exportModalOpen}
        onCancel={() => setExportModalOpen(false)}
        title={<Space><FilterOutlined /> Export &amp; Send Data</Space>}
        width={560}
        footer={null}
        destroyOnClose
      >
        <Space direction="vertical" style={{ width: "100%" }} size={16}>

          <div>
            <Text strong>Date Range</Text>
            <div style={{ marginTop: 6 }}>
              <RangePicker
                style={{ width: "100%" }}
                onChange={(_, strs) =>
                  setExportFilters((f) => ({ ...f, dateRange: strs[0] ? strs : null }))
                }
              />
            </div>
          </div>

          <div>
            <Text strong>AQI Range</Text>
            <Space style={{ marginTop: 6 }}>
              <InputNumber
                min={0} max={500} placeholder="Min AQI" style={{ width: 120 }}
                onChange={(v) => setExportFilters((f) => ({ ...f, aqiMin: v }))}
              />
              <Text type="secondary">–</Text>
              <InputNumber
                min={0} max={500} placeholder="Max AQI" style={{ width: 120 }}
                onChange={(v) => setExportFilters((f) => ({ ...f, aqiMax: v }))}
              />
            </Space>
          </div>

          <div>
            <Text strong>Status Filter</Text>
            <div style={{ marginTop: 6 }}>
              <Select
                mode="multiple"
                style={{ width: "100%" }}
                placeholder="All statuses (leave empty for no filter)"
                options={STATUS_OPTIONS.map((s) => ({ value: s, label: s }))}
                onChange={(v) => setExportFilters((f) => ({ ...f, statuses: v }))}
                allowClear
              />
            </div>
          </div>

          <Alert
            type="info"
            showIcon
            message={
              hasFilters
                ? <><strong>{filteredRows.length.toLocaleString()}</strong> of {rows.length.toLocaleString()} rows match current filters</>
                : <><strong>{rows.length.toLocaleString()}</strong> rows will be exported (no filters applied)</>
            }
          />

          <div style={{ borderTop: "1px solid var(--aqm-border)", paddingTop: 14 }}>
            <Text strong>Download CSV</Text>
            <div style={{ marginTop: 8 }}>
              <Button
                block
                icon={<DownloadOutlined />}
                onClick={handleDownloadCsv}
                disabled={filteredRows.length === 0}
              >
                Download CSV ({filteredRows.length.toLocaleString()} rows)
              </Button>
            </div>
          </div>

          <div style={{ borderTop: "1px solid var(--aqm-border)", paddingTop: 14 }}>
            <Text strong>Send to Email</Text>
            <Text type="secondary" style={{ display: "block", fontSize: 12, marginBottom: 8 }}>
              Sends an HTML report (up to 100 rows shown) to the specified address. Filters above apply.
            </Text>
            <Space.Compact style={{ width: "100%" }}>
              <Input
                prefix={<MailOutlined />}
                placeholder="recipient@example.com"
                value={emailRecipient}
                onChange={(e) => setEmailRecipient(e.target.value)}
                onPressEnter={handleSendEmail}
              />
              <Button
                type="primary"
                icon={<MailOutlined />}
                loading={sending}
                onClick={handleSendEmail}
                disabled={filteredRows.length === 0}
              >
                Send
              </Button>
            </Space.Compact>
          </div>
        </Space>
      </Modal>

      {/* ── Add / Edit Modal ──────────────────────────────────────── */}
      <Modal
        open={modalOpen}
        onCancel={() => setModalOpen(false)}
        onOk={handleSave}
        confirmLoading={saving}
        title={editingRow ? "Edit Row" : "Add New Row"}
        width={600}
        okText={editingRow ? "Save Changes" : "Add Row"}
        destroyOnClose
      >
        <Form form={form} layout="vertical" style={{ maxHeight: 480, overflowY: "auto", paddingRight: 4 }}>
          {columns.map((col) => (
            <Form.Item key={col} name={col} label={col}>
              <Input placeholder={`Enter ${col}`} />
            </Form.Item>
          ))}
        </Form>
      </Modal>

      {/* Erratic row highlight */}
      <style>{`
        .erratic-row td { background: #fff1f0 !important; }
        .erratic-row:hover td { background: #ffe4e4 !important; }
        .dark .erratic-row td,
        [data-theme="dark"] .erratic-row td { background: #420806 !important; }
        .dark .erratic-row:hover td,
        [data-theme="dark"] .erratic-row:hover td { background: #5c0e09 !important; }
      `}</style>
    </div>
  );
}
