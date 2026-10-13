const test = require("node:test");
const assert = require("node:assert/strict");
const vm = require("node:vm");
const fs = require("node:fs");
const path = require("node:path");
const { EventEmitter } = require("node:events");
const { createUpdateManager } = require("../src/updates.cjs");
const tick = () => new Promise((resolve) => setImmediate(resolve));

async function launch({
  firstRun = false,
  decline = false,
  installFailure = false,
  backupFailure = false,
  download,
  installationResult,
  runtimeFailure,
  repairChoice = 0,
} = {}) {
  const calls = [];
  const handlers = new Map();
  const dialogs = [];
  let ready;
  let window;
  let manager;
  const app = new EventEmitter();
  Object.assign(app, {
    isPackaged: true,
    getVersion: () => "0.1.5",
    name: "fresh-supply",
    setName() {},
    setPath() {},
    getPath: (name) =>
      name === "exe"
        ? "/Applications/fresh-supply.app/Contents/MacOS/fresh-supply"
        : "/fake/private/userdata",
    requestSingleInstanceLock: () => true,
    whenReady: () =>
      new Promise((resolve) => {
        ready = resolve;
      }),
    quit: () => {
      const event = {
        prevented: false,
        preventDefault() {
          this.prevented = true;
        },
      };
      app.emit("before-quit", event);
      calls.push(event.prevented ? "quit-blocked" : "quit");
    },
  });
  class Window extends EventEmitter {
    constructor() {
      super();
      window = this;
      this.url = "";
      this.webContents = new EventEmitter();
      Object.assign(this.webContents, {
        getURL: () => this.url,
        send: (channel, payload) => calls.push(["status", payload]),
        setWindowOpenHandler() {},
      });
    }
    async loadFile(file) {
      this.url = require("node:url").pathToFileURL(file).href;
      calls.push("startup-view");
    }
    async loadURL(url) {
      this.url = url;
      calls.push(["view", url]);
    }
    setProgressBar() {}
    isDestroyed() {
      return false;
    }
    isMinimized() {
      return false;
    }
    show() {}
    focus() {}
  }
  class Runtime extends EventEmitter {
    constructor() {
      super();
      this.started = false;
      this.url = "http://127.0.0.1:5555";
      this.logsDir = "/fake/logs";
    }
    async isFirstRun() {
      return firstRun;
    }
    async start() {
      calls.push("runtime-start");
      if (runtimeFailure) throw runtimeFailure;
      this.started = true;
      return this.url;
    }
    async stop() {
      calls.push("runtime-stop");
      this.started = false;
    }
    async backup() {
      calls.push("backup");
      await this.stop();
      if (backupFailure) throw new Error("Failed backup");
      return "/fake/backup";
    }
  }
  const electron = {
    app,
    BrowserWindow: Window,
    Menu: { buildFromTemplate: (value) => value, setApplicationMenu() {} },
    dialog: {
      showMessageBox: async (...args) => {
        const options = args.at(-1);
        dialogs.push(options);
        return {
          response: options.buttons.includes("Скачать установщик")
            ? repairChoice
            : options.buttons[0] === "Обновить"
              ? decline
                ? 1
                : 0
              : 0,
        };
      },
    },
    shell: {
      openExternal(url) {
        calls.push(["external", url]);
      },
      openPath(file) {
        calls.push(["open-path", file]);
      },
    },
    ipcMain: { handle: (name, fn) => handlers.set(name, fn) },
    session: {
      defaultSession: {
        setPermissionCheckHandler() {},
        setPermissionRequestHandler() {},
        on() {},
        clearStorageData: async () => {},
      },
    },
  };
  const context = vm.createContext({
    console,
    Buffer,
    process: { env: {}, platform: "darwin", resourcesPath: "/fake/resources" },
    __dirname: path.resolve(__dirname, "../src"),
    URL,
    require: (name) => {
      if (name === "electron") return electron;
      if (name === "node:fs") return { mkdirSync() {} };
      if (name === "./runtime.cjs") return { LocalRuntime: Runtime };
      if (name === "./data-import.cjs")
        return {
          createDataImporter: () => ({
            recoverPendingImport: async () => {},
            captureBaseline: async () => {},
            inspectEligibility: async () => ({ eligible: true }),
          }),
        };
      if (name === "./mac-update.cjs")
        return {
          prepareMacUpdate: async () => ({
            install: async () => {
              calls.push("installer");
              if (installFailure) throw new Error("Launch failed");
            },
            dispose: async () => {},
          }),
          confirmMacUpdateStarted: async () => calls.push("healthy"),
        };
      if (name === "./windows-update.cjs") return {};
      if (name === "./installation-status.cjs")
        return {
          readInstallResult: async () => installationResult || null,
          acknowledgeInstallResult: async () =>
            calls.push("acknowledge-installation"),
        };
      if (name === "./updates.cjs")
        return {
          createUpdateManager: (options) => {
            manager = createUpdateManager({
              ...options,
              platform: "darwin",
              arch: "arm64",
              cleanupDownload: async () => {},
              fetch: async () => {
                calls.push("check");
                return {
                  ok: true,
                  json: async () => ({
                    tag_name: "desktop-v0.1.6",
                    assets: [
                      {
                        name: "fresh-supply-0.1.6-mac-arm64.zip",
                        digest: "sha256:" + "a".repeat(64),
                        size: 1,
                      },
                    ],
                  }),
                };
              },
              download:
                download ||
                (async () => {
                  calls.push("download");
                  return "/fake/update.zip";
                }),
            });
            return manager;
          },
        };
      return require(
        name.startsWith("./") ? path.resolve(__dirname, "../src", name) : name,
      );
    },
  });
  vm.runInContext(
    fs.readFileSync(path.resolve(__dirname, "../src/main.cjs"), "utf8"),
    context,
  );
  ready();
  await tick();
  if (firstRun) {
    const event = {
      sender: window.webContents,
      senderFrame: { url: window.url },
    };
    const result = await handlers.get("desktop:setup")(event, {
      phone: "+77000000000",
      password: "private-test-password",
    });
    assert.equal(result.ok, true);
  }
  await tick();
  const settled = async () => {
    for (let i = 0; i < 50 && manager?.getState().busy; i++) await tick();
  };
  return { calls, app, window, manager, handlers, dialogs, settled };
}

