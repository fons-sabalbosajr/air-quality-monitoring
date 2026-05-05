/**
 * NlexAdmin – Settings configuration page for the /nlex LED wall display
 * Route: /nlex-admin
 */
import { useEffect } from "react";
import {
  ConfigProvider,
  Card,
  Switch,
  Radio,
  Divider,
  Button,
  Typography,
  Space,
  Tag,
  theme,
} from "antd";
import {
  SettingOutlined,
  EyeOutlined,
  EyeInvisibleOutlined,
  ExportOutlined,
} from "@ant-design/icons";
import { NlexSettingsProvider, useNlexSettings } from "../context/NlexSettingsContext";

const { Title, Text } = Typography;

const STATIONS = [
  { key: "clark", label: "Clark AQMS", address: "Clark Freeport Zone, Pampanga" },
  { key: "san-fernando", label: "San Fernando AQMS", address: "San Fernando, Pampanga" },
  { key: "meycauayan", label: "Meycauayan AQMS", address: "Meycauayan City, Bulacan" },
  { key: "zambales", label: "Zambales AQMS", address: "Olongapo City, Zambales" },
];

const THEME_OPTIONS = [
  { label: "Auto (weather-based)", value: "auto" },
  { label: "Light", value: "light" },
  { label: "Dark", value: "dark" },
];

function AdminPanel() {
  const { settings, update } = useNlexSettings();
  const { token } = theme.useToken();

  function toggleStation(key) {
    update({
      stationsVisible: {
        ...settings.stationsVisible,
        [key]: !settings.stationsVisible[key],
      },
    });
  }

  return (
    <div
      style={{
        minHeight: "100vh",
        background: token.colorBgLayout,
        padding: "clamp(16px, 4vw, 32px) clamp(12px, 3vw, 24px)",
        fontFamily: "'Poppins', sans-serif",
      }}
    >
      <div style={{ maxWidth: "min(640px, 100%)", margin: "0 auto" }}>
        {/* Header */}
        <div style={{ marginBottom: 24 }}>
          <Space align="center" style={{ marginBottom: 4 }}>
            <SettingOutlined style={{ fontSize: 22, color: token.colorPrimary }} />
            <Title level={3} style={{ margin: 0 }}>
              NLEX Display Settings
            </Title>
          </Space>
          <Text type="secondary">
            Configure the real-time LED wall display at{" "}
            <a href="/air-quality-monitoring/nlex" target="_blank" rel="noopener noreferrer">
              /nlex <ExportOutlined style={{ fontSize: 11 }} />
            </a>
          </Text>
        </div>

        {/* Station visibility */}
        <Card
          title="Station Cards"
          style={{ marginBottom: 16 }}
          extra={
            <Text type="secondary" style={{ fontSize: 12 }}>
              Show / hide stations on the display
            </Text>
          }
        >
          <Space direction="vertical" style={{ width: "100%" }} size={12}>
            {STATIONS.map((st) => {
              const visible = settings.stationsVisible[st.key] ?? true;
              return (
                <div
                  key={st.key}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    padding: "8px 12px",
                    borderRadius: 8,
                    background: token.colorBgContainer,
                    border: `1px solid ${token.colorBorderSecondary}`,
                  }}
                >
                  <Space direction="vertical" size={0}>
                    <Space>
                      <Text strong>{st.label}</Text>
                      {!visible && (
                        <Tag color="default" style={{ fontSize: 11 }}>
                          Hidden
                        </Tag>
                      )}
                    </Space>
                    <Text type="secondary" style={{ fontSize: 12 }}>
                      {st.address}
                    </Text>
                  </Space>
                  <Switch
                    checked={visible}
                    onChange={() => toggleStation(st.key)}
                    checkedChildren={<EyeOutlined />}
                    unCheckedChildren={<EyeInvisibleOutlined />}
                  />
                </div>
              );
            })}
          </Space>
        </Card>

        {/* Theme */}
        <Card title="Display Theme" style={{ marginBottom: 16 }}>
          <Space direction="vertical" size={8}>
            <Text type="secondary" style={{ fontSize: 13 }}>
              Override the automatic day/night theme detection.
            </Text>
            <Radio.Group
              options={THEME_OPTIONS}
              value={settings.theme}
              onChange={(e) => update({ theme: e.target.value })}
              optionType="button"
              buttonStyle="solid"
            />
          </Space>
        </Card>

        <Divider />

        {/* Actions */}
        <Space>
          <Button
            type="primary"
            icon={<ExportOutlined />}
            href="/air-quality-monitoring/nlex"
            target="_blank"
          >
            Open Display
          </Button>
          <Button
            onClick={() => {
              update({
                stationsVisible: {
                  clark: true,
                  "san-fernando": true,
                  meycauayan: true,
                  zambales: true,
                },
                theme: "auto",
              });
            }}
          >
            Reset to Defaults
          </Button>
        </Space>
      </div>
    </div>
  );
}

export default function NlexAdmin() {
  useEffect(() => {
    document.title = "NLEX Display Settings — EMB R3";
  }, []);

  return (
    <ConfigProvider>
      <NlexSettingsProvider>
        <AdminPanel />
      </NlexSettingsProvider>
    </ConfigProvider>
  );
}
