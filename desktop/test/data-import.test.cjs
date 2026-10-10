const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const os = require("node:os");
const { createHash } = require("node:crypto");
const {
  validateSourceUrl,
  validateManifest,
  stageArchive,
  downloadSource,
  rowsFromFile,
  compatibleSchema,
  restoreDatabase,
  createDataImporter,
  LIMITS,
} = require("../src/data-import.cjs");
const hash = (b) => createHash("sha256").update(b).digest("hex");
async function temporary(fn) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "ovoshi-import-test-"));
  try {
    return await fn(dir);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}
function crc32(bytes) {
  let crc = 0xffffffff;
  for (const b of bytes) {
    crc ^= b;
    for (let bit = 0; bit < 8; bit++)
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function zip(files) {
  const parts = [],
    central = [];
  let offset = 0;
  for (const item of files) {
    const name = Buffer.from(item.name),
      data = Buffer.from(item.data),
      local = Buffer.alloc(30),
      entry = Buffer.alloc(46),
      crc = crc32(data);
    local.writeUInt32LE(0x04034b50);
    local.writeUInt16LE(20, 4);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(name.length, 26);
    entry.writeUInt32LE(0x02014b50);
    entry.writeUInt16LE(0x0314, 4);
    entry.writeUInt16LE(20, 6);
    entry.writeUInt32LE(crc, 16);
    entry.writeUInt32LE(data.length, 20);
    entry.writeUInt32LE(data.length, 24);
    entry.writeUInt16LE(name.length, 28);
    entry.writeUInt32LE(item.attributes || 0, 38);
    entry.writeUInt32LE(offset, 42);
    parts.push(local, name, data);
    central.push(entry, name);
    offset += local.length + name.length + data.length;
  }
  const c = Buffer.concat(central),
    end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(c.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...parts, c, end]);
}
function fixture() {
  const rows = Buffer.from('["9007199254740993","record"]\n'),
    key = "uploads/photo.png",
    mime = Buffer.from("image/png"),
    object = Buffer.concat([
      Buffer.from("OVO1"),
      Buffer.from([0, mime.length]),
      mime,
      Buffer.from("PNG"),
    ]);
  const manifest = {
    format: "ovoshi-help-data-transfer",
    formatVersion: 1,
    createdAt: new Date().toISOString(),
    schemaVersion: "134",
    tables: [
      {
        name: "items",
        entry: "tables/0.jsonl",
        columns: [
          { name: "id", type: "bigint" },
          { name: "name", type: "text" },
        ],
        rowCount: 1,
        size: rows.length,
        sha256: hash(rows),
      },
    ],
    files: [
      {
        key,
        entry: `files/${hash(key)}.object`,
        size: object.length,
        sha256: hash(object),
      },
    ],
    sequences: [],
  };
  return {
    manifest,
    rows,
    object,
    files: [
      { name: "manifest.json", data: JSON.stringify(manifest) },
      { name: "tables/0.jsonl", data: rows },
      { name: manifest.files[0].entry, data: object },
    ],
  };
}
function metadata() {
  return {
    schemaVersion: "134",
    tables: [
      {
        name: "items",
        columns: [
          {
            name: "id",
            type: "bigint",
            required: true,
            generated: "",
            identity: "",
            default_value: null,
          },
          {
            name: "name",
            type: "text",
            required: false,
            generated: "",
            identity: "",
            default_value: null,
          },
        ],
      },
    ],
    constraints: [],
    sequences: [],
  };
}

test("source URL restricts plaintext credentials to explicit private/loopback addresses", () => {
  for (const value of [
    "http://localhost:8084",
    "http://127.0.0.1:8084",
    "http://[::1]:8084",
    "http://10.2.3.4",
    "http://172.16.0.1",
    "http://192.168.0.101",
    "https://example.org",
  ])
    assert.ok(validateSourceUrl(value));
  for (const value of [
    "http://example.org",
    "http://8.8.8.8",
    "http://172.32.0.1",
    "https://user:password@example.org",
    "https://example.org?token=secret",
    "https://example.org/#fragment",
    "file:///tmp/data",
  ])
    assert.throws(() => validateSourceUrl(value));
});
test("safe archive stages tables and complete native objects and preserves bigint text", async () =>
  temporary(async (dir) => {
    const data = fixture(),
      archive = path.join(dir, "source.zip");
    await fs.writeFile(archive, zip(data.files));
    const staged = await stageArchive(archive, dir);
    const rows = [];
    for await (const row of rowsFromFile(
      staged.staged.get("tables/0.jsonl"),
      2,
      1,
      LIMITS,
    ))
      rows.push(row);
    assert.equal(rows[0][0], "9007199254740993");
    assert.deepEqual(
      await fs.readFile(staged.staged.get(data.manifest.files[0].entry)),
      data.object,
    );
  }));
for (const [label, mutate] of [
  ["traversal", (f) => f.files.push({ name: "../outside", data: "bad" })],
  ["duplicate entries", (f) => f.files.push(f.files[1])],
  ["undeclared file", (f) => f.files.push({ name: "other.txt", data: "bad" })],
  [
    "symlink",
    (f) => {
      f.files[1].attributes = 0xa1ff0000;
    },
  ],
  [
    "checksum mismatch",
    (f) => {
      f.files[1].data = Buffer.from("x".repeat(f.rows.length));
    },
  ],
  [
    "bad native object header",
    (f) => {
      f.object[0] = 0;
      f.manifest.files[0].sha256 = hash(f.object);
      f.files[0].data = JSON.stringify(f.manifest);
    },
  ],
])
  test(`archive rejects ${label}`, async () =>
    temporary(async (dir) => {
      const data = fixture();
      mutate(data);
      await fs.writeFile(path.join(dir, "bad.zip"), zip(data.files));
      await assert.rejects(stageArchive(path.join(dir, "bad.zip"), dir));
      assert.equal(
        await fs.access(path.join(dir, "../outside")).then(
          () => true,
          () => false,
        ),
        false,
      );
    }));
test("archive declared size and expansion bounds are enforced before extraction", () => {
  const f = fixture(),
    entries = new Map(
      f.files.map((x) => [
        x.name,
        { uncompressedSize: Buffer.byteLength(x.data) },
      ]),
    );
  assert.throws(() =>
    validateManifest(f.manifest, entries, { ...LIMITS, maxExpanded: 1 }),
  );
  f.manifest.tables[0].size++;
  assert.throws(() => validateManifest(f.manifest, entries));
});
test("manifest refuses protectedtables and executable source SQL type spoofing", () => {
  const f = fixture(),
    entries = new Map(
      f.files.map((x) => [
        x.name,
        { uncompressedSize: Buffer.byteLength(x.data) },
      ]),
    );
  f.manifest.tables[0].name = "auth_sessions";
  assert.throws(() => validateManifest(f.manifest, entries));
  f.manifest.tables[0].name = "items";
  f.manifest.tables[0].columns[0].type = "bigint); DROP TABLE users;--";
  assert.throws(() => compatibleSchema(f.manifest, metadata()));
});
test("newer schema, unknown columns and missing required columns are refused", () => {
  const f = fixture();
  f.manifest.schemaVersion = "135";
  assert.throws(() => compatibleSchema(f.manifest, metadata()));
  f.manifest.schemaVersion = "134";
  f.manifest.tables[0].columns[0].name = "unknown";
  assert.throws(() => compatibleSchema(f.manifest, metadata()));
  f.manifest.tables[0].columns.shift();
  assert.throws(() => compatibleSchema(f.manifest, metadata()));
});
test("JSONL rejects numeric scalar corruption, row counts, invalid UTF8, long rows", async () =>
  temporary(async (dir) => {
    const p = path.join(dir, "rows");
    for (const b of [
      Buffer.from('[9007199254740993,"name"]\n'),
      Buffer.from('["1"]\n'),
      Buffer.from('["1","a"]\n["2","b"]\n'),
      Buffer.from([0xff]),
    ]) {
      await fs.writeFile(p, b);
      await assert.rejects(async () => {
        for await (const row of rowsFromFile(p, 2, 1, LIMITS)) {
        }
      });
    }
    await fs.writeFile(p, '["1","long"]\n');
    await assert.rejects(async () => {
      for await (const row of rowsFromFile(p, 2, 1, { ...LIMITS, maxRow: 2 })) {
      }
    });
  }));
test("downloader never follows export redirects and revokes its created session", async () =>
  temporary(async (dir) => {
    const calls = [],
      secret = "source-password";
    const fetchImpl = async (u, o) => {
      calls.push({ u, o });
      if (u.endsWith("/login"))
        return new Response(
          JSON.stringify({ success: true, data: { token: "session-token" } }),
        );
      if (u.endsWith("/export"))
        return new Response("", {
          status: 302,
          headers: { location: "https://attacker.invalid" },
        });
      return new Response("{}");
    };
    await assert.rejects(
      downloadSource({
        url: "https://source.invalid",
        phone: "+70000000000",
        password: secret,
        destination: path.join(dir, "copy.zip"),
        fetchImpl,
      }),
      (e) =>
        !e.message.includes(secret) && !e.message.includes("session-token"),
    );
    assert.equal(calls.length, 3);
    assert.ok(calls.every((c) => c.u.startsWith("https://source.invalid/")));
    assert.ok(calls.every((c) => c.o.redirect === "manual"));
    assert.ok(calls[2].u.endsWith("/logout"));
  }));
test("oversized transfer still revokes session and never creates archive", async () =>
  temporary(async (dir) => {
    const calls = [];
    const fetchImpl = async (u, o) => {
      calls.push(u);
      return u.endsWith("/login")
        ? new Response(
            JSON.stringify({ success: true, data: { token: "token" } }),
          )
        : u.endsWith("/export")
          ? new Response("zip", { headers: { "content-length": "100" } })
          : new Response("{}");
    };
    await assert.rejects(
      downloadSource({
        url: "http://127.0.0.1",
        phone: "phone",
        password: "password",
        destination: path.join(dir, "copy.zip"),
        fetchImpl,
        limits: { ...LIMITS, maxArchive: 4 },
      }),
    );
    assert.ok(calls.at(-1).endsWith("/logout"));
    assert.equal(
      await fs.access(path.join(dir, "copy.zip")).then(
        () => true,
        () => false,
      ),
      false,
    );
  }));
test("restore binds numeric strings and validates deferred FK rows before commit", async () =>
  temporary(async (dir) => {
    const f = fixture(),
      p = path.join(dir, "table");
    await fs.writeFile(p, f.rows);
    const queries = [],
      m = metadata();
    m.constraints = [
      {
        table_name: "items",
        name: "items_parent_fk",
        deferrable: false,
        deferred: false,
      },
    ];
    const client = {
      query: async (q, v) => {
        queries.push([q, v]);
        return { rows: [] };
      },
    };
    await restoreDatabase(
      client,
      { manifest: f.manifest, staged: new Map([["tables/0.jsonl", p]]) },
      m,
    );
    assert.deepEqual(queries.find(([q]) => q.startsWith("INSERT"))[1], [
      "9007199254740993",
      "record",
    ]);
    assert.ok(queries.find(([q]) => q === "SET CONSTRAINTS ALL IMMEDIATE"));
    assert.ok(queries.find(([q]) => q.includes("NOT DEFERRABLE")));
    assert.equal(queries.at(-1)[0], "COMMIT");
  }));
test("orphan FK rejection rolls transaction back instead of accepting source rows", async () =>
  temporary(async (dir) => {
    const f = fixture(),
      p = path.join(dir, "table");
    await fs.writeFile(p, f.rows);
    const queries = [],
      client = {
        query: async (q) => {
          queries.push(q);
          if (q === "SET CONSTRAINTS ALL IMMEDIATE") throw Error("orphan");
          return { rows: [] };
        },
      };
    await assert.rejects(
      restoreDatabase(
        client,
        { manifest: f.manifest, staged: new Map([["tables/0.jsonl", p]]) },
        metadata(),
      ),
      /orphan/,
    );
    assert.equal(queries.at(-1), "ROLLBACK");
    assert.equal(queries.includes("COMMIT"), false);
  }));
test("nonpristine baseline refuses before network/source credentials or local mutation", async () =>
  temporary(async (dir) => {
    const data = path.join(dir, "data");
    await fs.mkdir(data);
    await fs.writeFile(
      path.join(data, "data-import-baseline.json"),
      JSON.stringify({ formatVersion: 1, pristine: false }),
    );
    let calls = 0;
    const runtime = { root: dir, userData: dir, dataDir: data, started: true };
    const importer = createDataImporter({
      runtime,
      version: "0.1.1",
      fetchImpl: async () => {
        calls++;
      },
    });
    assert.equal((await importer.inspectEligibility()).eligible, false);
    await assert.rejects(
      importer.importFromSource({
        url: "https://source.invalid",
        phone: "phone",
        password: "password",
      }),
      /новую/,
    );
    assert.equal(calls, 0);
  }));
test("pending journal cannot restore an arbitrary external directory", async () =>
  temporary(async (dir) => {
    await fs.writeFile(
      path.join(dir, "data-import-pending.json"),
      JSON.stringify({ schemaVersion: 1, backup: "/outside" }),
    );
    let called = false;
    const runtime = {
      root: dir,
      userData: dir,
      dataDir: path.join(dir, "data"),
      backupsDir: path.join(dir, "backups"),
      restoreBackup: async () => {
        called = true;
      },
    };
    await assert.rejects(
      createDataImporter({ runtime, version: "1" }).recoverPendingImport(),
      /безопасная/,
    );
    assert.equal(called, false);
  }));

test("older schema cannot omit business tables, equal schema cannot omit optional columns and counters", () => {
  const f = fixture(),
    m = metadata();
  m.tables.push({ name: "other", columns: [] });
  f.manifest.schemaVersion = "133";
  assert.throws(() => compatibleSchema(f.manifest, m), /неполный/);
  f.manifest.schemaVersion = "134";
  m.tables.pop();
  f.manifest.tables[0].columns.pop();
  assert.throws(() => compatibleSchema(f.manifest, m), /столбцы/);
  f.manifest.tables[0].columns.push({ name: "name", type: "text" });
  m.sequences = [{ name: "product_sku_seq" }];
  assert.throws(() => compatibleSchema(f.manifest, m), /счётчики/);
});
test("declared SQL file references must have included object payloads", async () =>
  temporary(async (dir) => {
    const { validateRowsAndFiles } = require("../src/data-import.cjs");
    const p = path.join(dir, "table"),
      columns = [
        { name: "image_file_path", type: "text" },
        { name: "image_content_hash", type: "text" },
      ];
    await fs.writeFile(
      p,
      JSON.stringify(["/uploads/missing.png", null]) + "\n",
    );
    await assert.rejects(
      validateRowsAndFiles({
        manifest: {
          tables: [
            {
              name: "categories",
              entry: "tables/0.jsonl",
              columns,
              rowCount: 1,
            },
          ],
          files: [],
        },
        staged: new Map([["tables/0.jsonl", p]]),
      }),
      /отсутствует файл/,
    );
  }));
test("import account must remain active and existing in the copied snapshot", async () =>
  temporary(async (dir) => {
    const { validateRowsAndFiles } = require("../src/data-import.cjs");
    const p = path.join(dir, "table"),
      columns = ["phone", "active", "deleted_at", "password_hash"].map(
        (name) => ({ name, type: "text" }),
      );
    await fs.writeFile(
      p,
      JSON.stringify(["+70000000000", "f", null, "hash"]) + "\n",
    );
    await assert.rejects(
      validateRowsAndFiles(
        {
          manifest: {
            tables: [
              { name: "users", entry: "tables/0.jsonl", columns, rowCount: 1 },
            ],
            files: [],
          },
          staged: new Map([["tables/0.jsonl", p]]),
        },
        "+70000000000",
      ),
      /активную/,
    );
  }));

function fakeDatabaseRuntime(dir) {
  const dataDir = path.join(dir, "data"),
    database = path.join(dataDir, "fake-database.json");
  const columns = {
    items: ["id", "name"],
    users: ["id", "phone", "active", "deleted_at", "password_hash"],
  };
  let rollback;
  const clientFactory = () => ({
    connect: async () => {},
    end: async () => {},
    query: async (q, values) => {
      const data = JSON.parse(await fs.readFile(database, "utf8"));
      if (
        q.includes("c.relname AS name FROM pg_class") &&
        q.includes("relkind IN")
      )
        return {
          rows: Object.keys(columns)
            .sort()
            .map((name) => ({ name })),
        };
      if (q.includes("format_type(a.atttypid"))
        return {
          rows: Object.entries(columns).flatMap(([table_name, names]) =>
            names.map((name) => ({
              table_name,
              name,
              type: name === "id" ? "bigint" : "text",
              required: false,
              generated: "",
              identity: "",
              default_value: null,
            })),
          ),
        };
      if (q.includes("pg_constraint")) return { rows: [] };
      if (q.includes("c.relkind='S'")) return { rows: [] };
      if (q.includes("SELECT version FROM"))
        return { rows: [{ version: "134" }] };
      if (q.startsWith("SELECT count")) {
        const table = q.match(/"public"\."(\w+)"/)[1];
        return { rows: [{ count: String(data[table].length) }] };
      }
      if (q.startsWith("DECLARE import_fingerprint")) {
        const table = q.match(/FROM "public"\."(\w+)"/)[1];
        clientFactory.cursor = data[table].map((row) => ({
          value: JSON.stringify(row),
        }));
        return { rows: [] };
      }
      if (q.startsWith("FETCH")) {
        const rows = clientFactory.cursor || [];
        clientFactory.cursor = [];
        return { rows };
      }
      if (q === "BEGIN") rollback = data;
      if (q.startsWith("TRUNCATE")) {
        for (const name of Object.keys(data)) data[name] = [];
        await fs.writeFile(database, JSON.stringify(data));
      }
      if (q.startsWith("INSERT")) {
        const name = q.match(/"public"\."(\w+)"/)[1],
          length = columns[name].length;
        for (let i = 0; i < values.length; i += length)
          data[name].push(values.slice(i, i + length));
        await fs.writeFile(database, JSON.stringify(data));
      }
      if (q === "ROLLBACK" && rollback)
        await fs.writeFile(database, JSON.stringify(rollback));
      return { rows: [] };
    },
  });
  const runtime = {
    root: dir,
    userData: dir,
    dataDir,
    backupsDir: path.join(dir, "backups"),
    config: {},
    started: true,
    pauseBackend: async () => {
      runtime.started = false;
    },
    stop: async () => {
      runtime.started = false;
    },
    resumeDatabase: async () => {},
    backup: async () => {
      await runtime.stop();
      const destination = path.join(runtime.backupsDir, "before-import");
      await fs.mkdir(destination, { recursive: true });
      await fs.cp(dataDir, path.join(destination, "data"), { recursive: true });
      return destination;
    },
    restoreBackup: async (source) => {
      await fs.rm(dataDir, { recursive: true, force: true });
      await fs.cp(path.join(source, "data"), dataDir, { recursive: true });
    },
    start: async () => {
      const state = JSON.parse(
        await fs.readFile(path.join(dataDir, "app-state.json"), "utf8"),
      );
      if (runtime.failImportedReady && state.importedData)
        throw Error("injected new backend readiness failure");
      runtime.started = true;
      return "http://127.0.0.1:1";
    },
  };
  return { runtime, clientFactory, database, columns };
}
async function setupFakeImport(dir) {
  const fake = fakeDatabaseRuntime(dir);
  await fs.mkdir(path.join(fake.runtime.dataDir, "files"), { recursive: true });
  await fs.writeFile(
    fake.database,
    JSON.stringify({
      items: [],
      users: [["1", "+70000000001", "t", null, "bootstrap-hash"]],
    }),
  );
  await fs.writeFile(
    path.join(fake.runtime.dataDir, "app-state.json"),
    JSON.stringify({ setupCompleted: true, version: "0.1.1" }),
  );
  const f = fixture(),
    userRows = Buffer.from(
      JSON.stringify(["5", "+70000000000", "t", null, "source-hash"]) + "\n",
    );
  f.manifest.tables.push({
    name: "users",
    entry: "tables/1.jsonl",
    columns: fake.columns.users.map((name) => ({
      name,
      type: name === "id" ? "bigint" : "text",
    })),
    rowCount: 1,
    size: userRows.length,
    sha256: hash(userRows),
  });
  f.files.push({ name: "tables/1.jsonl", data: userRows });
  f.files[0].data = JSON.stringify(f.manifest);
  const bytes = zip(f.files),
    calls = [];
  const fetchImpl = async (u, o) => {
    calls.push(u);
    return u.endsWith("/login")
      ? new Response(
          JSON.stringify({
            success: true,
            data: { token: "private-session", user: { phone: "+70000000000" } },
          }),
        )
      : u.endsWith("/export")
        ? new Response(bytes)
        : new Response("{}");
  };
  const importer = createDataImporter({
    runtime: fake.runtime,
    version: "0.1.1",
    clientFactory: fake.clientFactory,
    fetchImpl,
  });
  await importer.captureBaseline({ trustedFreshSetup: true });
  return { ...fake, importer, calls };
}
test("complete import marks copied accounts, preserves bigint and rejects replacing imported data again", async () =>
  temporary(async (dir) => {
    const f = await setupFakeImport(dir);
    assert.equal((await f.importer.inspectEligibility()).eligible, true);
    await f.importer.importFromSource({
      url: "https://source.invalid",
      phone: "+70000000000",
      password: "password",
    });
    const data = JSON.parse(await fs.readFile(f.database, "utf8")),
      state = JSON.parse(
        await fs.readFile(
          path.join(f.runtime.dataDir, "app-state.json"),
          "utf8",
        ),
      );
    assert.equal(data.items[0][0], "9007199254740993");
    assert.equal(data.users[0][1], "+70000000000");
    assert.equal(state.importedData, true);
    assert.equal((await f.importer.inspectEligibility()).eligible, false);
    assert.equal(
      await fs.access(path.join(dir, "data-import-pending.json")).then(
        () => true,
        () => false,
      ),
      false,
    );
    assert.ok(f.calls.at(-1).endsWith("/logout"));
  }));
test("new backend readiness failure restores full original data, files and eligibility", async () =>
  temporary(async (dir) => {
    const f = await setupFakeImport(dir),
      before = await fs.readFile(f.database);
    f.runtime.failImportedReady = true;
    await assert.rejects(
      f.importer.importFromSource({
        url: "https://source.invalid",
        phone: "+70000000000",
        password: "password",
      }),
      /восстановлены/,
    );
    assert.deepEqual(await fs.readFile(f.database), before);
    assert.equal(
      JSON.parse(
        await fs.readFile(
          path.join(f.runtime.dataDir, "app-state.json"),
          "utf8",
        ),
      ).importedData,
      undefined,
    );
    assert.equal(
      (await fs.readdir(path.join(f.runtime.dataDir, "files"))).length,
      0,
    );
    assert.equal((await f.importer.inspectEligibility()).eligible, true);
    assert.equal(f.runtime.started, true);
    assert.equal(
      await fs.access(path.join(dir, "data-import-pending.json")).then(
        () => true,
        () => false,
      ),
      false,
    );
  }));
test("changed local table counts refuse download and cannot overwrite an existing baseline", async () =>
  temporary(async (dir) => {
    const f = await setupFakeImport(dir),
      before = await fs.readFile(
        path.join(f.runtime.dataDir, "data-import-baseline.json"),
      ),
      data = JSON.parse(await fs.readFile(f.database, "utf8"));
    data.items.push(["1", "local business data"]);
    await fs.writeFile(f.database, JSON.stringify(data));
    await f.importer.captureBaseline({ trustedFreshSetup: true });
    assert.deepEqual(
      await fs.readFile(
        path.join(f.runtime.dataDir, "data-import-baseline.json"),
      ),
      before,
    );
    await assert.rejects(
      f.importer.importFromSource({
        url: "https://source.invalid",
        phone: "+70000000000",
        password: "password",
      }),
      /изменены/,
    );
    assert.equal(f.calls.length, 0);
  }));
test("pending import recovery repairs interrupted restore and restores snapshot before clearing journal", async () =>
  temporary(async (dir) => {
    const f = await setupFakeImport(dir),
      before = await fs.readFile(f.database),
      backup = await f.runtime.backup();
    const previous = path.join(dir, "restore-previous");
    await fs.rename(f.runtime.dataDir, previous);
    const workspace = path.join(dir, "data-transfer-crash");
    await fs.mkdir(workspace);
    await fs.writeFile(
      path.join(dir, "data-import-pending.json"),
      JSON.stringify({ schemaVersion: 1, backup, workspace }),
    );
    const calls = [];
    f.runtime.recoverInterruptedRestore = async () => {
      calls.push("recover-directory");
      await fs.rename(previous, f.runtime.dataDir);
    };
    f.runtime.loadManifest = async () => {
      calls.push("manifest");
    };
    f.runtime.ensureDatabaseStopped = async () => {
      calls.push("stop-database");
    };
    assert.equal(await f.importer.recoverPendingImport(), true);
    assert.deepEqual(calls, ["recover-directory", "manifest", "stop-database"]);
    assert.deepEqual(await fs.readFile(f.database), before);
    assert.equal(
      await fs.access(workspace).then(
        () => true,
        () => false,
      ),
      false,
    );
    assert.equal(
      await fs.access(path.join(dir, "data-import-pending.json")).then(
        () => true,
        () => false,
      ),
      false,
    );
  }));
test("controlled user-facing failures never expose arbitrary PG/IO diagnostic messages", async () => {
  let error;
  try {
    validateSourceUrl("https://user:secret@example.invalid");
  } catch (e) {
    error = e;
  }
  assert.equal(typeof error.userMessage, "string");
  assert.equal(error.userMessage.includes("secret"), false);
});
test("native object MIME header must be valid Java modified UTF even with correct file checksum", async () =>
  temporary(async (dir) => {
    const f = fixture();
    f.object[6] = 0xf0;
    f.manifest.files[0].sha256 = hash(f.object);
    f.files[0].data = JSON.stringify(f.manifest);
    await fs.writeFile(path.join(dir, "bad.zip"), zip(f.files));
    await assert.rejects(
      stageArchive(path.join(dir, "bad.zip"), dir),
      /метаданные/,
    );
  }));
