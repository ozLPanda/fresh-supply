const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");
const { EventEmitter } = require("node:events");
const { spawn, execFile } = require("node:child_process");
const { promisify } = require("node:util");
const { setTimeout: delay } = require("node:timers/promises");
const { prepareWindowsUpdate } = require("../src/windows-update.cjs");

function pe(machine = 0x14c) {
  const bytes = Buffer.alloc(256);
  bytes.write("MZ");
  bytes.writeUInt32LE(128, 60);
  bytes.write("PE\0\0", 128);
  bytes.writeUInt16LE(machine, 132);
  return bytes;
}

async function fixture(t, options = {}) {
  const root = await fs.realpath(
    await fs.mkdtemp(path.join(os.tmpdir(), "fresh-supply-windows-update-")),
  );
  t.after(async () => {
    await fs.rm(root, {
      recursive: true,
      force: true,
      maxRetries: 5,
      retryDelay: 100,
    });
  });
  const userData = path.join(root, "Ovoshi Help & ! %literal%");
  const installDirectory = path.join(
    root,
    "fresh supply;$ harmless ' characters",
  );
  const downloadDirectory = path.join(userData, "updates", "download-abc123");
  await fs.mkdir(downloadDirectory, { recursive: true });
  await fs.mkdir(installDirectory);
  const archivePath = path.join(
    downloadDirectory,
    "fresh-supply-0.2.0-win-x64.exe",
  );
  const execPath = path.join(installDirectory, "fresh-supply.exe");
  await fs.writeFile(archivePath, pe());
  await fs.writeFile(execPath, pe(0x8664));
  const settings = {
    app: { isPackaged: true, getPath: () => userData },
    archivePath,
    version: "0.2.0",
    sha256: crypto.createHash("sha256").update(pe()).digest("hex"),
    execPath,
    platform: "win32",
    arch: "x64",
    env: { SystemRoot: "C:\\Windows" },
    timeoutMs: 400,
    pollMs: 5,
    ...options,
  };
  return {
    settings,
    root,
    userData,
    execPath,
    archivePath,
    installDirectory,
    downloadDirectory,
  };
}

async function waitFor(predicate, timeoutMs = 3000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await delay(5);
  }
  throw new Error("Timed out waiting for test helper.");
}

async function present(file) {
  try {
    await fs.access(file);
    return true;
  } catch {
    return false;
  }
}

function spawnFixture() {
  const child = new EventEmitter();
  const calls = [];
  let config;
  child.kill = () => {
    calls.push("kill");
    child.emit("exit", null);
  };
  child.unref = () => calls.push("unref");
  const fakeSpawn = (file, args, options) => {
    calls.push({ file, args, options });
    fs.readFile(options.env.FRESH_SUPPLY_UPDATE_CONFIG, "utf8").then(
      (content) => {
        config = JSON.parse(content);
      },
    );
    return child;
  };
  return {
    child,
    calls,
    spawn: fakeSpawn,
    getConfig: async () => {
      await waitFor(() => !!config);
      return config;
    },
  };
}

