const { EventEmitter } = require("node:events");
const fs = require("node:fs/promises");
const { createWriteStream } = require("node:fs");
const path = require("node:path");
const net = require("node:net");
const { spawn } = require("node:child_process");
const { randomBytes } = require("node:crypto");
const { Client } = require("pg");

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function bundlePath(root, relative) {
  if (typeof relative !== "string" || !relative || path.isAbsolute(relative)) {
    throw new Error("Некорректный путь в манифесте сборки");
  }
  const result = path.resolve(root, relative);
  if (!result.startsWith(path.resolve(root) + path.sep)) {
    throw new Error("Путь компонента выходит за каталог сборки");
  }
  return result;
}

async function readJson(file, fallback) {
  try {
    return JSON.parse(await fs.readFile(file, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return fallback;
    throw error;
  }
}

async function writeJson(file, value) {
  const temporary = file + ".tmp";
  await fs.writeFile(temporary, JSON.stringify(value, null, 2), {
    mode: 0o600,
  });
  await fs.rename(temporary, file);
}

async function availablePort(preferred = 0) {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", (error) => {
      if (preferred && error.code === "EADDRINUSE")
        availablePort().then(resolve, reject);
      else reject(error);
    });
    server.listen(preferred, "127.0.0.1", () => {
      const port = server.address().port;
      server.close((error) => (error ? reject(error) : resolve(port)));
    });
  });
}

function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      ...options,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let output = "";
    const append = (data) => {
      output = (output + data.toString()).slice(-12000);
    };
    child.stdout.on("data", append);
    child.stderr.on("data", append);
    child.once("error", reject);
    child.once("exit", (code) =>
      code === 0
        ? resolve(output)
        : reject(
            Object.assign(
              new Error(
                `${path.basename(command)} завершился с кодом ${code}: ${output}`,
              ),
              { exitCode: code },
            ),
          ),
    );
  });
}

async function waitForHealth(
  url,
  {
    timeout = 180000,
    alive = () => true,
    validate = (body) => body.status === "UP",
  } = {},
) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (!alive())
      throw new Error(
        `Компонент завершился до готовности: ${new URL(url).pathname}`,
      );
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(2000) });
      if (response.ok && validate(await response.json())) return;
    } catch {
      /* component still starting */
    }
    await delay(400);
  }
  throw new Error(`Компонент не запустился вовремя: ${new URL(url).pathname}`);
}

async function stopChild(child, timeout = 40000) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  if (child.connected && typeof child.send === "function")
    child.send({ type: "stop" });
  else child.kill("SIGTERM");
  await waitForExit(child, timeout);
  if (child.exitCode === null && child.signalCode === null) {
    if (process.platform === "win32")
      await run("taskkill", ["/PID", String(child.pid), "/T", "/F"]);
    else child.kill("SIGKILL");
    await waitForExit(child, 5000);
    if (child.exitCode === null && child.signalCode === null)
      throw new Error("Не удалось остановить локальный компонент");
  }
}

function waitForExit(child, timeout) {
  if (child.exitCode !== null || child.signalCode !== null)
    return Promise.resolve();
  return new Promise((resolve) => {
    const exited = () => {
      clearTimeout(timer);
      resolve();
    };
    const timer = setTimeout(() => {
      child.removeListener("exit", exited);
      resolve();
    }, timeout);
    child.once("exit", exited);
  });
}

class LocalRuntime extends EventEmitter {
  constructor({
    root,
    userData,
    version,
    platform = process.platform,
    arch = process.arch,
  }) {
    super();
    this.root = path.resolve(root);
    this.userData = path.resolve(userData);
    this.dataDir = path.join(this.userData, "data");
    this.logsDir = path.join(this.userData, "logs");
    this.backupsDir = path.join(this.userData, "backups");
    this.version = version;
    this.platform = platform;
    this.arch = arch;
    this.children = new Map();
    this.pgRunning = false;
    this.stopping = false;
    this.started = false;
    this.stopPromise = null;
    this.startPromise = null;
    this.cancelRequested = false;
    this.databaseStartPromise = null;
  }

  async isFirstRun() {
    await this.recoverInterruptedRestore();
    const state = await readJson(
      path.join(this.dataDir, "app-state.json"),
      null,
    );
    return !state?.setupCompleted;
  }

