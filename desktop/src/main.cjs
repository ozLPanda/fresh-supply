const {
  app,
  BrowserWindow,
  Menu,
  dialog,
  shell,
  ipcMain,
  session,
} = require("electron");
const path = require("node:path");
const { mkdirSync } = require("node:fs");
const { pathToFileURL } = require("node:url");
const { LocalRuntime } = require("./runtime.cjs");
const { createUpdateManager } = require("./updates.cjs");
const { isLocalUrl, allowPopup } = require("./navigation.cjs");
const { createDataImporter } = require("./data-import.cjs");

app.setName("fresh-supply");
// Keep the pre-rename location so updates retain the existing database and lock.
const dataDirectory = process.env.OVOSHI_DESKTOP_USER_DATA
  ? path.resolve(process.env.OVOSHI_DESKTOP_USER_DATA)
  : path.join(app.getPath("appData"), "Ovoshi Help");
mkdirSync(dataDirectory, { recursive: true, mode: 0o700 });
app.setPath("userData", dataDirectory);
const hasLock = app.requestSingleInstanceLock();
let window;
let runtime;
let updates;
let quitting = false;
let busy = false;
let setupPending;
let dataImporter;
let importFormActive = false;
let importInProgress = false;
let quitWhileImportMessage = false;
const startupFile = path.join(__dirname, "../ui/startup.html");
const startupUrl = pathToFileURL(startupFile).href;

if (!hasLock) app.quit();
else {
  app.on("second-instance", () => {
    if (window) {
      if (window.isMinimized()) window.restore();
      window.show();
      window.focus();
    }
  });
  app.whenReady().then(initialize).catch(showFailure);
  app.on("window-all-closed", () => app.quit());
  app.on("before-quit", (event) => {
    if (importInProgress) {
      event.preventDefault();
      showImportWait();
      return;
    }
    if (quitting || !runtime) return;
    event.preventDefault();
    busy = true;
    runtime
      .stop()
      .then(() => {
        quitting = true;
        updates?.dispose();
        app.quit();
      })
      .catch(async () => {
        busy = false;
        await dialog.showMessageBox({
          type: "error",
          title: "fresh-supply",
          message: "Не удалось завершить локальные компоненты.",
          detail:
            "Закрытие отменено. Проверьте журналы в папке данных приложения и повторите попытку.",
          buttons: ["OK"],
        });
      });
  });
}

function status(message) {
  if (window && !window.isDestroyed())
    window.webContents.send("desktop:status", { message });
}

function showImportWait() {
  if (quitWhileImportMessage) return;
  quitWhileImportMessage = true;
  void dialog
    .showMessageBox(window, {
      type: "info",
      title: "Перенос данных",
      message: "Перенос данных ещё идёт. Дождитесь его завершения.",
      buttons: ["OK"],
    })
    .finally(() => {
      quitWhileImportMessage = false;
    });
}

function isLocal(url) {
  return isLocalUrl(url, runtime?.url);
}

async function external(url) {
  try {
    const parsed = new URL(url);
    if (
      ["https:", "http:"].includes(parsed.protocol) &&
      !parsed.username &&
      !parsed.password
    )
      await shell.openExternal(url);
  } catch {
    /* malformed link */
  }
}

