/**
 * MongoDB connection management, data persistence, and ingestion helpers.
 */
const { MongoClient } = require("mongodb");
const cron = require("node-cron");
const {
  MONGO_URI,
  MONGO_DB_NAME,
  DEFAULT_DB_NAME,
  SERIES_COLLECTION_NAME,
  META_COLLECTION_NAME,
  STATION_COLLECTION_NAME,
  INGEST_CRON,
  INGEST_TZ,
  INGEST_ON_START,
  STATION_LAT,
  STATION_LON,
  STATION_NAME,
  STATION_ADDRESS,
} = require("../config/env");

let _mongoClient = null;
let _mongoDb = null;
let _seriesCollection = null;
let _metaCollection = null;
let _stationCollection = null;
let _ingestScheduled = false;
let _ingestRunning = false;

function inferDbName(uri) {
  if (!uri) return DEFAULT_DB_NAME;
  const noQuery = uri.split("?")[0];
  const parts = noQuery.split("/");
  const last = parts[parts.length - 1];
  return last && !last.includes("@") ? last : DEFAULT_DB_NAME;
}

async function ensureMongo() {
  if (_mongoDb) return _mongoDb;
  if (!MONGO_URI) {
    throw new Error("MONGO_URI is not configured");
  }
  _mongoClient = new MongoClient(MONGO_URI, {
    maxPoolSize: Number(process.env.MONGO_MAX_POOL || 5),
    serverSelectionTimeoutMS: 8000,
  });
  await _mongoClient.connect();
  const dbName = MONGO_DB_NAME || inferDbName(MONGO_URI) || DEFAULT_DB_NAME;
  _mongoDb = _mongoClient.db(dbName);
  _seriesCollection = _mongoDb.collection(SERIES_COLLECTION_NAME);
  _metaCollection = _mongoDb.collection(META_COLLECTION_NAME);
  _stationCollection = _mongoDb.collection(STATION_COLLECTION_NAME);
  try {
    await Promise.all([
      _seriesCollection.createIndex({ sheet: 1, epochMs: 1 }, { unique: true }),
      _seriesCollection.createIndex({ sheet: 1, timestamp: -1 }),
      _metaCollection.createIndex({ sheet: 1 }, { unique: true }),
      _stationCollection.createIndex({ key: 1 }, { unique: true }),
    ]);
  } catch (e) {
    console.warn(`[mongo] index creation warning: ${e && e.message}`);
  }
  console.log(
    `[mongo] connected to ${dbName}.${SERIES_COLLECTION_NAME} (ingestion enabled)`,
  );
  return _mongoDb;
}

async function getSeriesCollection() {
  await ensureMongo();
  return _seriesCollection;
}

async function getMetaCollection() {
  await ensureMongo();
  return _metaCollection;
}

async function getStationCollection() {
  await ensureMongo();
  return _stationCollection;
}

async function persistStationMeta() {
  if (!MONGO_URI) return;
  try {
    const col = await getStationCollection();
    const lat = STATION_LAT ? Number(STATION_LAT) : null;
    const lon = STATION_LON ? Number(STATION_LON) : null;
    const doc = {
      key: "default",
      name: STATION_NAME,
      address: STATION_ADDRESS,
      latitude: lat,
      longitude: lon,
      updatedAt: new Date(),
      source: "env",
    };
    await col.updateOne({ key: "default" }, { $set: doc }, { upsert: true });
  } catch (e) {
    console.warn(`[mongo] persistStationMeta failed: ${e.message}`);
  }
}

async function persistSeriesToMongo(sheetKey, data) {
  if (!data || !Array.isArray(data.series) || !data.series.length) {
    return { upserted: 0 };
  }
  const seriesCol = await getSeriesCollection();
  const metaCol = await getMetaCollection();
  const now = new Date();
  const ingestionId = `${sheetKey}:${now.toISOString()}`;
  const ops = data.series.map((pt) => ({
    updateOne: {
      filter: { sheet: sheetKey, epochMs: pt.t },
      update: {
        $set: {
          sheet: sheetKey,
          epochMs: pt.t,
          timestamp: new Date(pt.t),
          value: pt.y,
          metaSnapshot: {
            sheet: data.meta?.sheet || sheetKey,
            yKey: data.meta?.yKey || null,
            yLabel: data.meta?.yLabel || null,
          },
          updatedAt: now,
          ingestionId,
        },
      },
      upsert: true,
    },
  }));
  const chunk = Number(process.env.MONGO_BULK_BATCH || 500);
  for (let i = 0; i < ops.length; i += chunk) {
    const slice = ops.slice(i, i + chunk);
    await seriesCol.bulkWrite(slice, { ordered: false });
  }
  const metaPayload = {
    sheet: sheetKey,
    meta: {
      ...data.meta,
      sheet: data.meta?.sheet || sheetKey,
      yKey: data.meta?.yKey || null,
      yLabel: data.meta?.yLabel || null,
      points: data.series.length,
    },
    updatedAt: now,
    ingestionId,
  };
  await metaCol.updateOne(
    { sheet: sheetKey },
    { $set: metaPayload },
    { upsert: true },
  );
  return { upserted: data.series.length };
}

