/**
 * One-shot script: force-sync all Google Sheets stations into MongoDB,
 * bypassing maintenance mode. Clears the raw-tabular in-memory cache so
 * fresh data is always fetched from the sheet.
 *
 * Usage: node scripts/forceSyncAll.js
 */
require("dotenv").config({ path: require("path").join(__dirname, "../.env") });

const { ensureMongo } = require("../services/mongo");
const { setDb, runBackupCycle, ensureBackupIndexes } = require("../services/tabularBackup");

// Clear the googleSheets in-memory cache so data is always refetched from the sheet
const gs = require("../services/googleSheets");
gs.clearCache();

(async () => {
  console.log("[forceSyncAll] Connecting to MongoDB...");
  const db = await ensureMongo();
  setDb(db);
  await ensureBackupIndexes(db).catch(() => {});
  console.log("[forceSyncAll] Running forced backup cycle (maintenance bypass)...");
  const results = await runBackupCycle("force-admin", { force: true });
  if (!results) {
    console.log("[forceSyncAll] Cycle returned no results (DB not ready or already running)");
    process.exit(0);
  }
  for (const r of results) {
    if (r.error) {
      console.error(`  ✗ ${r.province}:${r.pollutant} — ERROR: ${r.error}`);
    } else if (r.updated) {
      console.log(`  ✓ ${r.province}:${r.pollutant} — UPDATED (${r.rowCount} rows)`);
    } else {
      console.log(`  = ${r.province}:${r.pollutant} — unchanged (${r.rowCount} rows)`);
    }
  }
  console.log("[forceSyncAll] Done.");
  process.exit(0);
})().catch((e) => {
  console.error("[forceSyncAll] Fatal:", e.message);
  process.exit(1);
});