test("Windows stages safely and confirms helper readiness before authorizing shutdown", async (t) => {
  const fixtureData = await fixture(t);
  const fake = spawnFixture();
  const prepared = await prepareWindowsUpdate({
    ...fixtureData.settings,
    spawn: fake.spawn,
  });
  assert.deepEqual(fake.calls, []);
  const installation = prepared.install();
  const config = await fake.getConfig();
  assert.equal(config.installDirectory, fixtureData.installDirectory);
  assert.equal(config.installedExecutable, fixtureData.execPath);
  assert.equal(config.requiresElevation, false);
  assert.equal(
    config.resultPath,
    path.join(
      fixtureData.userData,
      "updates",
      "windows-last-install-result.json",
    ),
  );
  assert.equal(await present(config.commitPath), false);
  const launch = fake.calls[0];
  assert.equal(launch.file, "C:\\Windows\\System32\\cmd.exe");
  assert.deepEqual(launch.args, [
    "/d",
    "/v:off",
    "/s",
    "/c",
    '""%FRESH_SUPPLY_UPDATE_LAUNCHER%""',
  ]);
  assert.equal(launch.options.shell, false);
  assert.equal(launch.options.windowsVerbatimArguments, true);
  assert.equal(launch.options.detached, true);
  assert.equal(launch.options.windowsHide, true);
  assert.equal(
    launch.options.env.FRESH_SUPPLY_POWERSHELL,
    "C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe",
  );
  assert.equal(
    launch.options.env.FRESH_SUPPLY_UPDATE_LAUNCHER,
    path.join(path.dirname(config.readyPath), "launcher.cmd"),
  );
  const script = Buffer.from(
    launch.options.env.FRESH_SUPPLY_UPDATE_SCRIPT,
    "base64",
  ).toString("utf16le");
  assert.equal(
    script,
    "& ([scriptblock]::Create([System.IO.File]::ReadAllText($env:FRESH_SUPPLY_UPDATE_HELPER)))",
  );
  assert.ok(launch.options.env.FRESH_SUPPLY_UPDATE_SCRIPT.length < 1000);
  assert.equal(
    await fs.readFile(launch.options.env.FRESH_SUPPLY_UPDATE_HELPER, "utf8"),
    await fs.readFile(
      path.join(__dirname, "../src/windows-update-helper.ps1"),
      "utf8",
    ),
  );
  assert.equal(script.includes(fixtureData.installDirectory), false);
  assert.equal(launch.args.includes("-ExecutionPolicy"), false);
  await fs.writeFile(config.readyPath, "1");
  await waitFor(() => present(config.commitPath));
  assert.equal(fake.calls.includes("unref"), false);
  await fs.writeFile(config.acceptedPath, "1");
  await installation;
  assert.equal(fake.calls.includes("unref"), true);
  await prepared.dispose();
  assert.equal(await present(config.cancelPath), false);
  assert.equal(fake.calls.includes("kill"), false);
});

test("Windows protected installation requests elevation only for the checked installer", async (t) => {
  const f = await fixture(t);
  const original = fs.writeFile;
  fs.writeFile = async (file, ...args) => {
    if (
      path.dirname(file) === f.installDirectory &&
      path.basename(file).startsWith(".fresh-supply-update-")
    ) {
      throw Object.assign(new Error("Access denied"), { code: "EACCES" });
    }
    return original(file, ...args);
  };
  try {
    const fake = spawnFixture();
    const prepared = await prepareWindowsUpdate({
      ...f.settings,
      spawn: fake.spawn,
    });
    assert.equal(prepared.requiresElevation, true);
    const pending = prepared.install();
    const config = await fake.getConfig();
    assert.equal(config.requiresElevation, true);
    assert.equal(
      fake.calls[0].options.env.FRESH_SUPPLY_UPDATE_SCRIPT.includes("runas"),
      false,
    );
    await original(config.readyPath, "1");
    await waitFor(() => present(config.commitPath));
    await original(config.acceptedPath, "1");
    await pending;
    await prepared.dispose();
  } finally {
    fs.writeFile = original;
  }
});

test("Windows disk errors cannot be mistaken for a need to elevate", async (t) => {
  const f = await fixture(t);
  const original = fs.writeFile;
  fs.writeFile = async (file, ...args) => {
    if (
      path.dirname(file) === f.installDirectory &&
      path.basename(file).startsWith(".fresh-supply-update-")
    ) {
      throw Object.assign(new Error("Disk full"), { code: "ENOSPC" });
    }
    return original(file, ...args);
  };
  try {
    await assert.rejects(prepareWindowsUpdate(f.settings), /Disk full/);
  } finally {
    fs.writeFile = original;
  }
});

