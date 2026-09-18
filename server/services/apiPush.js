/**
 * Hourly push (webhook) delivery for the external partner API.
 *
 * Every hour (EXTERNAL_API_PUSH_CRON, default 15 minutes past the hour so the
 * new hourly reading has been ingested), the latest reading for every
 * station/pollutant is POSTed to each active client that has a webhook
 * configured.
 *
 * Formats:
 *   json    — signed envelope { event, deliveryId, sentAt, data: <same as GET /api/v1/latest> }
 *             Headers: X-AQM-Event, X-AQM-Delivery, X-AQM-Timestamp,
 *                      X-AQM-Signature: sha256=<HMAC-SHA256(secret, timestamp + "." + body)>
 *   powerbi — bare JSON array of flat rows, as expected by a Power BI
 *             streaming-dataset push URL (no signature; the URL carries its key)
 *
 * Each delivery is retried (3 attempts, backoff) and logged to api_push_logs.
 */
const crypto = require("crypto");
const cron = require("node-cron");
const { MONGO_URI, INGEST_TZ } = require("../config/env");
const { ensureMongo } = require("./mongo");
const { buildLatestPayload, toPowerBiRows } = require("./externalData");
const { listWebhookClients, getClientById, recordWebhookResult, PUSH_LOG_COLLECTION } = require("./apiKeys");

const PUSH_CRON = process.env.EXTERNAL_API_PUSH_CRON || "15 * * * *";
const PUSH_TIMEOUT_MS = Number(process.env.EXTERNAL_API_PUSH_TIMEOUT_MS || 15_000);
const PUSH_ATTEMPTS = 3;
const PUSH_BACKOFF_MS = [5_000, 30_000];
const USER_AGENT = "EMBR3-AQM-Push/1.0 (+https://embr3-onlinesystems.cloud)";

let _scheduled = false;
let _running = false;

function sign(secret, timestamp, body) {
  return "sha256=" + crypto.createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("hex");
}

function buildRequest(client, payload, deliveryId) {
  const format = client.webhook.format || "json";
  const timestamp = Math.floor(Date.now() / 1000);
  let body;
  const headers = {
    "Content-Type": "application/json",
    "User-Agent": USER_AGENT,
    "X-AQM-Event": "readings.hourly",
    "X-AQM-Delivery": deliveryId,
    "X-AQM-Timestamp": String(timestamp),
  };
  if (format === "powerbi") {
    body = JSON.stringify(toPowerBiRows(payload));
  } else {
    body = JSON.stringify({
      event: "readings.hourly",
      deliveryId,
      sentAt: new Date().toISOString(),
      data: payload,
    });
    if (client.webhook.secret) headers["X-AQM-Signature"] = sign(client.webhook.secret, timestamp, body);
  }
  return { body, headers, format };
}

async function postOnce(url, { body, headers }) {
  const ac = new AbortController();
  const tid = setTimeout(() => ac.abort(), PUSH_TIMEOUT_MS);
  try {
    const res = await fetch(url, { method: "POST", headers, body, signal: ac.signal });
    const text = await res.text().catch(() => "");
    return { ok: res.ok, status: res.status, responseSnippet: text.slice(0, 300) };
  } catch (e) {
    return { ok: false, status: 0, error: e.name === "AbortError" ? `timeout after ${PUSH_TIMEOUT_MS}ms` : e.message };
  } finally {
    clearTimeout(tid);
  }
}

async function logDelivery(entry) {
  try {
    const db = await ensureMongo();
    await db.collection(PUSH_LOG_COLLECTION).insertOne({ ...entry, at: new Date() });
  } catch (e) {
    console.warn(`[api-push] failed to log delivery: ${e.message}`);
  }
}

/**
 * Deliver the payload to one client with retries. Returns the final result.
 * @param {object} client  raw client doc (with webhook.secret)
 * @param {object} payload output of buildLatestPayload()
 * @param {string} reason  "cron" | "manual" | "test"
 */
