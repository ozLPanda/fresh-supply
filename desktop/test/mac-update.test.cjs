const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { createHash } = require("node:crypto");
const { spawn } = require("node:child_process");
const { prepareMacUpdate, confirmMacUpdateStarted, extractBundle, validateBundle, bundleFromExecutable } = require("../src/mac-update.cjs");

function crc32(data) {
  let crc = 0xffffffff;
  for (const byte of data) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function makeZip(entries) {
  const chunks = [];
  const central = [];
  let offset = 0;
  for (const { name, data = "", mode = 0o100644 } of entries) {
    const filename = Buffer.from(name);
    const bytes = Buffer.isBuffer(data) ? data : Buffer.from(data);
    const header = Buffer.alloc(30);
    header.writeUInt32LE(0x04034b50, 0);
    header.writeUInt16LE(20, 4);
    header.writeUInt16LE(0x800, 6);
    header.writeUInt32LE(crc32(bytes), 14);
    header.writeUInt32LE(bytes.length, 18);
    header.writeUInt32LE(bytes.length, 22);
    header.writeUInt16LE(filename.length, 26);
    chunks.push(header, filename, bytes);
    const entry = Buffer.alloc(46);
    entry.writeUInt32LE(0x02014b50, 0);
    entry.writeUInt16LE((3 << 8) | 20, 4);
    entry.writeUInt16LE(20, 6);
    entry.writeUInt16LE(0x800, 8);
    entry.writeUInt32LE(crc32(bytes), 16);
    entry.writeUInt32LE(bytes.length, 20);
    entry.writeUInt32LE(bytes.length, 24);
    entry.writeUInt16LE(filename.length, 28);
    entry.writeUInt32LE((mode << 16) >>> 0, 38);
    entry.writeUInt32LE(offset, 42);
    central.push(entry, filename);
    offset += header.length + filename.length + bytes.length;
  }
  const directory = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...chunks, directory, end]);
}
async function fixture(t, entries) {
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "fresh-supply-mac-update-")));
  t.after(() => fs.rm(root, { force: true, recursive: true }));
  const archive = path.join(root, "update.zip");
  const stage = path.join(root, "stage");
  await fs.mkdir(stage);
  await fs.writeFile(archive, makeZip(entries));
  return { root, archive, stage };
}
const regular = [{ name: "fresh-supply.app/Contents/file", data: "new payload" }];

