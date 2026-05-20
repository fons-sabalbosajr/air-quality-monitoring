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
 *  3. Polls every 30 s to catch new Google Sheets data.
 *
 * Shares the same secureStorage key as useTabularData so any persisted row
 * from Dashboard/Kiosk visits is immediately visible here too.
 *
 * Returns: { latest, aqi, loading, fetchedAt, dateCol, time }
 */
import { useEffect, useState, useRef, useCallback } from "react";
import { getApiBase } from "../util/apiBase";
import { secureStorage } from "../utils/secureStorage";

const POLL_MS        = 15_000;                  // re-fetch every 15 s
const CACHE_TTL_MS   = 12 * 60 * 60 * 1000;    // 12 h — evict stale secureStorage
const FETCH_TIMEOUT_MS = 10_000;
const FETCH_RETRIES = 2;
const CACHE_SCHEMA_VERSION = 3;

function storageKey(province, pollutant) {
  // Same key as useTabularData so persisted rows are shared across hooks.
  return `aqm_aqi_latest:${province}:${pollutant}`;
}

function readPersisted(province, pollutant) {
  if (!province || !pollutant) return null;
  try {
    const s = secureStorage.getJSON(storageKey(province, pollutant));
    if (!s?.row || !s?.savedAt) return null;
    if (s.version !== CACHE_SCHEMA_VERSION) {
      secureStorage.removeItem(storageKey(province, pollutant));
      return null;
    }
    if (Date.now() - s.savedAt > CACHE_TTL_MS) {
      secureStorage.removeItem(storageKey(province, pollutant));
      return null;
    }
    return s; // { row, savedAt }
  } catch {
    return null;
  }
}

function writePersisted(province, pollutant, row, meta = {}) {
  try {
    secureStorage.setJSON(storageKey(province, pollutant), { version: CACHE_SCHEMA_VERSION, row, savedAt: Date.now(), meta });
  } catch { /* best-effort */ }
}

function parseAqiDate(value) {
  if (value == null) return null;
  if (typeof value === "number" && isFinite(value)) {
    const d = new Date(value);
    return isNaN(d.getTime()) || d.getFullYear() < 2015 ? null : d;
  }
  const s = String(value).trim();
  const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})\s+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(AM|PM)?$/i);
  if (m) {
    let hour = Number(m[4]);
    const ampm = m[7]?.toUpperCase();
    if (ampm === "PM" && hour < 12) hour += 12;
    if (ampm === "AM" && hour === 12) hour = 0;
    const d = new Date(Number(m[3]), Number(m[1]) - 1, Number(m[2]), hour, Number(m[5]), Number(m[6] || 0));
    if (
      d.getFullYear() === Number(m[3]) &&
      d.getMonth() === Number(m[1]) - 1 &&
      d.getDate() === Number(m[2])
    ) return d;
  }
  const d = new Date(s);
  return isNaN(d.getTime()) || d.getFullYear() < 2015 ? null : d;
}

function findDateKey(row) {
  return row ? (Object.keys(row).find((k) => /date|time/i.test(k)) ?? null) : null;
}

function isValidLatestRow(row) {
  if (!row) return false;
  const aqi = Number(row["AQI"] ?? row["aqi"]);
  if (!isFinite(aqi) || aqi <= 0 || aqi > 500) return false;
  const status = row["Status"] ?? row["status"];
  if (/^(invalid|for\s*validation)$/i.test(String(status || ""))) return false;
  return true;
}

