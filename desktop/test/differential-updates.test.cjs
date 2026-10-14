const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const os = require("node:os");
const { createHash } = require("node:crypto");
const { gzipSync } = require("node:zlib");
const { createUpdateManager, selectBlockmap } = require("../src/updates.cjs");
const { downloadReleaseAsset } = require("../src/update-download.cjs");
const { createUpdateCache } = require("../src/update-cache.cjs");
const sha = (bytes) =>
  "sha256:" + createHash("sha256").update(bytes).digest("hex");

async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "fresh-delta-manager-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const requests = [],
    events = [],
    calls = [];
  const cacheOptions = {
    directory: path.join(root, "updates"),
    repository: "ozLPanda/fresh-supply",
    platform: "win32",
    arch: "x64",
  };
  const cache = createUpdateCache(cacheOptions);
  let candidate, archive;
  function release(version, changed = false) {
    const blocks = [
      Buffer.alloc(1024 ** 2, 11),
      Buffer.alloc(16384, changed ? 22 : 33),
      Buffer.alloc(1024 ** 2, 44),
    ];
    const contents = Buffer.concat(blocks),
      name = `fresh-supply-${version}-win-x64.exe`;
    const map = gzipSync(
      JSON.stringify({
        version: "2",
        files: [
          {
            name: "file",
            offset: 0,
            sizes: blocks.map((b) => b.length),
            checksums: blocks.map((b) =>
              createHash("sha256")
                .update(b)
                .digest()
                .subarray(0, 18)
                .toString("base64"),
            ),
          },
        ],
      }),
    );
    const asset = { name, size: contents.length, digest: sha(contents) };
    const blockmap = {
      name: name + ".blockmap",
      size: map.length,
      digest: sha(map),
    };
    return {
      contents,
      map,
      metadata: { tag_name: "desktop-v" + version, assets: [asset, blockmap] },
    };
  }
  const fetchAsset = async (url, init) => {
    assert.equal(init.headers.Authorization, undefined);
    assert.ok(
      url.startsWith(
        "https://github.com/ozLPanda/fresh-supply/releases/download/",
      ),
    );
    const isMap = url.endsWith(".blockmap"),
      bytes = isMap ? candidate.map : candidate.contents;
    const range = init.headers.Range;
    if (range) {
      const [, start, end] = /^bytes=(\d+)-(\d+)$/.exec(range);
      const part = bytes.subarray(Number(start), Number(end) + 1);
      requests.push({ map: false, ranged: true, bytes: part.length });
      return new Response(part, {
        status: 206,
        headers: {
          "Content-Range": `bytes ${start}-${end}/${bytes.length}`,
          "Content-Length": String(part.length),
        },
      });
    }
    requests.push({ map: isMap, ranged: false, bytes: bytes.length });
    return new Response(bytes, {
      status: 200,
      headers: { "Content-Length": String(bytes.length) },
    });
  };
  const settings = {
    app: {
      isPackaged: true,
      getVersion: () => "0.1.0",
      getPath: () => root,
      quit: () => calls.push("quit"),
    },
    platform: "win32",
    arch: "x64",
    logger: { warn() {} },
    dialog: {
      showMessageBox: async (options) => ({
        response: options.buttons[0] === "Обновить" ? 0 : options.cancelId,
      }),
    },
    shell: { openExternal: async () => calls.push("external") },
    fetch: async () => ({ ok: true, json: async () => candidate.metadata }),
    download: (options) =>
      downloadReleaseAsset({ ...options, fetch: fetchAsset }),
    onProgress: (value) => events.push(value),
    prepareInstaller: async ({ archivePath }) => {
      archive = archivePath;
      assert.deepEqual(await fs.readFile(archive), candidate.contents);
      calls.push("stage");
      return {
        install: async () => calls.push("install"),
        dispose: async () => calls.push("dispose"),
      };
    },
    prepareUpdate: async () => calls.push("backup"),
  };
  return {
    root,
    requests,
    events,
    calls,
    cache,
    release,
    setCandidate(value) {
      candidate = value;
    },
    getArchive: () => archive,
    manager: (overrides = {}) =>
      createUpdateManager({ ...settings, ...overrides }),
  };
}

