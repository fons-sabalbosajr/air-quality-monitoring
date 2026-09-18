/**
 * Manage partner API keys for the external API (/api/v1) from the CLI.
 *
 * Usage:
 *   node scripts/apiKeys.js create --name "Partner System" [--org "Org"] [--email a@b.c]
 *                                  [--scopes read:stations,read:latest,read:readings]
 *                                  [--rate 60] [--expires 2027-12-31]
 *   node scripts/apiKeys.js list
 *   node scripts/apiKeys.js revoke <id>
 *
 * The plaintext key is printed ONCE on create — it is never stored.
 */
require("dotenv").config({ path: require("path").join(__dirname, "../.env") });
require("../config/env"); // applies DNS_SERVERS override before Mongo connects

const { ensureMongo } = require("../services/mongo");
const { createApiKey, listApiClients, revokeApiKey, ensureApiKeyIndexes, SCOPES } = require("../services/apiKeys");

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

(async () => {
  const args = parseArgs(process.argv.slice(2));
  const cmd = args._[0];
  if (!cmd || !["create", "list", "revoke"].includes(cmd)) {
    console.log("Usage: node scripts/apiKeys.js <create|list|revoke> [options]");
    console.log(`Valid scopes: ${SCOPES.join(", ")}`);
    process.exit(1);
  }

  const db = await ensureMongo();
  await ensureApiKeyIndexes(db);

  if (cmd === "create") {
    const { key, client } = await createApiKey({
      name: args.name,
      organization: args.org || null,
      contactEmail: args.email || null,
      scopes: args.scopes ? String(args.scopes).split(",").map((s) => s.trim()) : SCOPES,
      rateLimitPerMin: args.rate ? Number(args.rate) : undefined,
      expiresAt: args.expires || null,
      createdBy: "cli",
    });
    console.log("\nAPI key created. Copy it now — it will NOT be shown again.\n");
    console.log(`  Client : ${client.name}${client.organization ? ` (${client.organization})` : ""}`);
    console.log(`  ID     : ${client.id}`);
    console.log(`  Scopes : ${client.scopes.join(", ")}`);
    console.log(`  Rate   : ${client.rateLimitPerMin} requests/minute`);
    console.log(`  Expires: ${fmt(client.expiresAt)}`);
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
      }
    }
  } else if (cmd === "revoke") {
    const id = args._[1];
    if (!id) {
      console.error("Usage: node scripts/apiKeys.js revoke <id>");
      process.exit(1);
    }
    const client = await revokeApiKey(id);
    if (!client) {
      console.error("Key not found or already revoked.");
      process.exit(1);
    }
    console.log(`Revoked: ${client.name} (${client.keyPrefix}…) at ${fmt(client.revokedAt)}`);
  }
  process.exit(0);
})().catch((e) => {
  console.error("[apiKeys] Fatal:", e.message);
  process.exit(1);
});
