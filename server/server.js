/* Simple Express server to expose viz_data from an Excel workbook.
 * Configure the Excel location via environment:
 *   - EXCEL_FILE_PATH=D:/path/to/CLARK AQMS AQI.xlsm
 *   - or place the file at ./data/aqi.xlsm relative to this server and omit the env var
 */
require("dotenv").config();
const express = require("express");
const cors = require("cors");
const path = require("path");
const fs = require("fs");
const XLSX = require("xlsx");

const app = express();
app.use(cors());
app.use(express.json());

// Basic health & root info endpoints for deployment platforms (e.g., Render)
app.get('/', (req, res) => {
  res.status(200).json({ service: 'aqm-server', status: 'ok' });
});
app.get('/health', (req, res) => {
  res.status(200).json({ health: 'ok', timestamp: Date.now() });
});

const PORT = process.env.PORT || 3001;
const DEFAULT_RELATIVE = path.join(__dirname, "data", "aqi.xlsm");
// OpenWeatherMap API key (multiple possible env variable names including Vite prefix)
const OWM_API_KEY =
  process.env.OWM_API_KEY ||
  process.env.OPENWEATHERMAP_API_KEY ||
  process.env.VITE_OWM_API_KEY ||
  null;

// Caching to avoid repeated remote downloads/parsing
const CACHE_TTL_MS = Number(process.env.CACHE_TTL_MS || 60_000);
const DISK_CACHE_ENABLED = process.env.DISABLE_DISK_CACHE === '1' ? false : true;
const CACHE_DIR = process.env.CACHE_DIR || path.join(__dirname, 'data', '.cache');
if (DISK_CACHE_ENABLED) {
  try { fs.mkdirSync(CACHE_DIR, { recursive: true }); } catch {}
}
const _wbCache = new Map(); // key -> { ts, buf }
const _vizCache = new Map(); // key -> { ts, result }

// Generic resilient upstream fetch with timeout + limited retries
async function fetchWithRetry(url, { retries = 2, timeoutMs = 15000, backoffBase = 700, backoffFactor = 1.9, init } = {}) {
  let attempt = 0;
  let lastErr;
  while (attempt <= retries) {
    const ac = new AbortController();
    const tid = setTimeout(() => ac.abort(), timeoutMs);
    try {
      const res = await fetch(url, { signal: ac.signal, ...(init||{}) });
      clearTimeout(tid);
      if (!res.ok) {
        // retry on 5xx / network only
        if (res.status >= 500 && attempt < retries) throw new Error(`HTTP ${res.status}`);
        return { ok: res.ok, status: res.status, data: await res.json().catch(() => null) };
      }
      const data = await res.json();
      return { ok: true, status: res.status, data };
    } catch (e) {
      clearTimeout(tid);
      lastErr = e;
      if (attempt >= retries) break;
      const backoff = backoffBase * Math.pow(backoffFactor, attempt) + Math.random() * 150;
      await new Promise(r => setTimeout(r, backoff));
    }
    attempt += 1;
  }
  return { ok: false, status: 0, error: lastErr?.message || 'upstream failed' };
}

// Buffer (binary) fetch with retry and timeout
async function fetchBufferWithRetry(url, { retries = 2, timeoutMs = 60000, backoffBase = 800, backoffFactor = 1.9, headers, method, body } = {}) {
  let attempt = 0;
  let lastErr;
  while (attempt <= retries) {
    const ac = new AbortController();
    const tid = setTimeout(() => ac.abort(), timeoutMs);
    try {
      const res = await fetch(url, { signal: ac.signal, headers, method, body });
      clearTimeout(tid);
      if (!res.ok) {
        if (res.status >= 500 && attempt < retries) throw new Error(`HTTP ${res.status}`);
        const txt = await res.text().catch(() => '');
        throw new Error(`HTTP ${res.status} ${txt}`);
      }
      const ab = await res.arrayBuffer();
      return Buffer.from(ab);
    } catch (e) {
      clearTimeout(tid);
      lastErr = e;
      if (attempt >= retries) break;
      const backoff = backoffBase * Math.pow(backoffFactor, attempt) + Math.random() * 200;
      await new Promise(r => setTimeout(r, backoff));
    }
    attempt += 1;
  }
  throw new Error(lastErr?.message || 'buffer fetch failed');
}

function resolveWorkbookPath() {
  const p = process.env.EXCEL_FILE_PATH || DEFAULT_RELATIVE;
  return p;
}

function parseExcelDate(n) {
  // Excel serial date to JS Date (assuming 1900 date system)
  try {
    const d = XLSX.SSF.parse_date_code(n);
    if (!d) return null;
    const js = new Date(
      Date.UTC(
        d.y,
        (d.m || 1) - 1,
        d.d || 1,
        d.H || 0,
        d.M || 0,
        Math.floor(d.S || 0)
      )
    );
    return js;
    
  } catch {
    return null;
  }
}

function coerceDate(val) {
  if (val == null) return null;
  if (val instanceof Date) return val;
  if (typeof val === "number") {
    // try excel serial
    const d = parseExcelDate(val);
    if (d) return d;
    // maybe ms since epoch
    const d2 = new Date(val);
    if (!isNaN(d2)) return d2;
  }
  const d3 = new Date(String(val));
  if (!isNaN(d3)) return d3;
  return null;
}

