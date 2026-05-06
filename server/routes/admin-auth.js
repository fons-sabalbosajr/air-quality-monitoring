/**
 * Admin PIN-based authentication for /admin pages.
 *
 * Endpoints:
 *   GET  /api/admin/auth/status         — { pinSet: bool }
 *   POST /api/admin/auth/setup          — First-time PIN setup
 *   POST /api/admin/auth/verify         — Login with PIN
 *   POST /api/admin/auth/reset-request  — Request OTP for PIN reset
 *   POST /api/admin/auth/reset-confirm  — Confirm OTP and set new PIN
 *   POST /api/admin/auth/logout         — Invalidate session token
 */
const express = require("express");
const crypto  = require("crypto");
const router  = express.Router();

const { ensureMongo } = require("../services/mongo");
const { getEmailTransport } = require("../services/emailService");
const { EMAIL_USER } = require("../config/env");

/* ── Constants ─────────────────────────────────────────────────── */
const COLLECTION       = "admin_config";
const PIN_DOC_ID       = "nlex-admin-pin";
const OTP_DOC_ID       = "nlex-admin-otp";
const SESSION_TTL_MS   = 8 * 60 * 60 * 1000;   // 8 hours
const OTP_TTL_MS       = 15 * 60 * 1000;        // 15 minutes
const PBKDF2_ITER      = 100_000;
const PBKDF2_KEYLEN    = 64;
const PBKDF2_DIGEST    = "sha512";

/* ── In-memory session store: Map<token, { expiresAt }> ─────── */
const _sessions = new Map();

// Prune expired sessions every 30 min
setInterval(() => {
  const now = Date.now();
  for (const [tok, s] of _sessions) if (now > s.expiresAt) _sessions.delete(tok);
}, 30 * 60_000);

/* ── Helpers ───────────────────────────────────────────────────── */
function hashPin(pin, salt) {
  return crypto.pbkdf2Sync(pin, salt, PBKDF2_ITER, PBKDF2_KEYLEN, PBKDF2_DIGEST).toString("hex");
}

function generateToken() {
  return crypto.randomBytes(32).toString("hex");
}

function isValidToken(token) {
  if (!token) return false;
  const s = _sessions.get(token);
  if (!s) return false;
  if (Date.now() > s.expiresAt) { _sessions.delete(token); return false; }
  return true;
}

/* Validate PIN input (6 numeric digits) */
function validatePin(pin) {
  return typeof pin === "string" && /^\d{6}$/.test(pin);
}

/* ── Middleware — exported for use in other routes ────────────── */
function requireAdminToken(req, res, next) {
  const token = req.headers["x-admin-token"];
  if (!isValidToken(token)) return res.status(401).json({ error: "Unauthorized" });
  next();
}

/* ── Routes ────────────────────────────────────────────────────── */

// GET /api/admin/auth/status
router.get("/api/admin/auth/status", async (req, res) => {
  try {
    const db  = await ensureMongo();
    const col = db.collection(COLLECTION);
    const doc = await col.findOne({ _id: PIN_DOC_ID });
    res.json({ pinSet: !!doc });
  } catch (e) {
    res.status(500).json({ error: "Server error" });
  }
});

// POST /api/admin/auth/setup  — first-time PIN + recovery email
router.post("/api/admin/auth/setup", async (req, res) => {
  try {
    const { pin, recoveryEmail } = req.body;
    if (!validatePin(pin)) {
      return res.status(400).json({ error: "PIN must be 6 digits" });
    }
    const db  = await ensureMongo();
    const col = db.collection(COLLECTION);
    const existing = await col.findOne({ _id: PIN_DOC_ID });
    if (existing) return res.status(409).json({ error: "PIN already configured" });

    const salt = crypto.randomBytes(32).toString("hex");
    const hash = hashPin(pin, salt);
    await col.insertOne({
      _id: PIN_DOC_ID,
      hash,
      salt,
      recoveryEmail: recoveryEmail || null,
      createdAt: new Date(),
    });

    const token = generateToken();
    _sessions.set(token, { expiresAt: Date.now() + SESSION_TTL_MS });
    res.json({ ok: true, token });
  } catch (e) {
    res.status(500).json({ error: "Server error" });
  }
});