  async recoverInterruptedRestore() {
    const previous = path.join(this.userData, "restore-previous");
    const exists = async (file) =>
      fs.access(file).then(
        () => true,
        () => false,
      );
    if (!(await exists(this.dataDir)) && (await exists(previous))) {
      // Restore never falls back to an empty database if the process died
      // between the two directory renames.
      await fs.rename(previous, this.dataDir);
    }
  }

  async loadManifest() {
    this.manifest = await readJson(path.join(this.root, "manifest.json"), null);
    if (!this.manifest || this.manifest.schemaVersion !== 1) {
      throw new Error(
        "Нет подготовленной локальной сборки. Выполните npm run prepare:runtime перед упаковкой.",
      );
    }
    if (
      this.manifest.platform !== this.platform ||
      this.manifest.arch !== this.arch
    ) {
      throw new Error(
        "Сборка локальных компонентов не соответствует этому компьютеру",
      );
    }
    for (const key of [
      "java",
      "python",
      "backend",
      "frontend",
      "importer",
      "embeddingService",
      "model",
    ]) {
      await fs.access(bundlePath(this.root, this.manifest[key]));
    }
    for (const key of ["initdb", "pgCtl", "psql", "pgDump"]) {
      await fs.access(bundlePath(this.root, this.manifest.postgres[key]));
    }
  }

  start(options = {}) {
    if (this.started) return Promise.resolve(this.url);
    if (this.startPromise) return this.startPromise;
    this.cancelRequested = false;
    this.startPromise = this.startInternal(options).finally(() => {
      this.startPromise = null;
    });
    return this.startPromise;
  }

  assertStarting() {
    if (this.cancelRequested) throw new Error("Запуск приложения отменён.");
  }