function pickKeys(row) {
  // Backward-compatible simple heuristic based on header names
  const keys = Object.keys(row);
  const dateCandidates = [
    "Date",
    "Datetime",
    "DateTime",
    "Timestamp",
    "Time",
    "DATE",
    "DATETIME",
    "Data Visualization Process", // observed in provided workbook
  ];
  const valueCandidates = [
    "AQI",
    "Value",
    "PM2.5",
    "PM10",
    "NO2",
    "O3",
    "SO2",
    "CO",
    "Index",
    "Reading",
  ];
  let xKey =
    keys.find((k) => dateCandidates.includes(k)) ||
    keys.find((k) => /date|time/i.test(k));
  let yKey =
    keys.find((k) => valueCandidates.includes(k)) ||
    keys.find((k) => k !== xKey && /aqi|value|pm|index|reading/i.test(k));
  return { xKey, yKey };
}

function pickKeysFromRows(rows) {
  if (!rows || rows.length === 0) return { xKey: null, yKey: null };
  const keys = Object.keys(rows[0] || {});

  // Heuristic 1: If there is a synthetic header row (row 0) with textual labels like
  // "DATE & TIME", "HOURLY CONC (µg/Ncm)", "24 HR ROLLING AQI VALUE" etc.,
  // use those to map the date and preferred value columns.
  const headerRow = rows[0] || {};
  const headerValues = Object.fromEntries(
    keys.map((k) => [k, (headerRow[k] || "").toString().trim()])
  );
  const labels = Object.values(headerValues).filter((v) => v.length > 0);
  const headerLooksLikeLabels =
    labels.length >= 3 && labels.every((v) => /[A-Za-z]/.test(v));
  if (headerLooksLikeLabels) {
    // xKey: look for label containing DATE or TIME
    const xKeyFromHeader = keys.find((k) =>
      /date|time/i.test(headerValues[k] || "")
    );
    // yKey preference order: 24 HR ROLLING AQI VALUE > AQI (generic) > HOURLY CONC > TRUNCATED VALUE > first numeric
    const yPrefOrder = [
      /24\s*HR\s*ROLLING\s*AQI\s*VALUE/i,
      /\bAQI\b/i,
      /HOURLY\s*CONC/i,
      /TRUNCATED\s*VALUE/i,
    ];
    let yKeyFromHeader = null;
    for (const rx of yPrefOrder) {
      const found = keys.find((k) => rx.test(headerValues[k] || ""));
      if (found) {
        yKeyFromHeader = found;
        break;
      }
    }
    // If not found by regex, fall back to numeric scoring from data rows (skip header row)
    if (!yKeyFromHeader) {
      const candidates = keys.filter((k) => k !== xKeyFromHeader);
      const scores = candidates.map((k) => {
        let numericHits = 0;
        for (let i = 1; i < Math.min(rows.length, 20); i++) {
          let v = rows[i]?.[k];
          if (typeof v === "string") v = v.replace(/[, ]/g, "");
          if (v !== null && v !== undefined && v !== "") {
            const n = Number(v);
            if (isFinite(n)) numericHits++;
          }
        }
        return { k, score: numericHits };
      });
      scores.sort((a, b) => b.score - a.score);
      yKeyFromHeader = scores[0]?.score > 0 ? scores[0].k : null;
    }
    const xKey =
      xKeyFromHeader ||
      (keys.includes("Data Visualization Process")
        ? "Data Visualization Process"
        : null);
    const yKey = yKeyFromHeader || null;
    if (xKey && yKey) return { xKey, yKey };
  }

  // Generic scoring for date and numeric columns
  const sampleN = Math.min(rows.length, 20);
  const keyScores = keys.reduce(
    (acc, k) => {
      let dateHits = 0,
        numHits = 0;
      for (let i = 0; i < sampleN; i++) {
        const v = rows[i]?.[k];
        const d = coerceDate(v);
        if (d) dateHits++;
        let vv = v;
        if (typeof vv === "string") vv = vv.replace(/[, ]/g, "");
        const n = Number(vv);
        if (vv !== null && vv !== undefined && vv !== "" && isFinite(n))
          numHits++;
      }
      acc.date[k] = dateHits;
      acc.num[k] = numHits;
      return acc;
    },
    { date: {}, num: {} }
  );
  const bestDate = Object.entries(keyScores.date).sort(
    (a, b) => b[1] - a[1]
  )[0]?.[0];
  const bestNum = Object.entries(keyScores.num)
    .filter(([k]) => k !== bestDate)
    .sort((a, b) => b[1] - a[1])[0]?.[0];
  return { xKey: bestDate || null, yKey: bestNum || null };
}

