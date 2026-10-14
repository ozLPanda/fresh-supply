const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const os = require("node:os");
const { createHash } = require("node:crypto");
const { gzipSync } = require("node:zlib");
const { createUpdateCache } = require("../src/update-cache.cjs");
const digest = (data) =>
  "sha256:" + createHash("sha256").update(data).digest("hex");

async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "fresh-update-basis-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const options = {
    directory: path.join(root, "updates"),
    repository: "ozLPanda/fresh-supply",
    platform: "win32",
    arch: "x64",
  };
  const cache = createUpdateCache(options);
  async function candidate(
    version = "0.2.0",
    contents = Buffer.alloc(16384, 1),
  ) {
    const name = `fresh-supply-${version}-win-x64.exe`;
    const blockmap = gzipSync(
      JSON.stringify({
        version: "2",
        files: [
          {
            name: "file",
            offset: 0,
            sizes: [contents.length],
            checksums: [
              createHash("sha256")
                .update(contents)
                .digest()
                .subarray(0, 18)
                .toString("base64"),
            ],
          },
        ],
      }),
    );
    const file = path.join(root, name);
    await fs.writeFile(file, contents);
    return {
      file,
      asset: { name, size: contents.length, digest: digest(contents) },
      tag: "desktop-v" + version,
      blockmap,
      blockmapAsset: {
        name: name + ".blockmap",
        size: blockmap.length,
        digest: digest(blockmap),
      },
    };
  }
  return { root, options, cache, candidate };
}

test("verified cache survives cleanup of the updater's downloaded installer", async (t) => {
  const f = await fixture(t),
    candidate = await f.candidate();
  assert.equal(await f.cache.load(), null);
  assert.equal(await f.cache.save(candidate), true);
  await fs.rm(candidate.file);
  const cached = await f.cache.load();
  assert.deepEqual(
    await fs.readFile(cached.file),
    Buffer.alloc(candidate.asset.size, 1),
  );
  assert.deepEqual(cached.asset, candidate.asset);
  assert.deepEqual(cached.blockmap, candidate.blockmap);
});

test("successful replacement prunes only the old referenced basis", async (t) => {
  const f = await fixture(t);
  await f.cache.save(await f.candidate());
  const previous = await f.cache.load();
  const foreign = path.join(
    f.options.directory,
    "verified-bases",
    "other-user-directory",
  );
  await fs.mkdir(foreign);
  await fs.writeFile(path.join(foreign, "keep"), "unrelated");
  await f.cache.save(await f.candidate("0.3.0", Buffer.alloc(16384, 2)));
  assert.notEqual((await f.cache.load()).file, previous.file);
  await assert.rejects(fs.stat(previous.file), { code: "ENOENT" });
  assert.equal(
    await fs.readFile(path.join(foreign, "keep"), "utf8"),
    "unrelated",
  );
});

test("repository, architecture and platform must match the cache", async (t) => {
  const f = await fixture(t);
  await f.cache.save(await f.candidate());
  for (const change of [
    { repository: "different/project" },
    { arch: "arm64" },
    { platform: "darwin" },
  ])
    assert.equal(
      await createUpdateCache({ ...f.options, ...change }).load(),
      null,
    );
});

test("invalid map metadata, digest or coverage cannot replace a valid basis", async (t) => {
  const f = await fixture(t);
  await f.cache.save(await f.candidate());
  const previous = (await f.cache.load()).file;
  const next = await f.candidate("0.3.0");
  for (const change of [
    { tag: "../evil" },
    { blockmap: Buffer.from("not a map") },
    { asset: { ...next.asset, size: next.asset.size + 1 } },
    { blockmapAsset: { ...next.blockmapAsset, name: "other.blockmap" } },
  ]) {
    assert.equal(await f.cache.save({ ...next, ...change }), false);
    assert.equal((await f.cache.load()).file, previous);
  }
});

test("cancellation midway through retaining a basis preserves the previous pointer", async (t) => {
  const f = await fixture(t);
  await f.cache.save(await f.candidate());
  const previous = (await f.cache.load()).file;
  const next = await f.candidate("0.3.0");
  const controller = new AbortController(),
    original = fs.link;
  fs.link = async (...args) => {
    await original(...args);
    controller.abort();
  };
  try {
    await assert.rejects(f.cache.save({ ...next, signal: controller.signal }), {
      name: "AbortError",
    });
  } finally {
    fs.link = original;
  }
  assert.equal((await f.cache.load()).file, previous);
  const entries = await fs.readdir(path.dirname(path.dirname(previous)));
  assert.equal(entries.filter((entry) => entry.startsWith("basis-")).length, 1);
});

test("cache map corruption is ignored and symlinked payloads are never read", async (t) => {
  const f = await fixture(t);
  const candidate = await f.candidate();
  await f.cache.save(candidate);
  const cached = await f.cache.load();
  await fs.writeFile(
    path.join(path.dirname(cached.file), "map.gz"),
    Buffer.alloc(candidate.blockmap.length),
  );
  assert.equal(await f.cache.load(), null);
  await fs.writeFile(
    path.join(path.dirname(cached.file), "map.gz"),
    candidate.blockmap,
  );
  await fs.unlink(cached.file);
  await fs.symlink(candidate.file, cached.file);
  assert.equal(await f.cache.load(), null);
});

test("cache pointers cannot escape to application data or allocate oversized JSON", async (t) => {
  const f = await fixture(t);
  await f.cache.save(await f.candidate());
  const pointer = path.join(
    f.options.directory,
    "verified-bases",
    "current.json",
  );
  const record = JSON.parse(await fs.readFile(pointer));
  await fs.writeFile(
    pointer,
    JSON.stringify({ ...record, directory: "../../database" }),
  );
  assert.equal(await f.cache.load(), null);
  await fs.writeFile(pointer, " ".repeat(16385));
  assert.equal(await f.cache.load(), null);
});

test("unavailable cache storage cannot prevent a verified installer from proceeding", async (t) => {
  const f = await fixture(t);
  await fs.writeFile(f.options.directory, "occupied");
  assert.equal(await f.cache.save(await f.candidate()), false);
});