  async startInternal({ bootstrapPassword, bootstrapPhone } = {}) {
    this.stopping = false;
    await this.recoverInterruptedRestore();
    await this.loadManifest();
    this.assertStarting();
    await fs.mkdir(this.dataDir, { recursive: true, mode: 0o700 });
    await fs.mkdir(this.logsDir, { recursive: true, mode: 0o700 });
    // pg_ctl owns a detached database process. Recover only this application's
    // cluster after an interrupted exit before copying any physical database.
    await this.ensureDatabaseStopped();
    const oldState = await readJson(
      path.join(this.dataDir, "app-state.json"),
      null,
    );
    const upgrade = oldState?.version && oldState.version !== this.version;
    let upgradeBackup;
    if (upgrade) {
      this.emit("progress", "Создаём резервную копию перед обновлением…");
      upgradeBackup = await this.backup("before-upgrade", {
        duringStart: true,
      });
    }
    this.stopping = false;
    try {
      this.emit("progress", "Запускаем локальную базу данных…");
      await this.startDatabase();
      this.assertStarting();
      this.emit("progress", "Загружаем локальную модель поиска…");
      const embeddingPort = await availablePort(
        this.config.embeddingPort || 18002,
      );
      const backendPort = await availablePort(this.config.backendPort || 18084);
      Object.assign(this.config, { embeddingPort, backendPort });
      await writeJson(
        path.join(this.dataDir, "runtime-config.json"),
        this.config,
      );
      this.url = `http://127.0.0.1:${backendPort}`;
      const embedding = this.startProcess(
        "embeddings",
        this.component("python"),
        [
          "-m",
          "uvicorn",
          "app:app",
          "--host",
          "127.0.0.1",
          "--port",
          String(embeddingPort),
        ],
        {
          cwd: this.component("embeddingService"),
          env: this.baseEnv({
            MODEL_DIR: this.component("model"),
            MODEL_NAME: "intfloat/multilingual-e5-base",
            MODEL_DEVICE: "cpu",
            HF_HUB_OFFLINE: "1",
            TRANSFORMERS_OFFLINE: "1",
            HF_DATASETS_OFFLINE: "1",
            HF_HOME: path.join(this.userData, "cache", "huggingface"),
            TOKENIZERS_PARALLELISM: "false",
          }),
        },
      );
      await waitForHealth(`http://127.0.0.1:${embeddingPort}/health`, {
        timeout: 240000,
        alive: () =>
          !this.cancelRequested &&
          embedding.exitCode === null &&
          embedding.signalCode === null,
        validate: (body) => body.status === "ok" && body.dimensions === 768,
      });
      this.assertStarting();
      this.emit("progress", "Запускаем приложение и проверяем базу…");
      this.controlToken = randomBytes(32).toString("hex");
      const env = this.baseEnv({
        SPRING_PROFILES_ACTIVE: "desktop",
        SERVER_ADDRESS: "127.0.0.1",
        SERVER_PORT: String(backendPort),
        APP_DESKTOP_DATA_DIR: this.dataDir,
        APP_DESKTOP_WEB_ROOT: this.component("frontend"),
        SPRING_DATASOURCE_URL: `jdbc:postgresql://127.0.0.1:${this.config.postgresPort}/ovoshi_help`,
        SPRING_DATASOURCE_USERNAME: "ovoshi_help",
        SPRING_DATASOURCE_PASSWORD: this.config.databasePassword,
        APP_BOOTSTRAP_ADMIN_PASSWORD: bootstrapPassword || "",
        APP_DESKTOP_ADMIN_PHONE: bootstrapPhone || "",
        APP_DESKTOP_CONTROL_TOKEN: this.controlToken,
        APP_DESKTOP_IMPORTED_DATA:
          oldState?.importedData === true ? "true" : "false",
        APP_PRICE_IMPORT_PYTHON: this.component("python"),
        APP_PRICE_IMPORT_SCRIPT: this.component("importer"),
        APP_PRICE_IMPORT_TEMP_DIR: path.join(this.dataDir, "import-temp"),
        APP_EMBEDDINGS_ENABLED: "true",
        APP_EMBEDDINGS_URL: `http://127.0.0.1:${embeddingPort}`,
        APP_CORS_ALLOWED_ORIGINS: this.url,
        APP_GPT_ENABLED: "false",
        APP_AUTH_COOKIE_NAME: "ovoshi_help_desktop_session",
        APP_SEO_TEMPLATE_URL: `${this.url}/index.html`,
      });
      // Only explicitly configured integration settings enter the local backend.
      const integrations = await readJson(
        path.join(this.dataDir, "integrations.json"),
        {},
      );
      const allowed = new Set([
        "OPENAI_API_KEY",
        "APP_GPT_ENABLED",
        "APP_GPT_MODEL",
        "APP_GPT_ORDER_PHOTO_MODEL",
        "APP_WHATSAPP_ACCESS_TOKEN",
        "APP_WHATSAPP_PHONE_NUMBER_ID",
        "APP_WHATSAPP_WABA_ID",
        "APP_WHATSAPP_VERIFY_TOKEN",
        "APP_WHATSAPP_APP_SECRET",
        "APP_MKS_LOGIN",
        "APP_MKS_PASSWORD",
        "APP_ALIBABA_SOURCING_PROVIDER",
        "APP_WEB_PUSH_PUBLIC_KEY",
        "APP_WEB_PUSH_PRIVATE_KEY",
        "APP_WEB_PUSH_SUBJECT",
      ]);
      for (const [key, value] of Object.entries(integrations))
        if (allowed.has(key) && typeof value === "string") env[key] = value;
      const backend = this.startProcess(
        "backend",
        this.component("java"),
        [
          "-Dfile.encoding=UTF-8",
          "-Xms128m",
          "-Xmx1024m",
          "-jar",
          this.component("backend"),
        ],
        { cwd: this.dataDir, env },
      );
      await waitForHealth(`${this.url}/actuator/health/readiness`, {
        timeout: 240000,
        alive: () =>
          !this.cancelRequested &&
          backend.exitCode === null &&
          backend.signalCode === null,
      });
      this.assertStarting();
      await writeJson(path.join(this.dataDir, "app-state.json"), {
        ...oldState,
        schemaVersion: 1,
        version: this.version,
        setupCompleted: true,
        lastReadyAt: new Date().toISOString(),
      });
      this.started = true;
      await fs
        .rm(path.join(this.userData, "restore-previous"), {
          recursive: true,
          force: true,
        })
        .catch(() => {});
      return this.url;
    } catch (error) {
      await this.stopInternal();
      if (upgradeBackup) {
        await this.restoreBackup(upgradeBackup, { duringStart: true });
        error.message +=
          "\nДанные восстановлены из копии перед обновлением. Установите предыдущую рабочую версию приложения.";
      }
      throw error;
    }
  }

  component(key) {
    return bundlePath(this.root, this.manifest[key]);
  }
  pg(key) {
    return bundlePath(this.root, this.manifest.postgres[key]);
  }

