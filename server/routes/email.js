/**
 * Email sharing route.
 */
const { Router } = require("express");
const {
  getEmailTransport,
  buildEmailHtml,
  EMAIL_USER,
} = require("../services/emailService");
const { ensureMongo } = require("../services/mongo");

const router = Router();

router.post("/api/share-email", async (req, res) => {
  try {
    const transport = getEmailTransport();
    if (!transport) {
      return res
        .status(500)
        .json({ error: "Email not configured on this server" });
    }
    const { to, province, pollutant, columns, rows, totalRows, filters } =
      req.body;
    if (!to || !province) {
      return res
        .status(400)
        .json({ error: "Missing required fields (to, province)" });
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) {
      return res.status(400).json({ error: "Invalid email address" });
    }
    const generatedAt = new Date().toLocaleString("en-US", {
      timeZone: "Asia/Manila",
      dateStyle: "long",
      timeStyle: "short",
    });
    const html = buildEmailHtml({
      province,
      pollutant: pollutant || "PM10",
      columns: columns || [],
      rows: rows || [],
      totalRows: totalRows || (rows || []).length,
      filters: filters || {},
      generatedAt,
    });
    await transport.sendMail({
      from: `"EMBR3 AQI Monitoring" <${EMAIL_USER}>`,
      to,
      subject: `Air Quality Report — ${province} (${pollutant || "PM10"}) — ${new Date().toLocaleDateString("en-US")}`,
      html,
    });
    // Log the share event
    try {
      const db = await ensureMongo();
      await db.collection("email_share_logs").insertOne({
        to,
        province,
        pollutant,
        totalRows,
        filters,
        sentAt: new Date(),
        userAgent: req.headers["user-agent"] || null,
        ip: req.ip || null,
      });
    } catch {}
    res.json({ ok: true, message: `Report sent to ${to}` });
  } catch (e) {
    console.error("[share-email] error:", e.message);
    res.status(500).json({ error: e.message || "Failed to send email" });
  }
});

/** GET /api/email-share-logs  — retrieve email share log entries */
router.get("/api/email-share-logs", async (req, res) => {
  try {
    const db    = await ensureMongo();
    const limit = Math.min(Number(req.query.limit) || 200, 1000);
    const logs  = await db
      .collection("email_share_logs")
      .find({})
      .sort({ sentAt: -1 })
      .limit(limit)
      .toArray();
    // Mask email: show first 2 chars + *** + @domain
    const masked = logs.map((l) => ({
      ...l,
      to: l.to
        ? l.to.replace(/^(.{2})(.*)(@.+)$/, (_, a, b, c) => a + "*".repeat(Math.min(b.length, 4)) + c)
        : null,
    }));
    res.json({ logs: masked, total: masked.length });
  } catch (e) {
    console.error("[email-share-logs] error:", e.message);
    res.status(500).json({ error: "Failed to read logs" });
  }
});

module.exports = router;
