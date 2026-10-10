const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const {
  normalizeReference,
  assertPristineBlueprint,
  readDatabaseReference,
  verifyPristineReference,
} = require("../src/import-eligibility.cjs");

const column = (name, type = "text", notNull = true) => ({
  name,
  type,
  notNull,
});
const timestamp = column("updated_at", "timestamp with time zone");
function blueprint() {
  const table = (name, columns, rows) => ({ name, columns, rows });
  return {
    format: "ovoshi-help-pristine-reference",
    schemaVersion: 1,
    appVersion: "0.1.1",
    tables: [
      table(
        "users",
        [
          column("id", "bigint"),
          column("email"),
          column("name"),
          column("phone"),
          column("password_hash"),
          column("active", "boolean"),
          column("deleted_at", "timestamp with time zone", false),
          column("personal_discount_percent", "numeric(5,2)"),
          column("order_invoice_template"),
          timestamp,
        ],
        [
          [
            "1",
            "admin@active.kz",
            "Администратор",
            "+70000000000",
            "never-serialize-this-hash",
            "true",
            null,
            "0.00",
            "",
            "2026-10-09T00:00:00Z",
          ],
        ],
      ),
      table(
        "wallets",
        [
          column("id", "bigint"),
          column("user_id", "bigint"),
          column("balance", "numeric(14,2)"),
          timestamp,
        ],
        [["1", "1", "0.00", "2026-10-09T00:00:00Z"]],
      ),
      table(
        "warehouses",
        [
          column("id", "bigint"),
          column("code"),
          column("name_ru"),
          column("active", "boolean"),
          timestamp,
        ],
        [["1", "MAIN", "Основной склад", "true", "2026-10-09T00:00:00Z"]],
      ),
      table(
        "project_settings",
        [column("key"), column("value"), timestamp],
        [
          ["search.ai.enabled", "true", "2026-10-09T00:00:00Z"],
          ["commerce.wholesale.minQuantity", "10", "2026-10-09T00:00:00Z"],
        ],
      ),
      table(
        "roles",
        [column("id", "bigint"), column("code"), column("name_ru"), timestamp],
        [
          "administrator",
          "seller",
          "senior_seller",
          "accountant",
          "moderator",
          "china_sourcing",
          "dima",
          "installer",
        ].map((code, index) => [
          String(index + 1),
          code,
          code,
          "2026-10-09T00:00:00Z",
        ]),
      ),
      table(
        "permissions",
        [column("id", "bigint"), column("code"), timestamp],
        [["1", "data.export", "2026-10-09T00:00:00Z"]],
      ),
      table(
        "role_permissions",
        [column("role_id", "bigint"), column("permission_id", "bigint")],
        [["1", "1"]],
      ),
      table(
        "user_roles",
        [column("user_id", "bigint"), column("role_id", "bigint")],
        [["1", "1"]],
      ),
      table(
        "user_permissions",
        [column("user_id", "bigint"), column("permission_id", "bigint")],
        [],
      ),
      table(
        "products",
        [column("id", "bigint"), column("price", "numeric(38,8)")],
        [],
      ),
      table(
        "stock_documents",
        [
          column("id", "uuid"),
          column("effective_at", "timestamp with time zone"),
        ],
        [],
      ),
    ],
  };
}
const findTable = (reference, name) =>
  reference.tables.find((table) => table.name === name);
function database(reference, { credentials = false, sessions = true } = {}) {
  const tables = structuredClone(reference.tables);
  if (sessions)
    tables.push({
      name: "auth_sessions",
      columns: [],
      rows: [["old-browser-token-hash"]],
    });
  return {
    query: async (sql, args) => {
      if (sql.includes("SELECT EXISTS"))
        return { rows: [{ present: credentials }] };
      if (sql.includes("pg_catalog.pg_attribute"))
        return { rows: findTable({ tables }, args[0]).columns };
      if (sql.includes("pg_catalog.pg_class"))
        return { rows: tables.map((table) => ({ name: table.name })) };
      const name = /FROM public\."([^"]+)"/.exec(sql)?.[1];
      const table = findTable({ tables }, name);
      assert.ok(table, `Unexpected query: ${sql}`);
      assert.ok(
        table.columns.every((column) => sql.includes(`"${column.name}"::text`)),
        "all values cast to text",
      );
      return {
        rows: table.rows.map((row) =>
          Object.fromEntries(
            table.columns.map((column, index) => [column.name, row[index]]),
          ),
        ),
      };
    },
  };
}
async function temporary(testContext) {
  const root = await fs.mkdtemp(
    path.join(os.tmpdir(), "ovoshi-eligibility-test-"),
  );
  testContext.after(() => fs.rm(root, { recursive: true, force: true }));
  const referencePath = path.join(root, "reference.json");
  const filesDir = path.join(root, "files");
  await fs.mkdir(filesDir);
  await fs.writeFile(
    referencePath,
    JSON.stringify(normalizeReference(blueprint())),
  );
  return { root, referencePath, filesDir };
}

test("blueprint omits bootstrap credentials and generated timestamp values", () => {
  const reference = assertPristineBlueprint(blueprint());
  const serialized = JSON.stringify(reference);
  assert.equal(serialized.includes("never-serialize-this-hash"), false);
  assert.equal(serialized.includes("+70000000000"), false);
  assert.equal(serialized.includes("2026-10-09"), false);
});