async function initialize() {
  const root = app.isPackaged
    ? path.join(process.resourcesPath, "runtime")
    : path.resolve(
        process.env.OVOSHI_DESKTOP_RUNTIME_ROOT ||
          path.join(__dirname, "../runtime"),
      );
  runtime = new LocalRuntime({
    root,
    userData: app.getPath("userData"),
    version: app.getVersion(),
  });
  dataImporter = createDataImporter({ runtime, version: app.getVersion() });
  await dataImporter.recoverPendingImport();
  runtime.on("progress", status);
  runtime.on("component-failed", async (name) => {
    if (!runtime.started || busy) return;
    busy = true;
    await runtime.stop().catch(() => {});
    await dialog.showMessageBox(window, {
      type: "error",
      title: "fresh-supply",
      message: "Локальный компонент остановился. Перезапустите приложение.",
      detail: `Журнал: ${path.join(runtime.logsDir, name + ".log")}`,
      buttons: ["OK"],
    });
    app.quit();
  });
  window = new BrowserWindow({
    width: 1440,
    height: 940,
    minWidth: 900,
    minHeight: 650,
    backgroundColor: "#f7f6f4",
    show: false,
    title: "fresh-supply",
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
      backgroundThrottling: false,
    },
  });
  window.once("ready-to-show", () => window.show());
  window.on("close", (event) => {
    if (importInProgress) {
      event.preventDefault();
      showImportWait();
    }
  });
  window.webContents.on("will-navigate", (event, url) => {
    if (!isLocal(url) && url !== startupUrl) {
      event.preventDefault();
      void external(url);
    }
  });
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (allowPopup(url, window.webContents.getURL(), runtime.url)) {
      return {
        action: "allow",
        overrideBrowserWindowOptions: {
          webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
            sandbox: true,
            webSecurity: true,
          },
        },
      };
    }
    void external(url);
    return { action: "deny" };
  });
  window.webContents.on("did-create-window", (preview) => {
    preview.webContents.on("will-navigate", (event, url) => {
      if (url !== "about:blank" && !isLocal(url)) {
        event.preventDefault();
        void external(url);
      }
    });
    preview.webContents.setWindowOpenHandler(({ url }) => {
      void external(url);
      return { action: "deny" };
    });
  });
  session.defaultSession.setPermissionCheckHandler(
    (_contents, permission, requestingOrigin) =>
      isLocal(requestingOrigin) &&
      ["media", "notifications", "clipboard-sanitized-write"].includes(
        permission,
      ),
  );
  session.defaultSession.setPermissionRequestHandler(
    async (contents, permission, callback) => {
      if (
        !isLocal(contents.getURL()) ||
        !["media", "notifications"].includes(permission)
      )
        return callback(false);
      const result = await dialog.showMessageBox(window, {
        type: "question",
        title: "fresh-supply",
        message:
          permission === "media"
            ? "Разрешить доступ к камере и микрофону?"
            : "Разрешить уведомления?",
        buttons: ["Разрешить", "Отмена"],
        defaultId: 1,
        cancelId: 1,
      });
      callback(result.response === 0);
    },
  );
  session.defaultSession.on("will-download", (_event, item) => {
    item.setSaveDialogOptions({
      title: "Сохранить файл",
      defaultPath: path.join(
        app.getPath("downloads"),
        path.basename(item.getFilename()),
      ),
    });
  });
  updates = createUpdateManager({
    app,
    dialog,
    shell,
    prepareUpdate: prepareUpdate,
    allowAutomaticUpdates: false,
    logger: { warn: () => {} },
  });
  installMenu();
  await window.loadFile(startupFile);
  let credentials;
  const firstRun = await runtime.isFirstRun();
  if (firstRun) credentials = await getBootstrapCredentials();
  await startRuntime(credentials, { initializeImport: firstRun });
  credentials = undefined;
  if (firstRun) await openDataImport();
}

function getBootstrapCredentials() {
  return new Promise((resolve) => {
    setupPending = resolve;
    window.webContents.send("desktop:status", { setup: true });
  });
}

ipcMain.handle("desktop:setup", (event, credentials) => {
  if (
    !setupPending ||
    event.sender !== window?.webContents ||
    event.senderFrame?.url !== startupUrl
  )
    return { error: "Настройка недоступна." };
  const { password, phone } = credentials || {};
  if (
    typeof password !== "string" ||
    password.length < 16 ||
    password.length > 64 ||
    Buffer.byteLength(password, "utf8") > 72
  )
    return {
      error: "Пароль должен содержать от 16 до 64 символов (не более 72 байт).",
    };
  if (typeof phone !== "string" || phone.length > 40)
    return { error: "Введите телефон с кодом страны +7." };
  let digits = phone.replace(/\D/g, "");
  if (digits.length === 10) digits = "7" + digits;
  if (digits.startsWith("8")) digits = "7" + digits.slice(1);
  if (digits.length !== 11 || !digits.startsWith("7"))
    return { error: "Введите телефон с кодом страны +7." };
  const resolve = setupPending;
  setupPending = null;
  resolve({ bootstrapPassword: password, bootstrapPhone: "+" + digits });
  return { ok: true };
});

async function startRuntime(credentials, { initializeImport = false } = {}) {
  busy = true;
  try {
    const url = await runtime.start(credentials);
    if (initializeImport) {
      try {
        await dataImporter.captureBaseline();
      } catch {
        /* An existing or modified database must never become a pristine baseline. */
      }
    }
    // Desktop versions own updates. A website service worker must not serve
    // stale assets after installing another desktop version.
    await session.defaultSession.clearStorageData({
      storages: ["serviceworkers", "cachestorage"],
    });
    await window.loadURL(`${url}/admin/login`);
  } finally {
    busy = false;
    installMenu();
  }
}

