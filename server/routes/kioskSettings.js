/**
 * Kiosk display settings — server-side persistence.
 *
 * GET  /api/kiosk-settings — public; any device can poll for the latest settings
 * PUT  /api/kiosk-settings — admin-only; persists settings to MongoDB
 *
 * Enables cross-device real-time sync: changes in /admin/kiosk-settings are
 * persisted here and picked up by the kiosk page polling the GET endpoint.
 */
const { Router } = require("express");
const { requireAdminToken } = require("./admin-auth");
const { ensureMongo } = require("../services/mongo");

const router = Router();

const COLLECTION = "kiosk_settings";
const DOC_ID = "kiosk";

const DEFAULT_SETTINGS = {
  // Per-pollutant AQI value visibility (hides the numeric value in the gauge and meter)
  aqiValueVisible: {
    clark: true,
    "san-fernando": true,
    meycauayan_pm10: true,
    meycauayan_pm25: true,
    zambales_pm10: true,
    zambales_pm25: true,
  },
  // Per-pollutant AQI datetime visibility (hides the "Updated: …" timestamp)
  aqiDateTimeVisible: {
    clark: true,
    "san-fernando": true,
    meycauayan_pm10: true,
    meycauayan_pm25: true,
    zambales_pm10: true,
    zambales_pm25: true,
  },
  // Section visibility
  showWeather: true,
  showHourlyForecast: true,
  showWindMap: true,
  showStationCarousel: true,
  showYoutubeVideos: true,
  showContactCard: true,
  // Auto-cycle interval (seconds per station)
  cycleIntervalSec: 25,
  // Maintenance
  kioskMaintenance: false,
  kioskMaintenanceMsg: "",
};

// GET /api/kiosk-settings — public, no auth required
router.get("/api/kiosk-settings", async (req, res) => {
  try {
    const db = await ensureMongo();
    const col = db.collection(COLLECTION);
    const doc = await col.findOne({ _id: DOC_ID });
    if (doc) {
      res.json({ settings: doc.settings, persisted: true });
    } else {
      res.json({ settings: DEFAULT_SETTINGS, persisted: false });
    }
  } catch (e) {
    console.error("[kiosk-settings] GET error:", e.message);
    res.json({ settings: DEFAULT_SETTINGS, persisted: false });
  }
});

// PUT /api/kiosk-settings — admin only
router.put("/api/kiosk-settings", requireAdminToken, async (req, res) => {
  try {
    const settings = req.body;
    if (!settings || typeof settings !== "object" || Array.isArray(settings)) {
      return res.status(400).json({ error: "Invalid settings payload" });
    }
    const db = await ensureMongo();
    const col = db.collection(COLLECTION);
    await col.updateOne(
      { _id: DOC_ID },
      { $set: { settings, updatedAt: new Date() } },
      { upsert: true }
    );
    res.json({ ok: true });
  } catch (e) {
    console.error("[kiosk-settings] PUT error:", e.message);
    res.status(500).json({ error: "Server error" });
  }
});

module.exports = router;
