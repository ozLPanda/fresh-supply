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
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "fresh-supply-windows-update-")));
  t.after(async () => { await fs.rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); });
  const userData = path.join(root, "Ovoshi Help");
  const installDirectory = path.join(root, "fresh supply;$ harmless ' characters");
  const downloadDirectory = path.join(userData, "updates", "download-abc123");
  await fs.mkdir(downloadDirectory, { recursive: true });
  await fs.mkdir(installDirectory);
  const archivePath = path.join(downloadDirectory, "fresh-supply-0.2.0-win-x64.exe");
  const execPath = path.join(installDirectory, "fresh-supply.exe");
  await fs.writeFile(archivePath, pe());
  await fs.writeFile(execPath, pe(0x8664));
  const settings = {
    app: { isPackaged: true, getPath: () => userData },
    archivePath, version: "0.2.0", sha256: crypto.createHash("sha256").update(pe()).digest("hex"),
    execPath, platform: "win32", arch: "x64", env: { SystemRoot: "C:\\Windows" },
    timeoutMs: 400, pollMs: 5, ...options,
  };
  return { settings, root, userData, execPath, archivePath, installDirectory, downloadDirectory };
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
  try { await fs.access(file); return true; } catch { return false; }
}

function spawnFixture() {
  const child = new EventEmitter();
  const calls = [];
  let config;
  child.kill = () => { calls.push("kill"); child.emit("exit", null); };
  child.unref = () => calls.push("unref");
  const fakeSpawn = (file, args, options) => {
    calls.push({ file, args, options });
    fs.readFile(options.env.FRESH_SUPPLY_UPDATE_CONFIG, "utf8").then((content) => { config = JSON.parse(content); });
    return child;
  };
  return { child, calls, spawn: fakeSpawn, getConfig: async () => { await waitFor(() => !!config); return config; } };
}

test("Windows stages safely and confirms helper readiness before authorizing shutdown", async (t) => {
  const fixtureData = await fixture(t);
  const fake = spawnFixture();
  const prepared = await prepareWindowsUpdate({ ...fixtureData.settings, spawn: fake.spawn });
  assert.deepEqual(fake.calls, []);
  const installation = prepared.install();
  const config = await fake.getConfig();
  assert.equal(config.installDirectory, fixtureData.installDirectory);
  assert.equal(config.installedExecutable, fixtureData.execPath);
  assert.equal(await present(config.commitPath), false);
  const launch = fake.calls[0];
  assert.equal(launch.file, "C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe");
  assert.equal(launch.options.shell, false);
  assert.equal(launch.options.detached, true);
  assert.equal(launch.options.windowsHide, true);
  const script = Buffer.from(launch.args.at(-1), "base64").toString("utf16le");
  assert.equal(script, await fs.readFile(path.join(__dirname, "../src/windows-update-helper.ps1"), "utf8"));
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

test("Windows helper launch error cannot authorize application shutdown", async (t) => {
  const fixtureData = await fixture(t);
  const fake = spawnFixture();
  const prepared = await prepareWindowsUpdate({ ...fixtureData.settings, spawn: fake.spawn });
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
    const prepared = await prepareWindowsUpdate({ ...fixtureData.settings, spawn: fake.spawn });
    const installation = prepared.install();
    const rejection = assert.rejects(installation, outcome === "timeout" ? /не ответил/ : /завершился/);
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
  const prepared = await prepareWindowsUpdate({ ...fixtureData.settings, spawn: fake.spawn });
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
    async (f) => { await fs.writeFile(f.archivePath, "MZ damaged"); f.settings.sha256 = crypto.createHash("sha256").update("MZ damaged").digest("hex"); },
    async (f) => { f.settings.version = "0.3.0"; },
    async (f) => { await fs.writeFile(f.execPath, pe(0x14c)); },
  ]) {
    const fixtureData = await fixture(t);
    await mutate(fixtureData);
    let spawned = false;
    await assert.rejects(prepareWindowsUpdate({ ...fixtureData.settings, spawn: () => { spawned = true; } }));
    assert.equal(spawned, false);
    assert.equal(await present(fixtureData.archivePath), true);
  }
});

test("Windows refuses unsupported builds, arbitrary downloads and unsafe installation paths", async (t) => {
  for (const values of [
    { platform: "darwin" }, { arch: "arm64" }, { app: { isPackaged: false } }, { sha256: "" },
    { version: "0.2.0;Invoke-Expression" }, { env: { SystemRoot: "relative" } },
  ]) {
    const f = await fixture(t);
    await assert.rejects(prepareWindowsUpdate({ ...f.settings, ...values }));
  }
  const f = await fixture(t);
  const external = path.join(f.root, "fresh-supply-0.2.0-win-x64.exe");
  await fs.copyFile(f.archivePath, external);
  await assert.rejects(prepareWindowsUpdate({ ...f.settings, archivePath: external }), /локальном кэше/);
  const unsafeDirectory = path.join(f.root, 'unsafe"directory');
  if (process.platform !== "win32") {
    await fs.mkdir(unsafeDirectory);
    const unsafeExecutable = path.join(unsafeDirectory, "fresh-supply.exe");
    await fs.copyFile(f.execPath, unsafeExecutable);
    await assert.rejects(prepareWindowsUpdate({ ...f.settings, execPath: unsafeExecutable }), /Каталог установки/);
  }
});

test("Windows reports helper validation failure without committing installation", async (t) => {
  const f = await fixture(t);
  const fake = spawnFixture();
  const prepared = await prepareWindowsUpdate({ ...f.settings, spawn: fake.spawn });
  const installation = prepared.install();
  const rejection = assert.rejects(installation, /installer is missing/);
  const config = await fake.getConfig();
  await fs.writeFile(config.failurePath, "\uFEFF" + JSON.stringify({ message: "installer is missing" }));
  await rejection;
  assert.equal(fake.calls.includes("unref"), false);
  await prepared.dispose();
});