test("Windows requests installer elevation when only the installation parent is protected", async (t) => {
  const f = await fixture(t),
    original = fs.writeFile;
  fs.writeFile = async (file, ...args) => {
    if (
      path.dirname(file) === path.dirname(f.installDirectory) &&
      path.basename(file).startsWith(".fresh-supply-update-")
    )
      throw Object.assign(new Error("Protected installation parent"), {
        code: "EPERM",
      });
    return original(file, ...args);
  };
  try {
    const prepared = await prepareWindowsUpdate(f.settings);
    assert.equal(prepared.requiresElevation, true);
    await prepared.dispose();
    assert.equal(await present(f.execPath), true);
  } finally {
    fs.writeFile = original;
  }
});

test("Windows helper launch error cannot authorize application shutdown", async (t) => {
  const fixtureData = await fixture(t);
  const fake = spawnFixture();
  const prepared = await prepareWindowsUpdate({
    ...fixtureData.settings,
    spawn: fake.spawn,
  });
  const installation = prepared.install();
  const rejection = assert.rejects(installation, /PowerShell missing/);
  const config = await fake.getConfig();
  fake.child.emit("error", new Error("PowerShell missing"));
  await rejection;
  assert.equal(await present(config.commitPath), false);
  assert.equal(fake.calls.includes("unref"), false);
  assert.equal(await present(fixtureData.execPath), true);
  await prepared.dispose();
});

test("Windows helper timeout and early exit cancel without touching installation", async (t) => {
  for (const outcome of ["timeout", "exit"]) {
    const fixtureData = await fixture(t, { timeoutMs: 200 });
    const fake = spawnFixture();
    const prepared = await prepareWindowsUpdate({
      ...fixtureData.settings,
      spawn: fake.spawn,
    });
    const installation = prepared.install();
    const rejection = assert.rejects(
      installation,
      outcome === "timeout" ? /не ответил/ : /завершился/,
    );
    await fake.getConfig();
    if (outcome === "exit") fake.child.emit("exit", 1);
    await rejection;
    assert.equal(fake.calls.includes("unref"), false);
    assert.deepEqual(await fs.readFile(fixtureData.execPath), pe(0x8664));
    await prepared.dispose();
  }
});

test("Windows cancellation while waiting for helper cancels and removes staged files", async (t) => {
  const fixtureData = await fixture(t);
  const fake = spawnFixture();
  const prepared = await prepareWindowsUpdate({
    ...fixtureData.settings,
    spawn: fake.spawn,
  });
  const installation = prepared.install();
  const rejection = assert.rejects(installation, /отменена/);
  const config = await fake.getConfig();
  await prepared.dispose();
  await rejection;
  assert.equal(await present(path.dirname(config.readyPath)), false);
  assert.equal(fake.calls.includes("kill"), true);
  assert.equal(fake.calls.filter((call) => call === "kill").length, 1);
  assert.equal(fake.calls.includes("unref"), false);
});

test("Windows rejects tampered, malformed and mismatched installers before helper launch", async (t) => {
  for (const mutate of [
    async (f) => fs.appendFile(f.archivePath, "changed"),
    async (f) => {
      await fs.writeFile(f.archivePath, "MZ damaged");
      f.settings.sha256 = crypto
        .createHash("sha256")
        .update("MZ damaged")
        .digest("hex");
    },
    async (f) => {
      f.settings.version = "0.3.0";
    },
    async (f) => {
      await fs.writeFile(f.execPath, pe(0x14c));
    },
  ]) {
    const fixtureData = await fixture(t);
    await mutate(fixtureData);
    let spawned = false;
    await assert.rejects(
      prepareWindowsUpdate({
        ...fixtureData.settings,
        spawn: () => {
          spawned = true;
        },
      }),
    );
    assert.equal(spawned, false);
    assert.equal(await present(fixtureData.archivePath), true);
  }
});

