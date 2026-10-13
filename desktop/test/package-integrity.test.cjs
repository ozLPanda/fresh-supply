"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const os = require("node:os");
const { spawnSync } = require("node:child_process");
const {
  buildIntegrity,
  requiredPaths,
  METADATA,
} = require("../scripts/package-integrity.cjs");
const { patch, MARKER } = require("../scripts/prepare-windows-installer.cjs");
const manifest = {
  platform: "win32",
  arch: "x64",
  python: "python/python.exe",
  java: "java/bin/java.exe",
  backend: "backend.jar",
  importer: "price-importer/price_importer.py",
  postgres: {
    initdb: "postgres/bin/initdb.exe",
    pgCtl: "postgres/bin/pg_ctl.exe",
    psql: "postgres/bin/psql.exe",
    pgDump: "postgres/bin/pg_dump.exe",
    pgRestore: "postgres/bin/pg_restore.exe",
  },
};
async function fixture(t) {
  const root = await fs.mkdtemp(
    path.join(os.tmpdir(), "fresh-package-integrity-"),
  );
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  for (const p of requiredPaths(manifest)) {
    await fs.mkdir(path.dirname(path.join(root, p)), { recursive: true });
    await fs.writeFile(path.join(root, p), "MZfixture-" + p);
  }
  await fs.writeFile(
    path.join(root, "resources/runtime/manifest.json"),
    JSON.stringify(manifest),
  );
  await buildIntegrity(root, "0.1.9");
  return root;
}
async function validate(root, version = "0.1.9") {
  const candidates =
    process.platform === "win32"
      ? ["python.exe", path.join(__dirname, "../runtime/python/python.exe")]
      : [path.join(__dirname, "../runtime/python/bin/python3"), "python3"];
  for (const python of candidates) {
    const r = spawnSync(
      python,
      [
        "-I",
        path.join(__dirname, "../installer/verify-install.py"),
        root,
        version,
      ],
      { encoding: "utf8" },
    );
    if (r.error?.code === "ENOENT") continue;
    if (r.stdout?.includes("file_digest")) continue;
    return r;
  }
  throw Error(
    "Python 3.11 or later is required for staged installer validation tests",
  );
}
async function edit(root, callback) {
  const file = path.join(root, METADATA),
    m = JSON.parse(await fs.readFile(file));
  callback(m);
  await fs.writeFile(file, JSON.stringify(m));
}
test("installed-payload manifest verifies all required native application files", async (t) => {
  const root = await fixture(t),
    r = await validate(root);
  assert.equal(r.status, 0, r.stdout || r.stderr);
  assert.equal(
    JSON.parse(await fs.readFile(path.join(root, METADATA))).files.some(
      (f) => f.path === METADATA,
    ),
    false,
  );
});
test("staging refuses missing Python before replacing an existing application", async (t) => {
  const root = await fixture(t);
  await fs.rm(path.join(root, "resources/runtime/python/python.exe"));
  const r = await validate(root);
  assert.notEqual(r.status, 0);
  assert.match(r.stdout, /Missing installed file/);
});
test("staging refuses same-size damaged application files", async (t) => {
  const root = await fixture(t),
    file = path.join(root, "fresh-supply.exe"),
    body = await fs.readFile(file);
  body[0] ^= 1;
  await fs.writeFile(file, body);
  const r = await validate(root);
  assert.notEqual(r.status, 0);
  assert.match(r.stdout, /Damaged installed file/);
});
test("staging refuses wrong version and unlisted critical components", async (t) => {
  const root = await fixture(t);
  assert.notEqual((await validate(root, "0.1.8")).status, 0);
  await edit(
    root,
    (m) =>
      (m.files = m.files.filter(
        (f) => f.path !== "resources/runtime/python/python.exe",
      )),
  );
  assert.match((await validate(root)).stdout, /Missing critical package files/);
});
test("staging refuses traversal and duplicate Windows paths", async (t) => {
  const root = await fixture(t);
  await edit(root, (m) => m.files.push({ ...m.files[0], path: "../outside" }));
  assert.match((await validate(root)).stdout, /Invalid package file path/);
  await buildIntegrity(root, "0.1.9");
  await edit(root, (m) =>
    m.files.push({ ...m.files[0], path: m.files[0].path.toUpperCase() }),
  );
  assert.match((await validate(root)).stdout, /Duplicate package file path/);
});
test("packaging fails before creating a misleading complete manifest", async (t) => {
  const root = await fixture(t);
  await fs.rm(path.join(root, "resources/runtime/python/python.exe"));
  await assert.rejects(
    buildIntegrity(root, "0.1.9"),
    /Incomplete Windows package/,
  );
  await assert.rejects(fs.stat(path.join(root, METADATA)), { code: "ENOENT" });
});
test("pinned NSIS patch stages before replacement and never invokes old uninstaller", async () => {
  const file = path.join(
    path.dirname(require.resolve("app-builder-lib/package.json")),
    "templates/nsis/installSection.nsh",
  );
  const source = await fs.readFile(file, "utf8"),
    result = patch(source);
  assert.ok(result.startsWith(MARKER));
  assert.equal(patch(result), result);
  assert.ok(
    result.indexOf("freshPrepareInstallation") <
      result.indexOf("freshInstallApplicationFiles"),
  );
  assert.equal(result.includes("!insertmacro uninstallOldVersion"), false);
  assert.equal(
    result.includes("File /oname=uninstallerIcon.ico"),
    false,
    "No old application writes before activation",
  );
  assert.throws(() => patch(result + "\n"), /template changed/);
  assert.throws(() => patch("unexpected builder template"), /template changed/);
});