test("Windows native helper waits for parent exit and passes literal NSIS arguments", { skip: process.platform !== "win32", timeout: 60_000 }, async (t) => {
  const f = await fixture(t, { env: process.env, timeoutMs: 30_000 });
  const powershell = path.win32.join(process.env.SystemRoot, "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
  const recordPath = path.join(f.root, "installer-command.txt");
  // Disposable compiled EXE records its command line. No installer or user app runs.
  const source = 'using System; using System.IO; public class UpdateStub { public static void Main() { File.WriteAllText(Environment.GetEnvironmentVariable("FRESH_SUPPLY_TEST_COMMAND"), Environment.CommandLine); } }';
  // The system powershell.exe is Windows PowerShell 5.1: compiler options are
  // supplied through CompilerParameters, rather than PowerShell 7's parameter.
  const compile = [
    '$parameters = New-Object System.CodeDom.Compiler.CompilerParameters',
    '$parameters.CompilerOptions = "/platform:x64"',
    '$parameters.GenerateExecutable = $true',
    '$parameters.GenerateInMemory = $false',
    '$parameters.OutputAssembly = $env:FRESH_SUPPLY_TEST_EXE',
    'Add-Type -TypeDefinition $env:FRESH_SUPPLY_TEST_SOURCE -CompilerParameters $parameters -ErrorAction Stop',
  ].join('; ');
  await fs.rm(f.archivePath);
  await promisify(execFile)(powershell, ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", compile], {
    env: { ...process.env, FRESH_SUPPLY_TEST_SOURCE: source, FRESH_SUPPLY_TEST_EXE: f.archivePath }, windowsHide: true,
  });
  await fs.copyFile(process.execPath, f.execPath);
  f.settings.sha256 = crypto.createHash("sha256").update(await fs.readFile(f.archivePath)).digest("hex");
  f.settings.env = { ...process.env, FRESH_SUPPLY_TEST_COMMAND: recordPath };
  const parentReadyPath = path.join(f.root, "parent-ready");
  const parentEnv = { ...process.env, FRESH_SUPPLY_TEST_PARENT_READY: parentReadyPath };
  // The dummy application is an ordinary Node process, not another test worker.
  delete parentEnv.NODE_TEST_CONTEXT;
  const parent = spawn(process.execPath, ["-e", 'require("node:fs").writeFileSync(process.env.FRESH_SUPPLY_TEST_PARENT_READY, "ready"); setInterval(() => {}, 1000)'], {
    env: parentEnv, windowsHide: true, stdio: ["ignore", "pipe", "pipe"],
  });
  let parentError;
  let parentStdout = "";
  let parentStderr = "";
  parent.on("error", (error) => { parentError = error; });
  parent.stdout.on("data", (bytes) => { parentStdout = (parentStdout + bytes.toString()).slice(-4000); });
  parent.stderr.on("data", (bytes) => { parentStderr = (parentStderr + bytes.toString()).slice(-4000); });
  t.after(() => { parent.kill(); });
  f.settings.parentPid = parent.pid;
  let prepared;
  try {
    await waitFor(async () => {
      if (parentError) throw parentError;
      if (parent.exitCode !== null || parent.signalCode !== null) throw new Error("The dummy application exited before becoming ready.");
      return present(parentReadyPath);
    }, 10_000);
    await delay(100);
    assert.equal(parent.exitCode, null, "dummy application must be alive before staging");
    assert.equal(parent.signalCode, null);
    prepared = await prepareWindowsUpdate(f.settings);
    assert.equal(parent.exitCode, null, "dummy application must be alive before helper handoff");
    await prepared.install();
    assert.equal(await present(recordPath), false);
    await delay(100);
    assert.equal(await present(recordPath), false);
    parent.kill();
    await waitFor(() => present(recordPath), 10_000);
    const command = await fs.readFile(recordPath, "utf8");
    assert.equal(command.endsWith(`/S --updated --force-run /D=${f.installDirectory}`), true);
    await waitFor(async () => !(await present(f.downloadDirectory)), 10_000);
  } catch (error) {
    t.diagnostic(`Dummy application: pid=${parent.pid}, exitCode=${parent.exitCode}, signalCode=${parent.signalCode}, killed=${parent.killed}, error=${parentError?.message || "none"}`);
    if (parentStdout) t.diagnostic(`Dummy application stdout: ${parentStdout}`);
    if (parentStderr) t.diagnostic(`Dummy application stderr: ${parentStderr}`);
    const log = await fs.readFile(path.join(f.userData, "logs", "windows-update.log"), "utf8").catch(() => "No helper log was created.");
    t.diagnostic(`Windows updater helper log:\n${log}`);
    throw error;
  } finally {
    await prepared?.dispose();
  }
});

test("Windows native helper PowerShell source parses without syntax errors", { skip: process.platform !== "win32" }, async () => {
  const powershell = path.win32.join(process.env.SystemRoot, "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
  const command = '$tokens = $null; $errors = $null; [System.Management.Automation.Language.Parser]::ParseFile($env:FRESH_SUPPLY_TEST_HELPER, [ref] $tokens, [ref] $errors) | Out-Null; if ($errors.Count -gt 0) { throw ($errors | Out-String) }';
  await promisify(execFile)(powershell, ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", command], {
    env: { ...process.env, FRESH_SUPPLY_TEST_HELPER: path.join(__dirname, "../src/windows-update-helper.ps1") }, windowsHide: true,
  });
});
