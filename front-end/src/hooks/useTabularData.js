/**
 * useTabularData – fetches data from /api/tabular/:province/:pollutant
 * and transforms it into the format the dashboard components expect.
 *
 * Returns { rows, latest, dailyRows, loading, error, fetchedAt, retry, source, backupMeta }
 *   - rows       : raw enhanced rows from the server (newest-first)
 *   - latest     : the most recent row with valid AQI (for AQI hero card)
 *   - dailyRows  : array of { t, y, conc, status } in chronological order
 *   - loading    : boolean
 *   - error      : string | null
 *   - fetchedAt  : ISO timestamp
 *   - retry      : function to force re-fetch
 *   - source     : "sheet" | "cache" | "stale-cache" | "mongodb-backup"
 *   - backupMeta : { lastBackupAt, lastCheckedAt, rowCount } when served from backup
 */
import { useEffect, useState, useMemo, useCallback, useRef } from "react";
import { getApiBase } from "../util/apiBase";

const TABULAR_REFRESH_MS = 300_000;
const TABULAR_CACHE = new Map();

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
    const res = await fetch(url, { headers: { Accept: "application/json" } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    const json = await res.json();
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

export default function useTabularData(province, pollutant) {
  const initialCache = readCachedTabular(province, pollutant);
  const [raw, setRaw] = useState(initialCache?.data?.raw || null);
  const [loading, setLoading] = useState(Boolean(province && pollutant && !initialCache?.data));
  const [error, setError] = useState(null);
  const [fetchedAt, setFetchedAt] = useState(initialCache?.data?.fetchedAt || null);
  const [source, setSource] = useState(initialCache?.data?.source || null);
  const [backupMeta, setBackupMeta] = useState(initialCache?.data?.backupMeta || null);
  const mountedRef = useRef(true);

  const applyPayload = useCallback((payload) => {
    if (!payload) return;
    setRaw(payload.raw);
    setFetchedAt(payload.fetchedAt);
    setSource(payload.source);
    setBackupMeta(payload.backupMeta);
    setError(null);
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

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
  const dateCol = useMemo(() => {
    if (!raw?.columns) return null;
    const cols = raw.columns;
    const match = cols.find((c) => /date|time/i.test(c));
    return match || cols[0] || null;
  }, [raw]);

  // Find the concentration column key
  const concCol = useMemo(() => {
    if (!raw?.columns) return null;
    return raw.columns.find((c) => /concentration/i.test(c)) || null;
  }, [raw]);

  // Latest row – server returns NEWEST-FIRST, so rows[0] is the most recent.
  // Always display the latest encoded value from the Google Sheet,
  // regardless of how old it is. This ensures the most recent data
  // entered by the end user is always shown.
  const latest = useMemo(() => {
    if (!rows.length) return null;
    // Always use the absolute newest row (latest encoded data)
    return rows[0];
  }, [rows]);

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
        if (isNaN(d.getTime())) return null;
        const aqi = r["AQI"] ?? r["aqi"] ?? null;
        if (aqi == null || !isFinite(Number(aqi))) return null;
        // Include concentration and status for calendar tiles
        const conc = concCol ? (r[concCol] ?? null) : null;
        const status = r["Status"] ?? r["status"] ?? null;
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
    dailyRows,
    loading,
    error,
    fetchedAt,
    retry: fetchData,
    dateCol,
    concCol,
    raw,
    source,
    backupMeta,
  };
}