test("bundle location derives from Contents/MacOS and rejects unpackaged executable paths", () => {
  const bundle = path.join(path.parse(process.execPath).root, "Applications", "fresh-supply.app");
  assert.equal(bundleFromExecutable(path.join(bundle, "Contents", "MacOS", "fresh-supply")), bundle);
  assert.throws(() => bundleFromExecutable(path.join(path.parse(process.execPath).root, "tmp", "node")), /Программы/);
});
test("extracts executable permissions and internal framework symlink chains", { skip: process.platform === "win32" }, async (t) => {
  const { archive, stage } = await fixture(t, [
    { name: "fresh-supply.app/Contents/Frameworks/Test.framework/Versions/A/Test", data: "binary", mode: 0o100755 },
    { name: "fresh-supply.app/Contents/Frameworks/Test.framework/Versions/Current", data: "A", mode: 0o120777 },
    { name: "fresh-supply.app/Contents/Frameworks/Test.framework/Test", data: "Versions/Current/Test", mode: 0o120777 },
    { name: "__MACOSX/._fresh-supply.app", data: "metadata" },
  ]);
  const bundle = await extractBundle(archive, stage);
  const binary = path.join(bundle, "Contents/Frameworks/Test.framework/Test");
  assert.equal(await fs.readFile(binary, "utf8"), "binary");
  assert.equal((await fs.stat(binary)).mode & 0o777, 0o755);
});
for (const [label, entries] of [
  ["parent traversal", [{ name: "fresh-supply.app/../../outside", data: "bad" }]],
  ["absolute path", [{ name: "/tmp/outside", data: "bad" }]],
  ["absolute symlink", [...regular, { name: "fresh-supply.app/Contents/link", data: "/tmp", mode: 0o120777 }]],
  ["escaping symlink", [...regular, { name: "fresh-supply.app/Contents/link", data: "../../outside", mode: 0o120777 }]],
  ["duplicate files", [...regular, ...regular]],
  ["two application bundles", [...regular, { name: "OvoshiHelp.app/file", data: "bad" }]],
  ["unsupported device", [{ name: "fresh-supply.app/device", mode: 0o020666 }]],
]) test(`rejects ZIP ${label}`, async (t) => {
  const { archive, stage } = await fixture(t, entries);
  await assert.rejects(extractBundle(archive, stage));
});
test("symlinks cannot be extraction destinations or contain cycles", { skip: process.platform === "win32" }, async (t) => {
  for (const entries of [
    [
      { name: "fresh-supply.app/Contents/link", data: "directory", mode: 0o120777 },
      { name: "fresh-supply.app/Contents/link/payload", data: "bad" },
    ],
    [
      { name: "fresh-supply.app/Contents/one", data: "two", mode: 0o120777 },
      { name: "fresh-supply.app/Contents/two", data: "one", mode: 0o120777 },
    ],
  ]) {
    const { archive, stage } = await fixture(t, entries);
    await assert.rejects(extractBundle(archive, stage));
  }
});
async function fakeRun(command, args) {
  if (command.endsWith("lipo")) return { stdout: "arm64\n" };
  const values = { CFBundleIdentifier: "kz.ovoshi.help.desktop", CFBundleShortVersionString: "0.2.0", CFBundleExecutable: "fresh-supply" };
  return { stdout: values[args[1].slice("Print :".length)] + "\n" };
}
test("bundle validation rejects wrong version, identifier and architecture", async (t) => {
  const { stage } = await fixture(t, regular);
  const bundle = path.join(stage, "fresh-supply.app");
  await fs.mkdir(path.join(bundle, "Contents/MacOS"), { recursive: true });
  await fs.writeFile(path.join(bundle, "Contents/MacOS/fresh-supply"), "binary", { mode: 0o755 });
  await validateBundle(bundle, "0.2.0", "arm64", fakeRun);
  await assert.rejects(validateBundle(bundle, "0.3.0", "arm64", fakeRun));
  await assert.rejects(validateBundle(bundle, "0.2.0", "x64", fakeRun));
  await assert.rejects(validateBundle(bundle, "0.2.0", "arm64", async (command, args) => {
    if (args[1]?.includes("CFBundleIdentifier")) return { stdout: "other.app" };
    return fakeRun(command, args);
  }));
});
const plist = (version) => `<?xml version="1.0" encoding="UTF-8"?><!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd"><plist version="1.0"><dict><key>CFBundleIdentifier</key><string>kz.ovoshi.help.desktop</string><key>CFBundleShortVersionString</key><string>${version}</string><key>CFBundleExecutable</key><string>fresh-supply</string></dict></plist>`;
async function nativeFixture(t) {
  const executable = await fs.readFile(process.execPath);
  const { root, archive } = await fixture(t, [
    { name: "fresh-supply.app/Contents/Info.plist", data: plist("0.2.0") },
    { name: "fresh-supply.app/Contents/MacOS/fresh-supply", data: executable, mode: 0o100755 },
    { name: "fresh-supply.app/Contents/marker", data: "new" },
  ]);
  const target = path.join(root, "Папка 'тест' $()/fresh-supply.app");
  await fs.mkdir(path.join(target, "Contents/MacOS"), { recursive: true });
  await fs.writeFile(path.join(target, "Contents/Info.plist"), plist("0.1.0"));
  await fs.writeFile(path.join(target, "Contents/marker"), "old");
  await fs.copyFile(process.execPath, path.join(target, "Contents/MacOS/fresh-supply"));
  const userData = path.join(root, "Ovoshi Help");
  await fs.mkdir(userData);
  const app = { isPackaged: true, getPath: (key) => key === "userData" ? userData : path.join(target, "Contents/MacOS/fresh-supply"), getVersion: () => "0.2.0" };
  const sha256 = createHash("sha256").update(await fs.readFile(archive)).digest("hex");
  return { root, target, archive, app, sha256 };
}
async function waitFor(check) {
  const deadline = Date.now() + 6000;
  while (Date.now() < deadline) {
    if (await check()) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error("Timed out waiting for helper");
}
async function runningApplication(t) {
  const env = { ...process.env };
  delete env.NODE_TEST_CONTEXT;
  const child = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { env, stdio: "ignore" });
  t.after(() => child.kill());
  await new Promise((resolve, reject) => { child.once("spawn", resolve); child.once("error", reject); });
  return child;
}
test("native helper replaces disposable bundle and handles quoted Unicode paths without shell evaluation", { skip: process.platform !== "darwin" }, async (t) => {
  const { root, archive, app, target, sha256 } = await nativeFixture(t);
  const launcher = path.join(root, "fake-open.sh");
  await fs.writeFile(launcher, '#!/bin/sh\nprintf "%s\\n" "$2" > "$2/Contents/launched"\n', { mode: 0o755 });
  const application = await runningApplication(t);
  const prepared = await prepareMacUpdate({ app, archivePath: archive, sha256, version: "0.2.0", pid: application.pid, openCommand: launcher });
  assert.equal(await fs.readFile(path.join(target, "Contents/marker"), "utf8"), "old");
  await prepared.install();
  assert.equal(await fs.readFile(path.join(target, "Contents/marker"), "utf8"), "old");
  application.kill();
  await waitFor(async () => fs.access(path.join(target, "Contents/launched")).then(() => true, () => false));
  assert.equal(await fs.readFile(path.join(target, "Contents/marker"), "utf8"), "new");
  assert.equal((await fs.readFile(path.join(target, "Contents/launched"), "utf8")).trim(), target);
  assert.equal(await confirmMacUpdateStarted({ app }), true);
  await prepared.dispose();
  await waitFor(async () => !(await fs.readdir(path.dirname(target))).some((entry) => entry.startsWith(".fresh-supply-update-")));
});
test("native helper restores prior bundle when OS launcher rejects new application", { skip: process.platform !== "darwin" }, async (t) => {
  const { root, archive, app, target, sha256 } = await nativeFixture(t);
  const launcher = path.join(root, "fake-open.sh");
  await fs.writeFile(launcher, '#!/bin/sh\nif [ "$(cat "$2/Contents/marker")" = new ]; then exit 1; fi\nprintf restored > "$2/Contents/launched"\n', { mode: 0o755 });
  const application = await runningApplication(t);
  const prepared = await prepareMacUpdate({ app, archivePath: archive, sha256, version: "0.2.0", pid: application.pid, openCommand: launcher });
  await prepared.install();
  assert.equal(await fs.readFile(path.join(target, "Contents/marker"), "utf8"), "old");
  application.kill();
  await waitFor(async () => fs.access(path.join(target, "Contents/launched")).then(() => true, () => false));
  assert.equal(await fs.readFile(path.join(target, "Contents/marker"), "utf8"), "old");
});
test("dispose before installation removes stage and never replaces installed app", { skip: process.platform !== "darwin" }, async (t) => {
  const { archive, app, target, sha256 } = await nativeFixture(t);
  const prepared = await prepareMacUpdate({ app, archivePath: archive, sha256, version: "0.2.0" });
  await prepared.dispose();
  await assert.rejects(prepared.install(), /отменена/);
  assert.equal(await fs.readFile(path.join(target, "Contents/marker"), "utf8"), "old");
  assert.equal((await fs.readdir(path.dirname(target))).some((entry) => entry.startsWith(".fresh-supply-update-")), false);
});
test("helper times out if application fails to quit and never installs later", { skip: process.platform !== "darwin" }, async (t) => {
  const { archive, app, target, sha256 } = await nativeFixture(t);
  const prepared = await prepareMacUpdate({ app, archivePath: archive, sha256, version: "0.2.0", waitSeconds: 1 });
  await prepared.install();
  await waitFor(async () => !(await fs.readdir(path.dirname(target))).some((entry) => entry.startsWith(".fresh-supply-update-")));
  assert.equal(await fs.readFile(path.join(target, "Contents/marker"), "utf8"), "old");
});