function trustedStartup(event) {
  return (
    event.sender === window?.webContents &&
    event.senderFrame?.url === startupUrl
  );
}

async function openDataImport() {
  if (busy || !runtime.started) return;
  busy = true;
  installMenu();
  try {
    const eligibility = await dataImporter.inspectEligibility();
    if (!eligibility.eligible) {
      await dialog.showMessageBox(window, {
        type: "info",
        title: "Перенос данных",
        message: "Загрузка доступна только в пустую локальную базу.",
        detail:
          eligibility.reason ||
          "В базе уже есть данные или настройки изменены.",
        buttons: ["OK"],
      });
      busy = false;
      installMenu();
      return;
    }
    await window.loadFile(startupFile);
    importFormActive = true;
    window.webContents.send("desktop:status", { import: true });
  } catch {
    busy = false;
    installMenu();
    await dialog.showMessageBox(window, {
      type: "warning",
      title: "Перенос данных",
      message:
        "Не удалось проверить локальную базу. Перезапустите приложение и попробуйте снова.",
      buttons: ["OK"],
    });
  }
}

ipcMain.handle("desktop:import", async (event, payload) => {
  if (!trustedStartup(event) || !importFormActive || importInProgress)
    return { error: "Загрузка сейчас недоступна." };
  if (
    !payload ||
    typeof payload.url !== "string" ||
    payload.url.length > 2048 ||
    typeof payload.phone !== "string" ||
    payload.phone.length > 40 ||
    typeof payload.password !== "string" ||
    payload.password.length < 8 ||
    payload.password.length > 100
  )
    return { error: "Введите адрес сайта, телефон и пароль." };
  importInProgress = true;
  busy = true;
  installMenu();
  try {
    await dataImporter.importFromSource({
      url: payload.url,
      phone: payload.phone,
      password: payload.password,
      onProgress: status,
    });
    payload.password = "";
    importFormActive = false;
    await session.defaultSession.clearStorageData({
      storages: ["cookies", "serviceworkers", "cachestorage"],
    });
    await dialog.showMessageBox(window, {
      type: "info",
      title: "Перенос данных",
      message: "Данные сайта загружены.",
      detail:
        "Теперь войдите с телефоном и паролем своей учётной записи на сайте. Дальнейшие изменения сохраняются в локальной копии.",
      buttons: ["OK"],
    });
    await window.loadURL(`${runtime.url}/admin/login`);
    busy = false;
    return { ok: true };
  } catch (error) {
    payload.password = "";
    window.webContents.send("desktop:status", { import: true });
    return {
      error:
        error.userMessage ||
        "Не удалось перенести данные. Проверьте URL, право полного экспорта и учётные данные сайта. Локальная база сохранена.",
    };
  } finally {
    importInProgress = false;
    installMenu();
  }
});

ipcMain.handle("desktop:import-cancel", async (event) => {
  if (!trustedStartup(event) || !importFormActive || importInProgress)
    return { error: "Дождитесь завершения переноса." };
  importFormActive = false;
  busy = false;
  await window.loadURL(`${runtime.url}/admin/login`);
  installMenu();
  return { ok: true };
});

async function prepareUpdate() {
  if (busy || !runtime.started)
    throw new Error("Приложение ещё не готово к обновлению");
  busy = true;
  installMenu();
  const wasUrl = window.webContents.getURL();
  await window.loadFile(startupFile);
  status("Создаём резервную копию перед обновлением…");
  try {
    const backup = await runtime.backup("before-install");
    await dialog.showMessageBox(window, {
      type: "info",
      title: "fresh-supply",
      message: "Резервная копия готова. Приложение закроется для обновления.",
      detail: backup,
      buttons: ["OK"],
    });
  } catch (error) {
    await runtime.start();
    await window.loadURL(
      isLocal(wasUrl) ? wasUrl : `${runtime.url}/admin/login`,
    );
    busy = false;
    installMenu();
    throw error;
  }
}

