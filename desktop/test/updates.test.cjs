const test = require("node:test");
const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const { createUpdateManager, isNewerVersion } = require("../src/updates.cjs");

function fixture(options = {}) {
  const calls = [];
  const dialogs = [];
  const answers = [...(options.answers || [])];
  const updater = new EventEmitter();
  updater.checkForUpdates = async () => {
    calls.push("check");
    return { updateInfo: { version: "0.2.0", releaseNotes: "New release" } };
  };
  updater.downloadUpdate = async () => {
    calls.push("download");
    updater.emit("update-downloaded", { version: "0.2.0" });
    return ["installer.exe"];
  };
  updater.quitAndInstall = () => calls.push("install");
  const app = {
    isPackaged: true,
    getVersion: () => "0.1.0",
    quit: () => calls.push("quit"),
  };
  const settings = {
    app,
    dialog: {
      showMessageBox: async (details) => {
        dialogs.push(details);
        return { response: answers.shift() ?? details.cancelId ?? 0 };
      },
    },
    shell: { openExternal: async (url) => calls.push(["external", url]) },
    autoUpdater: updater,
    prepareUpdate: async () => calls.push("backup"),
    logger: { warn() {} },
    allowAutomaticUpdates: true,
    platform: "win32",
    arch: "x64",
    fetch: async (url, settings) => {
      calls.push(["fetch", url, settings]);
      return {
        ok: true,
        json: async () => ({
          tag_name: "desktop-v0.2.0",
          body: "New release",
          assets: [{ name: "OvoshiHelp-0.2.0-win-x64.exe" }],
          html_url: "https://evil.invalid/download",
        }),
      };
    },
    ...options.settings,
  };
  const manager = createUpdateManager(settings);
  return { manager, updater, calls, dialogs, app };
}

test("numeric stable version comparison excludes prereleases and downgrades", () => {
  assert.equal(isNewerVersion("desktop-v0.10.0", "0.9.0"), true);
  assert.equal(isNewerVersion("1.0.0-beta", "0.9.0"), false);
  assert.equal(isNewerVersion("v0.1.0", "0.2.0"), false);
  assert.equal(isNewerVersion("1.0.0", "1.0.0"), false);
});

test("does not check at startup, download automatically, or install on quit", () => {
  const { manager, updater, calls } = fixture();
  assert.deepEqual(calls, []);
  assert.equal(updater.autoDownload, false);
  assert.equal(updater.autoInstallOnAppQuit, false);
  assert.equal(updater.allowPrerelease, false);
  assert.equal(updater.allowDowngrade, false);
  manager.dispose();
});

test("explicit consent and successful backup precede installation even for cached event", async () => {
  const { manager, calls } = fixture({ answers: [0, 0] });
  assert.deepEqual(await manager.checkForUpdates(), { status: "installing" });
  assert.deepEqual(calls, ["check", "download", "backup", "install"]);
  assert.equal(manager.getState().busy, false);
  manager.dispose();
});

test("declining download does not create backup or install", async () => {
  const { manager, calls } = fixture({ answers: [1] });
  assert.deepEqual(await manager.checkForUpdates(), { status: "cancelled" });
  assert.deepEqual(calls, ["check"]);
  manager.dispose();
});

test("declining install leaves downloaded update without backup or quit", async () => {
  const { manager, calls, updater } = fixture({ answers: [0, 1] });
  assert.deepEqual(await manager.checkForUpdates(), { status: "downloaded" });
  assert.deepEqual(calls, ["check", "download"]);
  assert.equal(updater.autoInstallOnAppQuit, false);
  manager.dispose();
});

test("backup failure never invokes installer or quits the application", async () => {
  const { manager, calls, dialogs } = fixture({
    answers: [0, 0, 0],
    settings: {
      prepareUpdate: async () => {
        throw new Error("Backup failed");
      },
    },
  });
  assert.deepEqual(await manager.checkForUpdates(), {
    status: "error",
    phase: "preparation",
  });
  assert.deepEqual(calls, ["check", "download"]);
  assert.match(dialogs.at(-1).message, /отменена/);
  manager.dispose();
});

test("missing preparation callback fails closed", async () => {
  const { manager, calls } = fixture({
    answers: [0, 0, 0],
    settings: { prepareUpdate: undefined },
  });
  assert.equal((await manager.checkForUpdates()).phase, "preparation");
  assert.deepEqual(calls, ["check", "download"]);
  manager.dispose();
});

test("offline updater errors remain handled without changing local installation", async () => {
  const { manager, updater, calls } = fixture({ answers: [0] });
  updater.checkForUpdates = async () => {
    updater.emit("error", new Error("Offline"));
    throw new Error("Offline");
  };
  assert.equal((await manager.checkForUpdates()).status, "error");
  assert.deepEqual(calls, []);
  manager.dispose();
});

test("download failure never prepares data or installs", async () => {
  const { manager, updater, calls } = fixture({ answers: [0, 0] });
  updater.downloadUpdate = async () => {
    throw new Error("Interrupted");
  };
  assert.equal((await manager.checkForUpdates()).status, "error");
  assert.deepEqual(calls, ["check"]);
  manager.dispose();
});

