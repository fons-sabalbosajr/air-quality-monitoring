/**
 * Resilient HTTP fetch helpers with timeout, retries and backoff.
 */

// JSON fetch with retry
async function fetchWithRetry(
  url,
  {
    retries = 2,
    timeoutMs = 15000,
    backoffBase = 700,
    backoffFactor = 1.9,
    init,
  } = {},
) {
  let attempt = 0;
  let lastErr;
  while (attempt <= retries) {
    const ac = new AbortController();
    const tid = setTimeout(() => ac.abort(), timeoutMs);
    try {
      const res = await fetch(url, { signal: ac.signal, ...(init || {}) });
      clearTimeout(tid);
      if (!res.ok) {
        if (res.status >= 500 && attempt < retries)
          throw new Error(`HTTP ${res.status}`);
        return {
          ok: res.ok,
          status: res.status,
          data: await res.json().catch(() => null),
        };
      }
      const data = await res.json();
      return { ok: true, status: res.status, data };
    } catch (e) {
      clearTimeout(tid);
      lastErr = e;
      if (attempt >= retries) break;
      const backoff =
        backoffBase * Math.pow(backoffFactor, attempt) + Math.random() * 150;
      await new Promise((r) => setTimeout(r, backoff));
    }
    attempt += 1;
  }
  return { ok: false, status: 0, error: lastErr?.message || "upstream failed" };
}

// Binary buffer fetch with retry
async function fetchBufferWithRetry(
  url,
  {
    retries = 2,
    timeoutMs = 60000,
    backoffBase = 800,
    backoffFactor = 1.9,
    headers,
    method,
    body,
  } = {},
) {
  let attempt = 0;
  let lastErr;
  while (attempt <= retries) {
    const ac = new AbortController();
    const tid = setTimeout(() => ac.abort(), timeoutMs);
    try {
      const res = await fetch(url, {
        signal: ac.signal,
        headers,
        method,
        body,
      });
      clearTimeout(tid);
      if (!res.ok) {
        if (res.status >= 500 && attempt < retries)
          throw new Error(`HTTP ${res.status}`);
        const txt = await res.text().catch(() => "");
        throw new Error(`HTTP ${res.status} ${txt}`);
      }
      const ab = await res.arrayBuffer();
      return Buffer.from(ab);
    } catch (e) {
      clearTimeout(tid);
      lastErr = e;
      if (attempt >= retries) break;
      const backoff =
        backoffBase * Math.pow(backoffFactor, attempt) + Math.random() * 200;
      await new Promise((r) => setTimeout(r, backoff));
    }
    attempt += 1;
  }
  throw new Error(lastErr?.message || "buffer fetch failed");
}

module.exports = { fetchWithRetry, fetchBufferWithRetry };