test("first full update seeds a durable cache; next update downloads only changed bytes before backup/install", async (t) => {
  const f = await fixture(t);
  const first = f.release("0.2.0");
  f.setCandidate(first);
  assert.equal((await f.manager().checkForUpdates()).status, "installing");
  assert.deepEqual(f.calls, ["stage", "backup", "install", "quit"]);
  assert.equal(
    f.requests.filter((r) => !r.map).reduce((sum, r) => sum + r.bytes, 0),
    first.contents.length,
  );
  await fs.rm(path.dirname(f.getArchive()), { recursive: true });
  assert.ok(await f.cache.load());
  f.requests.length = 0;
  f.calls.length = 0;
  const second = f.release("0.3.0", true);
  f.setCandidate(second);
  assert.equal((await f.manager().checkForUpdates()).status, "installing");
  assert.deepEqual(f.calls, ["stage", "backup", "install", "quit"]);
  assert.deepEqual(
    f.requests.filter((r) => !r.map),
    [{ map: false, ranged: true, bytes: 16384 }],
  );
  assert.equal(
    f.events.findLast((e) => e.mode === "differential").percent,
    100,
  );
  assert.equal(
    (await f.cache.load()).asset.name,
    second.metadata.assets[0].name,
  );
  await fs.rm(path.dirname(f.getArchive()), { recursive: true });
  assert.deepEqual(
    await fs.readFile((await f.cache.load()).file),
    second.contents,
  );
});

test("an unavailable optional cache or blockmap cannot prevent a verified full update", async (t) => {
  const f = await fixture(t);
  f.setCandidate(f.release("0.2.0"));
  const brokenCache = {
    load: async () => {
      throw new Error("Unavailable cache");
    },
    save: async () => {
      throw new Error("No disk space");
    },
  };
  assert.equal(
    (await f.manager({ cache: brokenCache }).checkForUpdates()).status,
    "installing",
  );
  assert.deepEqual(f.calls, ["stage", "backup", "install", "quit"]);
  assert.equal(f.requests.filter((r) => !r.map).length, 1);
});

test("cancelling optional blockmap download never backs up or launches an installer", async (t) => {
  const f = await fixture(t);
  f.setCandidate(f.release("0.2.0"));
  let started;
  const waiting = new Promise((resolve) => {
    started = resolve;
  });
  const manager = f.manager({
    download: async (options) => {
      if (!options.asset.name.endsWith(".blockmap")) {
        const name = path.join(f.root, "installer");
        await fs.writeFile(name, "verified fixture");
        return name;
      }
      started();
      await new Promise((_, reject) =>
        options.signal.addEventListener(
          "abort",
          () => reject(options.signal.reason),
          { once: true },
        ),
      );
    },
    cleanupDownload: async () => {},
  });
  const task = manager.checkForUpdates();
  await waiting;
  assert.equal(manager.cancelDownload(), true);
  assert.equal((await task).status, "cancelled");
  assert.deepEqual(f.calls, []);
  assert.equal(await f.cache.load(), null);
});

test("only the exact checked sidecar of the selected installer is considered", () => {
  const asset = { name: "fresh-supply-0.2.0-win-x64.exe" };
  const map = {
    name: asset.name + ".blockmap",
    size: 1024,
    digest: "sha256:" + "a".repeat(64),
  };
  assert.equal(selectBlockmap({ assets: [map] }, asset), map);
  for (const candidate of [
    { ...map, name: "OvoshiHelp-0.2.0-win-x64.exe.blockmap" },
    { ...map, digest: undefined },
    { ...map, size: 8 * 1024 ** 2 + 1 },
  ])
    assert.equal(selectBlockmap({ assets: [candidate] }, asset), null);
});
