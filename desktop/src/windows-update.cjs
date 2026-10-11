const fs = require("node:fs/promises");
const { createReadStream } = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { spawn: nodeSpawn } = require("node:child_process");
const { setTimeout: delay } = require("node:timers/promises");

function updateFailure(message) {
  return Object.assign(new Error(message), { userMessage: message });
}

function inside(parent, child) {
  const relative = path.relative(parent, child);
  return relative !== "" && !relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative);
}

async function fileHash(file) {
  const hash = crypto.createHash("sha256");
  for await (const bytes of createReadStream(file)) hash.update(bytes);
  return hash.digest("hex");
}

async function validatePe(file, installed = false) {
  const info = await fs.lstat(file);
  if (!info.isFile() || info.isSymbolicLink()) throw updateFailure("Файл установки Windows недействителен.");
  const handle = await fs.open(file, "r");
  try {
    const header = Buffer.alloc(64);
    if ((await handle.read(header, 0, 64, 0)).bytesRead !== 64 || header.toString("ascii", 0, 2) !== "MZ") {
      throw updateFailure("Файл установки Windows не является EXE.");
    }
    const offset = header.readUInt32LE(60);
    if (offset < 64 || offset > Math.min(info.size - 6, 1024 * 1024)) throw updateFailure("Заголовок EXE повреждён.");
    const pe = Buffer.alloc(6);
    if ((await handle.read(pe, 0, 6, offset)).bytesRead !== 6 || !pe.subarray(0, 4).equals(Buffer.from([80, 69, 0, 0]))) {
      throw updateFailure("Заголовок EXE повреждён.");
    }
    // NSIS uses a 32-bit bootstrap executable even for an x64 application.
    const machine = pe.readUInt16LE(4);
    if (installed ? machine !== 0x8664 : ![0x14c, 0x8664].includes(machine)) {
      throw updateFailure("Архитектура приложения Windows не поддерживается.");
    }
  } finally {
    await handle.close();
  }
}

async function exists(file) {
  try { await fs.access(file); return true; } catch (error) { if (error.code === "ENOENT") return false; throw error; }
}

async function atomicSignal(file) {
  const temporary = `${file}.tmp`;
  await fs.writeFile(temporary, "1", { flag: "wx", mode: 0o600 });
  await fs.rename(temporary, file);
}

