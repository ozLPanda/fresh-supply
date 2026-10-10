const DEFAULT_RELEASE_URL = "https://github.com/ozLPanda/fresh-supply/releases";

function parseVersion(value) {
  const match = /^(?:desktop-)?v?(\d+)\.(\d+)\.(\d+)(?:\+[\w.-]+)?$/.exec(
    value || "",
  );
  return match ? match.slice(1, 4).map(Number) : null;
}

function isNewerVersion(candidate, current) {
  const next = parseVersion(candidate);
  const installed = parseVersion(current);
  if (!next || !installed) return false;
  for (let index = 0; index < 3; index += 1) {
    if (next[index] !== installed[index]) return next[index] > installed[index];
  }
  return false;
}

function releaseNotes(notes) {
  if (Array.isArray(notes)) {
    return notes
      .map((entry) => `${entry.version || ""}\n${entry.note || ""}`)
      .join("\n\n")
      .slice(0, 12000);
  }
  return String(
    notes || "Описание изменений доступно на странице выпуска.",
  ).slice(0, 12000);
}

/**
 * Automatic updates are opt-in for a packaged, signed distribution. The parent
 * supplies prepareUpdate: stop accepting work, stop local services, make a
 * consistent durable backup, and reject if any of those steps fail.
 * No startup check, automatic download, or install-on-quit is performed here.
 */
