/**
 * useTabularData – fetches data from /api/tabular/:province/:pollutant
 * and transforms it into the format the dashboard components expect.
 *
 * Returns { rows, latest, cachedLatest, dailyRows, loading, error, fetchedAt, retry, source, backupMeta }
 *   - rows         : raw enhanced rows from the server (newest-first)
 *   - latest       : the most recent row with valid AQI (live, from server)
 *   - cachedLatest : the most recent row stored in secureStorage (shown instantly on mount)
 *   - dailyRows    : array of { t, y, conc, status } in chronological order
 *   - loading      : boolean
 *   - error        : string | null
 *   - fetchedAt    : ISO timestamp
 *   - retry        : function to force re-fetch
 *   - source       : "sheet" | "cache" | "stale-cache" | "mongodb-backup"
 *   - backupMeta   : { lastBackupAt, lastCheckedAt, rowCount } when served from backup
 */
import { useEffect, useState, useMemo, useCallback, useRef } from "react";
import { getApiBase } from "../util/apiBase";
import { readJsonResponse, responseToError } from "../util/jsonResponse";
import { secureStorage } from "../utils/secureStorage";

// Persist the latest AQI row in secureStorage so the AQI card can render
// immediately on the next page load without waiting for the network.
const AQI_CACHE_TTL_MS = 12 * 60 * 60 * 1000; // 12 h — evict stale cache
const LATEST_POLL_MS = 15_000;                  // fast-poll for new AQI rows
const AQI_CACHE_SCHEMA_VERSION = 3;

function getAqiCacheKey(province, pollutant) {
  return `aqm_aqi_latest:${province}:${pollutant}`;
}

function readPersistedLatest(province, pollutant) {
  if (!province || !pollutant) return null;
  try {
    const stored = secureStorage.getJSON(getAqiCacheKey(province, pollutant));
    if (!stored?.row || !stored?.savedAt) return null;
    if (stored.version !== AQI_CACHE_SCHEMA_VERSION) {
      secureStorage.removeItem(getAqiCacheKey(province, pollutant));
      return null;
    }
    if (Date.now() - stored.savedAt > AQI_CACHE_TTL_MS) {
      secureStorage.removeItem(getAqiCacheKey(province, pollutant));
      return null;
    }
    return stored.row;
  } catch {
    return null;
  }
}

function persistLatestRow(province, pollutant, row) {
  if (!province || !pollutant || !row) return;
  try {
    secureStorage.setJSON(getAqiCacheKey(province, pollutant), { version: AQI_CACHE_SCHEMA_VERSION, row, savedAt: Date.now() });
  } catch { /* best-effort */ }
}

function findDateKey(row) {
  return row ? (Object.keys(row).find((k) => /date|time/i.test(k)) ?? null) : null;
}

const TABULAR_REFRESH_MS = 45_000;                   // frequent background refresh
const FETCH_TIMEOUT_MS = 10_000;
const TABULAR_CACHE = new Map();
const ETAG_STORE = new Map(); // province:pollutant -> etag string

function getCacheKey(province, pollutant) {
  return `${province || ""}:${pollutant || ""}`;
}

function readCachedTabular(province, pollutant) {
  const entry = TABULAR_CACHE.get(getCacheKey(province, pollutant));
  if (!entry?.data) return null;

  return {
    ...entry,
    fresh: Date.now() - entry.cachedAt < TABULAR_REFRESH_MS,
  };
}