async function fetchSeriesFromMongo(sheetKey) {
  if (!MONGO_URI) return null;
  try {
    const seriesCol = await getSeriesCollection();
    const metaCol = await getMetaCollection();
    const docs = await seriesCol
      .find({ sheet: sheetKey })
      .sort({ epochMs: 1 })
      .toArray();
    if (!docs.length) return null;
    const metaDoc = await metaCol.findOne({ sheet: sheetKey });
    const meta = {
      sheet: sheetKey,
      ...(metaDoc?.meta || {}),
      points: docs.length,
    };
    return {
      series: docs.map((d) => ({ t: d.epochMs, y: d.value })),
      meta,
    };
  } catch (err) {
    console.warn(`[mongo] fetchSeries failed (${sheetKey}): ${err.message}`);
    return null;
  }
}

async function fetchLatestFromMongo(sheetKey) {
  if (!MONGO_URI) return null;
  try {
    const seriesCol = await getSeriesCollection();
    const metaCol = await getMetaCollection();
    const doc = await seriesCol
      .find({ sheet: sheetKey })
      .sort({ epochMs: -1 })
      .limit(1)
      .next();
    if (!doc) return null;
    const metaDoc = await metaCol.findOne({ sheet: sheetKey });
    return { doc, meta: metaDoc?.meta || null };
  } catch (err) {
    console.warn(`[mongo] fetchLatest failed (${sheetKey}): ${err.message}`);
    return null;
  }
}

/**
 * Run a data ingestion cycle. Requires readVizData and readSheetSeries
 * to be injected to avoid circular dependencies.
 */
async function runIngestion(reason = "scheduled", { readVizData, readSheetSeries } = {}) {
  if (!MONGO_URI) {
    console.warn("[ingest] skipped (MONGO_URI missing)");
    return;
  }
  if (_ingestRunning) {
    console.log(`[ingest] overlapping run skipped (${reason})`);
    return;
  }
  _ingestRunning = true;
  const started = Date.now();
  try {
    const viz = await readVizData();
    const pm10 = await readSheetSeries("PM10");
    await persistSeriesToMongo("viz_data", viz);
    await persistSeriesToMongo("PM10", pm10);
    console.log(
      `[ingest] run ${reason} ok in ${Date.now() - started}ms (viz:${
        viz.meta?.points || viz.series.length
      } pts, pm10:${pm10.meta?.points || pm10.series.length} pts)`,
    );
  } catch (err) {
    console.error(`[ingest] run ${reason} failed: ${err.message}`);
  } finally {
    _ingestRunning = false;
  }
}

function scheduleIngestion({ readVizData, readSheetSeries } = {}) {
  if (_ingestScheduled || !MONGO_URI) return;
  try {
    cron.schedule(
      INGEST_CRON,
      () => {
        runIngestion("cron", { readVizData, readSheetSeries });
      },
      { timezone: INGEST_TZ },
    );
    console.log(
      `[ingest] cron scheduled (${INGEST_CRON}${INGEST_TZ ? ` ${INGEST_TZ}` : ""})`,
    );
    if (INGEST_ON_START) {
      runIngestion("startup", { readVizData, readSheetSeries }).catch((err) =>
        console.error(`[ingest] startup run failed: ${err.message}`),
      );
    }
    _ingestScheduled = true;
  } catch (err) {
    console.error(`[ingest] failed to schedule cron: ${err.message}`);
  }
}

module.exports = {
  ensureMongo,
  getSeriesCollection,
  getMetaCollection,
  getStationCollection,
  persistStationMeta,
  persistSeriesToMongo,
  fetchSeriesFromMongo,
  fetchLatestFromMongo,
  runIngestion,
  scheduleIngestion,
};
