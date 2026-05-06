import { createContext, useContext, useState, useCallback, useEffect, useRef } from "react";
import { getApiBase } from "../util/apiBase";

const BC_CHANNEL = "nlex-settings-sync";
const SERVER_POLL_MS = 5000;

const DEFAULT_AQI_DESCRIPTIONS = {
  good: "Air is clean. Safe for everyone.",
  fair: "Acceptable. Sensitive groups take caution.",
  usg: "Unhealthy for children, elderly & sick. Limit outdoor activity.",
  vu: "Wear a mask. Everyone may feel health effects.",
  au: "Health hazard for all. Avoid outdoor exposure.",
  emergency: "Stay indoors. Air is dangerous for everyone.",
};

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
  pollutantsVisible: {
    clark_pm10: true,
    "san-fernando_pm10": true,
    meycauayan_pm10: true,
    meycauayan_pm25: true,
    zambales_pm10: true,
    zambales_pm25: true,
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
  aqiDescriptions: DEFAULT_AQI_DESCRIPTIONS,
};

export const NlexSettingsContext = createContext({
  settings: DEFAULT_SETTINGS,
  update: () => {},
});

/** Merge a raw stored/server object into a clean settings shape (strips internal _ts field). */
function mergeSettings(source) {
  const { _ts, ...rest } = source ?? {};
  return {
    ...DEFAULT_SETTINGS,
    ...rest,
    stationsVisible: {
      ...DEFAULT_SETTINGS.stationsVisible,
      ...(rest.stationsVisible ?? {}),
    },
    carouselStationsVisible: {
      ...DEFAULT_SETTINGS.carouselStationsVisible,
      ...(rest.carouselStationsVisible ?? {}),
    },
    pollutantsVisible: {
      ...DEFAULT_SETTINGS.pollutantsVisible,
      ...(rest.pollutantsVisible ?? {}),
    },
    aqiDescriptions: {
      ...DEFAULT_AQI_DESCRIPTIONS,
      ...(rest.aqiDescriptions ?? {}),
    },
  };
}

function parseStored() {
  try {
    const stored = JSON.parse(localStorage.getItem("nlex-settings") ?? "{}");
    return mergeSettings(stored);
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

/** Read the _ts timestamp saved alongside settings in localStorage (0 if absent). */
function readLocalTs() {
  try { return JSON.parse(localStorage.getItem("nlex-settings") ?? "{}")._ts ?? 0; }
  catch { return 0; }
}

/**
 * Write settings to localStorage, broadcast to all same-origin contexts, and persist to server.
 * Stamps settings with _ts (millisecond timestamp) so the server poll can detect stale data
 * and avoid overwriting newer local changes (race-condition guard).
 * Returns the timestamp used.
 */
export function saveNlexSettings(newSettings) {
  const ts = Date.now();
  const stamped = { ...newSettings, _ts: ts };
  try { localStorage.setItem("nlex-settings", JSON.stringify(stamped)); } catch {}
  try {
    const bc = new BroadcastChannel(BC_CHANNEL);
    bc.postMessage({ type: "settings-updated", settings: stamped });
    bc.close();
  } catch {}
  // Server persist: fire-and-forget so cross-device sync works (other devices poll the server)
  try {
    const token = sessionStorage.getItem("admin-pin-token");
    if (token) {
      fetch(`${getApiBase()}/api/nlex-settings`, {
        method: "PUT",
        headers: { "Content-Type": "application/json", "X-Admin-Token": token },
        body: JSON.stringify(stamped),
      }).catch(() => {});
    }
  } catch {}
  return ts;
}

export function NlexSettingsProvider({ children }) {
  const [settings, setSettings] = useState(parseStored);
  const lastServerTs = useRef(0);
  // Tracks the _ts of the most recent settings we consider "local truth".
  // Initialized from localStorage so a page reload keeps the last-saved timestamp.
  const localTsRef = useRef(readLocalTs());

  function applyServerSettings(serverSettings) {
    if (!serverSettings || typeof serverSettings !== "object") return;
    const serverTs = serverSettings._ts ?? 0;
    // Guard: skip if server data is older than our current local state.
    // This prevents a slow-arriving server poll from reverting a change we just saved.
    if (serverTs < localTsRef.current) return;
    const merged = mergeSettings(serverSettings);
    localTsRef.current = serverTs;
    setSettings(merged);
    // Keep localStorage in sync so same-device tabs also see the update
    try { localStorage.setItem("nlex-settings", JSON.stringify({ ...merged, _ts: serverTs })); } catch {}
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
          // (applyServerSettings will skip if server data is stale vs our localTsRef)
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
              body: JSON.stringify({ ...local, _ts: localTsRef.current }),
            }).catch(() => {});
          }
        }
      } catch {}
    }
    fetchFromServer();
    const pollId = setInterval(fetchFromServer, SERVER_POLL_MS);

    // BroadcastChannel: fast cross-tab sync (works same-origin, all tabs)
    let bc;
    try {
      bc = new BroadcastChannel(BC_CHANNEL);
      bc.onmessage = (e) => {
        if (e.data?.type === "settings-updated" && e.data.settings) {
          const incomingTs = e.data.settings._ts ?? 0;
          // Only apply if this message is newer than our current local state
          if (incomingTs < localTsRef.current) return;
          localTsRef.current = incomingTs;
          const merged = mergeSettings(e.data.settings);
          setSettings(merged);
          // Keep localStorage in sync so visibilitychange/pageshow reads fresh data
          try { localStorage.setItem("nlex-settings", JSON.stringify({ ...merged, _ts: incomingTs })); } catch {}
        }
      };
    } catch {}
    // Fallback: storage event for cross-tab in older browsers
    function onStorage(e) {
      if (e.key !== "nlex-settings") return;
      try {
        const stored = JSON.parse(e.newValue ?? "{}");
        localTsRef.current = Math.max(localTsRef.current, stored._ts ?? 0);
      } catch {}
      setSettings(parseStored());
    }
    window.addEventListener("storage", onStorage);
    // Visibilitychange fallback: re-read localStorage whenever this tab gains focus
    // (covers same-browser scenarios where BC/storage events are skipped)
    function onVisible() {
      if (document.visibilityState === "visible") {
        localTsRef.current = Math.max(localTsRef.current, readLocalTs());
        setSettings(parseStored());
      }
    }
    document.addEventListener("visibilitychange", onVisible);
    // Pageshow fallback: covers iOS bfcache restore where visibilitychange may not fire
    function onPageShow() {
      localTsRef.current = Math.max(localTsRef.current, readLocalTs());
      setSettings(parseStored());
    }
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
      const ts = saveNlexSettings(next);
      localTsRef.current = ts;
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