async function loadWorkbook(p) {
  // Support local filesystem path or http(s) URL (best-effort).
  // For http(s): try anonymous download first (works for public/share links). If it fails or isn't a file download and the host is SharePoint with Graph creds, fall back to Graph.
  if (/^https?:\/\//i.test(p)) {
    const url = new URL(p);
    const isSP = /\.sharepoint\.com$/i.test(url.hostname);
    const hasGraph = !!(
      process.env.GRAPH_TENANT_ID &&
      process.env.GRAPH_CLIENT_ID &&
      process.env.GRAPH_CLIENT_SECRET
    );

    // Cache by URL (memory + disk)
    const cached = _wbCache.get(p);
    const diskKey = Buffer.from(p, 'utf8').toString('base64').replace(/\W/g, '_') + '.xlsm';
    const diskPath = path.join(CACHE_DIR, diskKey);
    if (cached && (Date.now() - cached.ts) < CACHE_TTL_MS) {
      return XLSX.read(cached.buf, { type: 'buffer', cellDates: true, cellNF: false, cellText: false });
    }
    // Try fresh-enough disk cache
    if (DISK_CACHE_ENABLED) {
      try {
        const st = fs.statSync(diskPath);
        if (st && (Date.now() - st.mtimeMs) < CACHE_TTL_MS) {
          const buf = fs.readFileSync(diskPath);
          _wbCache.set(p, { ts: Date.now(), buf });
          return XLSX.read(buf, { type: 'buffer', cellDates: true, cellNF: false, cellText: false });
        }
      } catch {}
    }

    // 1) Attempt anonymous fetch (works if link is "anyone with the link" and points to direct download)
    try {
      // Attempt anonymous direct bytes with retry
      const buf = await fetchBufferWithRetry(p, { retries: 1, timeoutMs: 25000 });
        _wbCache.set(p, { ts: Date.now(), buf });
        if (DISK_CACHE_ENABLED) { try { fs.writeFileSync(diskPath, buf); } catch {} }
        // If it's an Excel/zip/octet-stream it's likely the file. Try to parse regardless; if it fails, we'll fall back to Graph below.
        try {
          return XLSX.read(buf, {
            type: "buffer",
            cellDates: true,
            cellNF: false,
            cellText: false,
          });
        } catch (e) {
          // continue to fallback
        }
    } catch (_) {
      // ignore and try fallback when applicable
    }

    // 2) If SharePoint share link (/:x:/g/...) try canonical download.aspx?share=<id>
    if (isSP && /\/:.?:\/g\//i.test(url.pathname)) {
      // extract share id (last non-empty path segment)
      const parts = url.pathname.split("/").filter(Boolean);
      const shareId = parts[parts.length - 1];
      // try to reconstruct personal path segment to build _layouts download URL
      const personalIdx = parts.indexOf("personal");
      if (shareId && personalIdx !== -1 && parts.length > personalIdx + 1) {
        const userSegment = parts[personalIdx + 1];
        const dlUrl1 = `https://${
          url.hostname
        }/personal/${userSegment}/_layouts/15/download.aspx?share=${encodeURIComponent(
          shareId
        )}`;
        const dlUrl2 = `https://${
          url.hostname
        }/_layouts/15/download.aspx?share=${encodeURIComponent(shareId)}`;
        try {
          const buf2 = await fetchBufferWithRetry(dlUrl1, { retries: 1, timeoutMs: 25000 }).catch(async () => {
            return await fetchBufferWithRetry(dlUrl2, { retries: 1, timeoutMs: 25000 });
          });
          if (DISK_CACHE_ENABLED) { try { fs.writeFileSync(diskPath, buf2); } catch {} }
          return XLSX.read(buf2, {
            type: "buffer",
            cellDates: true,
            cellNF: false,
            cellText: false,
          });
        } catch (_) {
          // continue to next fallback
        }
      }
    }

    // 3) Fallback to Graph for SharePoint hosts when credentials are present
    if (isSP && hasGraph) {
      // If this is a share link (/:x:/g/...), use Graph shares API; else use site/drive path
      let buf;
      if (/\/:[a-z]:\/g\//i.test(url.pathname)) {
        buf = await downloadFromShareLinkViaGraph(url.href);
      } else {
        buf = await downloadFromSharePointViaGraph(url.href);
      }
      _wbCache.set(p, { ts: Date.now(), buf });
      if (DISK_CACHE_ENABLED) { try { fs.writeFileSync(diskPath, buf); } catch {} }
      return XLSX.read(buf, {
        type: "buffer",
        cellDates: true,
        cellNF: false,
        cellText: false,
      });
    }

    // 4) If we got here, anonymous failed and no Graph path available
    const reason = isSP
      ? "If this is a SharePoint/OneDrive link that is not public, either provide an 'anyone with the link' direct download URL or configure Microsoft Graph credentials and admin consent."
      : "Verify the URL is reachable and returns the file bytes.";
    throw new Error(`Failed to download Excel from URL. ${reason}`);
  }
  if (!fs.existsSync(p)) {
    throw new Error(
      `Excel file not found at ${p}. Set EXCEL_FILE_PATH or place file at ${DEFAULT_RELATIVE}`
    );
  }
  return XLSX.readFile(p, { cellDates: true, cellNF: false, cellText: false });
}

async function graphClientCredentialsToken() {
  const tenant = process.env.GRAPH_TENANT_ID;
  const clientId = process.env.GRAPH_CLIENT_ID;
  const clientSecret = process.env.GRAPH_CLIENT_SECRET;
  const authority = `https://login.microsoftonline.com/${tenant}/oauth2/v2.0/token`;
  const body = new URLSearchParams();
  body.set("grant_type", "client_credentials");
  body.set("client_id", clientId);
  body.set("client_secret", clientSecret);
  body.set("scope", "https://graph.microsoft.com/.default");
  const resp = await fetchWithRetry(authority, { timeoutMs: 12000, retries: 2, init: { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body } });
  if (!resp.ok || !resp.data?.access_token) {
    throw new Error(`Failed to acquire Graph token (${resp.status || 'n/a'})`);
  }
  const json = resp.data;
  return json.access_token;
}