/** Stage only; the caller must finish its database backup before calling install(). */
async function prepareWindowsUpdate({
  app, archivePath, version, sha256,
  platform = process.platform, arch = process.arch, execPath = process.execPath,
  spawn = nodeSpawn, env = process.env, parentPid = process.pid,
  timeoutMs = 60_000, pollMs = 100, parentExitTimeoutMs = 180_000,
}) {
  if (!app?.isPackaged || platform !== "win32" || arch !== "x64") {
    throw updateFailure("Автоматическая установка доступна в установленном приложении Windows x64.");
  }
  if (!/^\d+\.\d+\.\d+$/.test(version) || !/^[a-f0-9]{64}$/i.test(sha256 || "")) {
    throw updateFailure("Метаданные обновления Windows недействительны.");
  }
  if (!Number.isSafeInteger(parentPid) || parentPid <= 0) throw updateFailure("Процесс приложения недействителен.");
  const userData = path.resolve(app.getPath("userData"));
  const cache = path.join(userData, "updates");
  await fs.mkdir(cache, { recursive: true, mode: 0o700 });
  const cacheReal = await fs.realpath(cache);
  const userDataReal = await fs.realpath(userData);
  const installer = await fs.realpath(archivePath);
  const downloadDirectory = path.dirname(installer);
  if (!inside(cacheReal, installer) || path.dirname(downloadDirectory) !== cacheReal || !/^download-[\w-]+$/.test(path.basename(downloadDirectory))) {
    throw updateFailure("Файл обновления должен находиться в локальном кэше приложения.");
  }
  const names = [`fresh-supply-${version}-win-x64.exe`, `OvoshiHelp-${version}-win-x64.exe`];
  if (!names.includes(path.basename(installer))) throw updateFailure("Имя файла обновления Windows недействительно.");
  // Refuse aliases and reparse links supplied as an executable path.
  await validatePe(archivePath);
  if ((await fileHash(installer)) !== sha256.toLowerCase()) throw updateFailure("Контрольная сумма обновления Windows не совпадает.");
  await validatePe(execPath, true);
  const installedExecutable = await fs.realpath(execPath);
  if (!/^(fresh-supply|Ovoshi Help|OvoshiHelp)\.exe$/i.test(path.basename(installedExecutable))) {
    throw updateFailure("Не удалось определить установленное приложение Windows.");
  }
  const installDirectory = path.dirname(installedExecutable);
  if (/["\r\n\0]/.test(installDirectory) || inside(installDirectory, userDataReal) || inside(userDataReal, installDirectory) || installDirectory === userDataReal) {
    throw updateFailure("Каталог установки приложения недействителен.");
  }
  const probe = path.join(installDirectory, `.fresh-supply-update-${crypto.randomUUID()}`);
  try {
    await fs.writeFile(probe, "", { flag: "wx", mode: 0o600 });
  } catch {
    throw updateFailure("Нет прав на обновление в каталоге приложения. Установите fresh-supply для текущего пользователя.");
  } finally {
    await fs.rm(probe, { force: true });
  }
  const systemRoot = env.SystemRoot || env.SYSTEMROOT;
  if (typeof systemRoot !== "string" || !/^[a-z]:[\\/]/i.test(systemRoot) || /["\r\n\0]/.test(systemRoot)) {
    throw updateFailure("Не найден системный PowerShell Windows.");
  }
  const powershell = path.win32.join(systemRoot, "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
  const directory = await fs.mkdtemp(path.join(cache, "windows-install-"));
  const configPath = path.join(directory, "config.json");
  const readyPath = path.join(directory, "ready");
  const commitPath = path.join(directory, "commit");
  const acceptedPath = path.join(directory, "accepted");
  const cancelPath = path.join(directory, "cancel");
  const failurePath = path.join(directory, "failure.json");
  const logDirectory = path.join(userData, "logs");
  await fs.mkdir(logDirectory, { recursive: true, mode: 0o700 });
  const config = {
    schema: 1, parentPid, installer, sha256: sha256.toLowerCase(), installedExecutable,
    installDirectory, version, downloadDirectory, cacheDirectory: cacheReal,
    readyPath, commitPath, acceptedPath, cancelPath, failurePath,
    logPath: path.join(logDirectory, "windows-update.log"),
    parentExitTimeoutMs,
  };
  let child;
  let pending;
  let committed = false;
  let disposed = false;
  let terminalError;
  try {
    await fs.writeFile(configPath, JSON.stringify(config), { flag: "wx", mode: 0o600 });
  } catch (error) {
    await fs.rm(directory, { recursive: true, force: true });
    throw error;
  }

  async function stopUncommitted() {
    await fs.writeFile(cancelPath, "1", { mode: 0o600 }).catch(() => {});
    if (child && !committed) child.kill();
    if (!committed) await fs.rm(directory, { recursive: true, force: true });
  }

  async function waitSignal(file) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (disposed) throw updateFailure("Установка обновления отменена.");
      if (await exists(failurePath)) {
        // Windows PowerShell's UTF8 encoding may include a BOM.
        const failure = JSON.parse((await fs.readFile(failurePath, "utf8")).replace(/^\uFEFF/, ""));
        throw updateFailure(`Не удалось запустить установку: ${failure.message || "ошибка помощника Windows"}`);
      }
      if (terminalError) throw terminalError;
      if (await exists(file)) return;
      await delay(pollMs);
    }
    throw updateFailure("Помощник обновления Windows не ответил вовремя.");
  }

  function install() {
    if (pending) return pending;
    pending = (async () => {
      if (disposed) throw updateFailure("Установка обновления отменена.");
      try {
        const script = await fs.readFile(path.join(__dirname, "windows-update-helper.ps1"), "utf8");
        if (disposed) throw updateFailure("Установка обновления отменена.");
        // Only static application code enters the command. Paths are JSON data read
        // via an environment variable, never interpolated into PowerShell source.
        child = spawn(powershell, ["-NoLogo", "-NoProfile", "-NonInteractive", "-EncodedCommand", Buffer.from(script, "utf16le").toString("base64")], {
          detached: true, windowsHide: true, stdio: "ignore", shell: false,
          cwd: directory, env: { ...env, FRESH_SUPPLY_UPDATE_CONFIG: configPath },
        });
        child.on("error", (error) => {
          terminalError = error;
          terminalError.userMessage = "Не удалось запустить помощник обновления Windows. Приложение продолжит работу.";
        });
        child.on("exit", (code) => {
          if (!committed) terminalError = updateFailure(`Помощник обновления завершился до установки (${code ?? "сигнал"}).`);
        });
        await waitSignal(readyPath);
        await atomicSignal(commitPath);
        await waitSignal(acceptedPath);
        committed = true;
        child.unref();
      } catch (error) {
        await stopUncommitted();
        throw error;
      }
    })();
    return pending;
  }

  async function dispose() {
    // after accepted, normal application shutdown must not cancel the installer.
    if (committed) return;
    disposed = true;
    await stopUncommitted();
    if (pending) await pending.catch(() => {});
  }

  return { install, dispose };
}

module.exports = { prepareWindowsUpdate };
