import { createContext, useContext, useState, useCallback, useEffect, useRef } from "react";
import { getApiBase } from "../util/apiBase";
import { readJsonResponse } from "../util/jsonResponse";
import { secureSession, secureStorage } from "../utils/secureStorage";

const BC_CHANNEL = "kiosk-settings-sync";

export const DEFAULT_KIOSK_SETTINGS = {
  // Per-pollutant AQI value visibility (hides the numeric value in gauge & meter)
  aqiValueVisible: {
    clark: true,
    "san-fernando": true,
    meycauayan_pm10: true,
    meycauayan_pm25: true,
    zambales_pm10: true,
    zambales_pm25: true,
  },
  // Per-pollutant AQI datetime visibility (hides the "Updated: …" timestamp)
  aqiDateTimeVisible: {
    clark: true,
    "san-fernando": true,
    meycauayan_pm10: true,
    meycauayan_pm25: true,
    zambales_pm10: true,
    zambales_pm25: true,
  },
  // Section visibility
  showWeather: true,
  showHourlyForecast: true,
  showWindMap: true,
  showStationCarousel: true,
  showYoutubeVideos: true,
  showContactCard: true,
  // Auto-cycle interval (seconds per station)
  cycleIntervalSec: 25,
  // Maintenance
  kioskMaintenance: false,
  kioskMaintenanceMsg: "",
};

export const KioskSettingsContext = createContext({
  settings: DEFAULT_KIOSK_SETTINGS,
  update: () => {},
});

function parseStored() {
  try {
    const stored = secureStorage.getJSON("kiosk-settings") ?? {};
    return {
      ...DEFAULT_KIOSK_SETTINGS,
      ...stored,
      aqiValueVisible: {
        ...DEFAULT_KIOSK_SETTINGS.aqiValueVisible,
        ...(stored.aqiValueVisible ?? {}),
      },
      aqiDateTimeVisible: {
        ...DEFAULT_KIOSK_SETTINGS.aqiDateTimeVisible,
        ...(stored.aqiDateTimeVisible ?? {}),
      },
    };
  } catch {
    return { ...DEFAULT_KIOSK_SETTINGS };
  }
}

/** Write settings to localStorage, broadcast to all same-origin contexts, and persist to server. */
export function saveKioskSettings(newSettings) {
  try { secureStorage.setJSON("kiosk-settings", newSettings); } catch {}
  try {
    const bc = new BroadcastChannel(BC_CHANNEL);
    bc.postMessage({ type: "settings-updated", settings: newSettings });
    bc.close();
  } catch {}
  try {
    const token = secureSession.getItem("admin-pin-token");
    if (token) {
      fetch(`${getApiBase()}/api/kiosk-settings`, {
        method: "PUT",
        headers: { "Content-Type": "application/json", "X-Admin-Token": token },
        body: JSON.stringify(newSettings),
      }).catch(() => {});
    }
  } catch {}
}

export function KioskSettingsProvider({ children }) {
  const [settings, setSettings] = useState(parseStored);
  const lastServerTs = useRef(0);

  function applyServerSettings(serverSettings) {
    if (!serverSettings || typeof serverSettings !== "object") return;
    const merged = {
      ...DEFAULT_KIOSK_SETTINGS,
      ...serverSettings,
      aqiValueVisible: {
        ...DEFAULT_KIOSK_SETTINGS.aqiValueVisible,
        ...(serverSettings.aqiValueVisible ?? {}),
      },
      aqiDateTimeVisible: {
        ...DEFAULT_KIOSK_SETTINGS.aqiDateTimeVisible,
        ...(serverSettings.aqiDateTimeVisible ?? {}),
      },
    };
    setSettings(merged);
    try { secureStorage.setJSON("kiosk-settings", merged); } catch {}
  }

  useEffect(() => {
    async function fetchFromServer() {
      try {
        const res = await fetch(`${getApiBase()}/api/kiosk-settings`, { cache: "no-store" });
        if (!res.ok) return;
        const data = await readJsonResponse(res, "Kiosk settings request");
        if (data.persisted) {
          applyServerSettings(data.settings);
          lastServerTs.current = Date.now();
        } else {
          const token = secureSession.getItem("admin-pin-token");
          if (token) {
            const local = parseStored();
            fetch(`${getApiBase()}/api/kiosk-settings`, {
              method: "PUT",
              headers: { "Content-Type": "application/json", "X-Admin-Token": token },
              body: JSON.stringify(local),
            }).catch(() => {});
          }
        }
      } catch {}
    }
    fetchFromServer();
    const pollId = setInterval(fetchFromServer, 15000);

    let bc;
    try {
      bc = new BroadcastChannel(BC_CHANNEL);
      bc.onmessage = (e) => {
        if (e.data?.type === "settings-updated" && e.data.settings) {
          const merged = {
            ...DEFAULT_KIOSK_SETTINGS,
            ...e.data.settings,
            aqiValueVisible: {
              ...DEFAULT_KIOSK_SETTINGS.aqiValueVisible,
              ...(e.data.settings.aqiValueVisible ?? {}),
            },
            aqiDateTimeVisible: {
              ...DEFAULT_KIOSK_SETTINGS.aqiDateTimeVisible,
              ...(e.data.settings.aqiDateTimeVisible ?? {}),
            },
          };
          setSettings(merged);
          try { secureStorage.setJSON("kiosk-settings", merged); } catch {}
        }
      };
    } catch {}

    function onStorage(e) {
      if (e.key !== "kiosk-settings") return;
      setSettings(parseStored());
    }
    window.addEventListener("storage", onStorage);

    function onVisible() {
      if (document.visibilityState === "visible") setSettings(parseStored());
    }
    document.addEventListener("visibilitychange", onVisible);

    function onPageShow() { setSettings(parseStored()); }
    window.addEventListener("pageshow", onPageShow);

    return () => {
      clearInterval(pollId);
      try { bc?.close(); } catch {}
      window.removeEventListener("storage", onStorage);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("pageshow", onPageShow);
    };
  }, []);

  const update = useCallback((patch) => {
    setSettings((s) => {
      const next = { ...s, ...patch };
      saveKioskSettings(next);
      return next;
    });
  }, []);

  return (
    <KioskSettingsContext.Provider value={{ settings, update }}>
      {children}
    </KioskSettingsContext.Provider>
  );
}

export const useKioskSettings = () => useContext(KioskSettingsContext);
