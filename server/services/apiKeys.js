/**
 * API key management + authentication middleware for the external
 * (partner-facing) API under /api/v1.
 *
 * Security model:
 *   - Keys are random 256-bit tokens (`aqm_live_<64 hex>`), shown to the
 *     issuer exactly once. Only a SHA-256 hash is stored (collection
 *     `api_clients`), so a database leak does not leak usable keys.
 *   - Clients authenticate with `Authorization: Bearer <key>` (or
 *     `X-API-Key: <key>`). Lookup is by hash; revoked/expired keys are refused.
 *   - HTTPS is enforced in production (via X-Forwarded-Proto behind Nginx).
 *   - Each key has its own per-minute rate limit, independent of the global
 *     per-IP limiter in server.js.
 *   - Every request is written to `api_access_logs` (30-day TTL) for auditing.
 */
const crypto = require("crypto");
const { ensureMongo } = require("./mongo");

const CLIENTS_COLLECTION = "api_clients";
const ACCESS_LOG_COLLECTION = "api_access_logs";
const PUSH_LOG_COLLECTION = "api_push_logs";
const KEY_PREFIX = "aqm_live_";
const KEY_BYTES = 32;
const DEFAULT_RATE_LIMIT_PER_MIN = Number(process.env.EXTERNAL_API_DEFAULT_RATE_LIMIT || 60);
const ACCESS_LOG_TTL_DAYS = Number(process.env.EXTERNAL_API_LOG_TTL_DAYS || 30);
const REQUIRE_HTTPS =
  process.env.EXTERNAL_API_REQUIRE_HTTPS != null
    ? process.env.EXTERNAL_API_REQUIRE_HTTPS === "1" || process.env.EXTERNAL_API_REQUIRE_HTTPS === "true"
    : process.env.NODE_ENV === "production";

// read:recent — the rolling recent-readings window only; historical data is
// deliberately not exposed to partners.
const SCOPES = ["read:stations", "read:latest", "read:recent"];
const WEBHOOK_FORMATS = ["json", "powerbi"];

/* ── Key helpers ───────────────────────────────────────────────── */

function generateKey() {
  return KEY_PREFIX + crypto.randomBytes(KEY_BYTES).toString("hex");
}

function hashKey(key) {
  return crypto.createHash("sha256").update(String(key)).digest("hex");
}

function looksLikeKey(key) {
  return typeof key === "string" && key.startsWith(KEY_PREFIX) && key.length === KEY_PREFIX.length + KEY_BYTES * 2;
}

/** Public-safe view of a client document (never includes the hash). */
function toPublicClient(doc) {
  if (!doc) return null;
  return {
    id: String(doc._id),
    name: doc.name,
    organization: doc.organization || null,
    contactEmail: doc.contactEmail || null,
    keyPrefix: doc.keyPrefix,
    scopes: doc.scopes || [],
    rateLimitPerMin: doc.rateLimitPerMin || DEFAULT_RATE_LIMIT_PER_MIN,
    active: doc.active !== false,
    createdAt: doc.createdAt || null,
    createdBy: doc.createdBy || null,
    expiresAt: doc.expiresAt || null,
    revokedAt: doc.revokedAt || null,
    lastUsedAt: doc.lastUsedAt || null,
    requestCount: doc.requestCount || 0,
    webhook: doc.webhook
      ? {
          enabled: doc.webhook.enabled !== false,
          url: doc.webhook.url,
          format: doc.webhook.format || "json",
          hasSecret: !!doc.webhook.secret,
          lastDeliveryAt: doc.webhook.lastDeliveryAt || null,
          lastStatus: doc.webhook.lastStatus ?? null,
          lastError: doc.webhook.lastError || null,
          consecutiveFailures: doc.webhook.consecutiveFailures || 0,
        }
      : null,
  };
}

