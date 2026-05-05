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

const DEFAULT_SETTINGS = {
  stationsVisible: {
    clark: true,
    "san-fernando": true,
    meycauayan: true,
    zambales: true,
  },
  theme: "auto",
  showHeader: true,
  showAqiLegend: true,
  showFooter: true,
  showDateTime: true,
  showSubtitle: true,
  spotlightSpeed: "normal",
  spotlightEnabled: true,
  nlexMaintenance: false,
  nlexMaintenanceMsg: "",
  nlexMaintenanceUpdateDesc: "",
};

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
      res.json({ settings: doc.settings, persisted: true });
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
    await col.updateOne(
      { _id: DOC_ID },
      { $set: { settings, updatedAt: new Date() } },
      { upsert: true }
    );
    res.json({ ok: true });
  } catch (e) {
    console.error("[nlex-settings] PUT error:", e.message);
    res.status(500).json({ error: "Server error" });
  }
});

module.exports = router;
