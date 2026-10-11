const fs = require("node:fs");
const fsp = require("node:fs/promises");
const path = require("node:path");
const { spawn, execFile } = require("node:child_process");
const { promisify } = require("node:util");
const { pipeline } = require("node:stream/promises");
const { PassThrough } = require("node:stream");
const yauzl = require("yauzl");
const { createHash, randomUUID } = require("node:crypto");

const APP_ID = "kz.ovoshi.help.desktop";
const MAX_EXPANDED = 16 * 1024 ** 3;
const runFile = promisify(execFile);

function fail(message, detail) {
  const error = new Error(detail || message);
  error.userMessage = message;
  throw error;
}
function inside(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative));
}
function bundleFromExecutable(executable) {
  const suffix = `${path.sep}Contents${path.sep}MacOS${path.sep}`;
  const index = executable.lastIndexOf(suffix);
  const bundle = executable.slice(0, index);
  if (index < 0 || !bundle.endsWith(".app") || path.basename(executable) === "")
    fail("Обновление доступно после установки приложения в папку «Программы».");
  return bundle;
}
function safeEntry(name) {
  return typeof name === "string" && name.length < 4096 && !name.includes("\\") && !name.includes("\0") && !name.startsWith("/") &&
    !name.split("/").some((part) => part === ".." || part === ".") && !/^[A-Za-z]:/.test(name);
}
function openZip(archivePath) {
  return new Promise((resolve, reject) => yauzl.open(archivePath, {
    lazyEntries: true, autoClose: false, strictFileNames: true, validateEntrySizes: true,
  }, (error, zip) => error ? reject(error) : resolve(zip)));
}
function entryStream(zip, entry, signal) {
  return new Promise((resolve, reject) => zip.openReadStream(entry, (error, source) => {
    if (error) return reject(error);
    const stream = new PassThrough();
    source.on("error", (error) => stream.destroy(error));
    stream.on("close", () => { if (!source.destroyed && !source.readableEnded) source.destroy(); });
    if (signal) {
      const abort = () => stream.destroy(signal.reason);
      signal.addEventListener("abort", abort, { once: true });
      stream.once("close", () => signal.removeEventListener("abort", abort));
      if (signal.aborted) abort();
    }
    source.pipe(stream);
    resolve(stream);
  }));
}
async function extractBundle(archivePath, directory, onProgress = () => {}, signal) {
  signal?.throwIfAborted();
  const zip = await openZip(archivePath);
  const entries = new Map();
  const links = [];
  const directoryModes = [];
  let bundleName;
  let total = 0;
  let abort;
  try {
    await new Promise((resolve, reject) => {
      abort = () => reject(signal.reason);
      signal?.addEventListener("abort", abort, { once: true });
      if (signal?.aborted) return reject(signal.reason);
      zip.once("error", reject);
      zip.once("end", resolve);
      zip.on("entry", (entry) => {
        (async () => {
          signal?.throwIfAborted();
          const name = entry.fileName;
          if (!safeEntry(name) || entries.has(name) || entry.generalPurposeBitFlag & 1 || ![0, 8].includes(entry.compressionMethod))
            fail("Архив обновления содержит недопустимые файлы.");
          entries.set(name, true);
          const root = name.split("/")[0];
          if (entries.size > 100000) fail("Архив обновления содержит слишком много файлов.");
          if (root === "__MACOSX") return;
          if (!/^(fresh-supply|Ovoshi Help|OvoshiHelp)\.app$/.test(root) || (bundleName && bundleName !== root))
            fail("Архив обновления должен содержать одно приложение fresh-supply.");
          bundleName = root;
          if (!Number.isSafeInteger(entry.uncompressedSize) || entry.uncompressedSize < 0 || entry.uncompressedSize > 4 * 1024 ** 3 || entries.size > 100000)
            fail("Архив обновления превышает допустимый размер.");
          total += entry.uncompressedSize;
          if (total > MAX_EXPANDED) fail("Архив обновления превышает допустимый размер.");
          const destination = path.join(directory, name);
          const mode = (entry.externalFileAttributes >>> 16) & 0xffff;
          const kind = mode & 0xf000;
          if (![0, 0x4000, 0x8000, 0xa000].includes(kind)) fail("Архив содержит неподдерживаемый тип файла.");
          if (name.endsWith("/") || kind === 0x4000) {
            await fsp.mkdir(destination, { recursive: true, mode: 0o700 });
            directoryModes.push([destination, mode & 0o777 || 0o755]);
          } else {
            await fsp.mkdir(path.dirname(destination), { recursive: true, mode: 0o700 });
            const stream = await entryStream(zip, entry, signal);
            if (kind === 0xa000) {
              let target = "";
              let length = 0;
              for await (const chunk of stream) {
                length += chunk.length;
                if (length > 4096) fail("Архив содержит недопустимую ссылку.");
                target += chunk.toString("utf8");
              }
              const bundle = path.join(directory, root);
              if (!target || target.includes("\0") || path.isAbsolute(target) || !inside(bundle, path.resolve(path.dirname(destination), target)))
                fail("Архив содержит ссылку за пределы приложения.");
              links.push([destination, target]);
            } else {
              await pipeline(stream, fs.createWriteStream(destination, { flags: "wx", mode: mode & 0o777 || 0o644 }), { signal });
            }
          }
          onProgress({ phase: "extracting", files: entries.size, bytes: total });
        })().then(() => { if (!signal?.aborted) zip.readEntry(); }).catch(reject);
      });
      zip.readEntry();
    });
    if (!bundleName) fail("Архив обновления не содержит приложение.");
    const bundle = await fsp.realpath(path.join(directory, bundleName));
    // Create links only after regular files, so ZIP entries can never write through them.
    for (const [destination, target] of links) { signal?.throwIfAborted(); await fsp.symlink(target, destination); }
    for (const [destination] of links) {
      let resolved;
      try { resolved = await fsp.realpath(destination); }
      catch { fail("Архив содержит повреждённую или циклическую ссылку."); }
      if (!inside(bundle, resolved)) fail("Архив содержит ссылку за пределы приложения.");
    }
    // Delay restrictive permissions until extraction has finished.
    for (const [directoryPath, mode] of directoryModes.reverse()) await fsp.chmod(directoryPath, mode);
    return bundle;
  } finally { signal?.removeEventListener("abort", abort); zip.close(); }
}
async function readPlist(plist, key, run = runFile) {
  const { stdout } = await run("/usr/libexec/PlistBuddy", ["-c", `Print :${key}`, plist], { timeout: 10000, maxBuffer: 16384 });
  return stdout.trim();
}
async function validateBundle(bundle, version, arch, run = runFile) {
  const plist = path.join(bundle, "Contents", "Info.plist");
  const identifier = await readPlist(plist, "CFBundleIdentifier", run);
  const actualVersion = await readPlist(plist, "CFBundleShortVersionString", run);
  const executable = await readPlist(plist, "CFBundleExecutable", run);
  if (identifier !== APP_ID || actualVersion !== version || !executable || executable !== path.basename(executable))
    fail("Приложение в архиве не соответствует выбранной версии fresh-supply.");
  const binary = path.join(bundle, "Contents", "MacOS", executable);
  if (!inside(await fsp.realpath(bundle), await fsp.realpath(binary))) fail("Исполняемый файл находится за пределами приложения.");
  await fsp.access(binary, fs.constants.X_OK);
  const { stdout } = await run("/usr/bin/lipo", ["-archs", binary], { timeout: 10000, maxBuffer: 16384 });
  const expected = { arm64: "arm64", x64: "x86_64" }[arch];
  if (!expected || !stdout.trim().split(/\s+/).includes(expected)) fail("Обновление не подходит для этого Mac.");
}
async function hashArchive(archivePath, sha256, signal) {
  signal?.throwIfAborted();
  if (!/^[a-fA-F0-9]{64}$/.test(sha256 || "")) fail("У обновления отсутствует контрольная сумма.");
  const hash = createHash("sha256");
  for await (const chunk of fs.createReadStream(archivePath, { signal })) hash.update(chunk);
  if (hash.digest("hex") !== sha256.toLowerCase()) fail("Файл обновления повреждён. Загрузите его повторно.");
}
async function confirmMacUpdateStarted({ app }) {
  const journalPath = path.join(app.getPath("userData"), "updates", "mac-update-pending.json");
  let journal;
  try { journal = JSON.parse(await fsp.readFile(journalPath, "utf8")); }
  catch (error) { if (error.code === "ENOENT") return false; throw error; }
  const target = await fsp.realpath(bundleFromExecutable(app.getPath("exe")));
  if (journal.version !== app.getVersion() || journal.target !== target ||
      typeof journal.task !== "string" || path.dirname(journal.task) !== path.dirname(target) || !/^\.fresh-supply-update-[A-Za-z0-9]+$/.test(path.basename(journal.task))) return false;
  const taskStat = await fsp.lstat(journal.task);
  if (!taskStat.isDirectory() || taskStat.isSymbolicLink() || (taskStat.mode & 0o077) || taskStat.uid !== process.getuid()) return false;
  await fsp.writeFile(path.join(journal.task, "new-app-ready"), "ready", { flag: "wx", mode: 0o600 }).catch((error) => { if (error.code !== "EEXIST") throw error; });
  await fsp.unlink(journalPath);
  // A helper can have timed out during a slow/previous launch. Current runtime is
  // healthy, so the old bundle can now be discarded even if the helper exited.
  await fsp.rm(journal.task, { recursive: true, force: true });
  return true;
}
async function prepareMacUpdate({ app, archivePath, sha256, version, arch = process.arch, onProgress, signal,
  run = runFile, spawnProcess = spawn, pid = process.pid, openCommand = "/usr/bin/open", waitSeconds = 120,
  helperReadyTimeout = 10000, startupWaitSeconds = 600 } = {}) {
  signal?.throwIfAborted();
  if (!app?.isPackaged || !/^\d+\.\d+\.\d+$/.test(version || "")) fail("Обновление доступно только для установленного приложения.");
  const installedPath = bundleFromExecutable(app.getPath("exe"));
  if (installedPath.includes("/AppTranslocation/") || installedPath.startsWith("/Volumes/") || (await fsp.lstat(installedPath)).isSymbolicLink())
    fail("Переместите fresh-supply в доступную для записи папку «Программы» и запустите его оттуда.");
  const target = await fsp.realpath(installedPath);
  const parent = path.dirname(target);
  try { await fsp.access(parent, fs.constants.W_OK); }
  catch { fail("Для обновления переместите приложение в папку «Программы» своего пользователя, доступную для записи."); }
  if (await readPlist(path.join(target, "Contents", "Info.plist"), "CFBundleIdentifier", run) !== APP_ID)
    fail("Не удалось определить установленное приложение fresh-supply.");
  const userData = await fsp.realpath(app.getPath("userData"));
  const updatesDirectory = path.join(userData, "updates");
  const journalPath = path.join(updatesDirectory, "mac-update-pending.json");
  await fsp.mkdir(updatesDirectory, { recursive: true, mode: 0o700 });
  let pendingJournal = false;
  try { await fsp.access(journalPath); pendingJournal = true; }
  catch (error) { if (error.code !== "ENOENT") throw error; }
  if (pendingJournal && !await confirmMacUpdateStarted({ app }))
    fail("Предыдущее обновление ещё не завершено. Перезапустите приложение перед новой установкой.");
  const logDirectory = path.join(userData, "logs");
  await fsp.mkdir(logDirectory, { recursive: true, mode: 0o700 });
  const log = path.join(logDirectory, "mac-update.log");
  const archiveReal = await fsp.realpath(archivePath);
  const downloadDirectory = path.dirname(archiveReal);
  const disposableArchive = path.dirname(downloadDirectory) === await fsp.realpath(updatesDirectory) && /^download-[A-Za-z0-9]+$/.test(path.basename(downloadDirectory)) ? archiveReal : "";
  const task = await fsp.mkdtemp(path.join(parent, ".fresh-supply-update-"));
  await fsp.chmod(task, 0o700);
  let armed = false;
  let disposed = false;
  let child;
  let journalCreated = false;
  try {
    await hashArchive(archivePath, sha256, signal);
    const archiveSize = (await fsp.stat(archivePath)).size;
    const capacity = await fsp.statfs(parent);
    // Full payload includes the offline model and runtimes; keep headroom while both bundles exist.
    if (capacity.bavail * capacity.bsize < Math.max(5 * 1024 ** 3, archiveSize * 4))
      fail("Для обновления требуется не менее 5 ГБ свободного места на диске.");
    const staged = await extractBundle(archivePath, task, onProgress, signal);
    await validateBundle(staged, version, arch, run);
    const helper = path.join(task, "install.sh");
    await fsp.copyFile(path.join(__dirname, "mac-update-helper.sh"), helper);
    const previous = path.join(task, "previous.app");
    const journalTemporary = path.join(updatesDirectory, `mac-update-${randomUUID()}.tmp`);
    return {
      async install() {
        signal?.throwIfAborted();
        if (disposed || armed || child) fail("Установка обновления уже завершена или отменена.");
        let spawnError;
        let exited = false;
        child = spawnProcess("/bin/sh", [helper, String(pid), task, target, staged, previous, log, openCommand, String(waitSeconds), String(startupWaitSeconds), disposableArchive, journalPath],
          { detached: true, stdio: "ignore", env: { PATH: "/usr/bin:/bin", LANG: "en_US.UTF-8" } });
        child.once("error", (error) => { spawnError = error; });
        child.once("exit", () => { exited = true; });
        const deadline = Date.now() + helperReadyTimeout;
        while (true) {
          if (disposed || signal?.aborted || spawnError || exited || Date.now() > deadline) {
            await fsp.writeFile(path.join(task, "cancel"), "cancel").catch(() => {});
            fail("Не удалось запустить установку. Приложение продолжит работу.", spawnError?.message);
          }
          try { await fsp.access(path.join(task, "ready")); break; } catch {}
          await new Promise((resolve) => setTimeout(resolve, 30));
        }
        signal?.throwIfAborted();
        if (disposed) fail("Установка обновления отменена.");
        await fsp.writeFile(journalTemporary, JSON.stringify({ version, target, task }), { flag: "wx", mode: 0o600 });
        await fsp.link(journalTemporary, journalPath);
        journalCreated = true;
        await fsp.unlink(journalTemporary);
        await fsp.writeFile(path.join(task, "install"), "install", { mode: 0o600 });
        while (true) {
          if (disposed || signal?.aborted || spawnError || exited || Date.now() > deadline) {
            await fsp.writeFile(path.join(task, "cancel"), "cancel").catch(() => {});
            if (journalCreated) await fsp.unlink(journalPath).catch(() => {});
            fail("Не удалось подтвердить запуск установки. Приложение продолжит работу.");
          }
          try { await fsp.access(path.join(task, "accepted")); break; } catch {}
          await new Promise((resolve) => setTimeout(resolve, 30));
        }
        armed = true;
        child.unref();
      },
      async dispose() {
        // Main-process cleanup after successful handoff must not cancel the independent helper.
        if (armed || disposed) return;
        disposed = true;
        if (child) {
          await fsp.writeFile(path.join(task, "cancel"), "cancel").catch(() => {});
          child.kill();
        }
        await fsp.rm(task, { recursive: true, force: true });
        await fsp.unlink(journalTemporary).catch(() => {});
        if (journalCreated) await fsp.unlink(journalPath).catch(() => {});
      },
    };
  } catch (error) {
    await fsp.rm(task, { recursive: true, force: true }).catch(() => {});
    if (!error.userMessage) error.userMessage = "Не удалось подготовить обновление. Проверьте свободное место и доступ к папке приложения.";
    throw error;
  }
}
module.exports = { prepareMacUpdate, confirmMacUpdateStarted, extractBundle, validateBundle, bundleFromExecutable };