function splitSharePointUrl(spUrl) {
  // Expect: https://{host}/personal/{user}/Documents/.../file.xlsm
  const url = new URL(spUrl);
  const host = url.hostname;
  const parts = url.pathname.split("/").filter(Boolean);
  const idx = parts.indexOf("personal");
  if (idx === -1) return null;
  const sitePath = "/" + parts.slice(0, idx + 2).join("/"); // /personal/{user}
  const filePath = "/" + parts.slice(idx + 2).join("/"); // /Documents/.../file.xlsm
  return { host, sitePath, filePath };
}

async function downloadFromSharePointViaGraph(spUrl) {
  const token = await graphClientCredentialsToken();
  const parsed = splitSharePointUrl(spUrl);
  if (!parsed) throw new Error("Unable to parse SharePoint personal URL");
  const { host, sitePath, filePath } = parsed;
  const envHost = process.env.SHAREPOINT_HOST || host;
  const envSitePath = process.env.SHAREPOINT_SITE_PATH || sitePath;
  const envFilePath = process.env.SHAREPOINT_FILE_PATH || filePath;

  // Resolve site id
  const siteResp = await fetchWithRetry(`https://graph.microsoft.com/v1.0/sites/${encodeURIComponent(envHost)}:${encodeURI(envSitePath)}`, { retries: 2, timeoutMs: 15000, init: { headers: { Authorization: `Bearer ${token}` } } });
  if (!siteResp.ok) {
    throw new Error(`Failed to resolve SharePoint site (${siteResp.status})`);
  }
  const siteJson = siteResp.data;
  const siteId = siteJson.id;
  if (!siteId) throw new Error("SharePoint site id not found");

  // Download file content
  const buf = await fetchBufferWithRetry(`https://graph.microsoft.com/v1.0/sites/${encodeURIComponent(siteId)}/drive/root:${encodeURI(envFilePath)}:/content`, { retries: 2, timeoutMs: 30000, headers: { Authorization: `Bearer ${token}` } });
  return buf;
}

// Download using Graph from a SharePoint/OneDrive share link (/:x:/g/...)
function encodeShareUrlForGraph(url) {
  // base64url of the full URL, prefixed by 'u!'
  const b64 = Buffer.from(url, 'utf8').toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
  return 'u!' + b64;
}
async function downloadFromShareLinkViaGraph(shareUrl) {
  const token = await graphClientCredentialsToken();
  const encoded = encodeShareUrlForGraph(shareUrl);
  const buf = await fetchBufferWithRetry(`https://graph.microsoft.com/v1.0/shares/${encoded}/driveItem/content`, { retries: 2, timeoutMs: 30000, headers: { Authorization: `Bearer ${token}` } });
  return buf;
}

async function readVizData(yKeyOverride) {
  const wbPath = resolveWorkbookPath();
  const cacheKey = `${wbPath}|viz|${yKeyOverride || ''}`;
  const cached = _vizCache.get(cacheKey);
  if (cached && (Date.now() - cached.ts) < CACHE_TTL_MS) {
    return cached.result;
  }
  const wb = await loadWorkbook(wbPath);
  const sheetName =
    wb.SheetNames.find((n) => n.toLowerCase() === "viz_data") ||
    wb.SheetNames[0];
  const ws = wb.Sheets[sheetName];
  if (!ws) throw new Error(`Sheet 'viz_data' not found in workbook.`);
  const rows = XLSX.utils.sheet_to_json(ws, { raw: true, defval: null });
  if (!Array.isArray(rows))
    return {
      series: [],
      meta: {
        sheet: sheetName,
        xKey: null,
        yKey: null,
        yLabel: null,
        points: 0,
      },
    };

  const keysPicked = rows.length
    ? pickKeysFromRows(rows)
    : { xKey: null, yKey: null };
  const xKey = keysPicked.xKey;
  let yKey = yKeyOverride || keysPicked.yKey;
  // If override not provided and not found, attempt to pick the first numeric-looking column
  if (!yKey && rows.length) {
    const sample = rows[0];
    yKey = Object.keys(sample).find(
      (k) =>
        k !== xKey && !isNaN(Number(String(sample[k]).replace(/[, ]/g, "")))
    );
  }

  // Friendly labels from the first data row (often contains readable headers)
  const headerRow = rows[0] || {};
  const headerValues = Object.fromEntries(
    Object.keys(headerRow).map((k) => [
      k,
      (headerRow[k] || "").toString().trim(),
    ])
  );
  const yLabel = (yKey && headerValues[yKey]) || yKey || null;

  const series = rows
    .map((r) => {
      const t = coerceDate(r[xKey]);
      let yStr = r[yKey];
      if (typeof yStr === "string") yStr = yStr.replace(/[, ]/g, "");
      const y = Number(yStr);
      if (!t || !isFinite(y)) return null;
      // Use epoch milliseconds to preserve local wall-clock times in the client
      return { t: t.getTime(), y };
    })
    .filter(Boolean)
    .sort((a, b) =>
      typeof a.t === "string" ? a.t.localeCompare(b.t) : a.t - b.t
    );

  return {
    series,
    meta: {
      sheet: sheetName,
      xKey,
      yKey,
      yLabel,
      points: series.length,
      path: wbPath,
    },
  };
}

