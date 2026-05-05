/**
 * AdminLogsPage — export & email-share activity log viewer.
 * Route: /admin/logs
 * Protected by AdminPinGate.
 */
import { useState, useEffect, useCallback } from "react";
import {
  Table, Tabs, Button, Typography, Space, Tag, Tooltip, Badge,
} from "antd";
import {
  DownloadOutlined, MailOutlined, ReloadOutlined,
  FileTextOutlined, FilterOutlined,
} from "@ant-design/icons";
import { getApiBase } from "../util/apiBase";

const { Title, Text } = Typography;

function fmtDate(val) {
  if (!val) return "—";
  const d = new Date(val);
  return isNaN(d) ? String(val) : d.toLocaleString("en-PH", {
    timeZone: "Asia/Manila",
    dateStyle: "medium",
    timeStyle: "short",
  });
}

function fmtFilters(filters) {
  if (!filters || typeof filters !== "object") return "—";
  const parts = [];
  if (filters.dateRange?.[0]) parts.push(`${filters.dateRange[0]} → ${filters.dateRange[1]}`);
  if (filters.statuses?.length) parts.push(`Status: ${filters.statuses.join(", ")}`);
  if (filters.aqiMin != null) parts.push(`AQI ≥ ${filters.aqiMin}`);
  if (filters.aqiMax != null) parts.push(`AQI ≤ ${filters.aqiMax}`);
  return parts.length ? parts.join("  ·  ") : "None";
}

const PROVINCE_LABELS = {
  clark: "Clark",
  "san-fernando": "San Fernando",
  meycauayan: "Meycauayan",
  zambales: "Zambales",
};