test("archive integrity is rechecked before extraction", { skip: process.platform !== "darwin" }, async (t) => {
  const { archive, app, target } = await nativeFixture(t);
  await assert.rejects(prepareMacUpdate({ app, archivePath: archive, sha256: "0".repeat(64), version: "0.2.0" }), /повреждён/);
  assert.equal((await fs.readdir(path.dirname(target))).some((entry) => entry.startsWith(".fresh-supply-update-")), false);
});
test("unfinished different-version journal is preserved and blocks another update", { skip: process.platform !== "darwin" }, async (t) => {
  const { archive, app, target, sha256 } = await nativeFixture(t);
  const updates = path.join(app.getPath("userData"), "updates");
  await fs.mkdir(updates);
  const journal = JSON.stringify({ version: "0.3.0", target, task: path.join(path.dirname(target), ".fresh-supply-update-ABC123") });
  await fs.writeFile(path.join(updates, "mac-update-pending.json"), journal);
  await assert.rejects(prepareMacUpdate({ app, archivePath: archive, sha256, version: "0.2.0" }), /не завершено/);
  assert.equal(await fs.readFile(path.join(updates, "mac-update-pending.json"), "utf8"), journal);
});

test("extraction cancellation stops before later ZIP entries", async (t) => {
  const { archive, stage } = await fixture(t, [
    { name: "fresh-supply.app/Contents/one", data: "one" },
    { name: "fresh-supply.app/Contents/two", data: "two" },
  ]);
  const controller = new AbortController();
  await assert.rejects(extractBundle(archive, stage, () => controller.abort(), controller.signal), { name: "AbortError" });
  await assert.rejects(fs.access(path.join(stage, "fresh-supply.app/Contents/two")));
});
test("keeps previous bundle until healthy runtime confirmation and cleans only private download", { skip: process.platform !== "darwin" }, async (t) => {
  const { root, archive, app, target, sha256 } = await nativeFixture(t);
  const updates = path.join(app.getPath("userData"), "updates");
  const download = path.join(updates, "download-ABC123");
  await fs.mkdir(download, { recursive: true });
  const downloadedArchive = path.join(download, "update.zip");
  await fs.rename(archive, downloadedArchive);
  const userRecord = path.join(app.getPath("userData"), "user-record");
  await fs.writeFile(userRecord, "untouched");
  const launcher = path.join(root, "fake-open.sh");
  await fs.writeFile(launcher, '#!/bin/sh\nexit 0\n', { mode: 0o755 });
  const application = await runningApplication(t);
  const prepared = await prepareMacUpdate({ app, archivePath: downloadedArchive, sha256, version: "0.2.0", pid: application.pid, openCommand: launcher, startupWaitSeconds: 1 });
  await prepared.install();
  application.kill();
  await waitFor(async () => fs.readFile(path.join(app.getPath("userData"), "logs/mac-update.log"), "utf8").then((log) => log.includes("readiness not confirmed"), () => false));
  const journal = JSON.parse(await fs.readFile(path.join(updates, "mac-update-pending.json"), "utf8"));
  assert.equal(await fs.readFile(path.join(journal.task, "previous.app/Contents/marker"), "utf8"), "old");
  assert.equal(await fs.readFile(path.join(target, "Contents/marker"), "utf8"), "new");
  await assert.rejects(fs.access(downloadedArchive));
  await assert.rejects(fs.access(download));
  assert.equal(await confirmMacUpdateStarted({ app }), true);
  await assert.rejects(fs.access(journal.task));
  await assert.rejects(fs.access(path.join(updates, "mac-update-pending.json")));
  assert.equal(await fs.readFile(userRecord, "utf8"), "untouched");
});