async function readSheetSeries(sheetName, yKeyOverride) {
  const wbPath = resolveWorkbookPath();
  const wb = await loadWorkbook(wbPath);
  const sheet =
    wb.SheetNames.find(
      (n) => n.toLowerCase() === String(sheetName).toLowerCase()
    ) || null;
  if (!sheet) throw new Error(`Sheet '${sheetName}' not found in workbook.`);
  const ws = wb.Sheets[sheet];
  const rows = XLSX.utils.sheet_to_json(ws, { raw: true, defval: null });
  if (!Array.isArray(rows))
    return {
      series: [],
      meta: {
        sheet,
        xKey: null,
        yKey: null,
        yLabel: null,
        points: 0,
        path: wbPath,
      },
    };

  const keysPicked = rows.length
    ? pickKeysFromRows(rows)
    : { xKey: null, yKey: null };
  const xKey = keysPicked.xKey;
  let yKey = yKeyOverride || keysPicked.yKey;
  if (!yKey && rows.length) {
    const sample = rows[0];
    yKey = Object.keys(sample).find(
      (k) =>
        k !== xKey && !isNaN(Number(String(sample[k]).replace(/[, ]/g, "")))
    );
  }

  const headerRow = rows[0] || {};
  const headerValues = Object.fromEntries(
    Object.keys(headerRow).map((k) => [
      k,
      (headerRow[k] || "").toString().trim(),
    ])
  );
  const yLabel = (yKey && headerValues[yKey]) || yKey || null;

  const series = rows
    .map((r) => {
      const t = coerceDate(r[xKey]);
      let yStr = r[yKey];
      if (typeof yStr === "string") yStr = yStr.replace(/[, ]/g, "");
      const y = Number(yStr);
      if (!t || !isFinite(y)) return null;
      return { t: t.getTime(), y };
    })
    .filter(Boolean)
    .sort((a, b) =>
      typeof a.t === "string" ? a.t.localeCompare(b.t) : a.t - b.t
    );

  return {
    series,
    meta: { sheet, xKey, yKey, yLabel, points: series.length, path: wbPath },
  };
}

// PM10 worksheet series
app.get("/api/pm10-data", async (req, res) => {
  try {
    const { yKey } = req.query;
    const data = await readSheetSeries("PM10", yKey);
    res.json(data);
  } catch (e) {
    res.status(500).json({ error: e.message || "Failed to read PM10 sheet" });
  }
});

app.get("/api/viz-data", async (req, res) => {
  try {
    const { yKey } = req.query;
    const data = await readVizData(yKey);
    res.json(data);
  } catch (e) {
    res.status(500).json({ error: e.message || "Failed to read viz_data" });
  }
});

// Latest AQI category (from viz_data sheet)
app.get("/api/aqi/latest", async (req, res) => {
  try {
    const wbPath = resolveWorkbookPath();
    const wb = await loadWorkbook(wbPath);
    const sheetName =
      wb.SheetNames.find((n) => n.toLowerCase() === "viz_data") ||
      wb.SheetNames[0];
    const ws = wb.Sheets[sheetName];
    if (!ws) return res.status(404).json({ error: "viz_data sheet not found" });
    const rows = XLSX.utils.sheet_to_json(ws, { raw: true, defval: null });
    if (!Array.isArray(rows) || rows.length < 2)
      return res.status(404).json({ error: "No rows in viz_data" });

    // Determine keys from header labels where possible
    const headerRow = rows[0] || {};
    const headerValues = Object.fromEntries(
      Object.keys(headerRow).map((k) => [
        k,
        (headerRow[k] || "").toString().trim(),
      ])
    );
    // Prefer labels containing DATE/TIME for x
    const xKey =
      Object.keys(headerValues).find((k) =>
        /date|time/i.test(headerValues[k] || "")
      ) ||
      (Object.keys(headerValues).includes("Data Visualization Process")
        ? "Data Visualization Process"
        : null);
    // y (value) preference order
    const yPrefOrder = [
      /24\s*HR\s*ROLLING\s*AQI\s*VALUE/i,
      /^\s*AQI\s*$/i,
      /HOURLY\s*CONC/i,
      /TRUNCATED\s*VALUE/i,
    ];
    let valueKey = null;
    for (const rx of yPrefOrder) {
      const found = Object.keys(headerValues).find((k) =>
        rx.test(headerValues[k] || "")
      );
      if (found) {
        valueKey = found;
        break;
      }
    }
    // category column
    let categoryKey =
      Object.keys(headerValues).find((k) =>
        /AQI\s*CATEG(ORY)?/i.test(headerValues[k] || "")
      ) || null;

    // Fallbacks using content heuristics if header detection failed
    if (!valueKey || !xKey) {
      const picked = pickKeysFromRows(rows);
      if (!xKey) valueKey = valueKey; // no-op to keep valueKey
      const fallbackX = picked.xKey;
      const fallbackY = picked.yKey;
      // only adopt fallback if not already set
      const xUse = xKey || fallbackX;
      const yUse = valueKey || fallbackY;
      // assign for downstream
      valueKey = yUse;
      // also try to guess categoryKey as a non-numeric string column
      if (!categoryKey && rows.length > 1) {
        const keys = Object.keys(rows[1] || {});
        categoryKey =
          keys.find((k) => {
            if (k === xUse || k === yUse) return false;
            const v = rows[1]?.[k];
            if (v == null) return false;
            const n = Number(String(v).replace(/[, ]/g, ""));
            return !isFinite(n) && /category|aqi/i.test(String(v))
              ? true
              : /category|aqi/i.test(k);
          }) || null;
      }
    }

    let last = null;
    for (let i = rows.length - 1; i >= 1; i--) {
      const r = rows[i];
      const t = coerceDate(xKey ? r[xKey] : r["Data Visualization Process"]);
      let valRaw = valueKey ? r[valueKey] : null;
      if (typeof valRaw === "string") valRaw = valRaw.replace(/[, ]/g, "");
      const aqiVal = Number(valRaw);
      const cat = categoryKey
        ? r[categoryKey] != null
          ? String(r[categoryKey]).trim()
          : null
        : null;
      if (t && isFinite(aqiVal)) {
        last = { t: t.getTime(), value: aqiVal, category: cat || null };
        break;
      }
    }
    if (!last) return res.status(404).json({ error: "No valid AQI row" });

    // If category missing, infer from value using EPA ranges
    function inferCat(v) {
      if (v <= 50) return "GOOD";
      if (v <= 100) return "MODERATE";
      if (v <= 150) return "UNHEALTHY FOR SENSITIVE GROUPS";
      if (v <= 200) return "UNHEALTHY";
      if (v <= 300) return "VERY UNHEALTHY";
      if (v <= 500) return "HAZARDOUS";
      return "EMERGENCY";
    }
    const category = last.category || inferCat(last.value);
    res.json({
      parameter: "PM10",
      value: last.value,
      category,
      time: last.t,
      path: wbPath,
    });
  } catch (e) {
    res.status(500).json({ error: e.message || "Failed to read latest AQI" });
  }
});