export default function AdminLogsPage() {
  const [exportLogs, setExportLogs] = useState([]);
  const [emailLogs,  setEmailLogs]  = useState([]);
  const [loadingExport, setLoadingExport] = useState(false);
  const [loadingEmail,  setLoadingEmail]  = useState(false);

  const fetchExportLogs = useCallback(async () => {
    setLoadingExport(true);
    try {
      const r = await fetch(`${getApiBase()}/api/export-logs?limit=500`);
      const j = await r.json();
      setExportLogs((j.logs ?? []).map((l, i) => ({ ...l, _key: String(l._id ?? i) })));
    } catch {
      setExportLogs([]);
    } finally {
      setLoadingExport(false);
    }
  }, []);

  const fetchEmailLogs = useCallback(async () => {
    setLoadingEmail(true);
    try {
      const r = await fetch(`${getApiBase()}/api/email-share-logs?limit=500`);
      const j = await r.json();
      setEmailLogs((j.logs ?? []).map((l, i) => ({ ...l, _key: String(l._id ?? i) })));
    } catch {
      setEmailLogs([]);
    } finally {
      setLoadingEmail(false);
    }
  }, []);

  useEffect(() => {
    fetchExportLogs();
    fetchEmailLogs();
  }, [fetchExportLogs, fetchEmailLogs]);

  // ── Export log columns ──────────────────────────────────────────
  const exportColumns = [
    {
      title: "Date / Time",
      dataIndex: "exportedAt",
      key: "exportedAt",
      width: 180,
      render: fmtDate,
      sorter: (a, b) => new Date(a.exportedAt) - new Date(b.exportedAt),
      defaultSortOrder: "descend",
    },
    {
      title: "Station",
      dataIndex: "province",
      key: "province",
      width: 140,
      render: (v) => PROVINCE_LABELS[v] ?? v ?? "—",
    },
    {
      title: "Pollutant",
      dataIndex: "pollutant",
      key: "pollutant",
      width: 90,
      render: (v) => v ? <Tag color="blue">{v.toUpperCase()}</Tag> : "—",
    },
    {
      title: "Exported",
      dataIndex: "exportedRecords",
      key: "exportedRecords",
      width: 100,
      render: (v, r) => (
        <Text>
          {v != null ? v.toLocaleString() : "—"}
          {r.totalRecords > 0 && v != null && v < r.totalRecords && (
            <Text type="secondary" style={{ fontSize: 11, marginLeft: 4 }}>
              / {r.totalRecords.toLocaleString()}
            </Text>
          )}
        </Text>
      ),
    },
    {
      title: "Filters Applied",
      dataIndex: "filters",
      key: "filters",
      ellipsis: true,
      render: (v) => <Text type="secondary" style={{ fontSize: 12 }}>{fmtFilters(v)}</Text>,
    },
    {
      title: "File",
      dataIndex: "filename",
      key: "filename",
      width: 240,
      ellipsis: true,
      render: (v) => v
        ? <><DownloadOutlined style={{ marginRight: 4, color: "#1677ff" }} /><Text code style={{ fontSize: 11 }}>{v}</Text></>
        : "—",
    },
  ];

  // ── Email log columns ───────────────────────────────────────────
  const emailColumns = [
    {
      title: "Date / Time",
      dataIndex: "sentAt",
      key: "sentAt",
      width: 180,
      render: fmtDate,
      sorter: (a, b) => new Date(a.sentAt) - new Date(b.sentAt),
      defaultSortOrder: "descend",
    },
    {
      title: "Recipient",
      dataIndex: "to",
      key: "to",
      width: 180,
      render: (v) => <Text><MailOutlined style={{ marginRight: 4, color: "#1677ff" }} />{v ?? "—"}</Text>,
    },
    {
      title: "Station",
      dataIndex: "province",
      key: "province",
      width: 140,
      render: (v) => PROVINCE_LABELS[v] ?? v ?? "—",
    },
    {
      title: "Pollutant",
      dataIndex: "pollutant",
      key: "pollutant",
      width: 90,
      render: (v) => v ? <Tag color="blue">{v.toUpperCase()}</Tag> : "—",
    },
    {
      title: "Records Sent",
      dataIndex: "totalRows",
      key: "totalRows",
      width: 110,
      render: (v) => v != null ? v.toLocaleString() : "—",
    },
    {
      title: "Filters Applied",
      dataIndex: "filters",
      key: "filters",
      ellipsis: true,
      render: (v) => <Text type="secondary" style={{ fontSize: 12 }}>{fmtFilters(v)}</Text>,
    },
  ];

  const tabItems = [
    {
      key: "export",
      label: (
        <Space size={6}>
          <DownloadOutlined />
          CSV Downloads
          <Badge count={exportLogs.length} showZero style={{ backgroundColor: "#1677ff" }} />
        </Space>
      ),
      children: (
        <Table
          dataSource={exportLogs}
          columns={exportColumns}
          rowKey="_key"
          loading={loadingExport}
          size="small"
          scroll={{ x: "max-content", y: 500 }}
          bordered
          pagination={{
            pageSize: 50,
            showSizeChanger: true,
            pageSizeOptions: ["20", "50", "100"],
            showTotal: (t, r) => `${r[0]}–${r[1]} of ${t}`,
          }}
        />
      ),
    },
    {
      key: "email",
      label: (
        <Space size={6}>
          <MailOutlined />
          Email Shares
          <Badge count={emailLogs.length} showZero style={{ backgroundColor: "#1677ff" }} />
        </Space>
      ),
      children: (
        <Table
          dataSource={emailLogs}
          columns={emailColumns}
          rowKey="_key"
          loading={loadingEmail}
          size="small"
          scroll={{ x: "max-content", y: 500 }}
          bordered
          pagination={{
            pageSize: 50,
            showSizeChanger: true,
            pageSizeOptions: ["20", "50", "100"],
            showTotal: (t, r) => `${r[0]}–${r[1]} of ${t}`,
          }}
        />
      ),
    },
  ];

  return (
    <div style={{ padding: "clamp(12px, 3vw, 24px)" }}>
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", flexWrap: "wrap", gap: 12, marginBottom: 20 }}>
        <div>
          <Title level={4} style={{ margin: 0 }}>
            <FileTextOutlined style={{ marginRight: 8 }} />
            Export &amp; Share Logs
          </Title>
          <Text type="secondary">Audit trail of all CSV downloads and email reports sent from the Data Manager</Text>
        </div>
        <Button
          icon={<ReloadOutlined />}
          onClick={() => { fetchExportLogs(); fetchEmailLogs(); }}
          loading={loadingExport || loadingEmail}
        >
          Refresh
        </Button>
      </div>

      <Tabs items={tabItems} defaultActiveKey="export" />
    </div>
  );
}