export default function useLatestAqi(province, pollutant) {
  const persisted     = readPersisted(province, pollutant);
  const [latest, setLatest]       = useState(persisted?.row ?? null);
  const [loading, setLoading]     = useState(!persisted?.row && Boolean(province && pollutant));
  const [fetchedAt, setFetchedAt] = useState(
    persisted?.savedAt ? new Date(persisted.savedAt).toISOString() : null
  );
  const [time, setTime] = useState(persisted?.meta?.time ?? null);
  const [dateColState, setDateColState] = useState(persisted?.meta?.dateKey ?? findDateKey(persisted?.row));

  const latestRef  = useRef(latest);
  const etagRef = useRef(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  useEffect(() => {
    const nextPersisted = readPersisted(province, pollutant);
    latestRef.current = nextPersisted?.row ?? null;
    setLatest(nextPersisted?.row ?? null);
    setFetchedAt(nextPersisted?.savedAt ? new Date(nextPersisted.savedAt).toISOString() : null);
    setTime(nextPersisted?.meta?.time ?? null);
    setDateColState(nextPersisted?.meta?.dateKey ?? findDateKey(nextPersisted?.row));
    setLoading(!nextPersisted?.row && Boolean(province && pollutant));
    etagRef.current = null;
  }, [province, pollutant]);

  const fetchLatest = useCallback(async () => {
    if (!province || !pollutant) return;
    try {
      const base = getApiBase();
      let json = null;
      for (let attempt = 0; attempt <= FETCH_RETRIES; attempt += 1) {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
        try {
          const headers = {
            Accept: "application/json",
            "Cache-Control": "no-cache",
            Pragma: "no-cache",
          };
          if (etagRef.current) headers["If-None-Match"] = etagRef.current;
          const res = await fetch(
            `${base}/api/tabular/${encodeURIComponent(province)}/${encodeURIComponent(pollutant)}/latest`,
            { cache: "no-store", headers, signal: controller.signal }
          );
          clearTimeout(timeoutId);
          if (res.status === 304) {
            if (latestRef.current && mountedRef.current) setLoading(false);
            return;
          }
          if (!res.ok) {
            if (res.status >= 500 && attempt < FETCH_RETRIES) continue;
            return;
          }
          etagRef.current = res.headers.get("ETag") || etagRef.current;
          json = await res.json();
          break;
        } catch {
          clearTimeout(timeoutId);
          if (attempt >= FETCH_RETRIES) return;
        }
      }
      if (!mountedRef.current || !json?.row || !isValidLatestRow(json.row)) {
        if (mountedRef.current) {
          latestRef.current = null;
          secureStorage.removeItem(storageKey(province, pollutant));
          setLatest(null);
          setTime(null);
          setDateColState(null);
          setFetchedAt(null);
          setLoading(false);
        }
        return;
      }

      const dateKey = json.dateKey ?? findDateKey(json.row);
      const parsedTime = json.time ?? (dateKey ? parseAqiDate(json.row[dateKey])?.getTime() : null);

      const newStr = JSON.stringify(json.row);
      const curStr = latestRef.current ? JSON.stringify(latestRef.current) : null;
      if (newStr !== curStr) {
        latestRef.current = json.row;
        setLatest(json.row);
      }
      writePersisted(province, pollutant, json.row, { dateKey, time: parsedTime ?? null, displayTime: json.displayTime ?? null });
      setDateColState(dateKey);
      setTime(parsedTime ?? null);
      setFetchedAt(new Date().toISOString());
      setLoading(false);
    } catch { /* network errors are silent — display persisted data */ } finally {
      if (mountedRef.current && latestRef.current) setLoading(false);
    }
  }, [province, pollutant]);

  useEffect(() => {
    fetchLatest();
    const iv = setInterval(fetchLatest, POLL_MS);
    return () => clearInterval(iv);
  }, [fetchLatest]);

  useEffect(() => {
    function refreshWhenVisible() {
      if (document.visibilityState === "visible") fetchLatest();
    }
    document.addEventListener("visibilitychange", refreshWhenVisible);
    window.addEventListener("focus", fetchLatest);
    window.addEventListener("online", fetchLatest);
    return () => {
      document.removeEventListener("visibilitychange", refreshWhenVisible);
      window.removeEventListener("focus", fetchLatest);
      window.removeEventListener("online", fetchLatest);
    };
  }, [fetchLatest]);

  // Derive AQI number from the latest row
  const aqi = latest
    ? (() => { const v = Number(latest["AQI"] ?? latest["aqi"]); return isFinite(v) && v > 0 ? v : null; })()
    : null;

  // Find the date column key from the row (e.g. "Date & Time")
  const dateCol = latest ? (dateColState ?? findDateKey(latest)) : null;

  return { latest, aqi, loading, fetchedAt, dateCol, time };
}