// Station current weather (temperature, humidity, pressure) from Open-Meteo
app.get("/api/station/current", async (req, res) => {
  try {
    const lat = process.env.STATION_LAT;
    const lon = process.env.STATION_LON;
    if (!lat || !lon) {
      return res.status(400).json({ error: "STATION_LAT and STATION_LON must be set in .env" });
    }
    // Primary: Open-Meteo
    const om = new URL("https://api.open-meteo.com/v1/forecast");
    om.searchParams.set("latitude", lat);
    om.searchParams.set("longitude", lon);
    om.searchParams.set("current", "temperature_2m,relative_humidity_2m,pressure_msl");
    om.searchParams.set("timezone", "auto");
    const omResp = await fetchWithRetry(om.toString(), { retries: 2, timeoutMs: 7000 });

    let temperature = null, humidity = null, pressure = null, time = null, units = null;
    if (omResp.ok && omResp.data?.current) {
      temperature = omResp.data.current.temperature_2m ?? null;
      humidity = omResp.data.current.relative_humidity_2m ?? null;
      pressure = omResp.data.current.pressure_msl ?? null;
      time = omResp.data.current.time ?? null;
      units = omResp.data.current_units ?? null;
    }

    // Fallback: OpenWeatherMap (needs API key) if any of primary metrics missing
    if ((!temperature || !humidity || !pressure) && OWM_API_KEY) {
      const owmUrl = `https://api.openweathermap.org/data/2.5/weather?lat=${encodeURIComponent(lat)}&lon=${encodeURIComponent(lon)}&units=metric&appid=${encodeURIComponent(OWM_API_KEY)}`;
      const owResp = await fetchWithRetry(owmUrl, { retries: 2, timeoutMs: 7000 });
      if (owResp.ok && owResp.data) {
        const main = owResp.data.main || {};
        temperature = temperature ?? (main.temp != null ? Math.round(main.temp * 10) / 10 : null);
        humidity = humidity ?? main.humidity ?? null;
        pressure = pressure ?? main.pressure ?? null;
        time = time ?? (owResp.data.dt ? new Date(owResp.data.dt * 1000).toISOString() : null);
        units = units || { temperature_2m: "°C", relative_humidity_2m: "%", pressure_msl: "hPa" };
      }
    }

    if (temperature == null && humidity == null && pressure == null) {
      return res.status(502).json({ error: omResp.error || `All upstream sources failed` });
    }
    res.json({
      latitude: Number(lat),
      longitude: Number(lon),
      temperature_2m: temperature,
      relative_humidity_2m: humidity,
      pressure_msl: pressure,
      time,
      units,
      upstream: {
        openMeteoStatus: omResp.status,
        openWeatherUsed: !!OWM_API_KEY && (temperature == null || humidity == null || pressure == null ? true : false)
      }
    });
  } catch (e) {
    res.status(500).json({ error: e.message || "Failed to fetch station weather" });
  }
});

