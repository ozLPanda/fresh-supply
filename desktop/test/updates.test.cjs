const test = require("node:test");
const assert = require("node:assert/strict");
const { createUpdateManager, isNewerVersion, selectAsset } = require("../src/updates.cjs");
const digest = "sha256:" + "a".repeat(64);
const release = (name = "fresh-supply-0.2.0-win-x64.exe") => ({
  tag_name: "desktop-v0.2.0", body: "Исправления ошибок.",
  assets: [{ name, size: 1024, digest, browser_download_url: "https://evil.invalid/installer" }],
  html_url: "https://evil.invalid/release",
});
function fixture(options = {}) {
  const calls = [];
  const dialogs = [];
  const answers = [...(options.answers || [1])];
  const settings = {
    app: { isPackaged: true, getVersion: () => "0.1.0", getPath: () => "/private/data", quit: () => calls.push("quit") },
    dialog: { showMessageBox: async (details) => { dialogs.push(details); return { response: answers.shift() ?? details.cancelId ?? 0 }; } },
    shell: { openExternal: async (url) => calls.push(["external", url]) },
    platform: "win32", arch: "x64", logger: { warn() {} },
    fetch: async (url, settings) => { calls.push(["fetch", url, settings]); return { ok: true, json: async () => release() }; },
    download: async (options) => { calls.push(["download", options]); options.onProgress({ percent: 50 }); return "/private/data/updates/download-random/installer.exe"; },
    prepareInstaller: async (options) => { calls.push(["stage", options]); return { install: async () => calls.push("install"), dispose: async () => calls.push("dispose") }; },
    prepareUpdate: async () => calls.push("backup"),
    beginUpdate: async () => calls.push("begin"), endUpdate: async () => calls.push("recover"),
    cleanupDownload: async () => calls.push("cleanup"),
    onProgress: (value) => calls.push(["progress", value]),
    ...options.settings,
  };
  const manager = createUpdateManager(settings);
  return { manager, calls, dialogs, settings };
}
const actions = (calls) => calls.map((value) => Array.isArray(value) ? value[0] : value).filter((value) => value !== "progress");