/** Validate and normalise a webhook config. Throws on bad input. */
function normalizeWebhook({ url, secret = null, format = "json", enabled = true } = {}) {
  const cleanUrl = String(url || "").trim();
  let parsed;
  try {
    parsed = new URL(cleanUrl);
  } catch {
    throw new Error("webhook url must be a valid absolute URL");
  }
  if (parsed.protocol !== "https:" && process.env.NODE_ENV === "production") {
    throw new Error("webhook url must use https://");
  }
  if (!["https:", "http:"].includes(parsed.protocol)) throw new Error("webhook url must be http(s)");
  const cleanFormat = String(format || "json").toLowerCase();
  if (!WEBHOOK_FORMATS.includes(cleanFormat)) {
    throw new Error(`webhook format must be one of: ${WEBHOOK_FORMATS.join(", ")}`);
  }
  return {
    url: cleanUrl,
    secret: secret ? String(secret) : null,
    format: cleanFormat,
    enabled: enabled !== false,
    updatedAt: new Date(),
  };
}

async function getClientsCollection() {
  const db = await ensureMongo();
  return db.collection(CLIENTS_COLLECTION);
}

async function ensureApiKeyIndexes(db) {
  try {
    await Promise.all([
      db.collection(CLIENTS_COLLECTION).createIndex({ keyHash: 1 }, { unique: true }),
      db.collection(ACCESS_LOG_COLLECTION).createIndex({ clientId: 1, at: -1 }),
      db.collection(ACCESS_LOG_COLLECTION).createIndex(
        { at: 1 },
        { expireAfterSeconds: ACCESS_LOG_TTL_DAYS * 24 * 60 * 60 },
      ),
      db.collection(PUSH_LOG_COLLECTION).createIndex({ clientId: 1, at: -1 }),
      db.collection(PUSH_LOG_COLLECTION).createIndex(
        { at: 1 },
        { expireAfterSeconds: ACCESS_LOG_TTL_DAYS * 24 * 60 * 60 },
      ),
    ]);
  } catch (e) {
    console.warn(`[api-keys] index creation warning: ${e && e.message}`);
  }
}

/* ── Management ────────────────────────────────────────────────── */

/**
 * Issue a new API key. Returns { key, client } — `key` is the plaintext
 * secret and is NOT stored anywhere; hand it to the partner once.
 */
async function createApiKey({
  name,
  organization = null,
  contactEmail = null,
  scopes = SCOPES,
  rateLimitPerMin = DEFAULT_RATE_LIMIT_PER_MIN,
  expiresAt = null,
  createdBy = null,
  webhook = null,
} = {}) {
  const cleanName = String(name || "").trim();
  if (!cleanName) throw new Error("name is required");
  const cleanScopes = (Array.isArray(scopes) ? scopes : SCOPES).filter((s) => SCOPES.includes(s));
  if (!cleanScopes.length) throw new Error("at least one valid scope is required");
  const limit = Number(rateLimitPerMin);
  if (!Number.isFinite(limit) || limit < 1 || limit > 10_000) {
    throw new Error("rateLimitPerMin must be between 1 and 10000");
  }
  let expiry = null;
  if (expiresAt) {
    expiry = new Date(expiresAt);
    if (isNaN(expiry.getTime()) || expiry <= new Date()) throw new Error("expiresAt must be a future date");
  }

  const key = generateKey();
  const doc = {
    name: cleanName,
    organization: organization ? String(organization).trim() : null,
    contactEmail: contactEmail ? String(contactEmail).trim() : null,
    keyHash: hashKey(key),
    keyPrefix: key.slice(0, KEY_PREFIX.length + 8), // "aqm_live_1a2b3c4d" — for identification only
    scopes: cleanScopes,
    rateLimitPerMin: limit,
    active: true,
    createdAt: new Date(),
    createdBy,
    expiresAt: expiry,
    revokedAt: null,
    lastUsedAt: null,
    requestCount: 0,
    webhook: webhook && webhook.url ? normalizeWebhook(webhook) : null,
  };
  const col = await getClientsCollection();
  const { insertedId } = await col.insertOne(doc);
  return { key, client: toPublicClient({ ...doc, _id: insertedId }) };
}

