const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { createHash } = require("node:crypto");
const { gzipSync } = require("node:zlib");
const { downloadReleaseAsset, parseBlockMap } = require("../src/update-download.cjs");

function asset(name, bytes) {
  return { name, size: bytes.length, digest: `sha256:${createHash("sha256").update(bytes).digest("hex")}` };
}
function blockmap(chunks) {
  return gzipSync(JSON.stringify({ version: "2", files: [{ name: "file", offset: 0,
    // The planner treats digest bytes as opaque BLAKE2b identifiers; final SHA-256
    // remains authoritative even if an otherwise valid map lies about a block.
    checksums: chunks.map((chunk) => createHash("sha256").update(chunk).digest().subarray(0, 18).toString("base64")),
    sizes: chunks.map((chunk) => chunk.length) }] }));
}
function response(bytes, { status = 200, headers = {}, chunks } = {}) {
  const pieces = chunks || [bytes];
  return new Response(new ReadableStream({ pull(controller) {
    const next = pieces.shift();
    if (next) controller.enqueue(next);
    else controller.close();
  } }), { status, headers });
}
async function fixture(t) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "fresh-delta-test-"));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const oldChunks = [Buffer.alloc(1024 * 1024, 1), Buffer.alloc(16384, 2), Buffer.alloc(1024 * 1024, 3)];
  const newChunks = [oldChunks[0], Buffer.alloc(16384, 4), oldChunks[2]];
  const oldBytes = Buffer.concat(oldChunks), newBytes = Buffer.concat(newChunks);
  const oldMap = blockmap(oldChunks), newMap = blockmap(newChunks);
  const oldFile = path.join(directory, "cached.exe"), downloads = path.join(directory, "downloads");
  await fs.writeFile(oldFile, oldBytes);
  await fs.mkdir(downloads);
  const requests = [];
  const options = { asset: asset("fresh-supply-0.2.0-win-x64.exe", newBytes),
    blockmap: asset("fresh-supply-0.2.0-win-x64.exe.blockmap", newMap),
    previous: { file: oldFile, asset: asset("fresh-supply-0.1.0-win-x64.exe", oldBytes), blockmap: oldMap },
    repository: "ozLPanda/fresh-supply", tag: "desktop-v0.2.0", destinationDirectory: downloads,
    fetch: async (url, init) => {
      requests.push({ url, init });
      if (url.endsWith(".blockmap")) return response(newMap);
      if (!init.headers.Range) return response(newBytes);
      const [, start, end] = /^bytes=(\d+)-(\d+)$/.exec(init.headers.Range);
      return response(newBytes.subarray(Number(start), Number(end) + 1), { status: 206,
        headers: { "Content-Range": `bytes ${start}-${end}/${newBytes.length}`, "Content-Length": String(Number(end) - Number(start) + 1) } });
    } };
  return { directory, downloads, oldFile, oldBytes, newBytes, newMap, options, requests };
}
async function verifiedResult(f, overrides = {}) {
  const file = await downloadReleaseAsset({ ...f.options, ...overrides });
  assert.deepEqual(await fs.readFile(file), f.newBytes);
  assert.deepEqual(await fs.readdir(f.downloads), [path.basename(path.dirname(file))]);
  assert.deepEqual(await fs.readdir(path.dirname(file)), [f.options.asset.name]);
  return file;
}

test("reconstructs unchanged megabytes with only a changed 16 KiB range", async (t) => {
  const f = await fixture(t), progress = [];
  let map;
  await verifiedResult(f, { onProgress: (event) => progress.push(event), onBlockmap: (bytes) => { map = bytes; } });
  assert.equal(f.requests.length, 2);
  assert.equal(f.requests[1].init.headers.Range, "bytes=1048576-1064959");
  assert.deepEqual(map, f.newMap);
  assert.equal(progress[0].mode, "differential");
  assert.equal(progress.at(-1).transferred, 16384);
  assert.equal(progress.at(-1).total, 16384);
  assert.equal(progress.at(-1).reusedBytes, 2 * 1024 * 1024);
  assert.equal(progress.at(-1).percent, 100);
});

test("range redirects preserve the range without authentication", async (t) => {
  const f = await fixture(t), fetch = f.options.fetch;
  f.options.fetch = async (url, init) => {
    assert.equal(init.headers.Authorization, undefined);
    if (init.headers.Range && url.startsWith("https://github.com/")) {
      return new Response(null, { status: 302, headers: { Location: "https://release-assets.githubusercontent.com/installer" } });
    }
    return fetch(url, init);
  };
  await verifiedResult(f);
  assert.equal(f.requests.at(-1).init.headers.Range, "bytes=1048576-1064959");
});

