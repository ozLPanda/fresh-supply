const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { createHash } = require("node:crypto");
const { downloadReleaseAsset } = require("../src/update-download.cjs");

async function fixture(t, contents = Buffer.from("verified installer contents")) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "fresh-update-download-"));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const asset = {
    name: "fresh-supply-0.2.0-win-x64.exe",
    size: contents.byteLength,
    digest: `sha256:${createHash("sha256").update(contents).digest("hex")}`,
    browser_download_url: "https://evil.invalid/installer.exe",
  };
  const requests = [];
  const options = {
    asset,
    repository: "ozLPanda/fresh-supply",
    tag: "desktop-v0.2.0",
    destinationDirectory: directory,
    fetch: async (url, init) => {
      requests.push({ url, init });
      return response(contents);
    },
  };
  return { directory, asset, contents, requests, options };
}

function response(contents, options = {}) {
  const chunks = options.chunks || [contents.subarray(0, 5), contents.subarray(5)];
  const body = new ReadableStream({
    pull(controller) {
      const chunk = chunks.shift();
      if (chunk) controller.enqueue(chunk);
      else controller.close();
    },
  });
  return new Response(body, { status: 200, ...options });
}

async function assertEmpty(directory) {
  assert.deepEqual(await fs.readdir(directory), []);
}

test("streams verified bytes to a private file and derives the trusted release URL", async (t) => {
  const f = await fixture(t);
  const progress = [];
  const result = await downloadReleaseAsset({ ...f.options, onProgress: (event) => progress.push(event) });
  assert.equal(path.isAbsolute(result), true);
  assert.equal(path.basename(result), f.asset.name);
  assert.deepEqual(await fs.readFile(result), f.contents);
  assert.equal(f.requests[0].url, "https://github.com/ozLPanda/fresh-supply/releases/download/desktop-v0.2.0/fresh-supply-0.2.0-win-x64.exe");
  assert.equal(f.requests[0].init.redirect, "manual");
  assert.equal(f.requests[0].init.headers.Authorization, undefined);
  assert.equal(progress[0].percent, 0);
  assert.equal(progress.at(-1).percent, 100);
  assert.equal(progress.at(-1).transferred, f.asset.size);
  assert.deepEqual(await fs.readdir(path.dirname(result)), [f.asset.name]);
  if (process.platform !== "win32") {
    assert.equal((await fs.stat(path.dirname(result))).mode & 0o777, 0o700);
    assert.equal((await fs.stat(result)).mode & 0o777, 0o600);
  }
});

test("accepts uppercase SHA-256 bytes and matching content length", async (t) => {
  const f = await fixture(t);
  f.asset.digest = `sha256:${f.asset.digest.slice(7).toUpperCase()}`;
  f.options.fetch = async () => response(f.contents, { headers: { "Content-Length": String(f.asset.size) } });
  assert.deepEqual(await fs.readFile(await downloadReleaseAsset(f.options)), f.contents);
});

test("follows only allowlisted HTTPS GitHub CDN redirects without credentials", async (t) => {
  const f = await fixture(t);
  const urls = [];
  f.options.fetch = async (url, init) => {
    urls.push(url);
    assert.equal(init.headers.Authorization, undefined);
    return urls.length === 1
      ? new Response(null, { status: 302, headers: { Location: "https://release-assets.githubusercontent.com/github-production-release-asset/signed?token=public" } })
      : response(f.contents);
  };
  await downloadReleaseAsset(f.options);
  assert.equal(urls.length, 2);
  assert.equal(urls[1], "https://release-assets.githubusercontent.com/github-production-release-asset/signed?token=public");
});

for (const redirect of [
  "http://release-assets.githubusercontent.com/file",
  "https://evil.invalid/file",
  "https://release-assets.githubusercontent.com.evil.invalid/file",
  "https://user:password@github.com/file",
  "https://github.com:8443/file",
]) {
  test(`rejects unsafe redirect ${redirect.replace(/user:password@/, "")}`, async (t) => {
    const f = await fixture(t);
    f.options.fetch = async () => new Response(null, { status: 302, headers: { Location: redirect } });
    await assert.rejects(downloadReleaseAsset(f.options), { code: "UPDATE_SOURCE_INVALID" });
    await assertEmpty(f.directory);
  });
}

test("rejects redirects that never terminate and cleans staging", async (t) => {
  const f = await fixture(t);
  let requests = 0;
  f.options.fetch = async () => {
    requests += 1;
    return new Response(null, { status: 302, headers: { Location: "https://github.com/loop" } });
  };
  await assert.rejects(downloadReleaseAsset(f.options), { code: "UPDATE_SOURCE_INVALID" });
  assert.equal(requests, 7);
  await assertEmpty(f.directory);
});

