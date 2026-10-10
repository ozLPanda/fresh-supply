#!/usr/bin/env node
// Build only from a newly created disposable native runtime. No source URL,
// existing user-data path, database connection string, or credentials are accepted.
const fs = require("node:fs/promises");
const path = require("node:path");
const os = require("node:os");
const { randomBytes } = require("node:crypto");
const { Client } = require("pg");
const { LocalRuntime } = require("../src/runtime.cjs");
const {
  readDatabaseReference,
  assertPristineBlueprint,
} = require("../src/import-eligibility.cjs");

async function main() {
  const root = path.resolve(
    process.argv[2] || path.join(__dirname, "../runtime"),
  );
  const version = process.argv[3] || require("../package.json").version;
  const temporary = await fs.mkdtemp(
    path.join(os.tmpdir(), "ovoshi-import-reference-"),
  );
  const runtime = new LocalRuntime({ root, userData: temporary, version });
  let client;
  let stopped = false;
  try {
    await runtime.start({
      bootstrapPassword: randomBytes(24).toString("base64url"),
      bootstrapPhone: "+70000000000",
    });
    client = new Client({
      host: "127.0.0.1",
      port: runtime.config.postgresPort,
      user: "ovoshi_help",
      database: "ovoshi_help",
      password: runtime.config.databasePassword,
    });
    await client.connect();
    await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    const reference = assertPristineBlueprint(
      await readDatabaseReference(client, { appVersion: version }),
    );
    await client.query("COMMIT");
    await client.end();
    client = null;
    await runtime.stop();
    stopped = true;
    const output = path.join(root, "import-reference.json");
    const staging = output + ".tmp";
    await fs.writeFile(staging, JSON.stringify(reference, null, 2) + "\n", {
      mode: 0o644,
    });
    await fs.rename(staging, output);
    console.log(
      "Generated pristine import reference from an isolated fresh native database.",
    );
  } finally {
    if (client) await client.end().catch(() => {});
    if (!stopped) {
      await runtime.stop();
      stopped = true;
    }
    if (stopped) await fs.rm(temporary, { recursive: true, force: true });
  }
}

if (require.main === module)
  main().catch(() => {
    // Never print generated credentials, source data, or backend/connection errors.
    console.error("Failed to generate the isolated pristine import reference.");
    process.exitCode = 1;
  });

module.exports = { main };
