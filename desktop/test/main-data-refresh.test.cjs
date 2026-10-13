const test = require("node:test");
const assert = require("node:assert/strict");
const vm = require("node:vm");
const fs = require("node:fs");
const path = require("node:path");
const { EventEmitter } = require("node:events");
const tick = () => new Promise((resolve) => setImmediate(resolve));

async function launch({
  eligible = false,
  confirmation = 1,
  entryConfirmation = 0,
  importFailure = false,
  importGate,
} = {}) {
  const calls = [],
    dialogs = [],
    handlers = new Map();
  let ready, window, menu;
  const app = new EventEmitter();
  Object.assign(app, {
    isPackaged: false,
    getVersion: () => "0.1.7",
    setName() {},
    setPath() {},
    getPath: () => "/fake/userdata",
    requestSingleInstanceLock: () => true,
    whenReady: () =>
      new Promise((resolve) => {
        ready = resolve;
      }),
    quit() {},
  });
  class Window extends EventEmitter {
    constructor() {
      super();
      window = this;
      this.url = "";
      this.webContents = new EventEmitter();
      Object.assign(this.webContents, {
        getURL: () => this.url,
        send: (_channel, payload) => calls.push(["status", payload]),
        setWindowOpenHandler() {},
      });
    }
    async loadFile(file) {
      this.url = require("node:url").pathToFileURL(file).href;
    }
    async loadURL(url) {
      this.url = url;
      calls.push(["view", url]);
    }
    isDestroyed() {
      return false;
    }
    show() {}
    setProgressBar() {}
  }
  class Runtime extends EventEmitter {
    constructor() {
      super();
      this.started = false;
      this.url = "http://127.0.0.1:5555";
    }
    async isFirstRun() {
      return false;
    }
    async start() {
      this.started = true;
      return this.url;
    }
  }
  const importer = {
    recoverPendingImport: async () => {},
    inspectEligibility: async () => {
      calls.push("eligibility");
      return { eligible };
    },
    importFromSource: async (options) => {
      calls.push(["import", options.mode]);
      if (importGate) await importGate;
      if (importFailure) throw { userMessage: "Ошибка проверки копии сайта" };
      if (options.mode === "replace") {
        calls.push("validated");
        if (
          !(await options.confirmReplacement({
            sourceUrl: "https://site.example/",
            rows: 20,
            files: 3,
          }))
        )
          return { cancelled: true };
      } else assert.equal(options.confirmReplacement, undefined);
      calls.push("replace-data");
      return { imported: true, backup: "/fake/backups/before-data-refresh" };
    },
  };
  const electron = {
    app,
    BrowserWindow: Window,
    Menu: {
      buildFromTemplate: (value) => value,
      setApplicationMenu: (value) => {
        menu = value;
      },
    },
    dialog: {
      showMessageBox: async (...args) => {
        const options = args.at(-1);
        dialogs.push(options);
        calls.push(["dialog", options.message]);
        return {
          response:
            options.buttons[0] === "Заменить данные"
              ? confirmation
              : options.buttons[0] === "Продолжить"
                ? entryConfirmation
                : 0,
        };
      },
    },
    shell: {},
    ipcMain: { handle: (name, fn) => handlers.set(name, fn) },
    session: {
      defaultSession: {
        setPermissionCheckHandler() {},
        setPermissionRequestHandler() {},
        on() {},
        clearStorageData: async (options) =>
          calls.push(["clear-storage", options]),
      },
    },
  };
  const context = vm.createContext({
    console,
    URL,
    process: { env: {}, platform: "win32" },
    __dirname: path.resolve(__dirname, "../src"),
    require: (name) => {
      if (name === "electron") return electron;
      if (name === "node:fs") return { mkdirSync() {} };
      if (name === "./runtime.cjs") return { LocalRuntime: Runtime };
      if (name === "./data-import.cjs")
        return { createDataImporter: () => importer };
      if (name === "./updates.cjs")
        return {
          createUpdateManager: () => ({
            getState: () => ({ busy: false }),
            checkAtStartup: async () => {},
          }),
        };
      if (["./mac-update.cjs", "./windows-update.cjs"].includes(name))
        return {};
      if (name === "./installation-status.cjs")
        return {
          readInstallResult: async () => null,
          acknowledgeInstallResult: async () => {},
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
  await tick();
  window.url = "http://127.0.0.1:5555/admin/products?search=apple";
  const click = async (label) => {
    const item = menu
      .flatMap((entry) => entry.submenu || [])
      .find((entry) => entry.label === label);
    assert.ok(item);
    assert.equal(item.enabled, true);
    item.click();
    await tick();
    await tick();
  };
  const event = () => ({
    sender: window.webContents,
    senderFrame: { url: window.url },
  });
  const submit = (extra = {}) =>
    handlers.get("desktop:import")(event(), {
      url: "https://site.example",
      phone: "+77000000000",
      password: "private-test-only",
      ...extra,
    });
  return { calls, dialogs, handlers, window, click, event, submit, app };
}

test("filled local database retains initial-import guard but can open explicit data refresh", async () => {
  const result = await launch();
  await result.click("Загрузить данные с сайта…");
  assert.match(result.dialogs.at(-1).message, /пустую/);
  assert.equal(result.window.url.includes("/admin/products"), true);
  await result.click("Заменить все данные копией сайта…");
  assert.equal(result.calls.filter((item) => item === "eligibility").length, 1);
  assert.equal(result.calls.at(-1)[1].importMode, "replace");
});

test("refresh confirmation defaults to cancellation and keeps local session and return route", async () => {
  const result = await launch();
  await result.click("Заменить все данные копией сайта…");
  const clearedBefore = result.calls.filter(
    (item) => item[0] === "clear-storage",
  ).length;
  assert.equal(
    (await result.submit({ mode: "initial", confirmed: true })).cancelled,
    true,
  );
  assert.equal(
    result.calls.some((item) => item[0] === "import" && item[1] === "replace"),
    true,
  );
  assert.equal(result.calls.includes("replace-data"), false);
  const dialog = result.dialogs.at(-1);
  assert.equal(dialog.defaultId, 1);
  assert.equal(dialog.cancelId, 1);
  assert.match(dialog.detail, /резервной копии/);
  assert.ok(
    result.calls.indexOf("validated") <
      result.calls.findIndex(
        (item) =>
          item[0] === "dialog" &&
          item[1].startsWith("Заменить локальные данные"),
      ),
  );
  assert.equal(
    result.calls.filter((item) => item[0] === "clear-storage").length,
    clearedBefore,
  );
  assert.equal(
    (await result.handlers.get("desktop:import-cancel")(result.event())).ok,
    true,
  );
  assert.equal(
    result.window.url,
    "http://127.0.0.1:5555/admin/products?search=apple",
  );
});

test("confirmed refresh clears old authentication and shows backup location before website login", async () => {
  const result = await launch({ confirmation: 0 });
  await result.click("Заменить все данные копией сайта…");
  assert.equal((await result.submit()).ok, true);
  assert.equal(result.calls.includes("replace-data"), true);
  assert.equal(
    result.calls.some(
      (item) =>
        item[0] === "clear-storage" && item[1].storages.includes("cookies"),
    ),
    true,
  );
  assert.match(
    result.dialogs.at(-1).detail,
    /\/fake\/backups\/before-data-refresh/,
  );
  assert.equal(result.window.url, "http://127.0.0.1:5555/admin/login");
});

test("cancelling refresh entry preserves the current edit page before replacing its document", async () => {
  const result = await launch({ entryConfirmation: 1 });
  const before = result.window.url;
  await result.click("Заменить все данные копией сайта…");
  assert.equal(result.window.url, before);
  assert.equal(result.dialogs.at(-1).defaultId, 1);
  assert.match(result.dialogs.at(-1).detail, /Несохранённый ввод/);
  assert.equal(
    result.calls.some(
      (item) => item[0] === "status" && item[1].importMode === "replace",
    ),
    false,
  );
  assert.equal(
    result.calls.some((item) => item[0] === "import"),
    false,
  );
});

test("renderer cannot upgrade initial import into replacement or call import from an untrusted frame", async () => {
  const result = await launch({ eligible: true });
  await result.click("Загрузить данные с сайта…");
  const untrusted = {
    ...result.event(),
    senderFrame: { url: "https://site.example" },
  };
  assert.ok((await result.handlers.get("desktop:import")(untrusted, {})).error);
  assert.equal(
    (await result.submit({ mode: "replace", confirmed: true })).ok,
    true,
  );
  assert.equal(
    result.calls.some((item) => item[0] === "import" && item[1] === "initial"),
    true,
  );
  assert.equal(
    result.dialogs.some((item) => item.buttons[0] === "Заменить данные"),
    false,
  );
});

test("invalid source keeps refresh mode for retry and allows returning without deleting data", async () => {
  const result = await launch({ importFailure: true });
  await result.click("Заменить все данные копией сайта…");
  assert.match((await result.submit()).error, /проверки/);
  assert.equal(result.calls.at(-1)[1].importMode, "replace");
  assert.equal(result.calls.includes("replace-data"), false);
  assert.equal(
    (await result.handlers.get("desktop:import-cancel")(result.event())).ok,
    true,
  );
});

test("in-progress refresh rejects duplicate submits and cancellation and blocks closing", async () => {
  let finish;
  const importGate = new Promise((resolve) => {
    finish = resolve;
  });
  const result = await launch({ importGate });
  await result.click("Заменить все данные копией сайта…");
  const operation = result.submit();
  await tick();
  assert.ok((await result.submit()).error);
  assert.ok(
    (await result.handlers.get("desktop:import-cancel")(result.event())).error,
  );
  for (const [target, name] of [
    [result.window, "close"],
    [result.app, "before-quit"],
  ]) {
    const event = {
      prevented: false,
      preventDefault() {
        this.prevented = true;
      },
    };
    target.emit(name, event);
    assert.equal(event.prevented, true);
  }
  finish();
  assert.equal((await operation).cancelled, true);
  assert.equal(
    (await result.handlers.get("desktop:import-cancel")(result.event())).ok,
    true,
  );
});

test("default refresh merges without erasing login or contextual list state", async () => {
  const result = await launch();
  const before = result.window.url;
  const clearedBefore = result.calls.filter(
    (item) => item[0] === "clear-storage",
  ).length;
  await result.click("Обновить данные с сайта…");
  assert.equal(result.calls.at(-1)[1].importMode, "merge");
  assert.equal(
    (await result.submit({ mode: "replace", confirmed: true })).ok,
    true,
  );
  assert.ok(
    result.calls.some((item) => item[0] === "import" && item[1] === "merge"),
  );
  assert.equal(
    result.calls.filter((item) => item[0] === "clear-storage").length,
    clearedBefore,
  );
  assert.equal(
    result.dialogs.some((item) => item.buttons[0] === "Заменить данные"),
    false,
  );
  assert.match(result.dialogs.at(-1).message, /объединены/);
  assert.equal(result.window.url, before);
});

test("cancelled merge returns to the same filtered list without importing", async () => {
  const result = await launch();
  const before = result.window.url;
  await result.click("Обновить данные с сайта…");
  assert.equal(
    (await result.handlers.get("desktop:import-cancel")(result.event())).ok,
    true,
  );
  assert.equal(result.window.url, before);
  assert.equal(
    result.calls.some((item) => item[0] === "import"),
    false,
  );
});
