const path = require("node:path");
const fs = require("node:fs/promises");
const { downloadReleaseAsset } = require("./update-download.cjs");

const DEFAULT_RELEASE_URL = "https://github.com/ozLPanda/fresh-supply/releases";

function parseVersion(value) {
  const match = /^(?:desktop-)?v?(\d+)\.(\d+)\.(\d+)(?:\+[\w.-]+)?$/.exec(value || "");
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
function selectAsset(release, platform, arch) {
  const target = { darwin: ["mac", "zip"], win32: ["win", "exe"] }[platform];
  if (!target) return null;
  const version = release.tag_name.replace("desktop-v", "");
  for (const architecture of [arch, ...(platform === "darwin" ? ["universal"] : [])]) {
    for (const prefix of ["fresh-supply", "OvoshiHelp"]) {
      const name = `${prefix}-${version}-${target[0]}-${architecture}.${target[1]}`;
      const asset = release.assets?.find((item) => item.name === name);
      if (asset) return asset;
    }
  }
  return null;
}

// Checking is harmless; download and installation require explicit consent.
// Installation is staged before stopping runtime and always follows a backup.
function createUpdateManager({
  app, dialog, shell, prepareUpdate, prepareInstaller, quitForUpdate = () => app.quit(),
  beginUpdate = async () => {}, endUpdate = async () => {}, onProgress = () => {},
  onStateChange = () => {}, releaseUrl = DEFAULT_RELEASE_URL, logger = console,
  fetch: fetchRelease = globalThis.fetch, download = downloadReleaseAsset,
  cleanupDownload = (file) => fs.rm(path.dirname(file), { recursive: true, force: true }),
  platform = process.platform, arch = process.arch,
}) {
  const source = new URL(releaseUrl);
  if (source.protocol !== "https:" || source.hostname !== "github.com" ||
      source.username || source.password ||
      !/^\/[\w.-]+\/[\w.-]+\/releases\/?$/.test(source.pathname) || source.search || source.hash) {
    throw new Error("Updates require an HTTPS GitHub Releases URL.");
  }
  const releases = `${source.origin}${source.pathname.replace(/\/$/, "")}`;
  const repository = source.pathname.split("/").slice(1, 3).join("/");
  const automatic = Boolean(app.isPackaged && ["win32", "darwin"].includes(platform) && prepareInstaller);
  let pending = null;
  let disposed = false;
  let state = "idle";
  let controller;
  let startupChecked = false;
  function phase(value) { state = value; onStateChange(); }
  function assertActive() {
    if (disposed || controller?.signal.aborted) {
      throw Object.assign(new Error("Update cancelled."), { name: "AbortError" });
    }
  }
  async function show(options) {
    assertActive();
    const result = await dialog.showMessageBox({ title: "Обновление fresh-supply", ...options });
    assertActive();
    return result.response;
  }
  async function run({ quiet = false } = {}) {
    let archivePath;
    let prepared;
    let updating = false;
    let installing = false;
    controller ||= new AbortController();
    phase("checking");
    try {
      assertActive();
      const current = app.getVersion();
      const response = await fetchRelease(`https://api.github.com/repos/${repository}/releases/latest`, {
        headers: { Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28" },
        signal: AbortSignal.any([controller.signal, AbortSignal.timeout(15000)]),
      });
      assertActive();
      if (!response.ok) throw new Error("Release source is unavailable.");
      const release = await response.json();
      assertActive();
      if (release.draft || release.prerelease || !/^desktop-v\d+\.\d+\.\d+$/.test(release.tag_name || "")) {
        throw Object.assign(new Error("No supported stable desktop release."), { code: "DESKTOP_RELEASE_UNAVAILABLE" });
      }
      if (!isNewerVersion(release.tag_name, current)) {
        if (!quiet) await show({ type: "info", message: `Установлена версия ${current}. Обновление не требуется.`, buttons: ["OK"] });
        return { status: "current" };
      }
      const asset = selectAsset(release, platform, arch);
      if (!asset || !/^sha256:[a-f\d]{64}$/i.test(asset.digest || "") || !Number.isSafeInteger(asset.size) || asset.size <= 0) {
        throw Object.assign(new Error("No verified installer for this computer."), { code: "DESKTOP_RELEASE_UNAVAILABLE" });
      }
      const version = release.tag_name.replace("desktop-v", "");
      phase("available");
      const choice = await show({
        type: "question",
        message: `Доступна новая версия ${version}. Обновить приложение?`,
        detail: `${String(release.body || "Обновление приложения.").slice(0, 2000)}\n\nСейчас установлена ${current}. Сохраните изменения в открытых формах. Программа скачает обновление, создаст резервную копию данных и перезапустится.`,
        buttons: [automatic ? "Обновить" : "Открыть Releases", "Позже"], defaultId: 0, cancelId: 1,
      });
      if (choice !== 0) return { status: "cancelled" };
      if (!automatic) {
        await shell.openExternal(`${releases}/tag/${encodeURIComponent(release.tag_name)}`);
        return { status: "download-page-opened" };
      }
      // Mark active before invoking the UI hook so a partially opened view is recoverable.
      updating = true;
      phase("downloading");
      await beginUpdate();
      assertActive();
      archivePath = await download({ asset, repository, tag: release.tag_name,
        destinationDirectory: path.join(app.getPath("userData"), "updates"),
        signal: controller.signal,
        onProgress: (progress) => {
          if (!controller.signal.aborted) onProgress({ ...progress, phase: "downloading" });
        },
      });
      assertActive();
      phase("staging");
      onProgress({ phase: "staging" });
      prepared = await prepareInstaller({ archivePath, version, arch, sha256: asset.digest.slice(7).toLowerCase(),
        signal: controller.signal,
        onProgress: (progress) => {
          if (!controller.signal.aborted) onProgress({ ...progress, phase: "staging" });
        } });
      assertActive();
      phase("preparing");
      onProgress({ phase: "preparing", requiresElevation: Boolean(prepared.requiresElevation) });
      if (typeof prepareUpdate !== "function") throw new Error("Update preparation is unavailable.");
      await prepareUpdate({ requiresElevation: Boolean(prepared.requiresElevation) });
      assertActive();
      phase("installing");
      await prepared.install();
      // A successful handoff has armed an independent helper. Complete the quit
      // rather than deleting its payload after a late cancellation/disposal.
      installing = true;
      quitForUpdate();
      return { status: "installing" };
    } catch (error) {
      if (disposed) return { status: "disposed" };
      if (controller.signal.aborted || error.name === "AbortError") return { status: "cancelled" };
      const preparationFailed = ["staging", "preparing", "installing"].includes(state);
      phase("error");
      logger.warn?.("Desktop update failed; existing data is retained.");
      // Offline/current startup checks must never interrupt normal application startup.
      if (!quiet || updating) {
        const choice = await show({
          type: "warning",
          message: preparationFailed ? "Установка обновления отменена." : "Не удалось проверить или скачать обновление.",
          detail: error.userMessage || (error.code === "DESKTOP_RELEASE_UNAVAILABLE"
            ? "Готового стабильного выпуска для этого компьютера пока нет. Продолжайте работу в текущей версии."
            : "Проверьте подключение к GitHub и свободное место на диске. Текущие данные сохранены. Попробуйте обновиться позже."),
          buttons: ["Закрыть", "Открыть Releases"], defaultId: 0, cancelId: 0,
        });
        if (choice === 1) await shell.openExternal(releases);
      }
      return { status: "error", phase: preparationFailed ? "preparation" : "network" };
    } finally {
      if (!installing) {
        await prepared?.dispose().catch(() => {});
        if (archivePath) await cleanupDownload(archivePath).catch(() => {});
        if (updating && !disposed) await endUpdate();
        phase(disposed ? "disposed" : "idle");
      }
      controller = null;
    }
  }
  function checkForUpdates(options) {
    if (disposed) return Promise.resolve({ status: "disposed" });
    if (!pending) {
      controller = new AbortController();
      pending = Promise.resolve().then(() => run(options)).finally(() => { pending = null; onStateChange(); });
      onStateChange();
    }
    return pending;
  }
  return {
    checkForUpdates,
    checkAtStartup() {
      if (startupChecked || !app.isPackaged || disposed) return Promise.resolve({ status: "skipped" });
      startupChecked = true;
      return checkForUpdates({ quiet: true });
    },
    cancelDownload() {
      if (!["downloading", "staging"].includes(state)) return false;
      controller?.abort();
      return true;
    },
    cancelCheck() { controller?.abort(); },
    getState: () => ({ phase: state, busy: Boolean(pending), automatic }),
    dispose() { disposed = true; controller?.abort(); },
  };
}
module.exports = { createUpdateManager, isNewerVersion, selectAsset };
