/**
 * Excel workbook loading (local file, SharePoint + Graph),
 * and series extraction (readVizData, readSheetSeries).
 */
const path = require("path");
const fs = require("fs");
const XLSX = require("../xlsxCompat");
const {
  DEFAULT_RELATIVE,
  CACHE_TTL_MS,
  DISK_CACHE_ENABLED,
  CACHE_DIR,
  GRAPH_TENANT_ID,
  GRAPH_CLIENT_ID,
  GRAPH_CLIENT_SECRET,
} = require("../config/env");
const { coerceDate } = require("../utils/dateUtils");
const { fetchWithRetry, fetchBufferWithRetry } = require("../utils/fetchUtils");

// Ensure disk cache directory exists
if (DISK_CACHE_ENABLED) {
  try {
    fs.mkdirSync(CACHE_DIR, { recursive: true });
  } catch {}
}

const _wbCache = new Map();
const _vizCache = new Map();

// ── Key detection helpers ──

function pickKeysFromRows(rows) {
  if (!rows || rows.length === 0) return { xKey: null, yKey: null };
  const keys = Object.keys(rows[0] || {});

  const headerRow = rows[0] || {};
  const headerValues = Object.fromEntries(
    keys.map((k) => [k, (headerRow[k] || "").toString().trim()]),
  );
  const labels = Object.values(headerValues).filter((v) => v.length > 0);
  const headerLooksLikeLabels =
    labels.length >= 3 && labels.every((v) => /[A-Za-z]/.test(v));

  if (headerLooksLikeLabels) {
    const xKeyFromHeader = keys.find((k) =>
      /date|time/i.test(headerValues[k] || ""),
    );
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
    { date: {}, num: {} },
  );
  const bestDate = Object.entries(keyScores.date).sort(
    (a, b) => b[1] - a[1],
  )[0]?.[0];
  const bestNum = Object.entries(keyScores.num)
    .filter(([k]) => k !== bestDate)
    .sort((a, b) => b[1] - a[1])[0]?.[0];
  return { xKey: bestDate || null, yKey: bestNum || null };
}

// ── Graph / SharePoint helpers ──

async function graphClientCredentialsToken() {
  const tenant = GRAPH_TENANT_ID;
  const clientId = GRAPH_CLIENT_ID;
  const clientSecret = GRAPH_CLIENT_SECRET;
  const authority = `https://login.microsoftonline.com/${tenant}/oauth2/v2.0/token`;
  const body = new URLSearchParams();
  body.set("grant_type", "client_credentials");
  body.set("client_id", clientId);
  body.set("client_secret", clientSecret);
  body.set("scope", "https://graph.microsoft.com/.default");
  const resp = await fetchWithRetry(authority, {
    timeoutMs: 12000,
    retries: 2,
    init: {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
    },
  });
  if (!resp.ok || !resp.data?.access_token) {
    const detail = resp.data?.error_description || resp.data?.error || "";
    throw new Error(
      `Failed to acquire Graph token (${resp.status || "n/a"})${detail ? ": " + detail : ""}. Check GRAPH_TENANT_ID, GRAPH_CLIENT_ID and GRAPH_CLIENT_SECRET in .env — the client secret may have expired.`,
    );
  }
  return resp.data.access_token;
}

function splitSharePointUrl(spUrl) {
  const url = new URL(spUrl);
  const host = url.hostname;
  let parts = url.pathname.split("/").filter(Boolean);
  // Strip sharing-link prefix (e.g. ":x:", "g") before "personal"
  const personalIdx = parts.indexOf("personal");
  if (personalIdx === -1) return null;
  parts = parts.slice(personalIdx);
  const sitePath = "/" + parts.slice(0, 2).join("/");
  const filePath = parts.length > 2 ? "/" + parts.slice(2).join("/") : null;
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
  if (!envFilePath) {
    throw new Error("Cannot determine file path from sharing URL. Set SHAREPOINT_FILE_PATH in .env");
  }

  const siteResp = await fetchWithRetry(
    `https://graph.microsoft.com/v1.0/sites/${encodeURIComponent(envHost)}:${encodeURI(envSitePath)}`,
    {
      retries: 2,
      timeoutMs: 15000,
      init: { headers: { Authorization: `Bearer ${token}` } },
    },
  );
  if (!siteResp.ok) {
    throw new Error(`Failed to resolve SharePoint site (${siteResp.status})`);
  }
  const siteId = siteResp.data.id;
  if (!siteId) throw new Error("SharePoint site id not found");

  const buf = await fetchBufferWithRetry(
    `https://graph.microsoft.com/v1.0/sites/${encodeURIComponent(siteId)}/drive/root:${encodeURI(envFilePath)}:/content`,
    {
      retries: 2,
      timeoutMs: 30000,
      headers: { Authorization: `Bearer ${token}` },
    },
  );
  return buf;
}