/** Set, update or remove (config = null) a client's push webhook. */
async function setWebhook(id, config) {
  const { ObjectId } = require("mongodb");
  if (!ObjectId.isValid(id)) return null;
  const col = await getClientsCollection();
  const update = config
    ? { $set: { webhook: normalizeWebhook(config) } }
    : { $unset: { webhook: "" } };
  const result = await col.findOneAndUpdate(
    { _id: new ObjectId(id) },
    update,
    { returnDocument: "after", projection: { keyHash: 0 } },
  );
  return toPublicClient(result);
}

/** Active, unexpired clients with an enabled webhook (raw docs — includes secret). */
async function listWebhookClients() {
  const col = await getClientsCollection();
  const now = new Date();
  return col
    .find({
      active: { $ne: false },
      "webhook.url": { $exists: true, $ne: "" },
      "webhook.enabled": { $ne: false },
      $or: [{ expiresAt: null }, { expiresAt: { $gt: now } }],
    })
    .project({ keyHash: 0 })
    .toArray();
}

async function getClientById(id) {
  const { ObjectId } = require("mongodb");
  if (!ObjectId.isValid(id)) return null;
  const col = await getClientsCollection();
  return col.findOne({ _id: new ObjectId(id) }, { projection: { keyHash: 0 } });
}

async function recordWebhookResult(id, { ok, status, error }) {
  const col = await getClientsCollection();
  await col.updateOne(
    { _id: id },
    ok
      ? { $set: { "webhook.lastDeliveryAt": new Date(), "webhook.lastStatus": status, "webhook.lastError": null, "webhook.consecutiveFailures": 0 } }
      : { $set: { "webhook.lastDeliveryAt": new Date(), "webhook.lastStatus": status ?? null, "webhook.lastError": error || null }, $inc: { "webhook.consecutiveFailures": 1 } },
  );
}

async function listApiClients() {
  const col = await getClientsCollection();
  const docs = await col.find({}, { projection: { keyHash: 0 } }).sort({ createdAt: -1 }).toArray();
  return docs.map(toPublicClient);
}

async function revokeApiKey(id) {
  const { ObjectId } = require("mongodb");
  if (!ObjectId.isValid(id)) return null;
  const col = await getClientsCollection();
  const result = await col.findOneAndUpdate(
    { _id: new ObjectId(id), active: true },
    { $set: { active: false, revokedAt: new Date() } },
    { returnDocument: "after", projection: { keyHash: 0 } },
  );
  return toPublicClient(result);
}

/** Resolve a plaintext key to its client record, or null if unknown. */
async function findClientByKey(key) {
  if (!looksLikeKey(key)) return null;
  const col = await getClientsCollection();
  return col.findOne({ keyHash: hashKey(key) });
}

/* ── Per-key rate limiting (in-memory, fixed 60s window) ───────── */

const _buckets = new Map(); // clientId -> { start, count }
const RATE_WINDOW_MS = 60_000;

function consumeRateLimit(clientId, limit) {
  const now = Date.now();
  let b = _buckets.get(clientId);
  if (!b || now - b.start >= RATE_WINDOW_MS) {
    b = { start: now, count: 0 };
    _buckets.set(clientId, b);
  }
  b.count += 1;
  return {
    allowed: b.count <= limit,
    limit,
    remaining: Math.max(0, limit - b.count),
    resetAt: b.start + RATE_WINDOW_MS,
  };
}

setInterval(() => {
  const cutoff = Date.now() - RATE_WINDOW_MS;
  for (const [id, b] of _buckets) if (b.start < cutoff) _buckets.delete(id);
}, 5 * 60_000).unref();

/* ── Access logging ────────────────────────────────────────────── */

function clientIp(req) {
  return req.ip || req.socket?.remoteAddress || "unknown";
}

function logAccess(req, res, client, startedAt) {
  ensureMongo()
    .then((db) =>
      Promise.all([
        db.collection(ACCESS_LOG_COLLECTION).insertOne({
          clientId: client?._id || null,
          clientName: client?.name || null,
          method: req.method,
          path: req.originalUrl,
          status: res.statusCode,
          ip: clientIp(req),
          userAgent: req.headers["user-agent"] || null,
          durationMs: Date.now() - startedAt,
          at: new Date(),
        }),
        client
          ? db
              .collection(CLIENTS_COLLECTION)
              .updateOne({ _id: client._id }, { $set: { lastUsedAt: new Date() }, $inc: { requestCount: 1 } })
          : null,
      ]),
    )
    .catch(() => {});
}

