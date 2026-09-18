/**
 * Manage partner API keys and hourly push webhooks for the external API
 * (/api/v1) from the CLI.
 *
 * Usage:
 *   node scripts/apiKeys.js create --name "Partner System" [--org "Org"] [--email a@b.c]
 *                                  [--scopes read:stations,read:latest,read:recent]
 *                                  [--rate 60] [--expires 2027-12-31]
 *                                  [--webhook-url https://... --webhook-secret S --webhook-format json|powerbi]
 *   node scripts/apiKeys.js list
 *   node scripts/apiKeys.js revoke <id>
 *   node scripts/apiKeys.js webhook <id> --url https://... [--secret S] [--format json|powerbi] [--disable]
 *   node scripts/apiKeys.js webhook <id> --remove
 *   node scripts/apiKeys.js push [<id>]          — deliver the latest readings now (all clients, or one)
 *   node scripts/apiKeys.js deliveries <id> [--limit 20]
 *
 * The plaintext key is printed ONCE on create — it is never stored.
 */
require("dotenv").config({ path: require("path").join(__dirname, "../.env") });
require("../config/env"); // applies DNS_SERVERS override before Mongo connects

const { ensureMongo, closeMongo } = require("../services/mongo");
const { setDb: setBackupDb } = require("../services/tabularBackup");
const {
  createApiKey,
  listApiClients,
  revokeApiKey,
  setWebhook,
  ensureApiKeyIndexes,
  SCOPES,
  WEBHOOK_FORMATS,
} = require("../services/apiKeys");
const { runPushCycle, pushToClientNow, listDeliveries, PUSH_CRON } = require("../services/apiPush");

const COMMANDS = ["create", "list", "revoke", "webhook", "push", "deliveries"];

function parseArgs(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) {
      const k = a.slice(2);
      const v = argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[++i] : "true";
      out[k] = v;
    } else {
      out._.push(a);
    }
  }
  return out;
}

function fmt(d) {
  return d ? new Date(d).toISOString() : "-";
}

function usage() {
  console.log(`Usage: node scripts/apiKeys.js <${COMMANDS.join("|")}> [options]`);
  console.log(`Valid scopes: ${SCOPES.join(", ")}`);
  console.log(`Webhook formats: ${WEBHOOK_FORMATS.join(", ")}   (push schedule: ${PUSH_CRON})`);
  process.exit(1);
}

function printWebhook(c) {
  if (!c.webhook) return "  Webhook: none";
  const w = c.webhook;
  return (
    `  Webhook: ${w.enabled ? "enabled" : "DISABLED"} ${w.format} → ${w.url}` +
    (w.hasSecret ? " (signed)" : " (unsigned)") +
    `\n           last delivery ${fmt(w.lastDeliveryAt)} status=${w.lastStatus ?? "-"} failures=${w.consecutiveFailures}` +
    (w.lastError ? `\n           last error: ${w.lastError}` : "")
  );
}

(async () => {
  const args = parseArgs(process.argv.slice(2));
  const cmd = args._[0];
  if (!cmd || !COMMANDS.includes(cmd)) usage();

  const db = await ensureMongo();
  setBackupDb(db); // push needs the backup snapshot readers
  await ensureApiKeyIndexes(db);

  if (cmd === "create") {
    const webhook = args["webhook-url"]
      ? { url: args["webhook-url"], secret: args["webhook-secret"] || null, format: args["webhook-format"] || "json" }
      : null;
    const { key, client } = await createApiKey({
      name: args.name,
      organization: args.org || null,
      contactEmail: args.email || null,
      scopes: args.scopes ? String(args.scopes).split(",").map((s) => s.trim()) : SCOPES,
      rateLimitPerMin: args.rate ? Number(args.rate) : undefined,
      expiresAt: args.expires || null,
      webhook,
      createdBy: "cli",
    });
    console.log("\nAPI key created. Copy it now — it will NOT be shown again.\n");
    console.log(`  Client : ${client.name}${client.organization ? ` (${client.organization})` : ""}`);
    console.log(`  ID     : ${client.id}`);
    console.log(`  Scopes : ${client.scopes.join(", ")}`);
    console.log(`  Rate   : ${client.rateLimitPerMin} requests/minute`);
    console.log(`  Expires: ${fmt(client.expiresAt)}`);
    console.log(printWebhook(client));
    console.log(`\n  KEY    : ${key}\n`);
  } else if (cmd === "list") {
    const clients = await listApiClients();
    if (!clients.length) {
      console.log("No API keys issued yet.");
    } else {
      for (const c of clients) {
        const state = !c.active ? "REVOKED" : c.expiresAt && new Date(c.expiresAt) <= new Date() ? "EXPIRED" : "active";
        console.log(
          `${c.id}  ${c.keyPrefix}…  ${state.padEnd(7)}  ${c.name}${c.organization ? ` (${c.organization})` : ""}` +
            `  scopes=[${c.scopes.join(",")}]  rate=${c.rateLimitPerMin}/min  requests=${c.requestCount}` +
            `  lastUsed=${fmt(c.lastUsedAt)}  expires=${fmt(c.expiresAt)}`,
        );
        console.log(printWebhook(c));
      }
    }
  } else if (cmd === "revoke") {
    const id = args._[1];
    if (!id) usage();
    const client = await revokeApiKey(id);
    if (!client) {
      console.error("Key not found or already revoked.");
      process.exit(1);
    }
    console.log(`Revoked: ${client.name} (${client.keyPrefix}…) at ${fmt(client.revokedAt)}`);
  } else if (cmd === "webhook") {
    const id = args._[1];
    if (!id) usage();
    let client;
    if (args.remove) {
      client = await setWebhook(id, null);
    } else {
      if (!args.url) {
        console.error("--url is required (or --remove)");
        process.exit(1);
      }
      client = await setWebhook(id, {
        url: args.url,
        secret: args.secret || null,
        format: args.format || "json",
        enabled: !args.disable,
      });
    }
    if (!client) {
      console.error("Key not found.");
      process.exit(1);
    }
    console.log(`${client.name} (${client.keyPrefix}…)`);
    console.log(printWebhook(client));
  } else if (cmd === "push") {
    const id = args._[1];
    const results = id ? [await pushToClientNow(id, "manual")] : await runPushCycle("manual");
    if (!results.length) console.log("No clients with an enabled webhook.");
    for (const r of results) {
      console.log(`${r.ok ? "✓" : "✗"} ${r.clientName}  ${r.format}  HTTP ${r.status}  attempts=${r.attempts}  ${r.readings} readings  ${r.durationMs}ms${r.error ? `  ${r.error}` : ""}`);
    }
    if (results.some((r) => !r.ok)) {
      await closeMongo();
      process.exit(2);
    }
  } else if (cmd === "deliveries") {
    const id = args._[1];
    if (!id) usage();
    const rows = await listDeliveries(id, args.limit || 20);
    if (!rows.length) console.log("No deliveries logged.");
    for (const r of rows) {
      console.log(`${fmt(r.at)}  ${r.ok ? "✓" : "✗"}  ${r.reason.padEnd(6)}  ${r.format.padEnd(7)}  HTTP ${String(r.status).padEnd(3)}  attempts=${r.attempts}  ${r.durationMs}ms${r.error ? `  ${r.error}` : ""}`);
    }
  }
  // Let pending fire-and-forget log writes flush, then close cleanly.
  await new Promise((r) => setTimeout(r, 300));
  await closeMongo();
  process.exit(0);
})().catch(async (e) => {
  console.error("[apiKeys] Fatal:", e.message);
  await closeMongo();
  process.exit(1);
});