function encodeShareUrlForGraph(url) {
  const b64 = Buffer.from(url, "utf8")
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
  return "u!" + b64;
}

async function downloadFromShareLinkViaGraph(shareUrl) {
  const token = await graphClientCredentialsToken();
  const encoded = encodeShareUrlForGraph(shareUrl);
  const buf = await fetchBufferWithRetry(
    `https://graph.microsoft.com/v1.0/shares/${encoded}/driveItem/content`,
    {
      retries: 2,
      timeoutMs: 30000,
      headers: { Authorization: `Bearer ${token}` },
    },
  );
  return buf;
}

// ── Workbook loading ──

function resolveWorkbookPath() {
  const p = process.env.EXCEL_FILE_PATH || DEFAULT_RELATIVE;
  return p;
}

async function loadWorkbook(p) {
  if (/^https?:\/\//i.test(p)) {
    const url = new URL(p);
    const isSP = /\.sharepoint\.com$/i.test(url.hostname);
    const hasGraph = !!(GRAPH_TENANT_ID && GRAPH_CLIENT_ID && GRAPH_CLIENT_SECRET);

    const cached = _wbCache.get(p);
    const diskKey =
      Buffer.from(p, "utf8").toString("base64").replace(/\W/g, "_") + ".xlsm";
    const diskPath = path.join(CACHE_DIR, diskKey);
    if (cached && Date.now() - cached.ts < CACHE_TTL_MS) {
      return await XLSX.read(cached.buf, {
        type: "buffer",
        cellDates: true,
        cellNF: false,
        cellText: false,
      });
    }
    if (DISK_CACHE_ENABLED) {
      try {
        const st = fs.statSync(diskPath);
        if (st && Date.now() - st.mtimeMs < CACHE_TTL_MS) {
          const buf = fs.readFileSync(diskPath);
          _wbCache.set(p, { ts: Date.now(), buf });
          return await XLSX.read(buf, {
            type: "buffer",
            cellDates: true,
            cellNF: false,
            cellText: false,
          });
        }
      } catch {}
    }

    // 1) Anonymous fetch
    try {
      const buf = await fetchBufferWithRetry(p, {
        retries: 1,
        timeoutMs: 25000,
      });
      _wbCache.set(p, { ts: Date.now(), buf });
      if (DISK_CACHE_ENABLED) {
        try { fs.writeFileSync(diskPath, buf); } catch {}
      }
      try {
        return await XLSX.read(buf, {
          type: "buffer",
          cellDates: true,
          cellNF: false,
          cellText: false,
        });
      } catch (e) { /* continue to fallback */ }
    } catch (_) {}

    // 2) SharePoint canonical download.aspx
    if (isSP && /\/:.?:\/g\//i.test(url.pathname)) {
      const parts = url.pathname.split("/").filter(Boolean);
      const shareId = parts[parts.length - 1];
      const personalIdx = parts.indexOf("personal");
      if (shareId && personalIdx !== -1 && parts.length > personalIdx + 1) {
        const userSegment = parts[personalIdx + 1];
        const dlUrl1 = `https://${url.hostname}/personal/${userSegment}/_layouts/15/download.aspx?share=${encodeURIComponent(shareId)}`;
        const dlUrl2 = `https://${url.hostname}/_layouts/15/download.aspx?share=${encodeURIComponent(shareId)}`;
        try {
          const buf2 = await fetchBufferWithRetry(dlUrl1, {
            retries: 1,
            timeoutMs: 25000,
          }).catch(async () => {
            return await fetchBufferWithRetry(dlUrl2, {
              retries: 1,
              timeoutMs: 25000,
            });
          });
          if (DISK_CACHE_ENABLED) {
            try { fs.writeFileSync(diskPath, buf2); } catch {}
          }
          return await XLSX.read(buf2, {
            type: "buffer",
            cellDates: true,
            cellNF: false,
            cellText: false,
          });
        } catch (_) {}
      }
    }

    // 3) Graph for SharePoint — try both share-link and site/drive approaches
    if (isSP && hasGraph) {
      let buf;
      const isShareLink = /\/:[a-z]:\/g\//i.test(url.pathname);

      // Try primary method first, then fallback to the other
      const methods = isShareLink
        ? [
            { name: "share-link", fn: () => downloadFromShareLinkViaGraph(url.href) },
            { name: "site-drive", fn: () => downloadFromSharePointViaGraph(url.href) },
          ]
        : [
            { name: "site-drive", fn: () => downloadFromSharePointViaGraph(url.href) },
            { name: "share-link", fn: () => downloadFromShareLinkViaGraph(url.href) },
          ];

      let lastGraphErr;
      for (const m of methods) {
        try {
          buf = await m.fn();
          break;
        } catch (e) {
          console.warn(`[ingest] Graph ${m.name} failed: ${e.message}`);
          lastGraphErr = e;
          buf = null;
        }
      }

      if (buf) {
        _wbCache.set(p, { ts: Date.now(), buf });
        if (DISK_CACHE_ENABLED) {
          try { fs.writeFileSync(diskPath, buf); } catch {}
        }
        return await XLSX.read(buf, {
          type: "buffer",
          cellDates: true,
          cellNF: false,
          cellText: false,
        });
      }

      // Both methods failed — provide actionable guidance
      const is401 = /401/.test(lastGraphErr?.message || "");
      const hint = is401
        ? "The Graph API returned 401. This usually means: (1) GRAPH_CLIENT_SECRET has expired — generate a new secret in Azure AD > App registrations > Certificates & secrets, or (2) Admin consent for Files.Read.All / Sites.Read.All was revoked — re-grant it in API permissions."
        : `Graph error: ${lastGraphErr?.message || "unknown"}`;
      throw new Error(`SharePoint Graph download failed. ${hint}`);
    }

    const reason = isSP
      ? "If this is a SharePoint/OneDrive link that is not public, either provide an 'anyone with the link' direct download URL or configure Microsoft Graph credentials and admin consent."
      : "Verify the URL is reachable and returns the file bytes.";
    throw new Error(`Failed to download Excel from URL. ${reason}`);
  }

  if (!fs.existsSync(p)) {
    throw new Error(
      `Excel file not found at ${p}. Set EXCEL_FILE_PATH or place file at ${DEFAULT_RELATIVE}`,
    );
  }
  return await XLSX.readFile(p, {
    cellDates: true,
    cellNF: false,
    cellText: false,
  });
}