  baseEnv(extra = {}) {
    const env = {};
    for (const key of [
      "PATH",
      "HOME",
      "USERPROFILE",
      "SYSTEMROOT",
      "SystemRoot",
      "WINDIR",
      "TEMP",
      "TMP",
      "LANG",
      "LC_ALL",
      "TMPDIR",
      "COMSPEC",
      "PATHEXT",
    ])
      if (process.env[key]) env[key] = process.env[key];
    env.PYTHONPYCACHEPREFIX = path.join(this.userData, "cache", "python");
    env.PYTHONNOUSERSITE = "1";
    env.PYTHONUTF8 = "1";
    env.PATH =
      path.dirname(this.component("python")) +
      path.delimiter +
      (env.PATH || "");
    return { ...env, ...extra };
  }

  async startDatabase() {
    const configPath = path.join(this.dataDir, "runtime-config.json");
    this.config = await readJson(configPath, null);
    const pgDir = path.join(this.dataDir, "postgres");
    const initialized = await fs.access(path.join(pgDir, "PG_VERSION")).then(
      () => true,
      () => false,
    );
    if (initialized && this.manifest.versions?.postgres) {
      const existingMajor = (
        await fs.readFile(path.join(pgDir, "PG_VERSION"), "utf8")
      ).trim();
      if (existingMajor !== this.manifest.versions.postgres.split(".")[0]) {
        throw new Error(
          "Версия PostgreSQL в пакете несовместима с локальной базой. Для смены основной версии базы нужен отдельный перенос данных.",
        );
      }
    }
    if (!this.config && initialized)
      throw new Error(
        "Не найдены настройки существующей локальной базы. Восстановите резервную копию.",
      );
    if (!this.config)
      this.config = {
        schemaVersion: 1,
        databasePassword: randomBytes(32).toString("hex"),
      };
    this.config.postgresPort = await availablePort(
      this.config.postgresPort || 15434,
    );
    await writeJson(configPath, this.config);
    if (!initialized) {
      const pwFile = path.join(this.dataDir, ".initdb-password");
      await fs.writeFile(pwFile, this.config.databasePassword + "\n", {
        mode: 0o600,
      });
      try {
        await run(
          this.pg("initdb"),
          [
            "-D",
            pgDir,
            "-U",
            "ovoshi_help",
            "--encoding=UTF8",
            "--locale=C",
            "--auth-local=trust",
            "--auth-host=scram-sha-256",
            `--pwfile=${pwFile}`,
          ],
          { env: this.baseEnv() },
        );
      } finally {
        await fs.rm(pwFile, { force: true });
      }
    }
    this.assertStarting();
    await run(
      this.pg("pgCtl"),
      [
        "start",
        "-D",
        pgDir,
        "-l",
        path.join(this.logsDir, "postgres.log"),
        "-o",
        `-h 127.0.0.1 -p ${this.config.postgresPort}`,
        "-w",
        "-t",
        "60",
      ],
      { env: this.baseEnv() },
    );
    this.pgRunning = true;
    const client = new Client({
      host: "127.0.0.1",
      port: this.config.postgresPort,
      user: "ovoshi_help",
      password: this.config.databasePassword,
      database: "postgres",
    });
    try {
      await client.connect();
      const result = await client.query(
        "SELECT 1 FROM pg_database WHERE datname = 'ovoshi_help'",
      );
      if (!result.rowCount) await client.query("CREATE DATABASE ovoshi_help");
    } finally {
      await client.end();
    }
  }

  startProcess(name, executable, args, options) {
    const log = createWriteStream(path.join(this.logsDir, name + ".log"), {
      flags: "a",
      mode: 0o600,
    });
    // The wrapper observes IPC disconnection and terminates the native process
    // even if Electron is killed without executing before-quit.
    const child = spawn(
      process.execPath,
      [path.join(__dirname, "child.cjs"), executable, ...args],
      {
        ...options,
        env: { ...options.env, ELECTRON_RUN_AS_NODE: "1" },
        windowsHide: true,
        stdio: ["ignore", "pipe", "pipe", "ipc"],
      },
    );
    child.stdout.pipe(log, { end: false });
    child.stderr.pipe(log, { end: false });
    this.children.set(name, child);
    child.once("error", () => {
      log.end();
      this.emit("component-failed", name);
    });
    child.once("exit", () => {
      log.end();
      if (!this.stopping && this.started) this.emit("component-failed", name);
    });
    return child;
  }

  async stop() {
    this.cancelRequested = true;
    if (this.stopPromise) return this.stopPromise;
    this.stopPromise = (async () => {
      // Never let a pending pg_ctl start detach a database after shutdown has
      // already checked pgRunning. Startup observes cancellation at each phase.
      if (this.startPromise) await this.startPromise.catch(() => {});
      if (this.databaseStartPromise)
        await this.databaseStartPromise.catch(() => {});
      await this.stopInternal();
    })();
    try {
      await this.stopPromise;
    } finally {
      this.stopPromise = null;
    }
  }

