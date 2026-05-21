// Lightweight API client with retry, timeout, jitter, and in-memory cache.
// Focus: robust data loading with stale-while-refresh semantics.
import { getApiBase } from './apiBase';
import { readJsonResponse } from './jsonResponse';

const _cache = new Map(); // key -> { data, ts }

function sleep(ms, signal) {
  return new Promise((resolve, reject) => {
    const id = setTimeout(resolve, ms);
    if (signal) {
      signal.addEventListener('abort', () => {
        clearTimeout(id);
        reject(new DOMException('Aborted', 'AbortError'));
      }, { once: true });
    }
  });
}

export async function fetchJson(endpointOrUrl, opts = {}) {
  const {
    params,
    retries = 3,
    timeoutMs = 10000,
    backoffBase = 600,
    backoffFactor = 1.8,
    cacheKey,
    cacheTtlMs = 0,
    signal,
  } = opts;

  let url;
  try {
    if (/^https?:\/\//i.test(endpointOrUrl)) {
      url = new URL(endpointOrUrl);
    } else {
      // Concatenate base + path so subpath prefixes like /air-quality-monitoring are preserved
      url = new URL(getApiBase() + endpointOrUrl);
    }
  } catch (e) {
    throw new Error('Invalid URL: ' + endpointOrUrl);
  }
  if (params && typeof params === 'object') {
    Object.entries(params).forEach(([k, v]) => {
      if (v == null) return;
      url.searchParams.set(k, String(v));
    });
  }

  const key = cacheKey || url.toString();
  const now = Date.now();
  const cached = _cache.get(key);
  if (cached && cacheTtlMs > 0 && (now - cached.ts) < cacheTtlMs) {
    return { data: cached.data, fromCache: true };
  }

  let attempt = 0;
  let lastErr;
  while (attempt <= retries) {
    const attemptController = new AbortController();
    const compositeSignal = signal ? tieSignals(signal, attemptController.signal) : attemptController.signal;
    const tId = setTimeout(() => attemptController.abort(), timeoutMs);
    try {
      const res = await fetch(url.toString(), {
        cache: 'no-cache',
        signal: compositeSignal,
        headers: {
          'Accept': 'application/json',
          'Cache-Control': 'no-cache',
          'Pragma': 'no-cache',
        },
      });
      clearTimeout(tId);
      if (!res.ok) {
        // Treat 5xx and network errors as retryable; 4xx as fatal
        if (res.status >= 500 && attempt < retries) {
          throw new Error('Retryable HTTP ' + res.status);
        }
        if (res.status >= 400) {
          return { error: 'HTTP ' + res.status, status: res.status };
        }
      }
      const json = await readJsonResponse(res, 'API request');
      _cache.set(key, { data: json, ts: Date.now() });
      return { data: json, status: res.status, attempt };
    } catch (e) {
      clearTimeout(tId);
      lastErr = e;
      if (e && (e.name === 'AbortError' || /aborted/i.test(e.message))) {
        lastErr = new Error('Request timed out');
      }
      if (attempt >= retries) break;
      // Backoff with jitter
      const backoffMs = backoffBase * Math.pow(backoffFactor, attempt);
      const jitter = Math.random() * 120;
      try {
        await sleep(backoffMs + jitter, signal);
      } catch { break; }
    }
    attempt += 1;
  }
  return { error: lastErr?.message || 'fetch failed', attempt };
}

function tieSignals(a, b) {
  if (!a || a === b) return b;
  const c = new AbortController();
  function forwardAbort(from) {
    if (from.aborted && !c.aborted) c.abort();
  }
  a.addEventListener('abort', () => forwardAbort(a));
  b.addEventListener('abort', () => forwardAbort(b));
  return c.signal;
}

// Shared hook for declarative data loading with stale-while-refresh semantics.
import { useEffect, useRef, useState } from 'react';
export function useApiEndpoint(endpoint, options = {}) {
  const {
    params,
    cacheKey,
    cacheTtlMs = 0,
    refreshMs = 300000, // default 5 min
    enabled = true,
    transform, // optional function(json) -> data
    retries,
    timeoutMs,
  } = options;

  const [state, setState] = useState({ loading: true, refreshing: false, error: null, data: null, meta: null, updatedAt: null, attempt: 0, retrying: false });
  const [nonce, setNonce] = useState(0); // increment to force refetch
  const mountedRef = useRef(true);
  const controllerRef = useRef(null);

  useEffect(() => { return () => { mountedRef.current = false; if (controllerRef.current) controllerRef.current.abort(); }; }, []);

  // Keep transform stable via ref to avoid effect loops when a new function instance passed each render
  const transformRef = useRef(transform);
  transformRef.current = transform;

  const paramsHash = JSON.stringify(params);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    async function load(first = false, force = false) {
      if (cancelled) return;
      controllerRef.current?.abort();
      const ac = new AbortController();
      controllerRef.current = ac;
      setState(s => ({ ...s, loading: first && !s.data, refreshing: !first && !!s.data, error: first ? null : s.error, retrying: force }));
      const result = await fetchJson(endpoint, { params, cacheKey, cacheTtlMs: force ? 0 : cacheTtlMs, retries, timeoutMs, signal: ac.signal });
      if (cancelled) return;
      if (result.data) {
        const transformed = transformRef.current ? transformRef.current(result.data) : result.data;
        setState({ loading: false, refreshing: false, error: null, data: transformed?.data || transformed?.series || transformed, meta: transformed?.meta || null, updatedAt: Date.now(), attempt: result.attempt || 0, retrying: false });
      } else {
        setState(s => ({ ...s, loading: false, refreshing: false, error: result.error || 'Failed', attempt: result.attempt || (s.attempt+1), retrying: false }));
      }
    }
    load(true);
    if (refreshMs && refreshMs > 0) {
      const id = setInterval(() => load(false), refreshMs);
      return () => { cancelled = true; clearInterval(id); };
    }
    return () => { cancelled = true; };
  }, [endpoint, paramsHash, cacheKey, cacheTtlMs, refreshMs, enabled, retries, timeoutMs, nonce]);

  function retry() {
    // Force refetch bypassing cache and marking retrying
    setNonce(n => n + 1);
    setState(s => ({ ...s, retrying: true }));
  }

  return { ...state, retry };
}
