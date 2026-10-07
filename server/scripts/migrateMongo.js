/**
 * One-shot script: copy every collection (documents + indexes) of the app
 * database from one MongoDB cluster to another.
 *
 * Source: MONGO_URI_OLD (db = MONGO_DB_NAME_OLD, else the URI path)
 * Target: MONGO_URI     (db = MONGO_DB_NAME,     else the URI path)
 *
 * Default mode (before cutover): documents are replaced/upserted by _id, so
 * the script is safe to re-run while the target is not yet live. Nothing is
 * ever deleted from either side.
 *
 * --insert-only (after cutover, once the app writes to the target): only
 * documents missing from the target are added. Existing target documents are
 * never overwritten, and rows the live app already re-created under a new _id
 * (same unique key, e.g. sheet+epochMs) are skipped.
 *
 * --skip=a,b   collections to leave out, e.g. the air_data_backup* cache that
 *              the live backup cron rebuilds from the sheets by itself.
 *
 * Usage: node scripts/migrateMongo.js [--dry-run] [--insert-only] [--skip=a,b]
 */
require("dotenv").config({ path: require("path").join(__dirname, "../.env") });

const { MongoClient } = require("mongodb");

const DRY_RUN = process.argv.includes("--dry-run");
const INSERT_ONLY = process.argv.includes("--insert-only");
const SKIP = new Set(
  (process.argv.find((a) => a.startsWith("--skip=")) || "--skip=").slice(7).split(",").filter(Boolean),
);
const BATCH = Number(process.env.MONGO_BULK_BATCH || 1000);

function dbNameFrom(uri, explicit) {
  if (explicit && explicit.trim()) return explicit.trim();
  const last = uri.split("?")[0].split("/").pop();
  if (!last || last.includes("@")) throw new Error(`no database name in URI or env for ${hostOf(uri)}`);
  return last;
}

function hostOf(uri) {
  return uri.split("@").pop().split("/")[0];
}

async function copyCollection(srcDb, dstDb, name) {
  const src = srcDb.collection(name);
  const dst = dstDb.collection(name);
  const total = await src.countDocuments();

  // Recreate secondary indexes first so unique constraints apply during the copy.
  const indexes = (await src.indexes())
    .filter((ix) => ix.name !== "_id_")
    .map(({ v, ns, ...spec }) => spec);
  if (!DRY_RUN && indexes.length) await dst.createIndexes(indexes);

  let seen = 0;
  let inserted = 0;
  let duplicates = 0;
  let docs = [];
  const flush = async () => {
    if (!docs.length) return;
    seen += docs.length;
    let batch = docs;
    docs = [];
    if (INSERT_ONLY) {
      const present = new Set(
        (await dst.find({ _id: { $in: batch.map((d) => d._id) } }, { projection: { _id: 1 } }).toArray())
          .map((d) => String(d._id)),
      );
      batch = batch.filter((d) => !present.has(String(d._id)));
    }
    if (batch.length && !DRY_RUN) {
      const ops = INSERT_ONLY
        ? batch.map((doc) => ({ insertOne: { document: doc } }))
        : batch.map((doc) => ({ replaceOne: { filter: { _id: doc._id }, replacement: doc, upsert: true } }));
      try {
        await dst.bulkWrite(ops, { ordered: false });
      } catch (e) {
        // In insert-only mode a unique-key clash means the live app already has that row.
        const errs = e.writeErrors ? [].concat(e.writeErrors) : null;
        if (!INSERT_ONLY || !errs || errs.some((w) => w.code !== 11000)) throw e;
        duplicates += errs.length;
        inserted -= errs.length;
      }
    }
    inserted += batch.length;
    process.stdout.write(`\r  ${name}: ${seen}/${total}`);
  };
  for await (const doc of src.find({}, { batchSize: BATCH })) {
    docs.push(doc);
    if (docs.length >= BATCH) await flush();
  }
  await flush();

  const after = DRY_RUN ? null : await dst.countDocuments();
  if (INSERT_ONLY) {
    process.stdout.write(
      `\r  ✓ ${name}: source=${total} ${DRY_RUN ? "would insert" : "inserted"}=${inserted} already-live=${duplicates} target=${after ?? "-"}\n`,
    );
    return true;
  }
  const ok = DRY_RUN || after >= total;
  process.stdout.write(
    `\r  ${ok ? "✓" : "✗"} ${name}: source=${total} target=${after ?? seen} indexes=${indexes.length}\n`,
  );
  return ok;
}

(async () => {
  const fromUri = process.env.MONGO_URI_OLD;
  const toUri = process.env.MONGO_URI;
  if (!fromUri || !toUri) throw new Error("set MONGO_URI_OLD (source) and MONGO_URI (target) in .env");
  if (hostOf(fromUri) === hostOf(toUri)) throw new Error("source and target are the same cluster");

  const fromDbName = dbNameFrom(fromUri, process.env.MONGO_DB_NAME_OLD);
  const toDbName = dbNameFrom(toUri, process.env.MONGO_DB_NAME);
  const mode = [INSERT_ONLY && "insert-only", DRY_RUN && "dry run", SKIP.size && `skip: ${[...SKIP].join(",")}`].filter(Boolean);
  console.log(`[migrateMongo] ${hostOf(fromUri)}/${fromDbName} -> ${hostOf(toUri)}/${toDbName}${mode.length ? ` (${mode.join("; ")})` : ""}`);

  const from = await new MongoClient(fromUri, { serverSelectionTimeoutMS: 15000 }).connect();
  const to = await new MongoClient(toUri, { serverSelectionTimeoutMS: 15000 }).connect();
  try {
    const srcDb = from.db(fromDbName);
    const dstDb = to.db(toDbName);
    const names = (await srcDb.listCollections({ type: "collection" }).toArray())
      .map((c) => c.name)
      .filter((n) => !n.startsWith("system.") && !SKIP.has(n))
      .sort();
    let failed = 0;
    for (const name of names) {
      if (!(await copyCollection(srcDb, dstDb, name))) failed++;
    }
    console.log(failed ? `[migrateMongo] ${failed} collection(s) short — re-run.` : "[migrateMongo] Done.");
    process.exitCode = failed ? 1 : 0;
  } finally {
    await Promise.all([from.close(), to.close()]);
  }
})().catch((e) => {
  console.error("[migrateMongo] Fatal:", e.message);
  process.exit(1);
});
