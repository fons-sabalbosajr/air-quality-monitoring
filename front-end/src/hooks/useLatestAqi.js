/**
 * useLatestAqi — lightweight AQI hook for /nlex LED wall.
 *
 * Hits /api/tabular/:province/:pollutant/latest (single enriched row, served
 * from the in-memory enrichedCache on the server — typically ~50 ms).
 * Never loads the full 5000-row dataset; the /nlex wall only needs the newest
 * valid row per station.
 *
 * Instant display strategy:
 *  1. Reads the persisted row from secureStorage immediately (zero wait).
 *  2. Fires the /latest fetch on mount — updates within ~100 ms when warm.
 *  3. Polls every 60 s to catch new Google Sheets data.
 *
 * Shares the same secureStorage key as useTabularData so any persisted row
 * from Dashboard/Kiosk visits is immediately visible here too.
 *
 * Returns: { latest, aqi, loading, fetchedAt, dateCol }
 */
import { useEffect, useState, useRef, useCallback } from "react";
import { getApiBase } from "../util/apiBase";
import { secureStorage } from "../utils/secureStorage";

const POLL_MS        = 60_000;                  // re-fetch every 60 s
const CACHE_TTL_MS   = 12 * 60 * 60 * 1000;    // 12 h — evict stale secureStorage

function storageKey(province, pollutant) {
  // Same key as useTabularData so persisted rows are shared across hooks.
  return `aqm_aqi_latest:${province}:${pollutant}`;
}

function readPersisted(province, pollutant) {
  if (!province || !pollutant) return null;
  try {
    const s = secureStorage.getJSON(storageKey(province, pollutant));
    if (!s?.row || !s?.savedAt) return null;
    if (Date.now() - s.savedAt > CACHE_TTL_MS) {
      secureStorage.removeItem(storageKey(province, pollutant));
      return null;
    }
    return s; // { row, savedAt }
  } catch {
    return null;
  }
}

function writePersisted(province, pollutant, row) {
  try {
    secureStorage.setJSON(storageKey(province, pollutant), { row, savedAt: Date.now() });
  } catch { /* best-effort */ }
}

export default function useLatestAqi(province, pollutant) {
  const persisted     = readPersisted(province, pollutant);
  const [latest, setLatest]       = useState(persisted?.row ?? null);
  const [loading, setLoading]     = useState(!persisted?.row && Boolean(province && pollutant));
  const [fetchedAt, setFetchedAt] = useState(
    persisted?.savedAt ? new Date(persisted.savedAt).toISOString() : null
  );

  const latestRef  = useRef(latest);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  const fetchLatest = useCallback(async () => {
    if (!province || !pollutant) return;
    try {
      const base = getApiBase();
      const res = await fetch(
        `${base}/api/tabular/${encodeURIComponent(province)}/${encodeURIComponent(pollutant)}/latest`,
        { headers: { Accept: "application/json" } }
      );
      if (!res.ok || !mountedRef.current) return;
      const json = await res.json();
      if (!mountedRef.current || !json?.row) return;

      const newStr = JSON.stringify(json.row);
      const curStr = latestRef.current ? JSON.stringify(latestRef.current) : null;
      if (newStr !== curStr) {
        latestRef.current = json.row;
        writePersisted(province, pollutant, json.row);
        setLatest(json.row);
        setFetchedAt(new Date().toISOString());
      }
    } catch { /* network errors are silent — display persisted data */ } finally {
      if (mountedRef.current) setLoading(false);
    }
  }, [province, pollutant]);

  useEffect(() => {
    fetchLatest();
    const iv = setInterval(fetchLatest, POLL_MS);
    return () => clearInterval(iv);
  }, [fetchLatest]);

  // Derive AQI number from the latest row
  const aqi = latest
    ? (() => { const v = Number(latest["AQI"] ?? latest["aqi"]); return isFinite(v) && v > 0 ? v : null; })()
    : null;

  // Find the date column key from the row (e.g. "Date & Time")
  const dateCol = latest
    ? (Object.keys(latest).find((k) => /date|time/i.test(k)) ?? null)
    : null;

  return { latest, aqi, loading, fetchedAt, dateCol };
}