async function manualBackup() {
  if (busy || !runtime.started) return;
  const choice = await dialog.showMessageBox(window, {
    type: "question",
    title: "Резервная копия",
    message: "Создать копию локальной базы и файлов?",
    detail:
      "Сохраните изменения в открытых формах. Во время копирования работа приложения будет приостановлена.",
    buttons: ["Создать копию", "Отмена"],
    defaultId: 1,
    cancelId: 1,
  });
  if (choice.response !== 0) return;
  busy = true;
  installMenu();
  try {
    await window.loadFile(startupFile);
    status("Создаём резервную копию…");
    const backup = await runtime.backup();
    await startRuntime();
    await dialog.showMessageBox(window, {
      type: "info",
      title: "Резервная копия",
      message: "Копия сохранена.",
      detail: backup,
      buttons: ["OK"],
    });
  } catch (error) {
    await showFailure(error);
  } finally {
    busy = false;
    installMenu();
  }
}

async function manualRestore() {
  if (busy || !runtime.started) return;
  const selected = await dialog.showOpenDialog(window, {
    title: "Выберите резервную копию fresh-supply",
    defaultPath: runtime.backupsDir,
    properties: ["openDirectory"],
  });
  if (selected.canceled || !selected.filePaths[0]) return;
  const choice = await dialog.showMessageBox(window, {
    type: "warning",
    title: "Восстановление данных",
    message: "Восстановить базу и файлы из выбранной копии?",
    detail:
      "Изменения после создания выбранной копии исчезнут из текущей базы. Перед восстановлением будет сохранена отдельная копия текущих данных.",
    buttons: ["Восстановить", "Отмена"],
    defaultId: 1,
    cancelId: 1,
  });
  if (choice.response !== 0) return;
  busy = true;
  installMenu();
  try {
    await window.loadFile(startupFile);
    status("Восстанавливаем локальные данные…");
    await runtime.backup("before-restore");
    await runtime.restoreBackup(selected.filePaths[0]);
    await startRuntime();
  } catch (error) {
    await showFailure(error);
  } finally {
    busy = false;
    installMenu();
  }
}

function installMenu() {
  const ready = !busy && Boolean(runtime?.started);
  const template = [
    ...(process.platform === "darwin"
      ? [
          {
            label: app.name,
            submenu: [
              { role: "about" },
              { type: "separator" },
              { role: "hide" },
              { role: "hideOthers" },
              { role: "unhide" },
              { type: "separator" },
              { role: "quit" },
            ],
          },
        ]
      : []),
    {
      label: "Файл",
      submenu: [
        {
          label: "Загрузить данные с сайта…",
          enabled: ready,
          click: () => void openDataImport(),
        },
        {
          label: "Создать резервную копию…",
          enabled: ready,
          click: () => void manualBackup(),
        },
        {
          label: "Восстановить из копии…",
          enabled: ready,
          click: () => void manualRestore(),
        },
        {
          label: "Открыть папку данных",
          click: () => void shell.openPath(app.getPath("userData")),
        },
        { type: "separator" },
        { role: "quit", label: "Выход" },
      ],
    },
    {
      label: "Правка",
      submenu: [
        { role: "undo" },
        { role: "redo" },
        { type: "separator" },
        { role: "cut" },
        { role: "copy" },
        { role: "paste" },
        { role: "selectAll" },
      ],
    },
    {
      label: "Вид",
      submenu: [
        { role: "reload", enabled: ready },
        { role: "resetZoom" },
        { role: "zoomIn" },
        { role: "zoomOut" },
        { role: "togglefullscreen" },
        ...(!app.isPackaged ? [{ role: "toggleDevTools" }] : []),
      ],
    },
    {
      label: "Помощь",
      submenu: [
        { label: `Версия ${app.getVersion()}`, enabled: false },
        {
          label: "Проверить обновления…",
          enabled: ready,
          click: () => void updates.checkForUpdates(),
        },
        {
          label: "Выпуски на GitHub",
          click: () =>
            void external("https://github.com/ozLPanda/fresh-supply/releases"),
        },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

async function showFailure(error) {
  if (runtime) await runtime.stop().catch(() => {});
  const logPath = runtime?.logsDir || app.getPath("userData");
  const options = {
    type: "error",
    title: "fresh-supply",
    message: "Не удалось запустить приложение.",
    detail: `${String(error.message).slice(0, 1400)}\n\nЖурналы: ${logPath}`,
    buttons: ["Закрыть"],
  };
  if (window && !window.isDestroyed())
    await dialog.showMessageBox(window, options);
  else await dialog.showMessageBox(options);
  app.quit();
}
