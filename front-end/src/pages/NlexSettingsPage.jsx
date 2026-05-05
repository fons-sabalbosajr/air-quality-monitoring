/**
 * NlexSettingsPage – NLEX display settings embedded inside /admin layout.
 * Route: /admin/nlex-settings
 *
 * Uses a draft/save workflow: all edits are local until the user clicks
 * "Save Changes", which writes to localStorage and broadcasts via
 * BroadcastChannel so /nlex updates instantly in any open tab.
 */
import { useState, useEffect } from "react";
import Swal from "sweetalert2";
import {
  Tabs,
  Switch,
  Radio,
  Divider,
  Button,
  Typography,
  Space,
  Tag,
  Alert,
  Input,
  InputNumber,
  Slider,
  Collapse,
} from "antd";
import {
  ToolOutlined,
  EyeOutlined,
  EyeInvisibleOutlined,
  ExportOutlined,
  MonitorOutlined,
  SaveOutlined,
  UndoOutlined,
  CheckCircleOutlined,
  AppstoreOutlined,
  PlayCircleOutlined,
  LayoutOutlined,
  BgColorsOutlined,
  ThunderboltOutlined,
} from "@ant-design/icons";
import {
  NlexSettingsProvider,
  useNlexSettings,
  DEFAULT_SETTINGS,
} from "../context/NlexSettingsContext";

const { Title, Text } = Typography;

const STATIONS = [
  { key: "clark",        label: "Clark AQM Station",        address: "Clark Freeport Zone, Pampanga" },
  { key: "san-fernando", label: "San Fernando AQM Station", address: "San Fernando, Pampanga" },
  { key: "meycauayan",   label: "Meycauayan AQM Station",   address: "Meycauayan City, Bulacan" },
  { key: "zambales",     label: "Zambales AQM Station",      address: "Olongapo City, Zambales" },
];

// Per-station pollutant parameters (key matches pollutantsVisible keys)
const STATION_POLLUTANTS = [
  { station: "Clark",        params: [{ key: "clark_pm10",         label: "PM10" }] },
  { station: "San Fernando", params: [{ key: "san-fernando_pm10",  label: "PM10" }] },
  { station: "Meycauayan",   params: [{ key: "meycauayan_pm10",    label: "PM10" }, { key: "meycauayan_pm25", label: "PM2.5" }] },
  { station: "Zambales",     params: [{ key: "zambales_pm10",      label: "PM10" }, { key: "zambales_pm25",   label: "PM2.5" }] },
];

const THEME_OPTIONS = [
  { label: "Auto (weather-based)", value: "auto" },
  { label: "Light",                value: "light" },
  { label: "Dark",                 value: "dark" },
];

const SPEED_OPTIONS = [
  { label: "Slow (8 s)",   value: "slow" },
  { label: "Normal (5 s)", value: "normal" },
  { label: "Fast (3 s)",   value: "fast" },
];

const COMPONENT_TOGGLES = [
  { key: "showHeader",    label: "Header",          desc: "Logos + agency title block" },
  { key: "showDateTime",  label: "Date & Time",     desc: "Date/time line below \"Air Quality Index\"" },
  { key: "showSubtitle",  label: "Subtitle",        desc: "\"Real-time Particulate Matter Monitor\u2026\" line" },
  { key: "showAqiLegend", label: "AQI Legend Card", desc: "AQI scale reference band bar" },
  { key: "showFooter",    label: "Footer",          desc: "Office address, website and live clock" },
];