test("coalesces a small unchanged gap between changed blocks into one range", async (t) => {
  const f = await fixture(t);
  const oldChunks = [Buffer.alloc(1024 * 1024, 1), Buffer.alloc(8192, 2), Buffer.alloc(8192, 3), Buffer.alloc(8192, 4), Buffer.alloc(1024 * 1024, 5)];
  const newChunks = [oldChunks[0], Buffer.alloc(8192, 6), oldChunks[2], Buffer.alloc(8192, 7), oldChunks[4]];
  const oldBytes = Buffer.concat(oldChunks), newBytes = Buffer.concat(newChunks), newMap = blockmap(newChunks);
  await fs.writeFile(f.oldFile, oldBytes);
  f.newBytes = newBytes;
  f.options.previous = { file: f.oldFile, asset: asset(f.options.previous.asset.name, oldBytes), blockmap: blockmap(oldChunks) };
  f.options.asset = asset(f.options.asset.name, newBytes);
  f.options.blockmap = asset(f.options.blockmap.name, newMap);
  const ranges = [], progress = [];
  f.options.fetch = async (url, init) => {
    if (url.endsWith(".blockmap")) return response(newMap);
    assert.ok(init.headers.Range);
    ranges.push(init.headers.Range);
    const [, start, end] = /^bytes=(\d+)-(\d+)$/.exec(init.headers.Range);
    return response(newBytes.subarray(Number(start), Number(end) + 1), { status: 206,
      headers: { "Content-Range": `bytes ${start}-${end}/${newBytes.length}` } });
  };
  await verifiedResult(f, { onProgress: (event) => progress.push(event) });
  assert.deepEqual(ranges, ["bytes=1048576-1073151"]);
  assert.equal(progress.at(-1).total, 24576);
  assert.equal(progress.at(-1).reusedBytes, 2097152);
});

for (const problem of ["missing-map", "map-digest", "range-200", "range-wrong", "range-encoded", "range-short", "range-overflow", "range-digest", "range-redirect", "range-header-stall", "range-read-stall"]) {
  test(`falls back to a complete verified artifact after ${problem}`, async (t) => {
    const f = await fixture(t), fetch = f.options.fetch, modes = [];
    f.options.fetch = async (url, init) => {
      if (url.endsWith(".blockmap")) {
        if (problem === "missing-map") return new Response(null, { status: 404 });
        if (problem === "map-digest") return response(Buffer.alloc(f.newMap.length));
      }
      if (init.headers.Range) {
        if (problem === "range-header-stall") return new Promise(() => {});
        if (problem === "range-redirect") return new Response(null, { status: 302, headers: { Location: "https://evil.invalid/file" } });
        const goodHeaders = { "Content-Range": `bytes 1048576-1064959/${f.newBytes.length}` };
        if (problem === "range-read-stall") return new Response(new ReadableStream({ start() {} }), { status: 206, headers: goodHeaders });
        if (problem === "range-200") return response(f.newBytes);
        if (problem === "range-wrong") return response(Buffer.alloc(16384), { status: 206, headers: { "Content-Range": "bytes 0-16383/16384" } });
        if (problem === "range-encoded") return response(Buffer.alloc(16384), { status: 206, headers: { ...goodHeaders, "Content-Encoding": "gzip" } });
        if (["range-short", "range-overflow", "range-digest"].includes(problem)) return response(Buffer.alloc(problem === "range-short" ? 2 : problem === "range-overflow" ? 16385 : 16384), { status: 206, headers: goodHeaders });
      }
      return fetch(url, init);
    };
    await verifiedResult(f, { inactivityTimeoutMs: 25, onProgress: (event) => modes.push(event.mode) });
    assert.equal(modes.at(-1), "full");
    assert.equal(f.requests.at(-1).init.headers.Range, undefined);
  });
}

for (const problem of ["corrupt", "symlink", "truncated", "bad-old-map", "oversized-old-map", "wrong-old-coverage"]) {
  test(`ignores ${problem} cached basis and downloads in full`, async (t) => {
    const f = await fixture(t);
    if (problem === "corrupt") await fs.writeFile(f.oldFile, Buffer.alloc(f.oldBytes.length));
    if (problem === "truncated") await fs.truncate(f.oldFile, 1);
    if (problem === "symlink") {
      const link = path.join(f.directory, "link.exe");
      await fs.symlink(f.oldFile, link);
      f.options.previous.file = link;
    }
    if (problem === "bad-old-map") f.options.previous.blockmap = gzipSync("{}");
    if (problem === "oversized-old-map") f.options.previous.blockmap = Buffer.alloc(8 * 1024 ** 2 + 1);
    if (problem === "wrong-old-coverage") f.options.previous.blockmap = blockmap([Buffer.alloc(1)]);
    await verifiedResult(f);
    assert.equal(f.requests.length, 1);
    assert.equal(f.requests[0].init.headers.Range, undefined);
  });
}

