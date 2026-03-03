/**
 * Health / root info routes.
 */
const { Router } = require("express");
const router = Router();

router.get("/", (req, res) => {
  res.status(200).json({ service: "aqm-server", status: "ok" });
});

router.get("/health", (req, res) => {
  res.status(200).json({ health: "ok", timestamp: Date.now() });
});

module.exports = router;
