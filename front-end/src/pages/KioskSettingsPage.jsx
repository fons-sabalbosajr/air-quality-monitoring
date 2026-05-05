/**
 * KioskSettingsPage – Kiosk display settings embedded inside /admin layout.
 * Route: /admin/kiosk-settings
 *
 * Uses a draft/save workflow: all edits are local until the user clicks
 * "Save Changes", which writes to localStorage and broadcasts via
 * BroadcastChannel so the kiosk page updates instantly in any open tab.
 */
import { useState, useEffect } from "react";
import Swal from "sweetalert2";
import {
  Tabs,
  Switch,
  Collapse,
  Divider,
  Button,
  Typography,
  Space,
  Tag,
  Alert,
  Input,
  InputNumber,
  Slider,
  Tooltip,
} from "antd";
import {
  EyeOutlined,
  EyeInvisibleOutlined,
  ExportOutlined,
  MonitorOutlined,
  SaveOutlined,
  UndoOutlined,
  CheckCircleOutlined,
  ToolOutlined,
  DashboardOutlined,
  LayoutOutlined,
  ClockCircleOutlined,
} from "@ant-design/icons";
import {
  KioskSettingsProvider,
  useKioskSettings,
  DEFAULT_KIOSK_SETTINGS,
} from "../context/KioskSettingsContext";

const { Title, Text } = Typography;

/* ── Station definitions (merged stations have two pollutants) ── */
const SINGLE_STATIONS = [
  { key: "clark",        label: "Clark AQMS",         address: "Clark Freeport Zone, Pampanga" },
  { key: "san-fernando", label: "San Fernando AQMS",  address: "San Fernando, Pampanga" },
];

const MERGED_STATIONS = [
  {
    province: "meycauayan",
    label: "Meycauayan AQMS",
    address: "Meycauayan City, Bulacan",
    pollutants: [
      { key: "meycauayan_pm10", label: "PM10" },
      { key: "meycauayan_pm25", label: "PM2.5" },
    ],
  },
  {
    province: "zambales",
    label: "Zambales AQMS",
    address: "Santa Cruz, Zambales",
    pollutants: [
      { key: "zambales_pm10", label: "PM10" },
      { key: "zambales_pm25", label: "PM2.5" },
    ],
  },
];

/* ── Reusable toggle row ── */
function ToggleRow({ label, desc, checked, onChange, hidden, indent = false }) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        padding: "10px 14px",
        borderRadius: 8,
        border: "1px solid var(--aqm-border)",
        opacity: hidden ? 0.55 : 1,
        transition: "opacity 0.2s",
        marginLeft: indent ? 20 : 0,
      }}
    >
      <Space direction="vertical" size={0}>
        <Space size={6}>
          <Text strong>{label}</Text>
          {hidden && <Tag color="default">Hidden</Tag>}
        </Space>
        {desc && <Text type="secondary" style={{ fontSize: 12 }}>{desc}</Text>}
      </Space>
      <Switch
        checked={checked}
        onChange={onChange}
        checkedChildren={<EyeOutlined />}
        unCheckedChildren={<EyeInvisibleOutlined />}
      />
    </div>
  );
}

