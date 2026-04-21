/**
 * Health / root info routes.
 */
const { Router } = require("express");
const router = Router();

const maintenanceMode = () => process.env.MAINTENANCE_MODE === "true";

router.get("/", (req, res) => {
  res.status(200).json({ service: "aqm-server", status: "ok" });
});

router.get("/health", (req, res) => {
  res.status(200).json({ health: "ok", timestamp: Date.now(), maintenanceMode: maintenanceMode() });
});

// Aliased under /api/ so Nginx subpath rewrite reaches it
router.get("/api/health", (req, res) => {
  res.status(200).json({ health: "ok", timestamp: Date.now(), maintenanceMode: maintenanceMode() });
});

module.exports = router;