  async stopInternal() {
    await this.stopApplications();
    if (this.pgRunning) {
      await run(
        this.pg("pgCtl"),
        [
          "stop",
          "-D",
          path.join(this.dataDir, "postgres"),
          "-m",
          "fast",
          "-w",
          "-t",
          "60",
        ],
        { env: this.baseEnv() },
      );
      this.pgRunning = false;
    }
  }

  async pauseBackend() {
    this.cancelRequested = true;
    if (this.startPromise) await this.startPromise.catch(() => {});
    await this.stopApplications();
  }

  async resumeDatabase() {
    if (this.databaseStartPromise) return this.databaseStartPromise;
    this.cancelRequested = false;
    if (!this.manifest) await this.loadManifest();
    this.databaseStartPromise = this.startDatabase();
    try {
      await this.databaseStartPromise;
    } finally {
      this.databaseStartPromise = null;
    }
  }

  async ensureDatabaseStopped() {
    if (!this.manifest) await this.loadManifest();
    try {
      await run(
        this.pg("pgCtl"),
        ["status", "-D", path.join(this.dataDir, "postgres")],
        { env: this.baseEnv() },
      );
      this.pgRunning = true;
    } catch (error) {
      if (this.pgRunning || ![3, 4].includes(error.exitCode)) throw error;
    }
    await this.stopInternal();
  }

  async stopApplications() {
    this.stopping = true;
    this.started = false;
    for (const name of ["backend", "embeddings"]) {
      const child = this.children.get(name);
      if (
        name === "backend" &&
        child &&
        child.exitCode === null &&
        child.signalCode === null &&
        this.url &&
        this.controlToken
      ) {
        try {
          const response = await fetch(`${this.url}/__desktop/shutdown`, {
            method: "POST",
            headers: { "X-Ovoshi-Control": this.controlToken },
            signal: AbortSignal.timeout(3000),
          });
          if (response.ok) await waitForExit(child, 40000);
        } catch {
          /* process may have already exited during shutdown */
        }
      }
      await stopChild(child);
      this.children.delete(name);
    }
  }

  async backup(reason = "manual", { duringStart = false } = {}) {
    await (duringStart ? this.stopInternal() : this.stop());
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const destination = path.join(
      this.backupsDir,
      `${timestamp}-${reason}-${randomBytes(3).toString("hex")}`,
    );
    await fs.mkdir(destination, { recursive: true, mode: 0o700 });
    try {
      await fs.cp(this.dataDir, path.join(destination, "data"), {
        recursive: true,
        preserveTimestamps: true,
      });
      const state = await readJson(
        path.join(this.dataDir, "app-state.json"),
        null,
      );
      await writeJson(path.join(destination, "backup.json"), {
        schemaVersion: 1,
        reason,
        version: state?.version || this.version,
        createdAt: new Date().toISOString(),
        complete: true,
      });
      return destination;
    } catch (error) {
      await fs.rm(destination, { recursive: true, force: true });
      throw error;
    }
  }

  async restoreBackup(source, { duringStart = false } = {}) {
    await (duringStart ? this.stopInternal() : this.stop());
    const resolved = path.resolve(source);
    if (!resolved.startsWith(this.backupsDir + path.sep))
      throw new Error(
        "Копия должна находиться в каталоге резервных копий приложения",
      );
    const marker = await readJson(path.join(resolved, "backup.json"), null);
    if (!marker?.complete || marker.schemaVersion !== 1)
      throw new Error("Резервная копия не завершена");
    const staging = path.join(this.userData, "restore-staging");
    await fs.rm(staging, { recursive: true, force: true });
    await fs.cp(path.join(resolved, "data"), staging, {
      recursive: true,
      preserveTimestamps: true,
    });
    const previous = path.join(this.userData, "restore-previous");
    await fs.rm(previous, { recursive: true, force: true });
    await fs.rename(this.dataDir, previous);
    try {
      await fs.rename(staging, this.dataDir);
    } catch (error) {
      await fs.rename(previous, this.dataDir);
      throw error;
    }
    await fs.rm(previous, { recursive: true, force: true });
  }
}

module.exports = {
  LocalRuntime,
  bundlePath,
  availablePort,
  waitForHealth,
  readJson,
  writeJson,
  stopChild,
  run,
};