function SettingsPanel() {
  const { settings, update } = useKioskSettings();
  const [draft, setDraft] = useState(() => ({ ...settings }));
  const [savedFlag, setSavedFlag] = useState(false);

  const isDirty = JSON.stringify(draft) !== JSON.stringify(settings);

  useEffect(() => {
    if (!isDirty) setDraft({ ...settings });
  }, [settings]); // eslint-disable-line react-hooks/exhaustive-deps

  function patchDraft(patch) {
    setDraft((d) => ({ ...d, ...patch }));
  }

  function setAqiValueVisible(key, value) {
    setDraft((d) => ({
      ...d,
      aqiValueVisible: { ...d.aqiValueVisible, [key]: value },
    }));
  }

  function setAqiDateTimeVisible(key, value) {
    setDraft((d) => ({
      ...d,
      aqiDateTimeVisible: { ...d.aqiDateTimeVisible, [key]: value },
    }));
  }

  function handleSave() {
    update(draft);
    setSavedFlag(true);
    setTimeout(() => setSavedFlag(false), 2500);
  }

  function handleDiscard() {
    setDraft({ ...settings });
  }

  async function handleReset() {
    const result = await Swal.fire({
      title: "Reset to Defaults?",
      text: "All Kiosk display settings will be reverted to their default values.",
      icon: "warning",
      showCancelButton: true,
      confirmButtonColor: "#dc2626",
      cancelButtonColor: "#6b7280",
      confirmButtonText: "Yes, reset",
      cancelButtonText: "Cancel",
    });
    if (!result.isConfirmed) return;
    const fresh = { ...DEFAULT_KIOSK_SETTINGS };
    setDraft(fresh);
    update(fresh);
    setSavedFlag(true);
    setTimeout(() => setSavedFlag(false), 2500);
  }

  const kioskUrl = `${import.meta.env.BASE_URL?.replace(/\/$/, "") ?? ""}/ `;

  const tabItems = [
    /* ── Tab 1: AQI Dashboard ── */
    {
      key: "aqi-dashboard",
      label: (
        <Space size={6}>
          <DashboardOutlined />
          <span>AQI Dashboard</span>
        </Space>
      ),
      children: (
        <Space direction="vertical" style={{ width: "100%" }} size={12}>
          <Alert
            type="info"
            showIcon
            message="Control AQI value and update time visibility per station and pollutant."
            description="When the AQI value is hidden, it is also hidden in all related UI components (gauge, emoji, category badge, meter, etc.)."
          />

          <Collapse
            defaultActiveKey={[]}
            size="small"
            items={[
              /* Single-pollutant stations */
              ...SINGLE_STATIONS.map((st) => {
                const valVisible = draft.aqiValueVisible?.[st.key] !== false;
                const dtVisible = draft.aqiDateTimeVisible?.[st.key] !== false;
                const hiddenCount = [!valVisible, !dtVisible].filter(Boolean).length;
                return {
                  key: st.key,
                  label: (
                    <Space size={8}>
                      <Text strong>{st.label}</Text>
                      <Text type="secondary" style={{ fontSize: 12 }}>{st.address}</Text>
                      {hiddenCount > 0 && (
                        <Tag color="orange" style={{ fontSize: 11 }}>{hiddenCount} hidden</Tag>
                      )}
                    </Space>
                  ),
                  children: (
                    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                      <ToggleRow
                        label="AQI Value"
                        desc="Show or hide the numeric AQI reading, emoji, and category badge."
                        checked={valVisible}
                        onChange={(v) => setAqiValueVisible(st.key, v)}
                        hidden={!valVisible}
                      />
                      <ToggleRow
                        label="Update Date & Time"
                        desc="Show or hide the data update timestamp."
                        checked={dtVisible}
                        onChange={(v) => setAqiDateTimeVisible(st.key, v)}
                        hidden={!dtVisible}
                      />
                    </div>
                  ),
                };
              }),

              /* Merged (dual-pollutant) stations */
              ...MERGED_STATIONS.map((st) => {
                const allKeys = st.pollutants.map((p) => p.key);
                const hiddenCount = allKeys.filter(
                  (k) =>
                    draft.aqiValueVisible?.[k] === false ||
                    draft.aqiDateTimeVisible?.[k] === false
                ).length;
                return {
                  key: st.province,
                  label: (
                    <Space size={8}>
                      <Text strong>{st.label}</Text>
                      <Text type="secondary" style={{ fontSize: 12 }}>{st.address}</Text>
                      <Tag color="blue" style={{ fontSize: 11 }}>PM10 + PM2.5</Tag>
                      {hiddenCount > 0 && (
                        <Tag color="orange" style={{ fontSize: 11 }}>{hiddenCount} hidden</Tag>
                      )}
                    </Space>
                  ),
                  children: (
                    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                      {st.pollutants.map((p) => {
                        const valVisible = draft.aqiValueVisible?.[p.key] !== false;
                        const dtVisible = draft.aqiDateTimeVisible?.[p.key] !== false;
                        return (
                          <div key={p.key}>
                            <Text
                              type="secondary"
                              style={{ fontSize: 12, fontWeight: 600, display: "block", marginBottom: 6, marginLeft: 2 }}
                            >
                              {p.label} Pollutant
                            </Text>
                            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                              <ToggleRow
                                label="AQI Value"
                                desc={`Show or hide the ${p.label} AQI numeric value, emoji, and category badge.`}
                                checked={valVisible}
                                onChange={(v) => setAqiValueVisible(p.key, v)}
                                hidden={!valVisible}
                                indent
                              />
                              <ToggleRow
                                label="Update Date & Time"
                                desc={`Show or hide the ${p.label} data timestamp.`}
                                checked={dtVisible}
                                onChange={(v) => setAqiDateTimeVisible(p.key, v)}
                                hidden={!dtVisible}
                                indent
                              />
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  ),
                };
              }),
            ]}
          />
        </Space>
      ),
    },

    /* ── Tab 2: Display Sections ── */
    {
      key: "display",
      label: (
        <Space size={6}>
          <LayoutOutlined />
          <span>Display</span>
        </Space>
      ),
      children: (
        <Space direction="vertical" style={{ width: "100%" }} size={10}>
          <Alert
            type="info"
            showIcon
            message="Toggle individual sections that appear on the Kiosk page."
          />
          <ToggleRow
            label="Weather Panel"
            desc="Current weather data (temperature, humidity, wind, etc.) on the AQI hero card."
            checked={draft.showWeather !== false}
            onChange={(v) => patchDraft({ showWeather: v })}
            hidden={draft.showWeather === false}
          />
          <ToggleRow
            label="Hourly Weather Forecast"
            desc="24-hour weather forecast card below the AQI hero card."
            checked={draft.showHourlyForecast !== false}
            onChange={(v) => patchDraft({ showHourlyForecast: v })}
            hidden={draft.showHourlyForecast === false}
          />
          <ToggleRow
            label="Wind Map"
            desc="Wind direction map card in the station details section."
            checked={draft.showWindMap !== false}
            onChange={(v) => patchDraft({ showWindMap: v })}
            hidden={draft.showWindMap === false}
          />
          <ToggleRow
            label="AQMS Stations Carousel"
            desc="Scrollable list of all monitoring stations at the bottom."
            checked={draft.showStationCarousel !== false}
            onChange={(v) => patchDraft({ showStationCarousel: v })}
            hidden={draft.showStationCarousel === false}
          />
          <ToggleRow
            label="YouTube Videos"
            desc="EMB Region 3 air quality update YouTube embeds."
            checked={draft.showYoutubeVideos !== false}
            onChange={(v) => patchDraft({ showYoutubeVideos: v })}
            hidden={draft.showYoutubeVideos === false}
          />
          <ToggleRow
            label="EMB Contact Card"
            desc="Agency contact information and CTA card at the bottom."
            checked={draft.showContactCard !== false}
            onChange={(v) => patchDraft({ showContactCard: v })}
            hidden={draft.showContactCard === false}
          />
        </Space>
      ),
    },

    /* ── Tab 3: Cycling ── */
    {
      key: "cycling",
      label: (
        <Space size={6}>
          <ClockCircleOutlined />
          <span>Cycling</span>
        </Space>
      ),
      children: (
        <Space direction="vertical" style={{ width: "100%" }} size={16}>
          <Alert
            type="info"
            showIcon
            message="Controls the auto-cycling behavior between station views."
          />
          <div>
            <Text strong style={{ display: "block", marginBottom: 6 }}>Station Cycle Duration</Text>
            <Text type="secondary" style={{ fontSize: 12, display: "block", marginBottom: 12 }}>
              How many seconds each station stays on screen before automatically advancing to the next one.
            </Text>
            <Space align="center" wrap>
              <Slider
                min={5}
                max={120}
                step={5}
                value={draft.cycleIntervalSec ?? 25}
                onChange={(v) => patchDraft({ cycleIntervalSec: v })}
                style={{ width: 220 }}
                tooltip={{ formatter: (v) => `${v}s` }}
              />
              <InputNumber
                min={5}
                max={120}
                value={draft.cycleIntervalSec ?? 25}
                onChange={(v) => patchDraft({ cycleIntervalSec: v ?? 25 })}
                addonAfter="sec"
                style={{ width: 110 }}
              />
            </Space>
            <Text type="secondary" style={{ fontSize: 11, display: "block", marginTop: 6 }}>
              Default: 25 seconds. Longer intervals allow more time for AQI data to load.
            </Text>
          </div>
        </Space>
      ),
    },

    /* ── Tab 4: Maintenance ── */
    {
      key: "maintenance",
      label: (
        <Space size={6}>
          <ToolOutlined />
          <span>Maintenance</span>
          {draft.kioskMaintenance && <Tag color="error" style={{ marginInlineStart: 0 }}>ON</Tag>}
        </Space>
      ),
      children: (
        <Space direction="vertical" style={{ width: "100%" }} size={14}>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              padding: "10px 14px",
              borderRadius: 8,
              border: "1px solid var(--aqm-border)",
            }}
          >
            <Space direction="vertical" size={0}>
              <Text strong>Enable Maintenance Overlay</Text>
              <Text type="secondary" style={{ fontSize: 12 }}>
                When on, a maintenance notice covers the kiosk page.
              </Text>
            </Space>
            <Switch
              checked={draft.kioskMaintenance ?? false}
              onChange={(v) => patchDraft({ kioskMaintenance: v })}
              checkedChildren="On"
              unCheckedChildren="Off"
            />
          </div>
          {draft.kioskMaintenance && (
            <>
              <Input.TextArea
                placeholder="Optional maintenance message (leave blank for default)"
                value={draft.kioskMaintenanceMsg ?? ""}
                onChange={(e) => patchDraft({ kioskMaintenanceMsg: e.target.value })}
                rows={2}
                maxLength={200}
                showCount
              />
              <Alert
                type="warning"
                showIcon
                message="Maintenance mode is active. The kiosk will show an overlay instead of AQI data."
              />
            </>
          )}
        </Space>
      ),
    },
  ];

  return (
    <div style={{ maxWidth: "min(720px, 100%)" }}>
      <Space align="center" style={{ marginBottom: 8 }}>
        <MonitorOutlined style={{ fontSize: 18 }} />
        <Title level={4} style={{ margin: 0 }}>
          Kiosk Settings
        </Title>
      </Space>

      <Alert
        type="info"
        showIcon
        style={{ marginBottom: 16 }}
        message="How settings work"
        description={
          <>
            Edit settings below then click <strong>Save Changes</strong>. The{" "}
            <a href={kioskUrl} target="_blank" rel="noopener noreferrer">
              kiosk display <ExportOutlined style={{ fontSize: 11 }} />
            </a>{" "}
            updates in real-time — no page reload required.
          </>
        }
      />

      <Tabs
        type="card"
        size="middle"
        style={{ marginBottom: 16 }}
        tabBarStyle={{ overflowX: "auto", flexWrap: "nowrap" }}
        items={tabItems}
      />

      <Divider />

      {/* ── Action bar ── */}
      <Space wrap>
        <Button
          type="primary"
          icon={savedFlag ? <CheckCircleOutlined /> : <SaveOutlined />}
          onClick={handleSave}
          disabled={!isDirty && !savedFlag}
        >
          {savedFlag ? "Saved!" : "Save Changes"}
        </Button>
        {isDirty && (
          <Button icon={<UndoOutlined />} onClick={handleDiscard}>
            Discard
          </Button>
        )}
        <Button danger onClick={handleReset}>
          Reset to Defaults
        </Button>
        <Button
          icon={<ExportOutlined />}
          href={kioskUrl}
          target="_blank"
        >
          Open Kiosk
        </Button>
      </Space>

      {isDirty && (
        <Alert
          type="warning"
          showIcon
          message="You have unsaved changes — click Save Changes to apply them to the kiosk."
          style={{ marginTop: 16 }}
        />
      )}
    </div>
  );
}

export default function KioskSettingsPage() {
  return (
    <KioskSettingsProvider>
      <SettingsPanel />
    </KioskSettingsProvider>
  );
}
