"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const os = require("node:os");
const { gzipSync } = require("node:zlib");
const { promisify } = require("node:util");
const { execFile } = require("node:child_process");
const {
  verifyUpdateArtifacts,
} = require("../scripts/verify-update-artifacts.cjs");

const version = require("../package.json").version;
const win = `fresh-supply-${version}-win-x64.exe`;
const mac = `fresh-supply-${version}-mac-arm64.zip`;
const contents = Buffer.from("fixture updater artifact");
const checksum = Buffer.alloc(18, 7).toString("base64");
function map(size = contents.length) {
  return gzipSync(
    JSON.stringify({
      version: "2",
      files: [
        { name: "file", offset: 0, checksums: [checksum], sizes: [size] },
      ],
    }),
  );
}
async function fixture(t) {
  const directory = await fs.mkdtemp(
    path.join(os.tmpdir(), "fresh-update-artifacts-"),
  );
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  return directory;
}
async function artifact(directory, name, blockmap = map()) {
  await fs.writeFile(path.join(directory, name), contents);
  if (blockmap)
    await fs.writeFile(path.join(directory, `${name}.blockmap`), blockmap);
}

test("accepts primary EXE and ZIP maps, ignores aliases, old versions and optional DMG maps", async (t) => {
  const directory = await fixture(t);
  await artifact(directory, win);
  await artifact(directory, mac);
  await artifact(directory, win.replace("fresh-supply", "OvoshiHelp"), null);
  await artifact(directory, "fresh-supply-0.0.1-win-x64.exe", null);
  await artifact(directory, mac.replace(/zip$/, "dmg"), null);
  const result = await verifyUpdateArtifacts({ directory, version });
  assert.deepEqual(
    result.map((entry) => entry.name),
    [mac, win].sort(),
  );
  assert.ok(result.every((entry) => entry.size === contents.length));
});

for (const name of [win, mac]) {
  test(`rejects missing exact blockmap for ${name}`, async (t) => {
    const directory = await fixture(t);
    await artifact(directory, name, null);
    await fs.writeFile(path.join(directory, "unrelated.blockmap"), map());
    await assert.rejects(
      verifyUpdateArtifacts({ directory, version }),
      /Missing automatic-update blockmap/,
    );
  });
}

test("rejects outputs without a current primary automatic-update artifact", async (t) => {
  const directory = await fixture(t);
  await artifact(directory, win.replace("fresh-supply", "OvoshiHelp"));
  await assert.rejects(
    verifyUpdateArtifacts({ directory, version }),
    /No primary/,
  );
});

test("rejects a valid gzip blockmap that does not cover its artifact", async (t) => {
  const directory = await fixture(t);
  await artifact(directory, win, map(contents.length + 1));
  await assert.rejects(
    verifyUpdateArtifacts({ directory, version }),
    /Invalid automatic-update blockmap/,
  );
});

test("rejects malformed gzip and oversized compressed sidecars", async (t) => {
  const directory = await fixture(t);
  await artifact(directory, win, Buffer.from("not gzip"));
  await assert.rejects(
    verifyUpdateArtifacts({ directory, version }),
    /Invalid automatic-update blockmap/,
  );
  await fs.writeFile(
    path.join(directory, `${win}.blockmap`),
    Buffer.alloc(8 * 1024 ** 2 + 1),
  );
  await assert.rejects(
    verifyUpdateArtifacts({ directory, version }),
    /Invalid automatic-update blockmap/,
  );
});

test("rejects a gzip bomb before publication", async (t) => {
  const directory = await fixture(t);
  await artifact(
    directory,
    win,
    gzipSync(Buffer.alloc(32 * 1024 ** 2 + 1, 32)),
  );
  await assert.rejects(
    verifyUpdateArtifacts({ directory, version }),
    /Invalid automatic-update blockmap/,
  );
});

test("rejects directories masquerading as installer or blockmap files", async (t) => {
  const directory = await fixture(t);
  await fs.mkdir(path.join(directory, win));
  await assert.rejects(
    verifyUpdateArtifacts({ directory, version }),
    /Invalid automatic-update artifact/,
  );
  await fs.rm(path.join(directory, win), { recursive: true });
  await artifact(directory, win, null);
  await fs.mkdir(path.join(directory, `${win}.blockmap`));
  await assert.rejects(
    verifyUpdateArtifacts({ directory, version }),
    /Invalid automatic-update blockmap/,
  );
});

test(
  "rejects symlink artifacts and maps",
  { skip: process.platform === "win32" },
  async (t) => {
    const directory = await fixture(t);
    await fs.writeFile(path.join(directory, "real.exe"), contents);
    await fs.symlink("real.exe", path.join(directory, win));
    await assert.rejects(
      verifyUpdateArtifacts({ directory, version }),
      /Invalid automatic-update artifact/,
    );
    await fs.unlink(path.join(directory, win));
    await artifact(directory, win, null);
    await fs.writeFile(path.join(directory, "real.blockmap"), map());
    await fs.symlink("real.blockmap", path.join(directory, `${win}.blockmap`));
    await assert.rejects(
      verifyUpdateArtifacts({ directory, version }),
      /Invalid automatic-update blockmap/,
    );
  },
);

test("checksum build step refuses missing maps and includes valid primary map hashes", async (t) => {
  const directory = await fixture(t);
  await artifact(directory, win, null);
  const build = () =>
    promisify(execFile)(process.execPath, [
      path.join(__dirname, "../scripts/checksums.cjs"),
      directory,
    ]);
  await assert.rejects(build(), /Missing automatic-update blockmap/);
  await assert.rejects(fs.access(path.join(directory, "SHA256SUMS")), {
    code: "ENOENT",
  });
  await fs.writeFile(path.join(directory, `${win}.blockmap`), map());
  await build();
  const hashes = await fs.readFile(path.join(directory, "SHA256SUMS"), "utf8");
  assert.match(hashes, new RegExp(`  ${win.replaceAll(".", "\\.")}\\n`));
  assert.match(
    hashes,
    new RegExp(`  ${win.replaceAll(".", "\\.")}\\.blockmap\\n`),
  );
});