async function deliverToClient(client, payload, reason = "cron") {
  const deliveryId = crypto.randomUUID();
  const started = Date.now();
  const req = buildRequest(client, payload, deliveryId);
  let result;
  for (let attempt = 1; attempt <= PUSH_ATTEMPTS; attempt++) {
    result = await postOnce(client.webhook.url, req);
    // Retry only on network errors / 5xx / 429; 4xx means the receiver rejected it
    const retryable = !result.ok && (result.status === 0 || result.status >= 500 || result.status === 429);
    if (result.ok || !retryable || attempt === PUSH_ATTEMPTS) {
      result.attempts = attempt;
      break;
    }
    await new Promise((r) => setTimeout(r, PUSH_BACKOFF_MS[attempt - 1] || 30_000));
  }
  const summary = {
    clientId: client._id,
    clientName: client.name,
    deliveryId,
    reason,
    format: req.format,
    url: client.webhook.url,
    ok: result.ok,
    status: result.status,
    attempts: result.attempts,
    error: result.error || (!result.ok ? `HTTP ${result.status} ${result.responseSnippet || ""}`.trim() : null),
    readings: payload.count,
    durationMs: Date.now() - started,
  };
  await Promise.all([
    logDelivery(summary),
    recordWebhookResult(client._id, { ok: result.ok, status: result.status, error: summary.error }).catch(() => {}),
  ]);
  if (result.ok) {
    console.log(`[api-push] ${client.name} ← ${payload.count} readings (${req.format}, HTTP ${result.status}, ${summary.attempts} attempt${summary.attempts > 1 ? "s" : ""})`);
  } else {
    console.warn(`[api-push] ${client.name} FAILED after ${summary.attempts} attempt(s): ${summary.error}`);
  }
  return summary;
}

/** Push to every client with an enabled webhook. */
async function runPushCycle(reason = "cron") {
  if (!MONGO_URI) return [];
  if (_running) {
    console.log(`[api-push] overlapping run skipped (${reason})`);
    return [];
  }
  _running = true;
  try {
    const clients = await listWebhookClients();
    if (!clients.length) return [];
    const payload = await buildLatestPayload();
    const results = [];
    for (const client of clients) {
      results.push(await deliverToClient(client, payload, reason));
    }
    const failed = results.filter((r) => !r.ok).length;
    console.log(`[api-push] ${reason}: ${results.length - failed}/${results.length} delivered`);
    return results;
  } catch (e) {
    console.error(`[api-push] ${reason} failed: ${e.message}`);
    return [];
  } finally {
    _running = false;
  }
}

/** Push to a single client now (admin test / CLI). */
async function pushToClientNow(clientId, reason = "manual") {
  const client = await getClientById(clientId);
  if (!client) throw new Error("client not found");
  if (client.active === false) throw new Error("client is revoked");
  if (!client.webhook?.url) throw new Error("client has no webhook configured");
  const payload = await buildLatestPayload();
  return deliverToClient(client, payload, reason);
}

async function listDeliveries(clientId, limit = 50) {
  const { ObjectId } = require("mongodb");
  if (!ObjectId.isValid(clientId)) return [];
  const db = await ensureMongo();
  return db
    .collection(PUSH_LOG_COLLECTION)
    .find({ clientId: new ObjectId(clientId) })
    .sort({ at: -1 })
    .limit(Math.min(500, Math.max(1, Number(limit) || 50)))
    .toArray();
}

function schedulePush() {
  if (_scheduled || !MONGO_URI) return;
  try {
    cron.schedule(PUSH_CRON, () => runPushCycle("cron"), { timezone: INGEST_TZ });
    _scheduled = true;
    console.log(`[api-push] hourly webhook push scheduled (${PUSH_CRON}${INGEST_TZ ? ` ${INGEST_TZ}` : ""})`);
  } catch (e) {
    console.error(`[api-push] failed to schedule: ${e.message}`);
  }
}

module.exports = {
  PUSH_CRON,
  sign,
  runPushCycle,
  pushToClientNow,
  deliverToClient,
  listDeliveries,
  schedulePush,
};