test("rejects corrupt bytes before exposing an installer and deletes partial files", async (t) => {
  const f = await fixture(t);
  f.options.fetch = async () => response(Buffer.alloc(f.asset.size, 0));
  await assert.rejects(downloadReleaseAsset(f.options), { code: "UPDATE_CHECKSUM_MISMATCH" });
  await assertEmpty(f.directory);
});

for (const sizeDifference of [-1, 1]) {
  test(`rejects a stream with size difference ${sizeDifference}`, async (t) => {
    const f = await fixture(t);
    f.options.fetch = async () => response(Buffer.alloc(f.asset.size + sizeDifference, 0));
    await assert.rejects(downloadReleaseAsset(f.options), { code: "UPDATE_SIZE_MISMATCH" });
    await assertEmpty(f.directory);
  });
}

test("rejects a mismatching content length before reading the body", async (t) => {
  const f = await fixture(t);
  f.options.fetch = async () => response(f.contents, { headers: { "Content-Length": String(f.asset.size + 1) } });
  await assert.rejects(downloadReleaseAsset(f.options), { code: "UPDATE_SIZE_MISMATCH" });
  await assertEmpty(f.directory);
});

test("HTTP failures delete staging without returning a file", async (t) => {
  const f = await fixture(t);
  f.options.fetch = async () => new Response("missing", { status: 404 });
  await assert.rejects(downloadReleaseAsset(f.options), { code: "UPDATE_HTTP_ERROR" });
  await assertEmpty(f.directory);
});

test("network stream failure removes partial bytes", async (t) => {
  const f = await fixture(t);
  let reads = 0;
  f.options.fetch = async () => new Response(new ReadableStream({
    pull(controller) {
      reads += 1;
      if (reads === 1) controller.enqueue(f.contents.subarray(0, 5));
      else controller.error(new Error("Disconnected"));
    },
  }));
  await assert.rejects(downloadReleaseAsset(f.options), /Disconnected/);
  await assertEmpty(f.directory);
});

test("cancellation during download removes the private directory", async (t) => {
  const f = await fixture(t);
  const controller = new AbortController();
  await assert.rejects(downloadReleaseAsset({
    ...f.options,
    signal: controller.signal,
    onProgress: ({ transferred }) => { if (transferred > 0) controller.abort(); },
  }), { name: "AbortError" });
  await assertEmpty(f.directory);
});

test("an already cancelled request creates no files or requests", async (t) => {
  const f = await fixture(t);
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(downloadReleaseAsset({ ...f.options, signal: controller.signal }), { name: "AbortError" });
  assert.deepEqual(f.requests, []);
  await assertEmpty(f.directory);
});

test("inactivity timeout aborts a stalled header request and cleans storage", async (t) => {
  const f = await fixture(t);
  f.options.fetch = async () => new Promise(() => {});
  await assert.rejects(downloadReleaseAsset({ ...f.options, inactivityTimeoutMs: 20 }), { code: "UPDATE_TIMEOUT" });
  await assertEmpty(f.directory);
});

test("inactivity timeout aborts a stalled response read", async (t) => {
  const f = await fixture(t);
  f.options.fetch = async () => new Response(new ReadableStream({ start() {} }));
  await assert.rejects(downloadReleaseAsset({ ...f.options, inactivityTimeoutMs: 20 }), { code: "UPDATE_TIMEOUT" });
  await assertEmpty(f.directory);
});

for (const change of [
  { repository: "../fresh-supply" },
  { repository: "ozLPanda/fresh-supply/other" },
  { tag: "desktop-v0.2.0-beta" },
  { asset: { name: "../installer.exe" } },
  { asset: { name: "installer.exe/other" } },
  { asset: { digest: undefined } },
  { asset: { digest: "sha512:untrusted" } },
  { asset: { size: Infinity } },
  { asset: { size: 0 } },
  { maxBytes: 1 },
]) {
  test(`rejects invalid metadata ${JSON.stringify(change)}`, async (t) => {
    const f = await fixture(t);
    const settings = { ...f.options, ...change, asset: { ...f.asset, ...change.asset } };
    await assert.rejects(downloadReleaseAsset(settings));
    assert.deepEqual(f.requests, []);
    await assertEmpty(f.directory);
  });
}

test("simultaneous requests use different private directories", async (t) => {
  const f = await fixture(t);
  const files = await Promise.all([downloadReleaseAsset(f.options), downloadReleaseAsset(f.options)]);
  assert.notEqual(files[0], files[1]);
  assert.deepEqual(await fs.readFile(files[0]), f.contents);
  assert.deepEqual(await fs.readFile(files[1]), f.contents);
});