test("pristine legacy database with login sessions, changed bootstrap credentials and timestamps qualifies", async (t) => {
  const { referencePath, filesDir } = await temporary(t);
  const current = blueprint();
  const user = findTable(current, "users").rows[0];
  user[3] = "+79999999999";
  user[4] = "another-generated-salt";
  user[9] = "2030-01-01T12:00:00Z";
  for (const table of current.tables) table.rows.reverse();
  assert.deepEqual(
    await verifyPristineReference(database(current), referencePath, filesDir),
    { eligible: true },
  );
});

for (const [name, modify] of [
  [
    "modified setting",
    (r) => (findTable(r, "project_settings").rows[0][1] = "false"),
  ],
  [
    "extra setting",
    (r) =>
      findTable(r, "project_settings").rows.push([
        "priceImport.excludedNameTerms",
        "",
        "2030-01-01",
      ]),
  ],
  [
    "extra user",
    (r) => findTable(r, "users").rows.push([...findTable(r, "users").rows[0]]),
  ],
  ["wallet balance", (r) => (findTable(r, "wallets").rows[0][2] = "0.01")],
  [
    "renamed role",
    (r) => (findTable(r, "roles").rows[0][2] = "Changed administrator"),
  ],
  [
    "changed role grant",
    (r) => (findTable(r, "role_permissions").rows[0][0] = "2"),
  ],
  [
    "new user permission",
    (r) => findTable(r, "user_permissions").rows.push(["1", "1"]),
  ],
  ["changed user name", (r) => (findTable(r, "users").rows[0][2] = "My shop")],
  ["personal discount", (r) => (findTable(r, "users").rows[0][7] = "5.00")],
  [
    "custom invoice template",
    (r) => (findTable(r, "users").rows[0][8] = "Custom template"),
  ],
  [
    "renamed warehouse",
    (r) => (findTable(r, "warehouses").rows[0][2] = "Local warehouse"),
  ],
  [
    "business record",
    (r) =>
      findTable(r, "products").rows.push([
        "9007199254740993",
        "123456789012345678901234567890.12345678",
      ]),
  ],
  [
    "unknown table",
    (r) =>
      r.tables.push({
        name: "new_business_table",
        columns: [column("id")],
        rows: [],
      }),
  ],
  [
    "changed schema",
    (r) => (findTable(r, "products").columns[1].type = "numeric(14,2)"),
  ],
]) {
  test(`refuses ${name} without adopting a new baseline`, async (t) => {
    const { referencePath, filesDir } = await temporary(t);
    const current = blueprint();
    modify(current);
    assert.equal(
      (
        await verifyPristineReference(
          database(current),
          referencePath,
          filesDir,
        )
      ).eligible,
      false,
    );
  });
}

test("business timestamps and large numbers are preserved by normalization", () => {
  const reference = blueprint();
  findTable(reference, "stock_documents").rows.push([
    "uuid",
    "2026-10-09T00:00:00Z",
  ]);
  findTable(reference, "products").rows.push([
    "9007199254740993",
    "123456789012345678901234567890.12345678",
  ]);
  const normalized = normalizeReference(reference);
  assert.deepEqual(findTable(normalized, "stock_documents").rows, [
    ["uuid", "2026-10-09T00:00:00Z"],
  ]);
  assert.deepEqual(findTable(normalized, "products").rows, [
    ["9007199254740993", "123456789012345678901234567890.12345678"],
  ]);
  assert.throws(() => assertPristineBlueprint(reference), /Business data/);
});

test("refuses a reference missing from the package", async (t) => {
  const { root, filesDir } = await temporary(t);
  assert.equal(
    (
      await verifyPristineReference(
        database(blueprint()),
        path.join(root, "missing.json"),
        filesDir,
      )
    ).eligible,
    false,
  );
});

test("refuses any local stored asset or local API credential", async (t) => {
  const { referencePath, filesDir } = await temporary(t);
  assert.equal(
    (
      await verifyPristineReference(
        database(blueprint(), { credentials: true }),
        referencePath,
        filesDir,
      )
    ).eligible,
    false,
  );
  await fs.writeFile(path.join(filesDir, "existing.object"), "localdata");
  assert.equal(
    (
      await verifyPristineReference(
        database(blueprint()),
        referencePath,
        filesDir,
      )
    ).eligible,
    false,
  );
});

test("rejects symlinked storage directory and missing directory argument", async (t) => {
  const { root, referencePath, filesDir } = await temporary(t);
  const linked = path.join(root, "linked-files");
  await fs.symlink(filesDir, linked, "dir");
  assert.equal(
    (
      await verifyPristineReference(
        database(blueprint()),
        referencePath,
        linked,
      )
    ).eligible,
    false,
  );
  assert.equal(
    (await verifyPristineReference(database(blueprint()), referencePath))
      .eligible,
    false,
  );
});

test("database inspection excludes sessions and preserves schema and strings", async () => {
  const reference = await readDatabaseReference(database(blueprint()), {
    appVersion: "0.1.1",
  });
  assert.equal(
    reference.tables.some((table) => table.name === "auth_sessions"),
    false,
  );
  assert.deepEqual(reference, normalizeReference(blueprint()));
});