function createUpdateManager({
  app,
  dialog,
  shell,
  autoUpdater,
  prepareUpdate,
  releaseUrl = DEFAULT_RELEASE_URL,
  logger = console,
  allowAutomaticUpdates = false,
  fetch: fetchRelease = globalThis.fetch,
  platform = process.platform,
  arch = process.arch,
}) {
  const source = new URL(releaseUrl);
  if (
    source.protocol !== "https:" ||
    source.hostname !== "github.com" ||
    source.username ||
    source.password ||
    !/^\/[\w.-]+\/[\w.-]+\/releases\/?$/.test(source.pathname) ||
    source.search ||
    source.hash
  ) {
    throw new Error("Updates require an HTTPS GitHub Releases URL.");
  }
  const releases = `${source.origin}${source.pathname.replace(/\/$/, "")}`;
  const repository = source.pathname.split("/").slice(1, 3).join("/");
  const automatic = Boolean(
    app.isPackaged &&
    allowAutomaticUpdates &&
    autoUpdater &&
    ["win32", "darwin"].includes(platform),
  );
  let pending = null;
  let disposed = false;
  let state = "idle";
  const onUpdaterError = () =>
    logger.warn?.("Desktop update service reported an error.");
  if (autoUpdater) {
    autoUpdater.autoDownload = false;
    autoUpdater.autoInstallOnAppQuit = false;
    // Fail closed on the v27 API as well, should the dependency be upgraded.
    if ("autoInstallEvent" in autoUpdater)
      autoUpdater.autoInstallEvent = "manual";
    autoUpdater.allowPrerelease = false;
    autoUpdater.allowDowngrade = false;
    autoUpdater.on("error", onUpdaterError);
  }

  const assertActive = () => {
    if (disposed) throw new Error("Update manager is disposed.");
  };
  const show = async (options) => {
    assertActive();
    const result = await dialog.showMessageBox({
      title: "Обновление Ovoshi Help",
      ...options,
    });
    assertActive();
    return result.response;
  };

  async function prepareAndInstall(install) {
    state = "preparing";
    if (typeof prepareUpdate !== "function")
      throw new Error("Update preparation is unavailable.");
    await prepareUpdate();
    assertActive();
    state = "installing";
    await install();
    return { status: "installing" };
  }

  async function manualUpdate(current) {
    const response = await fetchRelease(
      `https://api.github.com/repos/${repository}/releases/latest`,
      {
        headers: {
          Accept: "application/vnd.github+json",
          "X-GitHub-Api-Version": "2022-11-28",
        },
        signal: AbortSignal.timeout(15000),
      },
    );
    assertActive();
    if (!response.ok) throw new Error("Release source is unavailable.");
    const release = await response.json();
    assertActive();
    if (
      release.draft ||
      release.prerelease ||
      !/^desktop-v\d+\.\d+\.\d+$/.test(release.tag_name || "")
    ) {
      throw Object.assign(new Error("No supported stable desktop release."), {
        code: "DESKTOP_RELEASE_UNAVAILABLE",
      });
    }
    if (!isNewerVersion(release.tag_name, current)) return showCurrent(current);
    const version = release.tag_name.replace("desktop-v", "");
    const target = { darwin: ["mac", "dmg"], win32: ["win", "exe"] }[platform];
    const installerNames = target
      ? [arch, ...(platform === "darwin" ? ["universal"] : [])].map(
          (architecture) =>
            `OvoshiHelp-${version}-${target[0]}-${architecture}.${target[1]}`,
        )
      : [];
    if (!release.assets?.some((asset) => installerNames.includes(asset.name))) {
      throw Object.assign(
        new Error(
          "No desktop installer available for this platform and architecture.",
        ),
        { code: "DESKTOP_RELEASE_UNAVAILABLE" },
      );
    }
    state = "available";
    const choice = await show({
      type: "info",
      message: `Доступна версия ${release.tag_name}. Сейчас установлена ${current}.`,
      detail: `${releaseNotes(release.body)}\n\nСкачайте установщик для своей ОС со страницы выпуска. Данные хранятся отдельно от программы.`,
      buttons: ["Скачать со страницы Releases", "Позже"],
      defaultId: 0,
      cancelId: 1,
    });
    if (choice !== 0) return { status: "cancelled" };
    // Do not trust html_url/asset links supplied by remote release metadata.
    await shell.openExternal(
      `${releases}/tag/${encodeURIComponent(release.tag_name)}`,
    );
    const installChoice = await show({
      type: "question",
      message: "Подготовить приложение к установке обновления?",
      detail:
        "Сначала скачайте установщик. Затем завершите текущую работу и нажмите «Подготовить и закрыть». Приложение создаст резервную копию и закроется. После этого запустите скачанный установщик. Проверяйте источник пакета и его подпись средствами ОС.",
      buttons: ["Подготовить и закрыть", "Продолжить работу"],
      defaultId: 1,
      cancelId: 1,
    });
    if (installChoice !== 0) return { status: "download-page-opened" };
    return prepareAndInstall(() => app.quit());
  }

  async function showCurrent(current) {
    await show({
      type: "info",
      message: `Установлена версия ${current}. Обновление не требуется.`,
      buttons: ["OK"],
    });
    return { status: "current" };
  }

  async function automaticUpdate(current) {
    const result = await autoUpdater.checkForUpdates();
    assertActive();
    const info = result?.updateInfo;
    if (!info || !parseVersion(info.version))
      throw new Error("No supported stable desktop release.");
    if (!isNewerVersion(info.version, current)) return showCurrent(current);
    state = "available";
    const choice = await show({
      type: "info",
      message: `Доступна версия ${info.version}. Сейчас установлена ${current}.`,
      detail: releaseNotes(info.releaseNotes),
      buttons: ["Скачать обновление", "Позже"],
      defaultId: 0,
      cancelId: 1,
    });
    if (choice !== 0) return { status: "cancelled" };
    state = "downloading";
    // Await the download promise, rather than attaching a late event listener:
    // a cached download may emit update-downloaded before downloadUpdate returns.
    await autoUpdater.downloadUpdate();
    assertActive();
    state = "downloaded";
    const installChoice = await show({
      type: "question",
      message: `Версия ${info.version} скачана. Установить сейчас?`,
      detail:
        "Завершите текущую работу. Перед установкой приложение создаст резервную копию локальных данных, остановит компоненты и перезапустится. Если подготовка не удастся, установка будет отменена.",
      buttons: ["Создать копию и установить", "Позже"],
      defaultId: 1,
      cancelId: 1,
    });
    if (installChoice !== 0) return { status: "downloaded" };
    return prepareAndInstall(() => autoUpdater.quitAndInstall(false, true));
  }

  async function run() {
    state = "checking";
    try {
      assertActive();
      const current = app.getVersion();
      return await (automatic
        ? automaticUpdate(current)
        : manualUpdate(current));
    } catch (error) {
      const preparationFailed = state === "preparing" || state === "installing";
      const releaseUnavailable = error.code === "DESKTOP_RELEASE_UNAVAILABLE";
      state = "error";
      logger.warn?.(
        preparationFailed
          ? "Desktop update preparation failed; installation was not completed."
          : "Desktop update check/download failed; existing installation is unchanged.",
      );
      if (disposed) return { status: "disposed" };
      const response = await show({
        type: "warning",
        message: preparationFailed
          ? "Установка обновления отменена."
          : releaseUnavailable
            ? "Готовый стабильный выпуск для этого компьютера пока недоступен."
            : "Не удалось проверить или скачать обновление.",
        detail: preparationFailed
          ? "Не удалось безопасно подготовить данные или запустить установку. Установка не продолжена. Проверьте локальные компоненты и журнал приложения перед повторной попыткой."
          : releaseUnavailable
            ? "На странице последнего выпуска нет стабильного настольного приложения или подходящего установщика для вашей ОС и архитектуры. Текущая установка сохранена. Проверьте остальные выпуски на GitHub."
            : "Проверьте подключение к интернету и доступ к GitHub. Текущая установка сохранена; можно продолжить работу. Для закрытого репозитория войдите в GitHub через браузер.",
        buttons: ["Закрыть", "Открыть Releases"],
        defaultId: 0,
        cancelId: 0,
      });
      if (response === 1) await shell.openExternal(releases);
      return {
        status: "error",
        phase: preparationFailed ? "preparation" : "network",
      };
    }
  }

  return {
    checkForUpdates() {
      if (disposed) return Promise.resolve({ status: "disposed" });
      if (!pending) {
        pending = Promise.resolve()
          .then(run)
          .finally(() => {
            pending = null;
            if (disposed && autoUpdater)
              autoUpdater.removeListener("error", onUpdaterError);
          });
      }
      return pending;
    },
    getState: () => ({ phase: state, busy: Boolean(pending), automatic }),
    dispose() {
      disposed = true;
      if (!pending && autoUpdater)
        autoUpdater.removeListener("error", onUpdaterError);
    },
  };
}

module.exports = { createUpdateManager, isNewerVersion };