test("real main startup schedules update only after runtime is ready and performs backup before quit", async () => {
  const result = await launch();
  await result.settled();
  assert.ok(
    result.calls.indexOf("runtime-start") < result.calls.indexOf("check"),
  );
  assert.ok(result.calls.indexOf("backup") < result.calls.indexOf("installer"));
  assert.ok(result.calls.indexOf("installer") < result.calls.indexOf("quit"));
  assert.equal(result.calls.filter((item) => item === "check").length, 1);
});
test("first-run setup/import are uninterrupted; startup prompt follows import cancellation", async () => {
  const result = await launch({ firstRun: true, decline: true });
  assert.equal(result.calls.includes("check"), false);
  const event = {
    sender: result.window.webContents,
    senderFrame: { url: result.window.url },
  };
  assert.equal(
    (await result.handlers.get("desktop:import-cancel")(event)).ok,
    true,
  );
  await result.settled();
  assert.equal(result.calls.filter((item) => item === "check").length, 1);
  assert.equal(result.calls.includes("backup"), false);
});
test("backup or installer launch failure restarts runtime and restores original view without quitting", async () => {
  for (const settings of [{ backupFailure: true }, { installFailure: true }]) {
    const result = await launch(settings);
    await result.settled();
    assert.equal(
      result.calls.filter((item) => item === "runtime-start").length,
      2,
    );
    assert.equal(result.window.url, "http://127.0.0.1:5555/admin/login");
    assert.equal(result.calls.includes("quit"), false);
    assert.equal(result.manager.getState().busy, false);
  }
});
test("close during download cancels and restores view, untrusted renderer cannot cancel", async () => {
  let started;
  const downloading = new Promise((resolve) => {
    started = resolve;
  });
  const result = await launch({
    download: async ({ signal }) => {
      started();
      await new Promise((_, reject) =>
        signal.addEventListener("abort", () => reject(signal.reason), {
          once: true,
        }),
      );
    },
  });
  await downloading;
  const untrusted = { sender: {}, senderFrame: { url: result.window.url } };
  assert.ok(
    (await result.handlers.get("desktop:update-cancel")(untrusted)).error,
  );
  const event = {
    prevented: false,
    preventDefault() {
      this.prevented = true;
    },
  };
  result.window.emit("close", event);
  assert.equal(event.prevented, true);
  await result.settled();
  assert.equal(result.calls.includes("backup"), false);
  assert.equal(result.window.url, "http://127.0.0.1:5555/admin/login");
});

test("post-exit installer failure is shown and acknowledged before opening the existing database", async () => {
  const result = await launch({
    decline: true,
    installationResult: {
      status: "failed",
      version: "0.1.9",
      message: "Подтверждение Windows отменено.",
    },
  });
  await result.settled();
  assert.match(result.dialogs[0].message, /0\.1\.9.*не завершено/);
  assert.match(result.dialogs[0].detail, /Подтверждение Windows отменено/);
  assert.ok(
    result.calls.indexOf("acknowledge-installation") <
      result.calls.indexOf("runtime-start"),
  );
  assert.equal(result.calls.includes("backup"), false);
});

test("incomplete runtime offers a repair installer and retains the application data path", async () => {
  const error = Object.assign(
    new Error("Недоступные файлы: python/python.exe"),
    { code: "DESKTOP_RUNTIME_INCOMPLETE" },
  );
  const result = await launch({ runtimeFailure: error, repairChoice: 1 });
  for (let i = 0; i < 5; i++) await tick();
  const failure = result.dialogs.find((d) =>
    d.buttons.includes("Скачать установщик"),
  );
  assert.ok(failure);
  assert.match(
    failure.detail,
    /Не удаляйте папку данных: \/fake\/private\/userdata/,
  );
  assert.ok(
    result.calls.some(
      (c) =>
        Array.isArray(c) &&
        c[0] === "external" &&
        c[1] === "https://github.com/ozLPanda/fresh-supply/releases/latest",
    ),
  );
  assert.equal(result.calls.includes("backup"), false);
  assert.equal(result.calls.includes("check"), false);
});