/* ── Middleware ────────────────────────────────────────────────── */

function isSecureRequest(req) {
  if (req.secure) return true;
  const proto = String(req.headers["x-forwarded-proto"] || "").split(",")[0].trim().toLowerCase();
  return proto === "https";
}

function extractKey(req) {
  const auth = req.headers.authorization;
  if (typeof auth === "string" && /^bearer\s+/i.test(auth)) return auth.replace(/^bearer\s+/i, "").trim();
  const header = req.headers["x-api-key"];
  if (typeof header === "string" && header.trim()) return header.trim();
  return null;
}

function unauthorized(res, code, message) {
  res.setHeader("WWW-Authenticate", 'Bearer realm="aqm-external-api"');
  return res.status(401).json({ error: code, message });
}

/**
 * Express middleware: authenticate an external API key.
 * On success sets req.apiClient (public view) and rate-limit headers.
 *
 * @param {string[]} [requiredScopes] scopes the route needs (all must be present)
 */
function requireApiKey(requiredScopes = []) {
  return async (req, res, next) => {
    const startedAt = Date.now();
    res.setHeader("Cache-Control", "no-store");

    if (REQUIRE_HTTPS && !isSecureRequest(req)) {
      res.status(403).json({ error: "https_required", message: "This API must be accessed over HTTPS." });
      return logAccess(req, res, null, startedAt);
    }

    const key = extractKey(req);
    if (!key) {
      unauthorized(res, "missing_api_key", "Provide your API key as 'Authorization: Bearer <key>'.");
      return logAccess(req, res, null, startedAt);
    }

    let client;
    try {
      client = await findClientByKey(key);
    } catch (e) {
      console.error(`[api-keys] lookup failed: ${e.message}`);
      return res.status(503).json({ error: "auth_unavailable", message: "Authentication service unavailable." });
    }
    if (!client) {
      unauthorized(res, "invalid_api_key", "The API key is not recognized.");
      return logAccess(req, res, null, startedAt);
    }
    if (client.active === false) {
      res.status(403).json({ error: "api_key_revoked", message: "This API key has been revoked." });
      return logAccess(req, res, client, startedAt);
    }
    if (client.expiresAt && new Date(client.expiresAt) <= new Date()) {
      res.status(403).json({ error: "api_key_expired", message: "This API key has expired." });
      return logAccess(req, res, client, startedAt);
    }
    const missing = requiredScopes.filter((s) => !(client.scopes || []).includes(s));
    if (missing.length) {
      res.status(403).json({ error: "insufficient_scope", message: `Key lacks scope(s): ${missing.join(", ")}` });
      return logAccess(req, res, client, startedAt);
    }

    const rl = consumeRateLimit(String(client._id), client.rateLimitPerMin || DEFAULT_RATE_LIMIT_PER_MIN);
    res.setHeader("X-RateLimit-Limit", rl.limit);
    res.setHeader("X-RateLimit-Remaining", rl.remaining);
    res.setHeader("X-RateLimit-Reset", Math.ceil(rl.resetAt / 1000));
    if (!rl.allowed) {
      res.setHeader("Retry-After", Math.max(1, Math.ceil((rl.resetAt - Date.now()) / 1000)));
      res.status(429).json({ error: "rate_limited", message: "Rate limit exceeded. Retry after the window resets." });
      return logAccess(req, res, client, startedAt);
    }

    req.apiClient = toPublicClient(client);
    res.on("finish", () => logAccess(req, res, client, startedAt));
    next();
  };
}

module.exports = {
  SCOPES,
  WEBHOOK_FORMATS,
  PUSH_LOG_COLLECTION,
  KEY_PREFIX,
  REQUIRE_HTTPS,
  createApiKey,
  listApiClients,
  revokeApiKey,
  findClientByKey,
  getClientById,
  setWebhook,
  listWebhookClients,
  recordWebhookResult,
  ensureApiKeyIndexes,
  requireApiKey,
  toPublicClient,
};