test("Windows refuses unsupported builds, arbitrary downloads and unsafe installation paths", async (t) => {
  for (const values of [
    { platform: "darwin" },
    { arch: "arm64" },
    { app: { isPackaged: false } },
    { sha256: "" },
    { version: "0.2.0;Invoke-Expression" },
    { env: { SystemRoot: "relative" } },
  ]) {
    const f = await fixture(t);
    await assert.rejects(prepareWindowsUpdate({ ...f.settings, ...values }));
  }
  const f = await fixture(t);
  const external = path.join(f.root, "fresh-supply-0.2.0-win-x64.exe");
  await fs.copyFile(f.archivePath, external);
  await assert.rejects(
    prepareWindowsUpdate({ ...f.settings, archivePath: external }),
    /локальном кэше/,
  );
  const unsafeDirectory = path.join(f.root, 'unsafe"directory');
  if (process.platform !== "win32") {
    await fs.mkdir(unsafeDirectory);
    const unsafeExecutable = path.join(unsafeDirectory, "fresh-supply.exe");
    await fs.copyFile(f.execPath, unsafeExecutable);
    await assert.rejects(
      prepareWindowsUpdate({ ...f.settings, execPath: unsafeExecutable }),
      /Каталог установки/,
    );
  }
});

test("Windows reports helper validation failure without committing installation", async (t) => {
  const f = await fixture(t);
  const fake = spawnFixture();
  const prepared = await prepareWindowsUpdate({
    ...f.settings,
    spawn: fake.spawn,
  });
  const installation = prepared.install();
  const rejection = assert.rejects(installation, /installer is missing/);
  const config = await fake.getConfig();
  await fs.writeFile(
    config.failurePath,
    "\uFEFF" + JSON.stringify({ message: "installer is missing" }),
  );
  await rejection;
  assert.equal(fake.calls.includes("unref"), false);
  await prepared.dispose();
});

async function nativeInstallerFixture(t, options = {}) {
  const f = await fixture(t, { env: process.env, timeoutMs: 30_000 });
  const powershell = path.win32.join(
    process.env.SystemRoot,
    "System32",
    "WindowsPowerShell",
    "v1.0",
    "powershell.exe",
  );
  const recordPath = path.join(f.root, "installer-command.txt");
  // Disposable compiled EXE records its command line. No installer or user app runs.
  const source =
    'using System; using System.IO; public class UpdateStub { public static int Main() { File.WriteAllText(Environment.GetEnvironmentVariable("FRESH_SUPPLY_TEST_COMMAND"), Environment.CommandLine); var remove = Environment.GetEnvironmentVariable("FRESH_SUPPLY_TEST_REMOVE"); if (!String.IsNullOrEmpty(remove)) File.Delete(remove); var code = Environment.GetEnvironmentVariable("FRESH_SUPPLY_TEST_EXIT"); return String.IsNullOrEmpty(code) ? 0 : Int32.Parse(code); } }';
  // The system powershell.exe is Windows PowerShell 5.1: compiler options are
  // supplied through CompilerParameters, rather than PowerShell 7's parameter.
  const compile = [
    "$parameters = New-Object System.CodeDom.Compiler.CompilerParameters",
    '$parameters.CompilerOptions = "/platform:x64"',
    "$parameters.GenerateExecutable = $true",
    "$parameters.GenerateInMemory = $false",
    "$parameters.OutputAssembly = $env:FRESH_SUPPLY_TEST_EXE",
    "Add-Type -TypeDefinition $env:FRESH_SUPPLY_TEST_SOURCE -CompilerParameters $parameters -ErrorAction Stop",
  ].join("; ");
  await fs.rm(f.archivePath);
  await promisify(execFile)(
    powershell,
    ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", compile],
    {
      env: {
        ...process.env,
        FRESH_SUPPLY_TEST_SOURCE: source,
        FRESH_SUPPLY_TEST_EXE: f.archivePath,
      },
      windowsHide: true,
    },
  );
  await fs.copyFile(process.execPath, f.execPath);
  // Minimal disposable installation manifest exercises the real post-install
  // hashing path. Full NSIS runtime and upgrade verification run separately.
  const critical = [
    "resources/app.asar",
    "resources/runtime/manifest.json",
    "resources/runtime/python/python.exe",
    "resources/runtime/java/bin/java.exe",
    "resources/runtime/postgres/bin/postgres.exe",
    "resources/runtime/backend.jar",
    "resources/runtime/frontend/index.html",
  ];
  for (const relative of critical) {
    const file = path.join(f.installDirectory, relative);
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, `disposable fixture ${relative}`);
  }
  // Python packages routinely include empty __init__.py modules; a zero-byte
  // entry with the correct digest must pass the real helper verification.
  const emptyModule =
    "resources/runtime/python/Lib/site-packages/fixture/__init__.py";
  await fs.mkdir(path.dirname(path.join(f.installDirectory, emptyModule)), {
    recursive: true,
  });
  await fs.writeFile(path.join(f.installDirectory, emptyModule), "");
  const entries = [];
  for (const relative of ["fresh-supply.exe", ...critical, emptyModule]) {
    const bytes = await fs.readFile(path.join(f.installDirectory, relative));
    entries.push({
      path: relative,
      size: bytes.length,
      sha256: crypto.createHash("sha256").update(bytes).digest("hex"),
    });
  }
  await fs.writeFile(
    path.join(f.installDirectory, "resources/package-integrity.json"),
    JSON.stringify({
      schemaVersion: 1,
      platform: "win32",
      arch: "x64",
      version: f.settings.version,
      files: entries,
    }),
  );
  f.settings.sha256 = crypto
    .createHash("sha256")
    .update(await fs.readFile(f.archivePath))
    .digest("hex");
  f.settings.env = {
    ...process.env,
    FRESH_SUPPLY_TEST_COMMAND: recordPath,
    FRESH_SUPPLY_TEST_EXIT: String(options.exitCode || 0),
    FRESH_SUPPLY_TEST_REMOVE: options.deleteInstalledFile
      ? path.join(f.installDirectory, options.deleteInstalledFile)
      : "",
  };
  return { f, recordPath };
}