test("stable numeric comparison excludes prereleases and downgrades", () => {
  assert.equal(isNewerVersion("desktop-v0.10.0", "0.9.0"), true);
  for (const version of ["1.0.0-beta", "v0.0.1", "0.1.0", "invalid"]) assert.equal(isNewerVersion(version, "0.1.0"), false);
});
test("factory does not check or install until startup is ready or user asks", () => {
  const { manager, calls } = fixture(); assert.deepEqual(calls, []); manager.dispose();
});
test("startup checks once and offers Update/Later for a newer stable version", async () => {
  const { manager, calls, dialogs } = fixture();
  assert.deepEqual(await manager.checkAtStartup(), { status: "cancelled" });
  assert.deepEqual(dialogs[0].buttons, ["Обновить", "Позже"]);
  assert.deepEqual(await manager.checkAtStartup(), { status: "skipped" });
  assert.deepEqual(actions(calls), ["fetch"]);
  assert.equal(calls[0][2].headers.Authorization, undefined);
});
test("startup current and offline checks do not show dialogs or stop components", async () => {
  for (const fetch of [async () => { throw new Error("Offline"); }, async () => ({ ok: true, json: async () => ({ ...release(), tag_name: "desktop-v0.1.0" }) })]) {
    const { manager, calls, dialogs } = fixture({ settings: { fetch } });
    await manager.checkAtStartup(); assert.deepEqual(calls, []); assert.deepEqual(dialogs, []);
  }
});
test("development builds do not check on startup", async () => {
  const { manager, calls } = fixture({ settings: { app: { isPackaged: false } } });
  assert.deepEqual(await manager.checkAtStartup(), { status: "skipped" }); assert.deepEqual(calls, []);
});
test("one confirmation downloads verified package, stages, backs up, installs and quits", async () => {
  const { manager, calls, dialogs } = fixture({ answers: [0] });
  assert.deepEqual(await manager.checkForUpdates(), { status: "installing" });
  assert.deepEqual(actions(calls), ["fetch", "begin", "download", "stage", "backup", "install", "quit"]);
  assert.equal(dialogs.length, 1);
  assert.equal(calls.find((call) => call[0] === "download")[1].repository, "ozLPanda/fresh-supply");
  assert.equal(calls.find((call) => call[0] === "stage")[1].sha256, "a".repeat(64));
  assert.equal(manager.getState().busy, false);
});
test("Later leaves current application and database running", async () => {
  const { manager, calls } = fixture({ answers: [1] });
  assert.deepEqual(await manager.checkForUpdates(), { status: "cancelled" });
  assert.deepEqual(actions(calls), ["fetch"]);
});
test("manual current check explicitly reports installed version", async () => {
  const { manager, dialogs } = fixture({ settings: { fetch: async () => ({ ok: true, json: async () => ({ ...release(), tag_name: "desktop-v0.1.0" }) }) } });
  assert.deepEqual(await manager.checkForUpdates(), { status: "current" }); assert.match(dialogs[0].message, /не требуется/);
});
test("manual offline check gives recoverable message without backup or quit", async () => {
  const { manager, calls, dialogs } = fixture({ answers: [0], settings: { fetch: async () => { throw new Error("Offline"); } } });
  assert.deepEqual(await manager.checkForUpdates(), { status: "error", phase: "network" }); assert.deepEqual(calls, []); assert.equal(dialogs.length, 1);
});
test("checksum/download failure restores view and cannot stop runtime or install", async () => {
  const { manager, calls } = fixture({ answers: [0], settings: { download: async () => { throw new Error("Checksum mismatch"); } } });
  assert.equal((await manager.checkForUpdates()).status, "error");
  assert.deepEqual(actions(calls), ["fetch", "begin", "recover"]);
});
test("staging failure cleans downloaded archive and restores view before data backup", async () => {
  const { manager, calls, dialogs } = fixture({ answers: [0], settings: { prepareInstaller: async () => { throw Object.assign(new Error("Read-only"), { userMessage: "Переместите приложение в папку Программы." }); } } });
  assert.equal((await manager.checkForUpdates()).phase, "preparation");
  assert.deepEqual(actions(calls), ["fetch", "begin", "download", "cleanup", "recover"]);
  assert.equal(dialogs.at(-1).detail, "Переместите приложение в папку Программы.");
});
test("backup failure or missing preparation callback never installs and restores runtime", async () => {
  for (const prepareUpdate of [undefined, async () => { throw new Error("Backup failed"); }]) {
    const { manager, calls } = fixture({ answers: [0], settings: { prepareUpdate } });
    assert.equal((await manager.checkForUpdates()).phase, "preparation");
    assert.deepEqual(actions(calls), ["fetch", "begin", "download", "stage", "dispose", "cleanup", "recover"]);
  }
});
test("installer launch failure after backup restores runtime and retains current process", async () => {
  const { manager, calls } = fixture({ answers: [0], settings: { prepareInstaller: async () => ({ install: async () => { throw new Error("Launch failed"); }, dispose: async () => calls.push("dispose") }) } });
  assert.equal((await manager.checkForUpdates()).phase, "preparation");
  assert.deepEqual(actions(calls), ["fetch", "begin", "download", "backup", "dispose", "cleanup", "recover"]);
});
test("partially failed UI hook is restored", async () => {
  const { manager, calls } = fixture({ answers: [0], settings: { beginUpdate: async () => { throw new Error("Load failed"); } } });
  await manager.checkForUpdates(); assert.deepEqual(actions(calls), ["fetch", "recover"]);
});
test("download can be cancelled with no backup/install or error popup", async () => {
  let started;
  const downloading = new Promise((resolve) => { started = resolve; });
  const { manager, calls, dialogs } = fixture({ answers: [0], settings: { download: async ({ signal }) => {
    started(); await new Promise((_, reject) => signal.addEventListener("abort", () => reject(signal.reason), { once: true }));
  } } });
  const task = manager.checkAtStartup(); await downloading;
  assert.equal(manager.cancelDownload(), true);
  assert.deepEqual(await task, { status: "cancelled" });
  assert.deepEqual(actions(calls), ["fetch", "begin", "recover"]); assert.equal(dialogs.length, 1);
});
test("cancellation during staging disposes stage after finishing and never starts backup", async () => {
  let started; let finish;
  const staging = new Promise((resolve) => { started = resolve; });
  const { manager, calls } = fixture({ answers: [0], settings: { prepareInstaller: () => { started(); return new Promise((resolve) => { finish = () => resolve({ install: () => calls.push("install"), dispose: async () => calls.push("dispose") }); }); } } });
  const task = manager.checkForUpdates(); await staging; manager.cancelDownload(); finish();
  assert.equal((await task).status, "cancelled");
  assert.deepEqual(actions(calls), ["fetch", "begin", "download", "dispose", "cleanup", "recover"]);
});
test("concurrent startup/manual checks share workflow and cannot install twice", async () => {
  const { manager, calls } = fixture({ answers: [0] });
  const first = manager.checkAtStartup(); assert.equal(first, manager.checkForUpdates());
  await first; assert.equal(actions(calls).filter((item) => item === "install").length, 1);
});
test("dispose during backup prevents installer and quit; ordinary quit never applies update", async () => {
  let start; let finish;
  const preparing = new Promise((resolve) => { start = resolve; });
  const { manager, calls } = fixture({ answers: [0], settings: { prepareUpdate: () => { start(); return new Promise((resolve) => { finish = resolve; }); } } });
  const first = manager.checkForUpdates(); await preparing;
  assert.equal(manager.cancelDownload(), false); manager.dispose(); finish();
  assert.deepEqual(await first, { status: "disposed" });
  assert.deepEqual(actions(calls), ["fetch", "begin", "download", "stage", "dispose", "cleanup"]);
});
test("Mac chooses ZIP for automatic replacement, exact architecture first then universal", async () => {
  for (const name of ["fresh-supply-0.2.0-mac-arm64.zip", "fresh-supply-0.2.0-mac-universal.zip", "OvoshiHelp-0.2.0-mac-arm64.zip"]) {
    const { manager, dialogs } = fixture({ settings: { platform: "darwin", arch: "arm64", fetch: async () => ({ ok: true, json: async () => release(name) }) } });
    assert.equal((await manager.checkForUpdates()).status, "cancelled"); assert.deepEqual(dialogs[0].buttons, ["Обновить", "Позже"]);
  }
  assert.equal(selectAsset({ ...release("fresh-supply-0.2.0-mac-universal.zip"), assets: [release("fresh-supply-0.2.0-mac-universal.zip").assets[0], release("fresh-supply-0.2.0-mac-arm64.zip").assets[0]] }, "darwin", "arm64").name, "fresh-supply-0.2.0-mac-arm64.zip");
});
test("rejects draft/prerelease/unrelated/incompatible/unsigned metadata before download", async () => {
  for (const metadata of [
    { ...release(), draft: true }, { ...release(), prerelease: true }, { ...release(), tag_name: "v0.2.0" },
    release("fresh-supply-0.2.0-mac-arm64.dmg"), { ...release(), assets: [{ name: release().assets[0].name, size: 1024 }] },
    { ...release(), assets: [{ ...release().assets[0], size: -1 }] },
  ]) {
    const { manager, calls } = fixture({ answers: [0], settings: { fetch: async () => ({ ok: true, json: async () => metadata }) } });
    assert.equal((await manager.checkForUpdates()).status, "error"); assert.deepEqual(calls, []);
  }
});
test("development manual check opens trusted Releases only, never installs", async () => {
  const { manager, calls } = fixture({ answers: [0], settings: { app: { isPackaged: false, getVersion: () => "0.1.0" } } });
  assert.equal((await manager.checkForUpdates()).status, "download-page-opened");
  assert.deepEqual(actions(calls), ["fetch", "external"]);
  assert.equal(calls[1][1], "https://github.com/ozLPanda/fresh-supply/releases/tag/desktop-v0.2.0");
});
test("rejects untrusted release sources, credentials, queries, hash and HTTP", () => {
  for (const releaseUrl of ["http://github.com/a/b/releases", "https://user:secret@github.com/a/b/releases", "https://evil.invalid/a/b/releases", "https://github.com/a/b/releases?secret=token", "https://github.com/a/b/releases#fragment"]) assert.throws(() => fixture({ settings: { releaseUrl } }), /HTTPS GitHub Releases/);
});

test("normal quit cancels a queued check immediately; failed quit can check again", async () => {
  const { manager, calls } = fixture();
  const queued = manager.checkForUpdates();
  manager.cancelCheck();
  assert.deepEqual(await queued, { status: "cancelled" });
  assert.deepEqual(calls, []);
  assert.deepEqual(await manager.checkForUpdates(), { status: "cancelled" });
  assert.deepEqual(actions(calls), ["fetch"]);
});