/* ── Shared row style ─────────────────────────────────────── */
function ToggleRow({ label, desc, checked, onChange, hidden }) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        padding: "10px 14px",
        borderRadius: 8,
        border: "1px solid var(--aqm-border)",
        opacity: hidden ? 0.5 : 1,
        transition: "opacity 0.2s",
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
  const { settings, update } = useNlexSettings();
  const [draft, setDraft] = useState(() => ({ ...settings }));
  const [savedFlag, setSavedFlag] = useState(false);

  const isDirty = JSON.stringify(draft) !== JSON.stringify(settings);

  // When settings update from another source and there are no local edits, sync draft
  useEffect(() => {
    if (!isDirty) setDraft({ ...settings });
  }, [settings]); // eslint-disable-line react-hooks/exhaustive-deps

  function patchDraft(patch) {
    setDraft((d) => ({ ...d, ...patch }));
  }

  function toggleStation(key) {
    setDraft((d) => ({
      ...d,
      stationsVisible: { ...d.stationsVisible, [key]: !d.stationsVisible[key] },
    }));
  }

  function toggleCarouselStation(key) {
    setDraft((d) => ({
      ...d,
      carouselStationsVisible: {
        ...d.carouselStationsVisible,
        [key]: !(d.carouselStationsVisible?.[key] ?? true),
      },
    }));
  }

  function togglePollutant(key) {
    setDraft((d) => ({
      ...d,
      pollutantsVisible: {
        ...d.pollutantsVisible,
        [key]: !(d.pollutantsVisible?.[key] ?? true),
      },
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
      text: "All NLEX display settings will be reverted to their default values.",
      icon: "warning",
      showCancelButton: true,
      confirmButtonColor: "#dc2626",
      cancelButtonColor: "#6b7280",
      confirmButtonText: "Yes, reset",
      cancelButtonText: "Cancel",
    });
    if (!result.isConfirmed) return;
    const fresh = { ...DEFAULT_SETTINGS };
    setDraft(fresh);
    update(fresh);
    setSavedFlag(true);
    setTimeout(() => setSavedFlag(false), 2500);
  }

  const hiddenCount = STATIONS.filter(
    (st) => draft.stationsVisible[st.key] === false,
  ).length;
  const carouselHiddenCount = STATIONS.filter(
    (st) => (draft.carouselStationsVisible?.[st.key] ?? true) === false,
  ).length;
  const pollutantsHiddenCount = STATION_POLLUTANTS.flatMap((s) => s.params).filter(
    (p) => (draft.pollutantsVisible?.[p.key] ?? true) === false,
  ).length;

  const nlexUrl = `${import.meta.env.BASE_URL?.replace(/\/$/, "") ?? ""}/nlex`;

  const tabItems = [
    /* ── Tab 1: Stations ── */
    {
      key: "stations",
      label: (
        <Space size={6}>
          <MonitorOutlined />
          <span>Stations</span>
          {(hiddenCount > 0 || carouselHiddenCount > 0 || pollutantsHiddenCount > 0) && (
            <Tag color="warning" style={{ marginInlineStart: 0 }}>
              {hiddenCount + carouselHiddenCount + pollutantsHiddenCount}
            </Tag>
          )}
        </Space>
      ),
      children: (
        <Space direction="vertical" style={{ width: "100%" }} size={10}>
          <Alert
            type="info"
            showIcon
            message="Show or hide individual station cards on the display."
          />

          <Collapse
            defaultActiveKey={[]}
            bordered={false}
            style={{ background: "transparent" }}
            items={[
              /* ── Grid Mode Visibility ── */
              {
                key: "grid",
                label: (
                  <Space size={6}>
                    <Text strong>Grid Mode Visibility</Text>
                    {hiddenCount > 0 && (
                      <Tag color="warning">{hiddenCount} hidden</Tag>
                    )}
                  </Space>
                ),
                children: (
                  <Space direction="vertical" style={{ width: "100%" }} size={8}>
                    {STATIONS.map((st) => {
                      const visible = draft.stationsVisible[st.key] !== false;
                      return (
                        <ToggleRow
                          key={st.key}
                          label={st.label}
                          desc={st.address}
                          checked={visible}
                          onChange={() => toggleStation(st.key)}
                          hidden={!visible}
                        />
                      );
                    })}
                  </Space>
                ),
              },

              /* ── Carousel Mode Visibility ── */
              {
                key: "carousel",
                label: (
                  <Space size={6}>
                    <Text strong>Carousel Mode Visibility</Text>
                    {carouselHiddenCount > 0 && (
                      <Tag color="warning">{carouselHiddenCount} hidden</Tag>
                    )}
                  </Space>
                ),
                extra: (
                  <Text type="secondary" style={{ fontSize: 11 }}>
                    Independent from Grid
                  </Text>
                ),
                children: (
                  <Space direction="vertical" style={{ width: "100%" }} size={8}>
                    <Text type="secondary" style={{ fontSize: 12 }}>
                      Independently control which stations appear when the display is in Carousel mode.
                    </Text>
                    {STATIONS.map((st) => {
                      const visible = (draft.carouselStationsVisible?.[st.key] ?? true) !== false;
                      return (
                        <ToggleRow
                          key={`carousel-${st.key}`}
                          label={st.label}
                          desc={st.address}
                          checked={visible}
                          onChange={() => toggleCarouselStation(st.key)}
                          hidden={!visible}
                        />
                      );
                    })}
                  </Space>
                ),
              },

              /* ── Parameter (Pollutant) Visibility ── */
              {
                key: "pollutants",
                label: (
                  <Space size={6}>
                    <Text strong>Parameter (Pollutant) Visibility</Text>
                    {pollutantsHiddenCount > 0 && (
                      <Tag color="warning">{pollutantsHiddenCount} hidden</Tag>
                    )}
                  </Space>
                ),
                children: (
                  <Space direction="vertical" style={{ width: "100%" }} size={10}>
                    <Text type="secondary" style={{ fontSize: 12 }}>
                      Hide specific pollutant readings per station. Hidden parameters are removed from
                      both Grid and Carousel modes in real-time.
                    </Text>
                    {STATION_POLLUTANTS.map(({ station, params }) => (
                      <div
                        key={station}
                        style={{
                          padding: "10px 14px",
                          borderRadius: 8,
                          border: "1px solid var(--aqm-border)",
                        }}
                      >
                        <Text strong style={{ display: "block", marginBottom: 8, fontSize: 13 }}>
                          {station}
                        </Text>
                        <Space direction="vertical" style={{ width: "100%" }} size={8}>
                          {params.map((p) => {
                            const visible = (draft.pollutantsVisible?.[p.key] ?? true) !== false;
                            return (
                              <div
                                key={p.key}
                                style={{
                                  display: "flex",
                                  alignItems: "center",
                                  justifyContent: "space-between",
                                  padding: "6px 10px",
                                  borderRadius: 6,
                                  background: "var(--aqm-fill-alt)",
                                  border: `1px solid ${visible ? "var(--aqm-border)" : "rgba(245,158,11,0.40)"}`,
                                  opacity: visible ? 1 : 0.65,
                                  transition: "opacity 0.2s, border-color 0.2s",
                                }}
                              >
                                <Space size={6}>
                                  <Text>{p.label}</Text>
                                  {!visible && <Tag color="warning" style={{ fontSize: 11 }}>Hidden</Tag>}
                                </Space>
                                <Switch
                                  size="small"
                                  checked={visible}
                                  onChange={() => togglePollutant(p.key)}
                                  checkedChildren={<EyeOutlined />}
                                  unCheckedChildren={<EyeInvisibleOutlined />}
                                />
                              </div>
                            );
                          })}
                        </Space>
                      </div>
                    ))}
                  </Space>
                ),
              },
            ]}
          />
        </Space>
      ),
    },

    /* ── Tab 2: Layout ── */
    {
      key: "layout",
      label: (
        <Space size={6}>
          <LayoutOutlined />
          <span>Layout</span>
          {(draft.cardDisplayMode ?? "grid") === "carousel" && (
            <Tag color="blue" style={{ marginInlineStart: 0 }}>Carousel</Tag>
          )}
        </Space>
      ),
      children: (
        <Space direction="vertical" style={{ width: "100%" }} size={16}>
          {/* Card Display Mode */}
          <div>
            <Text strong style={{ display: "block", marginBottom: 6 }}>Card Display Mode</Text>
            <Text type="secondary" style={{ fontSize: 12, display: "block", marginBottom: 10 }}>
              Choose how station cards are presented on the NLEX LED wall display.
            </Text>
            <Radio.Group
              value={draft.cardDisplayMode ?? "grid"}
              onChange={(e) => patchDraft({ cardDisplayMode: e.target.value })}
              optionType="button"
              buttonStyle="solid"
            >
              <Radio.Button value="grid">
                <Space size={4}><AppstoreOutlined />Grid (2×2)</Space>
              </Radio.Button>
              <Radio.Button value="carousel">
                <Space size={4}><PlayCircleOutlined />Carousel (1 at a time)</Space>
              </Radio.Button>
            </Radio.Group>
            <div style={{ marginTop: 10 }}>
              {(draft.cardDisplayMode ?? "grid") === "carousel" ? (
                <Alert
                  type="info"
                  showIcon
                  message="Carousel mode"
                  description="One station card is shown at a time and automatically advances to the next. Advance speed follows the Animation speed setting. Ideal for LED walls in public areas."
                />
              ) : (
                <Alert
                  type="info"
                  showIcon
                  message="Grid mode"
                  description="All visible station cards are shown simultaneously in a 2×2 grid layout."
                />
              )}
            </div>
          </div>

          <Divider style={{ margin: "4px 0" }} />

          {/* Gauge Chart toggle */}
          <div>
            <Text strong style={{ display: "block", marginBottom: 6 }}>Gauge Chart</Text>
            <Text type="secondary" style={{ fontSize: 12, display: "block", marginBottom: 10 }}>
              Show or hide the SVG arc gauge on each station tile. When hidden, the AQI number,
              status badge, and description scale up to fill the extra space — recommended for
              Carousel mode on LED walls viewed from a distance.
            </Text>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                padding: "10px 14px",
                borderRadius: 8,
                border: `1.5px solid ${
                  draft.showGaugeChart !== false
                    ? "rgba(22,119,255,0.30)"
                    : "rgba(245,158,11,0.45)"
                }`,
                background:
                  draft.showGaugeChart !== false
                    ? "rgba(22,119,255,0.04)"
                    : "rgba(245,158,11,0.06)",
                transition: "border-color 0.2s, background 0.2s",
              }}
            >
              <Space size={8}>
                <span style={{ fontSize: 22 }}>
                  {draft.showGaugeChart !== false ? "📊" : "🔢"}
                </span>
                <Space direction="vertical" size={0}>
                  <Text strong>
                    {draft.showGaugeChart !== false ? "Gauge visible" : "Gauge hidden — large text mode"}
                  </Text>
                  <Text type="secondary" style={{ fontSize: 11 }}>
                    {draft.showGaugeChart !== false
                      ? "Arc gauge SVG shown on each station tile."
                      : "AQI number, status and description are enlarged for maximum readability."}
                  </Text>
                </Space>
              </Space>
              <Switch
                checked={draft.showGaugeChart !== false}
                onChange={() => patchDraft({ showGaugeChart: !(draft.showGaugeChart !== false) })}
                checkedChildren={<EyeOutlined />}
                unCheckedChildren={<EyeInvisibleOutlined />}
              />
            </div>
          </div>

          <Divider style={{ margin: "4px 0" }} />

          {/* Theme */}
          <div>
            <Text strong style={{ display: "block", marginBottom: 6 }}>Display Theme</Text>
            <Text type="secondary" style={{ fontSize: 12, display: "block", marginBottom: 10 }}>
              Override the automatic day/night weather-based theme on the display.
            </Text>
            <Radio.Group
              options={THEME_OPTIONS}
              value={draft.theme}
              onChange={(e) => patchDraft({ theme: e.target.value })}
              optionType="button"
              buttonStyle="solid"
            />
            {draft.theme !== "auto" && (
              <Alert
                type="warning"
                showIcon
                message={`Theme locked to "${draft.theme}". Switch to Auto to restore weather-based theming.`}
                style={{ marginTop: 10 }}
              />
            )}
          </div>
        </Space>
      ),
    },

    /* ── Tab 3: Components ── */
    {
      key: "components",
      label: (
        <Space size={6}>
          <BgColorsOutlined />
          <span>Components</span>
        </Space>
      ),
      children: (
        <Space direction="vertical" style={{ width: "100%" }} size={10}>
          <Alert
            type="info"
            showIcon
            message="Toggle individual UI components on the NLEX display."
          />
          {COMPONENT_TOGGLES.map((item) => {
            const visible = draft[item.key] !== false;
            return (
              <ToggleRow
                key={item.key}
                label={item.label}
                desc={item.desc}
                checked={visible}
                onChange={() => patchDraft({ [item.key]: !draft[item.key] })}
                hidden={!visible}
              />
            );
          })}
        </Space>
      ),
    },

    /* ── Tab 4: Animation ── */
    {
      key: "animation",
      label: (
        <Space size={6}>
          <ThunderboltOutlined />
          <span>Animation</span>
        </Space>
      ),
      children: (
        <Space direction="vertical" style={{ width: "100%" }} size={14}>
          <Alert
            type="info"
            showIcon
            message="Controls the spotlight cycle on grid mode, and advance speed in carousel mode."
          />
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
              <Text strong>Enable Spotlight Cycle</Text>
              <Text type="secondary" style={{ fontSize: 12 }}>
                Cycles through each station tile with a zoom-in highlight effect.
              </Text>
            </Space>
            <Switch
              checked={draft.spotlightEnabled ?? true}
              onChange={() => patchDraft({ spotlightEnabled: !(draft.spotlightEnabled ?? true) })}
              checkedChildren="On"
              unCheckedChildren="Off"
            />
          </div>
          {(draft.spotlightEnabled ?? true) && (
            <div>
              <Text type="secondary" style={{ fontSize: 12, display: "block", marginBottom: 8 }}>
                How long each station tile stays highlighted in Grid mode.
              </Text>
              <Radio.Group
                options={SPEED_OPTIONS}
                value={draft.spotlightSpeed ?? "normal"}
                onChange={(e) => patchDraft({ spotlightSpeed: e.target.value })}
                optionType="button"
                buttonStyle="solid"
              />
            </div>
          )}

          <Divider style={{ margin: "4px 0" }} />

          {/* Carousel duration */}
          <div>
            <Text strong style={{ display: "block", marginBottom: 6 }}>
              Carousel Card Duration
            </Text>
            <Text type="secondary" style={{ fontSize: 12, display: "block", marginBottom: 10 }}>
              How many seconds each station card stays on screen before advancing to the next one in
              Carousel mode.
            </Text>
            <Space align="center" wrap>
              <Slider
                min={3}
                max={60}
                step={1}
                value={draft.carouselDurationSec ?? 10}
                onChange={(v) => patchDraft({ carouselDurationSec: v })}
                style={{ width: 220 }}
                tooltip={{ formatter: (v) => `${v}s` }}
              />
              <InputNumber
                min={3}
                max={60}
                value={draft.carouselDurationSec ?? 10}
                onChange={(v) => patchDraft({ carouselDurationSec: v ?? 10 })}
                addonAfter="sec"
                style={{ width: 110 }}
              />
            </Space>
            {(draft.cardDisplayMode ?? "grid") !== "carousel" && (
              <Alert
                type="warning"
                showIcon
                message="Display is currently in Grid mode. Switch to Carousel to use this setting."
                style={{ marginTop: 10 }}
              />
            )}
          </div>
        </Space>
      ),
    },

    /* ── Tab 5: Maintenance ── */
    {
      key: "maintenance",
      label: (
        <Space size={6}>
          <ToolOutlined />
          <span>Maintenance</span>
          {draft.nlexMaintenance && <Tag color="error" style={{ marginInlineStart: 0 }}>ON</Tag>}
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
              <Text type="secondary" style={{ fontSize: 12 }}>When on, a maintenance notice covers the NLEX display.</Text>
            </Space>
            <Switch
              checked={draft.nlexMaintenance ?? false}
              onChange={() => patchDraft({ nlexMaintenance: !draft.nlexMaintenance })}
              checkedChildren="On"
              unCheckedChildren="Off"
            />
          </div>
          {draft.nlexMaintenance && (
            <>
              <Input.TextArea
                placeholder="Optional maintenance message (leave blank for default)"
                value={draft.nlexMaintenanceMsg ?? ""}
                onChange={(e) => patchDraft({ nlexMaintenanceMsg: e.target.value })}
                rows={2}
                maxLength={200}
                showCount
              />
              <Alert
                type="warning"
                showIcon
                message="Maintenance mode is active. The NLEX display will show an overlay instead of AQI data."
              />
            </>
          )}
          <div>
            <Text strong style={{ display: "block", marginBottom: 4 }}>Update Description</Text>
            <Text type="secondary" style={{ fontSize: 12, display: "block", marginBottom: 8 }}>
              Shown on the display for ~20 seconds when maintenance is turned <strong>off</strong>. Describe what was updated.
            </Text>
            <Input.TextArea
              placeholder="e.g. Firmware updated. Sensor calibration complete. All stations operational."
              value={draft.nlexMaintenanceUpdateDesc ?? ""}
              onChange={(e) => patchDraft({ nlexMaintenanceUpdateDesc: e.target.value })}
              rows={2}
              maxLength={300}
              showCount
            />
          </div>
        </Space>
      ),
    },
  ];

  return (
    <div style={{ maxWidth: "min(720px, 100%)" }}>
      <Space align="center" style={{ marginBottom: 8 }}>
        <MonitorOutlined style={{ fontSize: 18 }} />
        <Title level={4} style={{ margin: 0 }}>
          NLEX Display Settings
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
            <a href={nlexUrl} target="_blank" rel="noopener noreferrer">
              /nlex display <ExportOutlined style={{ fontSize: 11 }} />
            </a>{" "}
            updates instantly with smooth animations — no page reload required.
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

      {/* ── Action bar ────────────────────────────────────────── */}
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
          href={nlexUrl}
          target="_blank"
        >
          Open Display
        </Button>
      </Space>

      {isDirty && (
        <Alert
          type="warning"
          showIcon
          message="You have unsaved changes — click Save Changes to apply them to the display."
          style={{ marginTop: 16 }}
        />
      )}
    </div>
  );
}

export default function NlexSettingsPage() {
  return (
    <NlexSettingsProvider>
      <SettingsPanel />
    </NlexSettingsProvider>
  );
}