async function requestTabularData(province, pollutant, force = false) {
  if (!province || !pollutant) return null;

  const cacheKey = getCacheKey(province, pollutant);
  const cached = readCachedTabular(province, pollutant);
  if (!force && cached?.data) return cached.data;

  const existing = TABULAR_CACHE.get(cacheKey);
  if (existing?.pending) return existing.pending;

  const pending = (async () => {
    const base = getApiBase();
    const url = `${base}/api/tabular/${encodeURIComponent(province)}/${encodeURIComponent(pollutant)}`;
    const headers = {
      Accept: "application/json",
      "Cache-Control": "no-cache",
      Pragma: "no-cache",
    };

    // Send ETag for conditional request (saves bandwidth when data unchanged)
    const etagKey = getCacheKey(province, pollutant);
    const existingEtag = ETAG_STORE.get(etagKey);
    if (existingEtag) {
      headers["If-None-Match"] = existingEtag;
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    let res;
    try {
      res = await fetch(url, { cache: "no-cache", headers, signal: controller.signal });
    } finally {
      clearTimeout(timeoutId);
    }

    // 304 Not Modified — data unchanged, reuse cached data
    if (res.status === 304) {
      const cachedEntry = TABULAR_CACHE.get(cacheKey);
      if (cachedEntry?.data) return cachedEntry.data;
    }

    if (!res.ok) throw await responseToError(res, "Tabular data request");

    // Store ETag from response
    const responseEtag = res.headers.get("ETag");
    if (responseEtag) {
      ETAG_STORE.set(etagKey, responseEtag);
    }

    const json = await readJsonResponse(res, "Tabular data request");
    return {
      raw: json,
      fetchedAt: json.fetchedAt || new Date().toISOString(),
      source: json.source || "sheet",
      backupMeta: json.backupMeta || null,
    };
  })();

  TABULAR_CACHE.set(cacheKey, {
    ...(existing || {}),
    pending,
  });

  try {
    const data = await pending;
    TABULAR_CACHE.set(cacheKey, {
      data,
      cachedAt: Date.now(),
      pending: null,
    });
    return data;
  } catch (error) {
    if (cached?.data) {
      TABULAR_CACHE.set(cacheKey, {
        ...cached,
        pending: null,
      });
    } else {
      TABULAR_CACHE.delete(cacheKey);
    }
    throw error;
  }
}

export function prefetchTabularData(province, pollutant) {
  return requestTabularData(province, pollutant).catch(() => null);
}

export async function prefetchLatestAqi(province, pollutant) {
  if (!province || !pollutant) return null;
  try {
    const base = getApiBase();
    const url = `${base}/api/tabular/${encodeURIComponent(province)}/${encodeURIComponent(pollutant)}/latest`;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    let res;
    try {
      res = await fetch(url, {
        cache: "no-store",
        signal: controller.signal,
        headers: {
          Accept: "application/json",
          "Cache-Control": "no-cache",
          Pragma: "no-cache",
        },
      });
    } finally {
      clearTimeout(timeoutId);
    }
    if (!res.ok) return null;
    const json = await readJsonResponse(res, "Latest AQI request");
    if (json?.row) persistLatestRow(province, pollutant, json.row);
    return json;
  } catch {
    return null;
  }
}

export default function useTabularData(province, pollutant) {
  const initialCache = readCachedTabular(province, pollutant);
  const [raw, setRaw] = useState(initialCache?.data?.raw || null);
  const [loading, setLoading] = useState(Boolean(province && pollutant && !initialCache?.data));
  const [error, setError] = useState(null);
  const [fetchedAt, setFetchedAt] = useState(initialCache?.data?.fetchedAt || null);
  const [source, setSource] = useState(initialCache?.data?.source || null);
  const [backupMeta, setBackupMeta] = useState(initialCache?.data?.backupMeta || null);
  // sheetSyncing: server is actively fetching fresh data from Google Sheets in the background
  const [sheetSyncing, setSheetSyncing] = useState(initialCache?.data?.raw?.sheetSyncing ?? false);
  // latestAqiVerified: true when the newest row’s AQI value came from the sheet’s own formula
  const [latestAqiVerified, setLatestAqiVerified] = useState(initialCache?.data?.raw?.latestAqiVerified ?? true);
  const mountedRef = useRef(true);

  // Persisted latest row — loaded from secureStorage so the AQI card is
  // visible immediately on mount without waiting for the API response.
  const [cachedLatest, setCachedLatest] = useState(() => readPersistedLatest(province, pollutant));

  // Ref to track the current latest row for fast-poll comparison
  const latestRowRef = useRef(null);

  const applyPayload = useCallback((payload) => {
    if (!payload) return;
    setRaw(payload.raw);
    setFetchedAt(payload.fetchedAt);
    setSource(payload.source);
    setBackupMeta(payload.backupMeta);
    setSheetSyncing(payload.raw?.sheetSyncing ?? false);
    setLatestAqiVerified(payload.raw?.latestAqiVerified ?? true);
    setError(null);
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  useEffect(() => {
    const persisted = readPersistedLatest(province, pollutant);
    setCachedLatest(persisted);
    latestRowRef.current = persisted;
  }, [province, pollutant]);

  const fetchData = useCallback(async ({ force = false, background = false } = {}) => {
    if (!province || !pollutant) {
      setRaw(null);
      setLoading(false);
      setFetchedAt(null);
      setSource(null);
      setBackupMeta(null);
      setError(null);
      return;
    }

    const cached = readCachedTabular(province, pollutant);
    if (cached?.data) {
      applyPayload(cached.data);
    }

    if (!background) {
      setLoading(!cached?.data);
    }

    try {
      const payload = await requestTabularData(province, pollutant, force);
      if (!mountedRef.current) return;
      applyPayload(payload);
    } catch (e) {
      if (!mountedRef.current) return;
      setError(e.message || "Failed to fetch data");
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  }, [applyPayload, province, pollutant]);

  useEffect(() => {
    const cached = readCachedTabular(province, pollutant);
    if (cached?.data) {
      applyPayload(cached.data);
      setLoading(false);
    } else {
      setRaw(null);
      setFetchedAt(null);
      setSource(null);
      setBackupMeta(null);
      setError(null);
      setLoading(Boolean(province && pollutant));
    }

    if (!cached?.fresh) {
      fetchData({ force: true, background: Boolean(cached?.data) });
    }

    const iv = setInterval(() => {
      fetchData({ force: true, background: true });
    }, TABULAR_REFRESH_MS);
    return () => clearInterval(iv);
  }, [applyPayload, fetchData, pollutant, province]);

  // Parse rows into usable shape
  const rows = useMemo(() => {
    if (!raw?.rows) return [];
    return raw.rows;
  }, [raw]);

  // Find the date column key (may vary per sheet)
  // Prefer the authoritative dateKey/concKey the server computed during enrichment.
  // Fall back to regex-based column detection only when the server key is absent.
  const dateCol = useMemo(() => {
    if (raw?.dateKey) return raw.dateKey;
    if (raw?.columns) return raw.columns.find((c) => /date|time/i.test(c)) || null;
    return findDateKey(cachedLatest);
  }, [raw, cachedLatest]);

  // Find the concentration column key
  const concCol = useMemo(() => {
    if (raw?.concKey) return raw.concKey;
    if (!raw?.columns) return null;
    return raw.columns.find((c) => /concentration/i.test(c)) || null;
  }, [raw]);

  // Latest row – server returns NEWEST-FIRST.
  // Skip erratic rows (AQI = 0 or status = Invalid/For Validation) so the
  // AQI hero card always shows the most recent *valid* reading.
  const latest = useMemo(() => {
    if (!rows.length) return cachedLatest || null;
    const validRow = rows.find((r) => {
      const aqi = r["AQI"] ?? r["aqi"];
      if (aqi == null || Number(aqi) === 0 || Number(aqi) > 500) return false;
      const status = r["Status"] ?? r["status"];
      if (/^(invalid|for\s*validation)$/i.test(String(status || ""))) return false;
      return true;
    });
    return validRow || cachedLatest || null;
  }, [rows, cachedLatest]);

  // Persist latest row to secureStorage whenever it changes so the AQI card
  // can render immediately on the next page load from cache.
  useEffect(() => {
    if (!latest || !province || !pollutant) return;
    const newStr = JSON.stringify(latest);
    const curStr = latestRowRef.current ? JSON.stringify(latestRowRef.current) : null;
    if (newStr === curStr) return; // no change
    latestRowRef.current = latest;
    persistLatestRow(province, pollutant, latest);
    setCachedLatest(latest);
  }, [latest, province, pollutant]);

  // Fast poll — hits the lightweight /latest endpoint every minute to detect
  // new Google Sheets data early and update the AQI card before the full
  // 5-minute tabular refresh fires.
  useEffect(() => {
    if (!province || !pollutant) return;
    let cancelled = false;
    let intervalId = null;
    let startDelayId = null;

    const pollLatest = async () => {
      try {
        const base = getApiBase();
        const url = `${base}/api/tabular/${encodeURIComponent(province)}/${encodeURIComponent(pollutant)}/latest`;
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
        let res;
        try {
          res = await fetch(url, {
            cache: "no-store",
            signal: controller.signal,
            headers: {
              Accept: "application/json",
              "Cache-Control": "no-cache",
              Pragma: "no-cache",
            },
          });
        } finally {
          clearTimeout(timeoutId);
        }
        if (!res.ok || cancelled) return;
        const json = await readJsonResponse(res, "Latest AQI poll");
        if (cancelled || !json?.row) return;
        const newStr = JSON.stringify(json.row);
        const curStr = latestRowRef.current ? JSON.stringify(latestRowRef.current) : null;
        if (newStr !== curStr) {
          // New AQI data detected — update card immediately, then reload full table
          latestRowRef.current = json.row;
          persistLatestRow(province, pollutant, json.row);
          setCachedLatest(json.row);
          fetchData({ force: true, background: true });
        }
      } catch { /* network errors are silent */ }
    };

    // Delay the first fast poll so it doesn't race with the initial full fetch
    startDelayId = setTimeout(() => {
      if (!cancelled) {
        intervalId = setInterval(pollLatest, LATEST_POLL_MS);
      }
    }, 5000);

    return () => {
      cancelled = true;
      clearTimeout(startDelayId);
      if (intervalId) clearInterval(intervalId);
    };
  }, [province, pollutant, fetchData]);

  // Transform to { t, y, conc, status } for chart & calendar (y = AQI)
  // Server delivers newest-first, so we reverse to chronological order.
  const dailyRows = useMemo(() => {
    if (!rows.length || !dateCol) return [];
    // Reverse to chronological (oldest-first) for charts & calendar
    const chrono = [...rows].reverse();
    return chrono
      .map((r) => {
        const dateRaw = r[dateCol];
        if (!dateRaw) return null;
        const d = new Date(dateRaw);
        // Require a plausible year to reject epoch-0 or non-date column values
        if (isNaN(d.getTime()) || d.getFullYear() < 2015) return null;
        const aqi = r["AQI"] ?? r["aqi"] ?? null;
        if (aqi == null || !isFinite(Number(aqi))) return null;
        // Skip erratic data: zero AQI or Invalid/For Validation status
        if (Number(aqi) === 0) return null;
        const status = r["Status"] ?? r["status"] ?? null;
        if (/^(invalid|for\s*validation)$/i.test(String(status || ""))) return null;
        // Include concentration and status for calendar tiles
        const conc = concCol ? (r[concCol] ?? null) : null;
        return {
          t: d.toISOString(),
          y: Number(aqi),
          conc: conc != null ? Number(conc) : null,
          status: status || null,
        };
      })
      .filter(Boolean);
  }, [rows, dateCol, concCol]);

  return {
    rows,
    latest,
    cachedLatest, // from secureStorage — available immediately on mount
    dailyRows,
    loading,
    error,
    fetchedAt,
    retry: () => fetchData({ force: true }),
    dateCol,
    concCol,
    raw,
    source,
    backupMeta,
    sheetSyncing,       // true while server fetches fresh data from Google Sheets
    latestAqiVerified,  // true when newest row AQI came from the sheet's own formula
  };
}