test(
  "Windows native installer survives the real helper creator exiting",
  { skip: process.platform !== "win32", timeout: 60_000 },
  async (t) => {
    const { f, recordPath } = await nativeInstallerFixture(t);
    const acceptedPath = path.join(f.root, "application-update-accepted");
    const starterEnv = {
      ...f.settings.env,
      FRESH_SUPPLY_TEST_MODULE: path.join(
        __dirname,
        "../src/windows-update.cjs",
      ),
      FRESH_SUPPLY_TEST_ACCEPTED: acceptedPath,
      FRESH_SUPPLY_TEST_SETTINGS: JSON.stringify({
        userData: f.userData,
        archivePath: f.archivePath,
        version: f.settings.version,
        sha256: f.settings.sha256,
        execPath: f.execPath,
      }),
    };
    delete starterEnv.NODE_TEST_CONTEXT;
    // This disposable app process creates the real detached helper and then exits,
    // just as Electron will after its successful backup and install handoff.
    const source = `
    const fs = require("node:fs");
    const { prepareWindowsUpdate } = require(process.env.FRESH_SUPPLY_TEST_MODULE);
    (async () => {
      const settings = JSON.parse(process.env.FRESH_SUPPLY_TEST_SETTINGS);
      const prepared = await prepareWindowsUpdate({
        ...settings, app: { isPackaged: true, getPath: () => settings.userData },
        timeoutMs: 30000,
      });
      await prepared.install();
      if (fs.existsSync(process.env.FRESH_SUPPLY_TEST_COMMAND)) throw new Error("Installer started before the application exited.");
      fs.writeFileSync(process.env.FRESH_SUPPLY_TEST_ACCEPTED, "accepted");
      process.exit(0);
    })().catch((error) => { console.error(error); process.exit(1); });
  `;
    const starter = spawn(process.execPath, ["-e", source], {
      env: starterEnv,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let output = "";
    starter.stdout.on("data", (bytes) => {
      output = (output + bytes.toString()).slice(-8000);
    });
    starter.stderr.on("data", (bytes) => {
      output = (output + bytes.toString()).slice(-8000);
    });
    const completion = new Promise((resolve, reject) => {
      starter.once("error", reject);
      starter.once("close", (code, signal) => resolve({ code, signal }));
    });
    const timeout = setTimeout(() => starter.kill(), 45_000);
    t.after(() => {
      clearTimeout(timeout);
      starter.kill();
    });
    try {
      const result = await completion;
      clearTimeout(timeout);
      assert.deepEqual(result, { code: 0, signal: null }, output);
      assert.equal(
        await present(acceptedPath),
        true,
        "application confirmed handoff before exiting",
      );
      await waitFor(() => present(recordPath), 10_000);
      assert.equal(
        starter.exitCode,
        0,
        "creator has exited while the independent helper continues",
      );
      const command = await fs.readFile(recordPath, "utf8");
      assert.equal(
        command.includes(
          "/S --updated /currentuser /fresh-supply-user-sid=S-1-",
        ),
        true,
      );
      assert.equal(command.endsWith(`/D=${f.installDirectory}`), true);
      assert.equal(command.includes("--force-run"), false);
      await waitFor(async () => !(await present(f.downloadDirectory)), 10_000);
      const installResult = JSON.parse(
        await fs.readFile(
          path.join(f.userData, "updates/windows-last-install-result.json"),
          "utf8",
        ),
      );
      assert.equal(installResult.status, "success");
      assert.equal(installResult.version, f.settings.version);
      const metadata = JSON.parse(
        await fs.readFile(
          path.join(f.installDirectory, "resources/package-integrity.json"),
          "utf8",
        ),
      );
      assert.equal(
        metadata.files.some(
          (entry) => entry.path.endsWith("/__init__.py") && entry.size === 0,
        ),
        true,
      );
    } catch (error) {
      t.diagnostic(
        `Updater creator: pid=${starter.pid}, exitCode=${starter.exitCode}, signalCode=${starter.signalCode}, output=${output}`,
      );
      for (const name of ["windows-update.log", "windows-update-host.log"]) {
        const log = await fs
          .readFile(path.join(f.userData, "logs", name), "utf8")
          .catch(() => "No log was created.");
        t.diagnostic(`${name}:\n${log}`);
      }
      throw error;
    }
  },
);

test(
  "Windows native helper preserves failed installer and reports damaged installation after handoff",
  { skip: process.platform !== "win32", timeout: 120_000 },
  async (t) => {
    for (const options of [
      { exitCode: 7 },
      { deleteInstalledFile: "resources/runtime/python/python.exe" },
    ]) {
      const { f, recordPath } = await nativeInstallerFixture(t, options);
      const parent = spawn(
        process.execPath,
        ["-e", "setInterval(() => {}, 1000)"],
        { env: process.env, windowsHide: true, stdio: "ignore" },
      );
      t.after(() => parent.kill());
      f.settings.parentPid = parent.pid;
      const prepared = await prepareWindowsUpdate(f.settings);
      try {
        await prepared.install();
        assert.equal(
          await present(recordPath),
          false,
          "installer cannot run while the parent is alive",
        );
        parent.kill();
        const resultPath = path.join(
          f.userData,
          "updates/windows-last-install-result.json",
        );
        await waitFor(() => present(resultPath), 15_000);
        const result = JSON.parse(await fs.readFile(resultPath, "utf8"));
        assert.equal(result.schema, 1);
        assert.equal(result.status, "failed");
        assert.equal(result.version, f.settings.version);
        assert.match(
          result.message,
          options.exitCode ? /exit code 7/ : /python\/python.exe/,
        );
        assert.equal(
          await present(f.archivePath),
          true,
          "verified installer remains available for repair after failure",
        );
        assert.equal(
          await present(f.execPath),
          true,
          "helper never removes the installed application itself",
        );
      } finally {
        await prepared.dispose();
      }
    }
  },
);

test(
  "Windows native helper waits for parent exit and passes literal NSIS arguments",
  { skip: process.platform !== "win32", timeout: 60_000 },
  async (t) => {
    const { f, recordPath } = await nativeInstallerFixture(t);
    const parentReadyPath = path.join(f.root, "parent-ready");
    const parentEnv = {
      ...process.env,
      FRESH_SUPPLY_TEST_PARENT_READY: parentReadyPath,
    };
    // The dummy application is an ordinary Node process, not another test worker.
    delete parentEnv.NODE_TEST_CONTEXT;
    const parent = spawn(
      process.execPath,
      [
        "-e",
        'require("node:fs").writeFileSync(process.env.FRESH_SUPPLY_TEST_PARENT_READY, "ready"); setInterval(() => {}, 1000)',
      ],
      {
        env: parentEnv,
        windowsHide: true,
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    let parentError;
    let parentStdout = "";
    let parentStderr = "";
    parent.on("error", (error) => {
      parentError = error;
    });
    parent.stdout.on("data", (bytes) => {
      parentStdout = (parentStdout + bytes.toString()).slice(-4000);
    });
    parent.stderr.on("data", (bytes) => {
      parentStderr = (parentStderr + bytes.toString()).slice(-4000);
    });
    t.after(() => {
      parent.kill();
    });
    f.settings.parentPid = parent.pid;
    let prepared;
    try {
      await waitFor(async () => {
        if (parentError) throw parentError;
        if (parent.exitCode !== null || parent.signalCode !== null)
          throw new Error(
            "The dummy application exited before becoming ready.",
          );
        return present(parentReadyPath);
      }, 10_000);
      await delay(100);
      assert.equal(
        parent.exitCode,
        null,
        "dummy application must be alive before staging",
      );
      assert.equal(parent.signalCode, null);
      prepared = await prepareWindowsUpdate(f.settings);
      assert.equal(
        parent.exitCode,
        null,
        "dummy application must be alive before helper handoff",
      );
      await prepared.install();
      assert.equal(await present(recordPath), false);
      await delay(100);
      assert.equal(await present(recordPath), false);
      parent.kill();
      await waitFor(() => present(recordPath), 10_000);
      const command = await fs.readFile(recordPath, "utf8");
      assert.equal(
        command.includes(
          "/S --updated /currentuser /fresh-supply-user-sid=S-1-",
        ),
        true,
      );
      assert.equal(command.endsWith(`/D=${f.installDirectory}`), true);
      assert.equal(command.includes("--force-run"), false);
      await waitFor(async () => !(await present(f.downloadDirectory)), 10_000);
    } catch (error) {
      t.diagnostic(
        `Dummy application: pid=${parent.pid}, exitCode=${parent.exitCode}, signalCode=${parent.signalCode}, killed=${parent.killed}, error=${parentError?.message || "none"}`,
      );
      if (parentStdout)
        t.diagnostic(`Dummy application stdout: ${parentStdout}`);
      if (parentStderr)
        t.diagnostic(`Dummy application stderr: ${parentStderr}`);
      const log = await fs
        .readFile(path.join(f.userData, "logs", "windows-update.log"), "utf8")
        .catch(() => "No helper log was created.");
      t.diagnostic(`Windows updater helper log:\n${log}`);
      const hostLog = await fs
        .readFile(
          path.join(f.userData, "logs", "windows-update-host.log"),
          "utf8",
        )
        .catch(() => "No PowerShell host log was created.");
      t.diagnostic(`PowerShell host output:\n${hostLog}`);
      throw error;
    } finally {
      await prepared?.dispose();
    }
  },
);

test(
  "Windows native helper PowerShell source parses without syntax errors",
  { skip: process.platform !== "win32" },
  async () => {
    const powershell = path.win32.join(
      process.env.SystemRoot,
      "System32",
      "WindowsPowerShell",
      "v1.0",
      "powershell.exe",
    );
    const command =
      "$tokens = $null; $errors = $null; [System.Management.Automation.Language.Parser]::ParseFile($env:FRESH_SUPPLY_TEST_HELPER, [ref] $tokens, [ref] $errors) | Out-Null; if ($errors.Count -gt 0) { throw ($errors | Out-String) }";
    await promisify(execFile)(
      powershell,
      ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", command],
      {
        env: {
          ...process.env,
          FRESH_SUPPLY_TEST_HELPER: path.join(
            __dirname,
            "../src/windows-update-helper.ps1",
          ),
        },
        windowsHide: true,
      },
    );
  },
);