// Station 3-day forecast (temperature max/min from daily, humidity & pressure daily means from hourly)
app.get("/api/station/forecast", async (req, res) => {
  try {
    const lat = process.env.STATION_LAT;
    const lon = process.env.STATION_LON;
    let days = Number(req.query.days || 3);
    if (!isFinite(days) || days <= 0) days = 3;
    days = Math.min(Math.max(Math.floor(days), 1), 7); // clamp 1..7
    if (!lat || !lon) {
      return res
        .status(400)
        .json({ error: "STATION_LAT and STATION_LON must be set in .env" });
    }
    const url = new URL("https://api.open-meteo.com/v1/forecast");
    url.searchParams.set("latitude", lat);
    url.searchParams.set("longitude", lon);
    url.searchParams.set("daily", "temperature_2m_max,temperature_2m_min");
    url.searchParams.set("hourly", "relative_humidity_2m,pressure_msl");
    url.searchParams.set("timezone", "auto");
    url.searchParams.set("forecast_days", String(days));
    const r = await fetch(url.toString());
    if (!r.ok)
      return res.status(502).json({ error: `Weather upstream ${r.status}` });
    const j = await r.json();

    const daily = j?.daily || {};
    const dtime = daily.time || [];
    const tmax = daily.temperature_2m_max || [];
    const tmin = daily.temperature_2m_min || [];

    const hourly = j?.hourly || {};
    const htime = hourly.time || [];
    const rh = hourly.relative_humidity_2m || [];
    const p = hourly.pressure_msl || [];

    // Group hourly values by date (YYYY-MM-DD) from the provided local timezone timestamps
    const groups = new Map();
    for (let i = 0; i < htime.length; i++) {
      const ts = htime[i];
      const dateKey = typeof ts === "string" ? ts.slice(0, 10) : null; // 'YYYY-MM-DDTHH:MM' -> date
      if (!dateKey) continue;
      if (!groups.has(dateKey)) groups.set(dateKey, { rh: [], p: [] });
      const g = groups.get(dateKey);
      const rv = rh[i];
      const pv = p[i];
      if (rv != null && isFinite(Number(rv))) g.rh.push(Number(rv));
      if (pv != null && isFinite(Number(pv))) g.p.push(Number(pv));
    }

    const out = [];
    for (let i = 0; i < dtime.length && i < days; i++) {
      const date = dtime[i]; // 'YYYY-MM-DD'
      const g = groups.get(date) || { rh: [], p: [] };
      const humidity_mean = g.rh.length
        ? g.rh.reduce((a, b) => a + b, 0) / g.rh.length
        : null;
      const pressure_mean = g.p.length
        ? g.p.reduce((a, b) => a + b, 0) / g.p.length
        : null;
      out.push({
        date,
        temp_max: tmax[i] ?? null,
        temp_min: tmin[i] ?? null,
        humidity_mean: humidity_mean != null ? Math.round(humidity_mean) : null,
        pressure_mean: pressure_mean != null ? Math.round(pressure_mean) : null,
      });
    }

    res.json({
      latitude: Number(lat),
      longitude: Number(lon),
      days,
      forecast: out,
      units: {
        temp: j?.daily_units?.temperature_2m_max || "°C",
        humidity: j?.hourly_units?.relative_humidity_2m || "%",
        pressure: j?.hourly_units?.pressure_msl || "hPa",
      },
    });
  } catch (e) {
    res
      .status(500)
      .json({ error: e.message || "Failed to fetch station forecast" });
  }
});

// Previous N calendar days AQI values (from viz_data y series), excluding today
app.get("/api/aqi/last-days", async (req, res) => {
  try {
    let days = Number(req.query.days || 3);
    if (!isFinite(days) || days <= 0) days = 3;
    days = Math.min(Math.max(Math.floor(days), 1), 14);
    const { series } = await readVizData();
    if (!Array.isArray(series) || series.length === 0) {
      return res.status(404).json({ error: "No viz_data series" });
    }
    // map dateKey -> last value for that date (local time). Exclude today.
    const todayKey = new Date().toISOString().slice(0, 10);
    const lastByDate = new Map();
    for (const pt of series) {
      const d = new Date(pt.t);
      const key = new Date(d.getFullYear(), d.getMonth(), d.getDate())
        .toISOString()
        .slice(0, 10);
      if (key === todayKey) continue; // exclude today
      // overwrite to keep last value of the day as we traverse ascending
      lastByDate.set(key, pt.y);
    }
    // Get most recent N dates
    const dates = Array.from(lastByDate.keys())
      .sort((a, b) => (a < b ? 1 : -1))
      .slice(0, days)
      .sort();
    function inferCat(v) {
      if (v <= 50) return "GOOD";
      if (v <= 100) return "MODERATE";
      if (v <= 150) return "UNHEALTHY FOR SENSITIVE GROUPS";
      if (v <= 200) return "UNHEALTHY";
      if (v <= 300) return "VERY UNHEALTHY";
      if (v <= 500) return "HAZARDOUS";
      return "EMERGENCY";
    }
    const items = dates.map((date) => {
      const val = lastByDate.get(date);
      return { date, value: val, category: inferCat(Number(val)) };
    });
    res.json({ days: items.length, items });
  } catch (e) {
    res
      .status(500)
      .json({ error: e.message || "Failed to compute AQI last days" });
  }
});

// Station metadata (name/address/coords) from environment with graceful nulls
app.get("/api/station/meta", async (req, res) => {
  try {
    const name = process.env.STATION_NAME || null;
    const address = process.env.STATION_ADDRESS || null;
    const lat = process.env.STATION_LAT
      ? Number(process.env.STATION_LAT)
      : null;
    const lon = process.env.STATION_LON
      ? Number(process.env.STATION_LON)
      : null;
    res.json({ name, address, latitude: lat, longitude: lon });
  } catch (e) {
    res.status(500).json({ error: e.message || "Failed to read station meta" });
  }
});