test("unsigned distribution uses public API and trusted Releases page, then backup and quit", async () => {
  const { manager, calls } = fixture({
    answers: [0, 0],
    settings: { allowAutomaticUpdates: false },
  });
  assert.equal((await manager.checkForUpdates()).status, "installing");
  assert.deepEqual(
    calls.map((call) => (Array.isArray(call) ? call[0] : call)),
    ["fetch", "external", "backup", "quit"],
  );
  assert.equal(
    calls[0][1],
    "https://api.github.com/repos/ozLPanda/fresh-supply/releases/latest",
  );
  assert.equal(calls[0][2].headers.Authorization, undefined);
  assert.equal(
    calls[1][1],
    "https://github.com/ozLPanda/fresh-supply/releases/tag/desktop-v0.2.0",
  );
  manager.dispose();
});

test("development builds stay manual even if automatic mode requested", async () => {
  const { manager, app, calls } = fixture({
    answers: [1],
    settings: {
      app: { isPackaged: false, getVersion: () => "0.1.0" },
    },
  });
  await manager.checkForUpdates();
  assert.equal(calls[0][0], "fetch");
  assert.equal(manager.getState().automatic, false);
  manager.dispose();
});

test("manual download does not prepare or quit until user is ready", async () => {
  const { manager, calls } = fixture({
    answers: [0, 1],
    settings: { allowAutomaticUpdates: false },
  });
  assert.equal(
    (await manager.checkForUpdates()).status,
    "download-page-opened",
  );
  assert.deepEqual(
    calls.map((call) => call[0]),
    ["fetch", "external"],
  );
  manager.dispose();
});

test("manual backup failure never quits", async () => {
  const { manager, calls } = fixture({
    answers: [0, 0, 0],
    settings: {
      allowAutomaticUpdates: false,
      prepareUpdate: async () => {
        throw new Error("Backup failed");
      },
    },
  });
  assert.equal((await manager.checkForUpdates()).phase, "preparation");
  assert.equal(calls.includes("quit"), false);
  manager.dispose();
});

test("offline unsigned build keeps current installation and does not stop local components", async () => {
  const { manager, calls } = fixture({
    answers: [0],
    settings: {
      allowAutomaticUpdates: false,
      fetch: async () => {
        throw new Error("Offline");
      },
    },
  });
  assert.equal((await manager.checkForUpdates()).status, "error");
  assert.deepEqual(calls, []);
  manager.dispose();
});

test("unsigned Mac accepts a universal desktop installer without invoking updater", async () => {
  const { manager, calls } = fixture({
    answers: [1],
    settings: {
      allowAutomaticUpdates: false,
      platform: "darwin",
      arch: "arm64",
      fetch: async () => ({
        ok: true,
        json: async () => ({
          tag_name: "desktop-v0.2.0",
          assets: [{ name: "OvoshiHelp-0.2.0-mac-universal.dmg" }],
        }),
      }),
    },
  });
  assert.deepEqual(await manager.checkForUpdates(), { status: "cancelled" });
  assert.deepEqual(calls, []);
  manager.dispose();
});

test("manual check excludes unrelated releases, prereleases and incompatible installers", async () => {
  for (const release of [
    { tag_name: "v0.2.0", assets: [{ name: "OvoshiHelp-0.2.0-win-x64.exe" }] },
    { tag_name: "desktop-v0.2.0", prerelease: true },
    { tag_name: "desktop-v0.2.0", draft: true },
    {
      tag_name: "desktop-v0.2.0",
      assets: [{ name: "OvoshiHelp-0.2.0-mac-arm64.dmg" }],
    },
  ]) {
    const { manager, calls } = fixture({
      answers: [0],
      settings: {
        allowAutomaticUpdates: false,
        fetch: async () => ({ ok: true, json: async () => release }),
      },
    });
    assert.equal((await manager.checkForUpdates()).status, "error");
    assert.deepEqual(calls, []);
    manager.dispose();
  }
});

test("concurrent checks share one workflow; dispose during preparation prevents install", async () => {
  let releaseBackup;
  let notifyBackup;
  const backupStarted = new Promise((resolve) => {
    notifyBackup = resolve;
  });
  const { manager, calls } = fixture({
    answers: [0, 0],
    settings: {
      prepareUpdate: () => {
        notifyBackup();
        return new Promise((resolve) => {
          releaseBackup = resolve;
        });
      },
    },
  });
  const first = manager.checkForUpdates();
  assert.equal(first, manager.checkForUpdates());
  await backupStarted;
  manager.dispose();
  releaseBackup();
  assert.deepEqual(await first, { status: "disposed" });
  assert.deepEqual(calls, ["check", "download"]);
});

test("rejects non-GitHub sources and URL credentials", () => {
  for (const releaseUrl of [
    "http://github.com/a/b/releases",
    "https://user:secret@github.com/a/b/releases",
    "https://evil.invalid/a/b/releases",
    "https://github.com/a/b/releases?secret=token",
  ]) {
    assert.throws(
      () => fixture({ settings: { releaseUrl } }),
      /HTTPS GitHub Releases/,
    );
  }
});
