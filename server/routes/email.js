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

module.exports = router;