// Proxy OpenWeatherMap tile layers so the frontend doesn't expose the API key
// Usage: /api/tiles/owm/:layer/:z/:x/:y.png
// Allowed layers example: clouds_new, precipitation_new, rain_new, wind_new, temp_new, pressure_new
app.get("/api/tiles/owm/:layer/:z/:x/:y.png", async (req, res) => {
  try {
    if (!OWM_API_KEY) {
      return res
        .status(501)
        .json({ error: "OWM_API_KEY is not configured on the server" });
    }
    const { layer, z, x, y } = req.params;
    const allowed = new Set([
      "clouds_new",
      "precipitation_new",
      "rain_new",
      "wind_new",
      "temp_new",
      "pressure_new",
    ]);
    if (!allowed.has(layer)) {
      return res.status(400).json({ error: "Unsupported layer" });
    }
    const url = `https://tile.openweathermap.org/map/${encodeURIComponent(
      layer
    )}/${encodeURIComponent(z)}/${encodeURIComponent(x)}/${encodeURIComponent(
      y
    )}.png?appid=${encodeURIComponent(OWM_API_KEY)}`;
    const upstream = await fetch(url);
    if (!upstream.ok) {
      return res.status(upstream.status).end();
        console.log(`[owm-tiles] request ${layer}/${z}/${x}/${y}`);
    }
    const buf = Buffer.from(await upstream.arrayBuffer());
    res.setHeader("Content-Type", "image/png");
    // Cache for 5 minutes at clients and allow CDN/proxy caching
    res.setHeader("Cache-Control", "public, max-age=300, s-maxage=300");
          console.warn(`[owm-tiles] upstream ${upstream.status} ${layer}/${z}/${x}/${y}`);
    return res.status(200).send(buf);
  } catch (e) {
    return res.status(502).json({ error: "Tile proxy failed" });
  }
});

// Diagnostics endpoint to help troubleshoot workbook loading and sheet/key detection
app.get("/api/viz-data/diagnostics", async (req, res) => {
        console.error(`[owm-tiles] error: ${e && e.message}`);
  try {
    const wbPath = resolveWorkbookPath();
    const wb = await loadWorkbook(wbPath);
    const sheetNames = wb.SheetNames;
    const sheetName =
      sheetNames.find((n) => n.toLowerCase() === "viz_data") || sheetNames[0];
    const ws = wb.Sheets[sheetName];
    let rows = [];
    let head = null;
    if (ws) {
      rows = XLSX.utils.sheet_to_json(ws, { raw: true, defval: null });
      head = rows[0] || null;
    }
    const keysPicked =
      Array.isArray(rows) && rows.length
        ? pickKeysFromRows(rows)
        : { xKey: null, yKey: null };
    const headerValues = head
      ? Object.fromEntries(
          Object.keys(head).map((k) => [k, (head[k] || "").toString().trim()])
        )
      : {};
    const xLabel = keysPicked.xKey
      ? headerValues[keysPicked.xKey] || keysPicked.xKey
      : null;
    const yLabel = keysPicked.yKey
      ? headerValues[keysPicked.yKey] || keysPicked.yKey
      : null;
    res.json({
      path: wbPath,
      sheetNames,
      chosenSheet: sheetName,
      rowsCount: Array.isArray(rows) ? rows.length : 0,
      keysPicked,
      labels: { xLabel, yLabel },
      sample: Array.isArray(rows) ? rows.slice(0, 3) : [],
    });
  } catch (e) {
    res.status(500).json({ error: e.message || "Diagnostics failed" });
  }
});

// Reverse geocoding proxy with fallback to avoid browser CORS and centralize provider logic
app.get("/api/reverse-geocode", async (req, res) => {
  try {
    const { lat, lon } = req.query;
    if (!lat || !lon)
      return res.status(400).json({ error: "lat and lon are required" });

    // First try Open-Meteo reverse geocoding
    const omUrl = `https://geocoding-api.open-meteo.com/v1/reverse?latitude=${encodeURIComponent(
      lat
    )}&longitude=${encodeURIComponent(lon)}&language=en&format=json`;
    let name = null,
      region = null;
    try {
      const r = await fetch(omUrl);
      if (r.ok) {
        const j = await r.json();
        const rec = j?.results?.[0] || {};
        name =
          rec.name ||
          rec.city ||
          rec.locality ||
          rec.town ||
          rec.village ||
          null;
        region = rec.admin2 || rec.admin1 || rec.country || null;
      }
    } catch {}

    // Fallback to BigDataCloud if needed
    if (!name) {
      try {
        const bdcUrl = `https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=${encodeURIComponent(
          lat
        )}&longitude=${encodeURIComponent(lon)}&localityLanguage=en`;
        const r2 = await fetch(bdcUrl);
        if (r2.ok) {
          const b = await r2.json();
          name = b.locality || b.city || null;
          region = b.principalSubdivision || b.countryName || region || null;
        }
      } catch {}
    }

    if (!name && !region)
      return res.status(404).json({ error: "No location found" });
    const display = name
      ? region && region !== name
        ? `${name}, ${region}`
        : name
      : region || "";
    res.json({ name, region, display });
  } catch (e) {
    res.status(500).json({ error: e.message || "Reverse geocoding failed" });
  }
});

app.listen(PORT, () => {
  const external = process.env.RENDER_EXTERNAL_URL || process.env.VITE_API_BASE || '';
  if (external) {
    console.log(`Server ready on port ${PORT} (${external})`);
  } else {
    console.log(`Server ready on port ${PORT}`);
  }
  // Pre-warm workbook cache asynchronously to reduce first-request latency
  try {
    const wbPath = resolveWorkbookPath();
    setTimeout(() => {
      loadWorkbook(wbPath).catch(() => {});
    }, 10);
    // Periodically refresh caches in background so requests serve hot data
    let warming = false;
    const intervalMs = Math.max(60000, Number(CACHE_TTL_MS) || 60000);
    setInterval(async () => {
      if (warming) return;
      warming = true;
      try {
        await loadWorkbook(wbPath);
        // Prime computed series caches
        await Promise.allSettled([
          readVizData(),
          readSheetSeries('PM10'),
        ]);
      } catch {}
      warming = false;
    }, intervalMs);
  } catch {}
});