// ── Series extraction ──

async function readVizData(yKeyOverride) {
  const wbPath = resolveWorkbookPath();
  const cacheKey = `${wbPath}|viz|${yKeyOverride || ""}`;
  const cached = _vizCache.get(cacheKey);
  if (cached && Date.now() - cached.ts < CACHE_TTL_MS) {
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
      meta: { sheet: sheetName, xKey: null, yKey: null, yLabel: null, points: 0 },
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
        k !== xKey && !isNaN(Number(String(sample[k]).replace(/[, ]/g, ""))),
    );
  }

  const headerRow = rows[0] || {};
  const headerValues = Object.fromEntries(
    Object.keys(headerRow).map((k) => [k, (headerRow[k] || "").toString().trim()]),
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
    .sort((a, b) => a.t - b.t);

  const result = {
    series,
    meta: { sheet: sheetName, xKey, yKey, yLabel, points: series.length, path: wbPath },
  };
  _vizCache.set(cacheKey, { ts: Date.now(), result });
  return result;
}

async function readSheetSeries(sheetName, yKeyOverride) {
  const wbPath = resolveWorkbookPath();
  const wb = await loadWorkbook(wbPath);
  const sheet =
    wb.SheetNames.find(
      (n) => n.toLowerCase() === String(sheetName).toLowerCase(),
    ) || null;
  if (!sheet) throw new Error(`Sheet '${sheetName}' not found in workbook.`);
  const ws = wb.Sheets[sheet];
  const rows = XLSX.utils.sheet_to_json(ws, { raw: true, defval: null });
  if (!Array.isArray(rows))
    return {
      series: [],
      meta: { sheet, xKey: null, yKey: null, yLabel: null, points: 0, path: wbPath },
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
        k !== xKey && !isNaN(Number(String(sample[k]).replace(/[, ]/g, ""))),
    );
  }

  const headerRow = rows[0] || {};
  const headerValues = Object.fromEntries(
    Object.keys(headerRow).map((k) => [k, (headerRow[k] || "").toString().trim()]),
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
    .sort((a, b) => a.t - b.t);

  return {
    series,
    meta: { sheet, xKey, yKey, yLabel, points: series.length, path: wbPath },
  };
}

module.exports = {
  resolveWorkbookPath,
  loadWorkbook,
  pickKeysFromRows,
  readVizData,
  readSheetSeries,
};
