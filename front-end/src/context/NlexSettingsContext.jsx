import { createContext, useContext, useState, useCallback, useEffect, useRef } from "react";
import { getApiBase } from "../util/apiBase";

const BC_CHANNEL = "nlex-settings-sync";

export const DEFAULT_SETTINGS = {
  stationsVisible: {
    clark: true,
    "san-fernando": true,
    meycauayan: true,
    zambales: true,
  },
  carouselStationsVisible: {
    clark: true,
    "san-fernando": true,
    meycauayan: true,
    zambales: true,
  },
  theme: "auto",            // "auto" | "light" | "dark"
  showHeader: true,         // logos + agency title block
  showAqiLegend: true,      // AQI scale reference card
  showFooter: true,         // address + clock footer
  showDateTime: true,       // date/time line below "Air Quality Index"
  showSubtitle: true,       // "Real-time Particulate Matter Monitor…" subtitle
  showGaugeChart: true,     // false = hide SVG arc gauge; AQI value enlarged
  cardDisplayMode: "grid",  // "grid" | "carousel" — how station cards are shown
  carouselDurationSec: 10,  // seconds each card stays visible in carousel mode
  spotlightSpeed: "normal", // "slow" | "normal" | "fast"
  spotlightEnabled: true,   // false = keep all tiles fully lit, no cycling
  nlexMaintenance: false,         // true = show maintenance overlay on /nlex
  nlexMaintenanceMsg: "",         // optional custom message on overlay
  nlexMaintenanceUpdateDesc: "",  // shown on /nlex when maintenance is turned off
};

export const NlexSettingsContext = createContext({
  settings: DEFAULT_SETTINGS,
  update: () => {},
});

function parseStored() {
  try {
    const stored = JSON.parse(localStorage.getItem("nlex-settings") ?? "{}");
    return {
      ...DEFAULT_SETTINGS,
      ...stored,
      stationsVisible: {
        ...DEFAULT_SETTINGS.stationsVisible,
        ...(stored.stationsVisible ?? {}),
      },
      carouselStationsVisible: {
        ...DEFAULT_SETTINGS.carouselStationsVisible,
        ...(stored.carouselStationsVisible ?? {}),
      },
    };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

/** Write settings to localStorage, broadcast to all same-origin contexts, and persist to server. */
export function saveNlexSettings(newSettings) {
  try { localStorage.setItem("nlex-settings", JSON.stringify(newSettings)); } catch {}
  try {
    const bc = new BroadcastChannel(BC_CHANNEL);
    bc.postMessage({ type: "settings-updated", settings: newSettings });
    bc.close();
  } catch {}
  // Server persist: fire-and-forget so cross-device sync works (other devices poll the server)
  try {
    const token = sessionStorage.getItem("admin-pin-token");
    if (token) {
      fetch(`${getApiBase()}/api/nlex-settings`, {
        method: "PUT",
        headers: { "Content-Type": "application/json", "X-Admin-Token": token },
        body: JSON.stringify(newSettings),
      }).catch(() => {});
    }
  } catch {}
}

export function NlexSettingsProvider({ children }) {
  const [settings, setSettings] = useState(parseStored);
  const lastServerTs = useRef(0);

  function applyServerSettings(serverSettings) {
    if (!serverSettings || typeof serverSettings !== "object") return;
    const merged = {
      ...DEFAULT_SETTINGS,
      ...serverSettings,
      stationsVisible: {
        ...DEFAULT_SETTINGS.stationsVisible,
        ...(serverSettings.stationsVisible ?? {}),
      },
      carouselStationsVisible: {
        ...DEFAULT_SETTINGS.carouselStationsVisible,
        ...(serverSettings.carouselStationsVisible ?? {}),
      },
    };
    setSettings(merged);
    // Keep localStorage in sync so same-device tabs also see the update
    try { localStorage.setItem("nlex-settings", JSON.stringify(merged)); } catch {}
  }

  useEffect(() => {
    // Server poll: fetches settings every 15 s so any device (mobile, LED wall, etc.)
    // picks up changes made from /admin — regardless of device or browser instance.
    async function fetchFromServer() {
      try {
        const res = await fetch(`${getApiBase()}/api/nlex-settings`, { cache: "no-store" });
        if (!res.ok) return;
        const data = await res.json();
        if (data.persisted) {
          // Server has explicitly-saved settings — apply them as the source of truth
          applyServerSettings(data.settings);
          lastServerTs.current = Date.now();
        } else {
          // Server has never been written to yet. DO NOT overwrite local settings.
          // If we are the admin, push our current localStorage settings up to the server
          // so all other devices pick them up on their next poll.
          const token = sessionStorage.getItem("admin-pin-token");
          if (token) {
            const local = parseStored();
            fetch(`${getApiBase()}/api/nlex-settings`, {
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

    // BroadcastChannel: fast cross-tab sync (works same-origin, all tabs)
    let bc;
    try {
      bc = new BroadcastChannel(BC_CHANNEL);
      bc.onmessage = (e) => {
        if (e.data?.type === "settings-updated" && e.data.settings) {
          const merged = {
            ...DEFAULT_SETTINGS,
            ...e.data.settings,
            stationsVisible: {
              ...DEFAULT_SETTINGS.stationsVisible,
              ...(e.data.settings.stationsVisible ?? {}),
            },
            carouselStationsVisible: {
              ...DEFAULT_SETTINGS.carouselStationsVisible,
              ...(e.data.settings.carouselStationsVisible ?? {}),
            },
          };
          setSettings(merged);
          // Keep localStorage in sync so visibilitychange/pageshow reads fresh data
          try { localStorage.setItem("nlex-settings", JSON.stringify(merged)); } catch {}
        }
      };
    } catch {}
    // Fallback: storage event for cross-tab in older browsers
    function onStorage(e) {
      if (e.key !== "nlex-settings") return;
      setSettings(parseStored());
    }
    window.addEventListener("storage", onStorage);
    // Visibilitychange fallback: re-read localStorage whenever this tab gains focus
    // (covers same-browser scenarios where BC/storage events are skipped)
    function onVisible() {
      if (document.visibilityState === "visible") setSettings(parseStored());
    }
    document.addEventListener("visibilitychange", onVisible);
    // Pageshow fallback: covers iOS bfcache restore where visibilitychange may not fire
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
      saveNlexSettings(next);
      return next;
    });
  }, []);

  return (
    <NlexSettingsContext.Provider value={{ settings, update }}>
      {children}
    </NlexSettingsContext.Provider>
  );
}

export const useNlexSettings = () => useContext(NlexSettingsContext);

