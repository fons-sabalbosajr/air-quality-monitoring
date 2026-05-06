/**
 * NLEX display settings — server-side persistence.
 *
 * GET  /api/nlex-settings — public; any device can poll for the latest settings
 * PUT  /api/nlex-settings — admin-only; persists settings to MongoDB
 *
 * This enables cross-device sync: changes made in /admin are immediately
 * persisted here and picked up by any /nlex tab polling the GET endpoint.
 */
const { Router } = require("express");
const { requireAdminToken } = require("./admin-auth");
const { ensureMongo } = require("../services/mongo");

const router = Router();

const COLLECTION = "nlex_settings";
const DOC_ID = "nlex";

const DEFAULT_AQI_DESCRIPTIONS = {
  good: "Air is clean. Safe for everyone.",
  fair: "Acceptable. Sensitive groups take caution.",
  usg: "Unhealthy for children, elderly & sick. Limit outdoor activity.",
  vu: "Wear a mask. Everyone may feel health effects.",
  au: "Health hazard for all. Avoid outdoor exposure.",
  emergency: "Stay indoors. Air is dangerous for everyone.",
};

const DEFAULT_SETTINGS = {
  stationsVisible: {
    clark: true,
    "san-fernando": true,
    meycauayan: true,
    zambales: true,
  },
  carouselStationsVisible: {
    clark: true,
    "san-fernando": true,
    meycauayan: true,
    zambales: true,
  },
  pollutantsVisible: {
    clark_pm10: true,
    "san-fernando_pm10": true,
    meycauayan_pm10: true,
    meycauayan_pm25: true,
    zambales_pm10: true,
    zambales_pm25: true,
  },
  theme: "auto",
  showHeader: true,
  showAqiLegend: true,
  showFooter: true,
  showDateTime: true,
  showSubtitle: true,
  showGaugeChart: true,
  cardDisplayMode: "grid",
  carouselDurationSec: 10,
  spotlightSpeed: "normal",
  spotlightEnabled: true,
  nlexMaintenance: false,
  nlexMaintenanceMsg: "",
  nlexMaintenanceUpdateDesc: "",
  aqiDescriptions: DEFAULT_AQI_DESCRIPTIONS,
};

function mergeSettings(source) {
  const settings = source && typeof source === "object" ? source : {};
  return {
    ...DEFAULT_SETTINGS,
    ...settings,
    stationsVisible: {
      ...DEFAULT_SETTINGS.stationsVisible,
      ...(settings.stationsVisible || {}),
    },
    carouselStationsVisible: {
      ...DEFAULT_SETTINGS.carouselStationsVisible,
      ...(settings.carouselStationsVisible || {}),
    },
    pollutantsVisible: {
      ...DEFAULT_SETTINGS.pollutantsVisible,
      ...(settings.pollutantsVisible || {}),
    },
    aqiDescriptions: {
      ...DEFAULT_AQI_DESCRIPTIONS,
      ...(settings.aqiDescriptions || {}),
    },
  };
}

// GET /api/nlex-settings — public, no auth required
// Returns { settings, persisted } where persisted=true means an admin explicitly saved settings.
// Clients MUST check persisted before overwriting their local state, so fresh installs
// never clobber existing localStorage settings with server defaults.
router.get("/api/nlex-settings", async (req, res) => {
  try {
    const db = await ensureMongo();
    const col = db.collection(COLLECTION);
    const doc = await col.findOne({ _id: DOC_ID });
    if (doc) {
      res.json({ settings: mergeSettings(doc.settings), persisted: true });
    } else {
      res.json({ settings: DEFAULT_SETTINGS, persisted: false });
    }
  } catch (e) {
    console.error("[nlex-settings] GET error:", e.message);
    // Persisted:false so clients fall back to their own localStorage on error
    res.json({ settings: DEFAULT_SETTINGS, persisted: false });
  }
});

// PUT /api/nlex-settings — admin only
// Called by /admin when settings change; persists to MongoDB for cross-device sync
router.put("/api/nlex-settings", requireAdminToken, async (req, res) => {
  try {
    const settings = req.body;
    if (!settings || typeof settings !== "object" || Array.isArray(settings)) {
      return res.status(400).json({ error: "Invalid settings payload" });
    }
    const db = await ensureMongo();
    const col = db.collection(COLLECTION);
    const merged = mergeSettings(settings);
    await col.updateOne(
      { _id: DOC_ID },
      { $set: { settings: merged, updatedAt: new Date() } },
      { upsert: true }
    );
    res.json({ ok: true });
  } catch (e) {
    console.error("[nlex-settings] PUT error:", e.message);
    res.status(500).json({ error: "Server error" });
  }
});

module.exports = router;
