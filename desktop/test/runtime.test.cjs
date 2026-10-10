const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const os = require("node:os");
const net = require("node:net");
const http = require("node:http");
const { spawn } = require("node:child_process");
const {
  LocalRuntime,
  bundlePath,
  availablePort,
  waitForHealth,
  writeJson,
  readJson,
  stopChild,
} = require("../src/runtime.cjs");

test("manifest paths stay inside the runtime bundle", () => {
  const root = path.join(os.tmpdir(), "bundle");
  assert.equal(
    bundlePath(root, "java/bin/java"),
    path.join(root, "java/bin/java"),
  );
  for (const invalid of ["../secret", path.resolve("/outside"), "", null])
    assert.throws(() => bundlePath(root, invalid));
});

test("occupied preferred port selects another loopback port", async () => {
  const server = net.createServer();
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    assert.notEqual(
      await availablePort(server.address().port),
      server.address().port,
    );
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("readiness rejects stopped child and accepts only ready status", async () => {
  await assert.rejects(
    waitForHealth("http://127.0.0.1:1/health", { alive: () => false }),
    /завершился/,
  );
  const server = http.createServer((_req, res) => {
    res.end(JSON.stringify({ status: "UP" }));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    await waitForHealth(`http://127.0.0.1:${server.address().port}/health`, {
      timeout: 1000,
    });
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("consistent backup stops services before copying, restores data and rejects incomplete copy", async () => {
  const temporary = await fs.mkdtemp(
    path.join(os.tmpdir(), "ovoshi-backup-test-"),
  );
  const runtime = new LocalRuntime({
    root: path.join(temporary, "runtime"),
    userData: temporary,
    version: "0.2.0",
  });
  try {
    await fs.mkdir(runtime.dataDir, { recursive: true });
    await writeJson(path.join(runtime.dataDir, "app-state.json"), {
      version: "0.1.0",
      setupCompleted: true,
    });
    await fs.writeFile(
      path.join(runtime.dataDir, "important.txt"),
      "old order",
    );
    let stopped = false;
    runtime.stop = async () => {
      stopped = true;
      await fs.writeFile(
        path.join(runtime.dataDir, "shutdown-marker"),
        "stopped",
      );
    };
    const backup = await runtime.backup("test");
    assert.equal(stopped, true);
    assert.equal(
      await fs.readFile(path.join(backup, "data/shutdown-marker"), "utf8"),
      "stopped",
    );
    assert.equal(
      (await readJson(path.join(backup, "backup.json"))).version,
      "0.1.0",
    );
    await fs.writeFile(
      path.join(runtime.dataDir, "important.txt"),
      "new order",
    );
    await runtime.restoreBackup(backup);
    assert.equal(
      await fs.readFile(path.join(runtime.dataDir, "important.txt"), "utf8"),
      "old order",
    );
    assert.equal(await runtime.isFirstRun(), false);
    const incomplete = path.join(runtime.backupsDir, "incomplete");
    await fs.mkdir(incomplete);
    await assert.rejects(runtime.restoreBackup(incomplete), /не завершена/);
    await assert.rejects(
      runtime.restoreBackup(temporary),
      /каталоге резервных/,
    );
  } finally {
    await fs.rm(temporary, { recursive: true, force: true });
  }
});

test("failed service shutdown prevents backup creation", async () => {
  const temporary = await fs.mkdtemp(
    path.join(os.tmpdir(), "ovoshi-stop-test-"),
  );
  try {
    const runtime = new LocalRuntime({
      root: temporary,
      userData: temporary,
      version: "0.1.0",
    });
    runtime.stop = async () => {
      throw new Error("database is still running");
    };
    await assert.rejects(runtime.backup(), /still running/);
    await assert.rejects(fs.access(runtime.backupsDir), { code: "ENOENT" });
  } finally {
    await fs.rm(temporary, { recursive: true, force: true });
  }
});

test("failed upgrade restores the complete previous data and version marker", async () => {
  const temporary = await fs.mkdtemp(
    path.join(os.tmpdir(), "ovoshi-upgrade-test-"),
  );
  const root = path.join(temporary, "runtime");
  const runtime = new LocalRuntime({
    root,
    userData: temporary,
    version: "0.2.0",
  });
  try {
    await fs.mkdir(root);
    await fs.writeFile(path.join(root, "placeholder"), "not executable");
    await writeJson(path.join(root, "manifest.json"), {
      schemaVersion: 1,
      platform: process.platform,
      arch: process.arch,
      java: "placeholder",
      python: "placeholder",
      backend: "placeholder",
      frontend: "placeholder",
      importer: "placeholder",
      embeddingService: "placeholder",
      model: "placeholder",
      postgres: {
        initdb: "placeholder",
        pgCtl: "placeholder",
        psql: "placeholder",
        pgDump: "placeholder",
      },
    });
    await fs.mkdir(runtime.dataDir);
    await writeJson(path.join(runtime.dataDir, "app-state.json"), {
      version: "0.1.0",
      setupCompleted: true,
    });
    await fs.writeFile(path.join(runtime.dataDir, "order"), "before migration");
    runtime.startDatabase = async () => {
      await fs.writeFile(
        path.join(runtime.dataDir, "order"),
        "partially migrated",
      );
      throw new Error("migration failed");
    };
    runtime.ensureDatabaseStopped = async () => {};
    await assert.rejects(runtime.start(), /Данные восстановлены/);
    assert.equal(
      await fs.readFile(path.join(runtime.dataDir, "order"), "utf8"),
      "before migration",
    );
    assert.equal(
      (await readJson(path.join(runtime.dataDir, "app-state.json"))).version,
      "0.1.0",
    );
  } finally {
    await fs.rm(temporary, { recursive: true, force: true });
  }
});

test("interrupted restore recovers previous database instead of offering a fresh installation", async () => {
  const temporary = await fs.mkdtemp(
    path.join(os.tmpdir(), "ovoshi-restore-recovery-"),
  );
  try {
    const previous = path.join(temporary, "restore-previous");
    await fs.mkdir(previous);
    await writeJson(path.join(previous, "app-state.json"), {
      version: "0.1.0",
      setupCompleted: true,
    });
    await fs.writeFile(path.join(previous, "order"), "preserved");
    const runtime = new LocalRuntime({
      root: temporary,
      userData: temporary,
      version: "0.1.0",
    });
    assert.equal(await runtime.isFirstRun(), false);
    assert.equal(
      await fs.readFile(path.join(runtime.dataDir, "order"), "utf8"),
      "preserved",
    );
  } finally {
    await fs.rm(temporary, { recursive: true, force: true });
  }
});

test("quit during database startup waits for pending start and stops the resulting process", async () => {
  const temporary = await fs.mkdtemp(
    path.join(os.tmpdir(), "ovoshi-start-cancel-"),
  );
  try {
    const runtime = new LocalRuntime({
      root: temporary,
      userData: temporary,
      version: "0.1.0",
    });
    runtime.loadManifest = async () => {
      runtime.manifest = { python: "missing", postgres: { pgCtl: "missing" } };
    };
    runtime.ensureDatabaseStopped = async () => {};
    let entered;
    const databaseEntered = new Promise((resolve) => {
      entered = resolve;
    });
    let release;
    const databaseFinished = new Promise((resolve) => {
      release = resolve;
    });
    runtime.startDatabase = async () => {
      entered();
      await databaseFinished;
      runtime.pgRunning = true;
    };
    let stoppedDatabase = false;
    runtime.stopInternal = async () => {
      if (runtime.pgRunning) stoppedDatabase = true;
      runtime.pgRunning = false;
    };
    const starting = runtime.start();
    const rejected = assert.rejects(starting, /отменён/);
    await databaseEntered;
    const stopping = runtime.stop();
    assert.equal(stoppedDatabase, false);
    release();
    await rejected;
    await stopping;
    assert.equal(stoppedDatabase, true);
    assert.equal(runtime.pgRunning, false);
  } finally {
    await fs.rm(temporary, { recursive: true, force: true });
  }
});

test("child wrapper stops native subprocess when parent IPC disconnects", async () => {
  const temporary = await fs.mkdtemp(
    path.join(os.tmpdir(), "ovoshi-child-test-"),
  );
  const marker = path.join(temporary, "stopped");
  const wrapper = spawn(
    process.execPath,
    [
      path.join(__dirname, "../src/child.cjs"),
      process.execPath,
      "-e",
      'const fs = require("fs"); process.on("SIGTERM", () => { fs.writeFileSync(process.argv[1], "stopped"); process.exit(0); }); console.log("ready:" + process.pid); setInterval(() => {}, 1000);',
      marker,
    ],
    { stdio: ["ignore", "pipe", "pipe", "ipc"] },
  );
  try {
    const ready = await new Promise((resolve, reject) => {
      wrapper.stdout.once("data", resolve);
      wrapper.once("error", reject);
    });
    const nativePid = Number(/ready:(\d+)/.exec(ready.toString())[1]);
    const exit = new Promise((resolve) => wrapper.once("exit", resolve));
    wrapper.disconnect();
    await exit;
    assert.throws(() => process.kill(nativePid, 0), { code: "ESRCH" });
    // Windows terminates native processes on SIGTERM without running JS hooks;
    // the invariant is that neither the wrapper nor its child remains alive.
    if (process.platform !== "win32")
      assert.equal(await fs.readFile(marker, "utf8"), "stopped");
  } finally {
    if (wrapper.exitCode === null) wrapper.kill("SIGKILL");
    await fs.rm(temporary, { recursive: true, force: true });
  }
});

test("normal stop uses IPC so the native child exits with its wrapper on Windows too", async () => {
  const wrapper = spawn(
    process.execPath,
    [
      path.join(__dirname, "../src/child.cjs"),
      process.execPath,
      "-e",
      'console.log("ready"); setInterval(() => {}, 1000);',
    ],
    { stdio: ["ignore", "pipe", "pipe", "ipc"] },
  );
  try {
    await new Promise((resolve, reject) => {
      wrapper.stdout.once("data", resolve);
      wrapper.once("error", reject);
    });
    await stopChild(wrapper, 5000);
    assert.notEqual(wrapper.exitCode, null);
  } finally {
    if (wrapper.exitCode === null) wrapper.kill("SIGKILL");
  }
});