// POST /api/admin/auth/verify
router.post("/api/admin/auth/verify", async (req, res) => {
  try {
    const { pin } = req.body;
    if (!pin) return res.status(400).json({ error: "PIN required" });

    const db  = await ensureMongo();
    const col = db.collection(COLLECTION);
    const doc = await col.findOne({ _id: PIN_DOC_ID });
    if (!doc) return res.status(404).json({ error: "PIN not configured" });

    const hash = hashPin(pin, doc.salt);
    if (hash !== doc.hash) {
      return res.status(401).json({ error: "Incorrect PIN" });
    }

    const token = generateToken();
    _sessions.set(token, { expiresAt: Date.now() + SESSION_TTL_MS });
    res.json({ ok: true, token });
  } catch (e) {
    res.status(500).json({ error: "Server error" });
  }
});

// POST /api/admin/auth/reset-request
router.post("/api/admin/auth/reset-request", async (req, res) => {
  try {
    const { email } = req.body;
    if (!email || typeof email !== "string") {
      return res.status(400).json({ error: "Email required" });
    }

    const db  = await ensureMongo();
    const col = db.collection(COLLECTION);
    const doc = await col.findOne({ _id: PIN_DOC_ID });

    // Always return success to avoid email enumeration
    if (!doc || !doc.recoveryEmail || doc.recoveryEmail !== email.trim()) {
      return res.json({ ok: true });
    }

    const otp = String(Math.floor(100000 + Math.random() * 900000));
    await col.replaceOne(
      { _id: OTP_DOC_ID },
      { _id: OTP_DOC_ID, otp, expiry: new Date(Date.now() + OTP_TTL_MS) },
      { upsert: true }
    );

    const transport = getEmailTransport();
    if (!transport) {
      console.warn("[admin-auth] Email transport not available");
      return res.json({ ok: true });
    }

    await transport.sendMail({
      from: `"EMB R3 Admin" <${EMAIL_USER}>`,
      to: email.trim(),
      subject: "NLEX Admin PIN Reset — One-Time Code",
      html: `
        <div style="font-family:'Segoe UI',Arial,sans-serif;max-width:480px;margin:0 auto;padding:32px 24px;background:#f8fafc;border-radius:12px;">
          <h2 style="color:#1e3a5f;margin-bottom:8px;">Admin PIN Reset</h2>
          <p style="color:#374151;margin-bottom:24px;">Use the code below to reset your NLEX Admin PIN. This code expires in <strong>15 minutes</strong>.</p>
          <div style="text-align:center;background:#fff;border:1px solid #e5e7eb;border-radius:8px;padding:24px;">
            <span style="font-size:40px;font-weight:700;letter-spacing:10px;color:#1677ff;">${otp}</span>
          </div>
          <p style="color:#6b7280;font-size:13px;margin-top:24px;">If you did not request this, ignore this email. Your PIN remains unchanged.</p>
        </div>`,
    });

    res.json({ ok: true });
  } catch (e) {
    console.error("[admin-auth] reset-request error:", e.message);
    res.status(500).json({ error: "Server error" });
  }
});

// POST /api/admin/auth/reset-confirm
router.post("/api/admin/auth/reset-confirm", async (req, res) => {
  try {
    const { otp, newPin } = req.body;
    if (!otp || !newPin) {
      return res.status(400).json({ error: "OTP and new PIN required" });
    }
    if (!validatePin(newPin)) {
      return res.status(400).json({ error: "PIN must be 6 digits" });
    }

    const db  = await ensureMongo();
    const col = db.collection(COLLECTION);
    const otpDoc = await col.findOne({ _id: OTP_DOC_ID });

    if (!otpDoc || otpDoc.otp !== String(otp) || new Date() > new Date(otpDoc.expiry)) {
      return res.status(400).json({ error: "Invalid or expired OTP" });
    }

    const salt = crypto.randomBytes(32).toString("hex");
    const hash = hashPin(newPin, salt);
    await col.updateOne({ _id: PIN_DOC_ID }, { $set: { hash, salt, updatedAt: new Date() } });
    await col.deleteOne({ _id: OTP_DOC_ID });

    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: "Server error" });
  }
});

// POST /api/admin/auth/logout
router.post("/api/admin/auth/logout", (req, res) => {
  const token = req.headers["x-admin-token"];
  if (token) _sessions.delete(token);
  res.json({ ok: true });
});

module.exports = { router, requireAdminToken };