test("oversized target compressed map is rejected before requesting it", async (t) => {
  const f = await fixture(t);
  f.options.blockmap.size = 8 * 1024 ** 2 + 1;
  await verifiedResult(f);
  assert.equal(f.requests.length, 1);
});

test("bounded decompression rejects a gzip bomb", async () => {
  await assert.rejects(parseBlockMap(gzipSync(Buffer.alloc(32 * 1024 ** 2 + 1)), 1));
});

for (const change of [
  (map) => { map.version = "1"; },
  (map) => { map.files.push(map.files[0]); },
  (map) => { map.files[0].offset = 1; },
  (map) => { map.files[0].name = "other"; },
  (map) => { map.files[0].sizes[0] = -1; },
  (map) => { map.files[0].sizes[0] = 1.5; },
  (map) => { map.files[0].sizes[0] = Number.MAX_SAFE_INTEGER; },
  (map) => { map.files[0].checksums[0] = "invalid"; },
  (map) => { map.files[0].checksums.push(map.files[0].checksums[0]); },
  (map) => { map.files[0].sizes = Array(250001).fill(1); map.files[0].checksums = Array(250001).fill(map.files[0].checksums[0]); },
]) {
  test(`rejects malformed map: ${change.toString()}`, async () => {
    const bytes = blockmap([Buffer.alloc(100)]);
    const map = JSON.parse(require("node:zlib").gunzipSync(bytes));
    change(map);
    await assert.rejects(parseBlockMap(gzipSync(JSON.stringify(map)), 100));
  });
}

test("an altered valid blockmap cannot bypass final artifact verification", async (t) => {
  const f = await fixture(t), fetch = f.options.fetch;
  const map = JSON.parse(require("node:zlib").gunzipSync(f.newMap));
  const oldMap = JSON.parse(require("node:zlib").gunzipSync(f.options.previous.blockmap));
  map.files[0].checksums[1] = oldMap.files[0].checksums[1];
  f.newMap = gzipSync(JSON.stringify(map));
  f.options.blockmap = asset(f.options.blockmap.name, f.newMap);
  f.options.fetch = async (url, init) => url.endsWith(".blockmap") ? response(f.newMap) : fetch(url, init);
  await verifiedResult(f);
  assert.equal(f.requests.at(-1).init.headers.Range, undefined);
});

test("all copied bytes require no artifact network requests", async (t) => {
  const f = await fixture(t), progress = [];
  f.newBytes = f.oldBytes;
  f.options.asset = asset(f.options.asset.name, f.oldBytes);
  f.options.blockmap = asset(f.options.blockmap.name, f.options.previous.blockmap);
  f.options.fetch = async (url) => { assert.ok(url.endsWith(".blockmap")); return response(f.options.previous.blockmap); };
  await verifiedResult(f, { onProgress: (event) => progress.push(event) });
  assert.equal(progress.at(-1).total, 0);
  assert.equal(progress.at(-1).percent, 100);
});

for (const stage of ["before", "copy", "network", "headers"]) {
  test(`user cancellation during ${stage} never starts a full fallback`, async (t) => {
    const f = await fixture(t), controller = new AbortController(), fetch = f.options.fetch;
    let fullRequests = 0;
    if (stage === "before") controller.abort();
    f.options.fetch = async (url, init) => {
      if (!url.endsWith(".blockmap") && !init.headers.Range) fullRequests += 1;
      if (stage === "headers" && init.headers.Range) { controller.abort(); return new Promise(() => {}); }
      return fetch(url, init);
    };
    let copiedProgress = 0;
    await assert.rejects(downloadReleaseAsset({ ...f.options, signal: controller.signal,
      onProgress: (event) => {
        if (stage === "copy" && event.mode === "differential" && event.transferred === 0 && ++copiedProgress === 2) controller.abort();
        if (stage === "network" && event.transferred > 0) controller.abort();
      } }), { name: "AbortError" });
    assert.equal(fullRequests, 0);
    assert.deepEqual(await fs.readdir(f.downloads), []);
  });
}

test("failed differential and full checksum validation leave no staged artifact", async (t) => {
  const f = await fixture(t), fetch = f.options.fetch;
  f.options.fetch = async (url, init) => url.endsWith(".blockmap") ? fetch(url, init) : response(Buffer.alloc(init.headers.Range ? 16384 : f.newBytes.length), {
    status: init.headers.Range ? 206 : 200,
    headers: init.headers.Range ? { "Content-Range": `bytes 1048576-1064959/${f.newBytes.length}` } : {},
  });
  await assert.rejects(downloadReleaseAsset(f.options), { code: "UPDATE_CHECKSUM_MISMATCH" });
  assert.deepEqual(await fs.readdir(f.downloads), []);
});
