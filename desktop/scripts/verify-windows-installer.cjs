#!/usr/bin/env node
"use strict";
// Runs only on an ephemeral Windows GitHub runner. Installs the actual built
// NSIS package, never a mock recorder, and never touches a user's installation.
const fs = require("node:fs/promises");
const path = require("node:path");
const os = require("node:os");
const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const { randomBytes } = require("node:crypto");
const { LocalRuntime } = require("../src/runtime.cjs");
const { hash, METADATA, requiredPaths } = require("./package-integrity.cjs");
const GUID = "977d56cb-bf9d-5e99-8e00-f5d825fc9966";
const powershell = path.join(
  process.env.SystemRoot || "C:\\Windows",
  "System32/WindowsPowerShell/v1.0/powershell.exe",
);
function run(command, args, { env = process.env, timeout = 900000 } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
      env,
    });
    let stdout = "",
      stderr = "";
    child.stdout.on("data", (b) => (stdout += b));
    child.stderr.on("data", (b) => (stderr += b));
    const timer = setTimeout(() => {
      child.kill();
      reject(Error("Native installer test timed out"));
    }, timeout);
    child.on("error", (e) => {
      clearTimeout(timer);
      reject(e);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code, stdout, stderr });
    });
  });
}
async function ps(script, env = {}) {
  const r = await run(
    powershell,
    [
      "-NoLogo",
      "-NoProfile",
      "-NonInteractive",
      "-EncodedCommand",
      Buffer.from(script, "utf16le").toString("base64"),
    ],
    { env: { ...process.env, ...env } },
  );
  assert.equal(r.code, 0, r.stderr || r.stdout);
  return r.stdout.trim();
}
async function snapshot(directory) {
  const files = [];
  async function walk(relative = "") {
    for (const name of (
      await fs.readdir(path.join(directory, relative))
    ).sort()) {
      const file = relative ? relative + "/" + name : name,
        absolute = path.join(directory, file),
        stat = await fs.lstat(absolute);
      if (stat.isDirectory()) await walk(file);
      else {
        assert.ok(stat.isFile(), "Installed regular file " + file);
        files.push({
          path: file,
          size: stat.size,
          sha256: await hash(absolute),
        });
      }
    }
  }
  await walk();
  return files;
}
async function verify(directory, version, { legacy = false } = {}) {
  const manifest = JSON.parse(
    await fs.readFile(
      path.join(directory, "resources/runtime/manifest.json"),
      "utf8",
    ),
  );
  const metadata = legacy
    ? {
        version,
        platform: manifest.platform,
        arch: manifest.arch,
        files: await snapshot(directory),
      }
    : JSON.parse(await fs.readFile(path.join(directory, METADATA), "utf8"));
  assert.equal(metadata.version, version);
  assert.equal(metadata.platform, "win32");
  assert.equal(metadata.arch, "x64");
  const listed = new Set(metadata.files.map((f) => f.path));
  for (const file of requiredPaths(manifest))
    assert.ok(listed.has(file), "Installed critical file " + file);
  for (const f of metadata.files) {
    const file = path.join(directory, f.path);
    assert.equal(
      (await fs.stat(file)).size,
      f.size,
      "Installed size " + f.path,
    );
    assert.equal(await hash(file), f.sha256, "Installed hash " + f.path);
  }
  const python = path.join(directory, "resources/runtime", manifest.python);
  const r = await run(python, [
    "-I",
    "-c",
    'import torch, sentence_transformers, fastapi, uvicorn, openpyxl; print("Installed Python dependencies ready")',
  ]);
  assert.equal(r.code, 0, r.stderr);
  console.log(r.stdout.trim());
  return metadata;
}
async function main() {
  if (
    process.platform !== "win32" ||
    process.env.GITHUB_ACTIONS !== "true" ||
    process.env.RUNNER_OS !== "Windows"
  )
    throw Error(
      "Actual installer tests require an isolated Windows GitHub runner",
    );
  const desktop = path.resolve(__dirname, ".."),
    version = require("../package.json").version;
  const installer = path.join(
    desktop,
    "dist",
    `fresh-supply-${version}-win-x64.exe`,
  );
  const oldVersion = "0.1.8",
    oldHash =
      "648045b082c2036f42fedec94f8be82dafaf1484963f1592482524c5d0bd609b";
  const previous = path.join(
    desktop,
    ".cache",
    `upgrade-baseline-${oldVersion}-win-x64.exe`,
  );
  await fs.mkdir(path.dirname(previous), { recursive: true });
  if ((await hash(previous).catch(() => null)) !== oldHash) {
    const downloaded = await run("curl.exe", [
      "--fail",
      "--location",
      "--retry",
      "3",
      "https://github.com/ozLPanda/fresh-supply/releases/download/desktop-v0.1.8/fresh-supply-0.1.8-win-x64.exe",
      "--output",
      previous,
    ]);
    assert.equal(downloaded.code, 0, "Pinned old release download");
    assert.equal(await hash(previous), oldHash, "Pinned old release SHA256");
  }
  const temporary = await fs.mkdtemp(
    path.join(os.tmpdir(), "fresh-supply-native-installed-"),
  );
  const directory = path.join(temporary, "Installed application with spaces");
  const userData = path.join(temporary, "Separate application data");
  const password = randomBytes(24).toString("base64url"),
    phone = "+70000000000";
  let runtime,
    registered = false,
    machineRegistered = false,
    lock;
  const machineDirectory = path.join(
    temporary,
    "Machine application with spaces",
  );
  const env = {
    FRESH_SUPPLY_TEST_INSTALLER: installer,
    FRESH_SUPPLY_TEST_DIRECTORY: directory,
    FRESH_SUPPLY_TEST_GUID: GUID,
  };
  const install = async (
    updated = false,
    binary = installer,
    target = directory,
    { sid = "" } = {},
  ) => {
    const output = await ps(
      `$ErrorActionPreference='Stop';$ownerArg='';if($env:FRESH_SUPPLY_TEST_SID){$ownerArg=' /fresh-supply-user-sid='+$env:FRESH_SUPPLY_TEST_SID};$p=New-Object System.Diagnostics.ProcessStartInfo;$p.FileName=$env:FRESH_SUPPLY_TEST_INSTALLER;$p.UseShellExecute=$false;$p.Arguments='/S /currentuser'+${updated ? "' --updated'" : "''"}+$ownerArg+' /fresh-supply-data-dir="'+$env:FRESH_SUPPLY_TEST_DATA+'" /D='+$env:FRESH_SUPPLY_TEST_DIRECTORY;$c=[System.Diagnostics.Process]::Start($p);$c.WaitForExit();Write-Output $c.ExitCode`,
      {
        ...env,
        FRESH_SUPPLY_TEST_INSTALLER: binary,
        FRESH_SUPPLY_TEST_DIRECTORY: target,
        FRESH_SUPPLY_TEST_DATA: userData,
        FRESH_SUPPLY_TEST_SID: sid,
        FRESH_SUPPLY_INSTALLER_KEEP_FAILED_STAGE: "1",
      },
    );
    return Number(output.split(/\r?\n/).at(-1));
  };
  const uninstall = async (target = directory, scope = "currentuser") =>
    ps(
      `$ErrorActionPreference='Stop';$p=New-Object System.Diagnostics.ProcessStartInfo;$p.FileName=Join-Path $env:FRESH_SUPPLY_TEST_DIRECTORY 'Uninstall fresh-supply.exe';$p.Arguments='/S /'+$env:FRESH_SUPPLY_TEST_SCOPE+' /KEEP_APP_DATA _?='+$env:FRESH_SUPPLY_TEST_DIRECTORY;$p.UseShellExecute=$false;$c=[System.Diagnostics.Process]::Start($p);$c.WaitForExit();if($c.ExitCode -ne 0){throw 'Test uninstaller failed'}`,
      {
        ...env,
        FRESH_SUPPLY_TEST_DIRECTORY: target,
        FRESH_SUPPLY_TEST_SCOPE: scope,
      },
    );
  const shortcut = async () =>
    JSON.parse(
      await ps(
        `$ErrorActionPreference='Stop';$s=New-Object -ComObject WScript.Shell;$d=Join-Path $s.SpecialFolders.Item('Desktop') 'fresh-supply.lnk';$m=Join-Path $s.SpecialFolders.Item('Programs') 'fresh-supply.lnk';@{desktop=$s.CreateShortcut($d).TargetPath;menu=$s.CreateShortcut($m).TargetPath;registered=(Get-ItemProperty ('HKCU:\\Software\\'+$env:FRESH_SUPPLY_TEST_GUID)).InstallLocation}|ConvertTo-Json -Compress`,
        env,
      ),
    );
  const startup = async (appVersion = version) => {
    runtime = new LocalRuntime({
      root: path.join(directory, "resources/runtime"),
      userData,
      version: appVersion,
    });
    await runtime.start({ bootstrapPhone: phone, bootstrapPassword: password });
    const login = await fetch(runtime.url + "/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ phone, password }),
    });
    assert.equal(login.status, 200);
    const data = await login.json();
    assert.ok(data.data.token);
    return {
      token: data.data.token,
      headers: {
        Authorization: "Bearer " + data.data.token,
        "Content-Type": "application/json",
      },
    };
  };
  try {
    assert.equal(
      await ps(
        `Write-Output ((Test-Path ('HKCU:\\Software\\'+$env:FRESH_SUPPLY_TEST_GUID)) -or (Test-Path ('HKLM:\\Software\\'+$env:FRESH_SUPPLY_TEST_GUID)))`,
        env,
      ),
      "False",
      "Runner must have no existing fresh-supply installation",
    );
    await fs.mkdir(userData, { recursive: true });
    const guardSentinel = path.join(userData, "guard-sentinel.txt");
    await fs.writeFile(guardSentinel, "never-replace-user-data");
    assert.equal(
      await install(false, installer, userData),
      28,
      "Installer rejects application/data directory overlap before extraction",
    );
    assert.equal(
      await fs.readFile(guardSentinel, "utf8"),
      "never-replace-user-data",
    );
    assert.equal(
      await ps(
        `Write-Output (Test-Path ('HKCU:\\Software\\'+$env:FRESH_SUPPLY_TEST_GUID))`,
        env,
      ),
      "False",
      "Rejected data-directory install creates no registration",
    );
    // First install must also work when even the chosen parent is absent.
    const firstDirectory = path.join(
      temporary,
      "New parent with spaces",
      "Second level",
      "Fresh installed app",
    );
    assert.equal(
      await install(false, installer, firstDirectory),
      0,
      "Fresh installation creates a missing nested parent",
    );
    await verify(firstDirectory, version);
    await uninstall(firstDirectory);
    await fs.rm(path.join(temporary, "New parent with spaces"), {
      recursive: true,
      force: true,
      maxRetries: 8,
      retryDelay: 250,
    });
    assert.equal(
      await ps(
        `Write-Output (Test-Path ('HKCU:\\Software\\'+$env:FRESH_SUPPLY_TEST_GUID))`,
        env,
      ),
      "False",
      "Fresh-install test unregisters before legacy-upgrade test",
    );
    assert.equal(
      await install(false, previous),
      0,
      "Initial actual old 0.1.8 NSIS install",
    );
    registered = true;
    await verify(directory, oldVersion, { legacy: true });
    const links = await shortcut();
    assert.equal(links.desktop, path.join(directory, "fresh-supply.exe"));
    assert.equal(links.menu, links.desktop);
    assert.equal(links.registered, directory);
    // Prove the installed Electron entry binary runs, independently of source
    // node_modules or the unpacked build. No GUI or normal app-data is opened.
    const electron = await run(
      path.join(directory, "fresh-supply.exe"),
      [
        "-e",
        "process.stdout.write(JSON.stringify({electron:process.versions.electron,arch:process.arch}))",
      ],
      {
        env: {
          ...process.env,
          ELECTRON_RUN_AS_NODE: "1",
          OVOSHI_DESKTOP_USER_DATA: userData,
        },
      },
    );
    assert.equal(electron.code, 0, electron.stderr);
    assert.equal(JSON.parse(electron.stdout).arch, "x64");
    const auth = await startup(oldVersion);
    const created = await fetch(runtime.url + "/api/categories", {
      method: "POST",
      headers: auth.headers,
      body: JSON.stringify({
        nameRu: "Installed upgrade sentinel",
        nameKk: "Орнату",
        slug: "installed-upgrade-sentinel",
        active: true,
        sortOrder: 0,
      }),
    });
    assert.equal(created.status, 200);
    const category = (await created.json()).data;
    await runtime.stop();
    runtime = null;
    const checkpoint = await fs.readFile(
      path.join(userData, "data/runtime-config.json"),
    );
    const oldPayload = await snapshot(directory);
    const sentinel = path.join(userData, "installation-sentinel.txt");
    await fs.writeFile(sentinel, "preserve-user-data");
    assert.equal(
      await install(true, installer, directory, { sid: "S-1-5-21-0-0-0-9999" }),
      22,
      "Real installer refuses an alternate Windows owner before replacement",
    );
    assert.deepEqual(
      await snapshot(directory),
      oldPayload,
      "Wrong SID preserves every old application file",
    );
    assert.deepEqual(await shortcut(), links);
    assert.equal(await fs.readFile(sentinel, "utf8"), "preserve-user-data");
    // A locked old executable must abort before replacement, preserving the
    // old entire payload, registration, shortcuts and existing local data.
    const lockReady = path.join(temporary, "lock-ready");
    lock = spawn(
      powershell,
      [
        "-NoLogo",
        "-NoProfile",
        "-NonInteractive",
        "-EncodedCommand",
        Buffer.from(
          "$ErrorActionPreference='Stop';$f=[System.IO.File]::Open($env:FRESH_SUPPLY_LOCK_FILE,[System.IO.FileMode]::Open,[System.IO.FileAccess]::Read,[System.IO.FileShare]::None);try{[System.IO.File]::WriteAllText($env:FRESH_SUPPLY_LOCK_READY,'ready');while($true){Start-Sleep -Milliseconds 200}}finally{$f.Dispose()}",
          "utf16le",
        ).toString("base64"),
      ],
      {
        stdio: "ignore",
        windowsHide: true,
        env: {
          ...process.env,
          FRESH_SUPPLY_LOCK_FILE: path.join(directory, "fresh-supply.exe"),
          FRESH_SUPPLY_LOCK_READY: lockReady,
        },
      },
    );
    for (let i = 0; i < 100; i++) {
      if (await fs.stat(lockReady).catch(() => null)) break;
      await new Promise((r) => setTimeout(r, 100));
    }
    assert.ok(await fs.stat(lockReady));
    const rejected = await install(true);
    assert.notEqual(
      rejected,
      0,
      "Locked installation must fail, not silently delete the old executable",
    );
    const lockExited = new Promise((resolve) => lock.once("exit", resolve));
    lock.kill();
    await lockExited;
    lock = null;
    assert.deepEqual(
      await snapshot(directory),
      oldPayload,
      "Rejected update preserves every old application file",
    );
    assert.deepEqual(await shortcut(), links);
    assert.equal(await fs.readFile(sentinel, "utf8"), "preserve-user-data");
    // Perform real --updated replacement, then repair a deliberately missing
    // python.exe and a deliberately broken shortcut with the same installer.
    assert.equal(await install(true), 0, "Actual NSIS upgrade");
    await verify(directory, version);
    await fs.rm(path.join(directory, "resources/runtime/python/python.exe"));
    await ps(
      `$s=New-Object -ComObject WScript.Shell;$l=$s.CreateShortcut((Join-Path $s.SpecialFolders.Item('Desktop') 'fresh-supply.lnk'));$l.TargetPath=Join-Path $env:FRESH_SUPPLY_TEST_DIRECTORY 'missing.exe';$l.Save()`,
      env,
    );
    assert.equal(await install(true), 0, "Actual NSIS repair");
    await verify(directory, version);
    assert.deepEqual(await shortcut(), links);
    assert.equal(await fs.readFile(sentinel, "utf8"), "preserve-user-data");
    assert.deepEqual(
      await fs.readFile(path.join(userData, "data/runtime-config.json")),
      checkpoint,
    );
    const restored = await startup();
    assert.equal(
      JSON.parse(
        await fs.readFile(path.join(userData, "data/app-state.json"), "utf8"),
      ).version,
      version,
      "New application version checkpoint",
    );
    assert.ok(
      (await fs.readdir(path.join(userData, "backups"))).some((name) =>
        name.includes("before-upgrade"),
      ),
      "Old-to-new runtime creates a pre-upgrade backup",
    );
    const preserved = await fetch(
      runtime.url + `/api/categories/${category.id}`,
      { headers: restored.headers },
    );
    assert.equal(preserved.status, 200);
    assert.equal(
      (await preserved.json()).data.nameRu,
      "Installed upgrade sentinel",
    );
    await runtime.stop();
    runtime = null;
    // Existing tests run against installed resources, covering imported Cyrillic
    // catalog/picker searches, PDF documents, refresh, cancellation and rollback.
    const native = await run(
      process.execPath,
      [
        path.join(desktop, "scripts/smoke-data-transfer.cjs"),
        path.join(directory, "resources/runtime"),
      ],
      { timeout: 1800000 },
    );
    assert.equal(native.code, 0, native.stderr || native.stdout);
    console.log(native.stdout);
    // GitHub's administrator runner verifies true per-machine NSIS registry
    // and shortcut behavior. Interactive UAC consent remains a separate manual
    // test; this test neither bypasses nor automates the Windows secure desktop.
    await uninstall();
    registered = false;
    assert.equal(
      await ps(
        `$p=New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent());Write-Output $p.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)`,
      ),
      "True",
      "Machine install contract needs the elevated disposable GitHub runner",
    );
    const machineEnvironment = {
      ...env,
      FRESH_SUPPLY_TEST_DIRECTORY: machineDirectory,
      FRESH_SUPPLY_TEST_DATA: userData,
    };
    const machineInstall = async (updated = false) =>
      Number(
        (
          await ps(
            `$ErrorActionPreference='Stop';$p=New-Object System.Diagnostics.ProcessStartInfo;$p.FileName=$env:FRESH_SUPPLY_TEST_INSTALLER;$p.UseShellExecute=$false;$p.Arguments='/S /allusers'+${updated ? "' --updated'" : "''"}+' /fresh-supply-data-dir="'+$env:FRESH_SUPPLY_TEST_DATA+'" /D='+$env:FRESH_SUPPLY_TEST_DIRECTORY;$c=[System.Diagnostics.Process]::Start($p);$c.WaitForExit();Write-Output $c.ExitCode`,
            machineEnvironment,
          )
        )
          .split(/\r?\n/)
          .at(-1),
      );
    const machineLinks = async () =>
      JSON.parse(
        await ps(
          `$ErrorActionPreference='Stop';$s=New-Object -ComObject WScript.Shell;$d=Join-Path ([Environment]::GetFolderPath('CommonDesktopDirectory')) 'fresh-supply.lnk';$m=Join-Path ([Environment]::GetFolderPath('CommonPrograms')) 'fresh-supply.lnk';@{desktop=$s.CreateShortcut($d).TargetPath;menu=$s.CreateShortcut($m).TargetPath;registered=(Get-ItemProperty ('HKLM:\\Software\\'+$env:FRESH_SUPPLY_TEST_GUID)).InstallLocation;hasUserRegistration=(Test-Path ('HKCU:\\Software\\'+$env:FRESH_SUPPLY_TEST_GUID))}|ConvertTo-Json -Compress`,
          machineEnvironment,
        ),
      );
    assert.equal(await machineInstall(), 0, "Actual all-users NSIS install");
    machineRegistered = true;
    await verify(machineDirectory, version);
    const allLinks = await machineLinks();
    assert.equal(
      allLinks.desktop,
      path.join(machineDirectory, "fresh-supply.exe"),
    );
    assert.equal(allLinks.menu, allLinks.desktop);
    assert.equal(allLinks.registered, machineDirectory);
    assert.equal(allLinks.hasUserRegistration, false);
    await fs.rm(
      path.join(machineDirectory, "resources/runtime/python/python.exe"),
    );
    assert.equal(
      await machineInstall(true),
      0,
      "Actual all-users repair preserves installation scope",
    );
    await verify(machineDirectory, version);
    assert.deepEqual(await machineLinks(), allLinks);
    assert.equal(await fs.readFile(sentinel, "utf8"), "preserve-user-data");
    await uninstall(machineDirectory, "allusers");
    machineRegistered = false;
    console.log(
      "Actual Windows installer, rejected replacement, upgrade, repair, shortcuts and local data persistence passed",
    );
  } catch (error) {
    const log = path.join(
      process.env.LOCALAPPDATA,
      "fresh-supply-desktop-updater/installation.log",
    );
    const body = await fs
      .readFile(log, "utf8")
      .catch(() => "(installer log not found)");
    console.error("Native installer diagnostic log:\n" + body);
    const diagnostics = path.join(desktop, ".cache", "installer-diagnostics");
    await fs.mkdir(diagnostics, { recursive: true });
    await fs.writeFile(path.join(diagnostics, "installation.log"), body);
    await fs.writeFile(
      path.join(diagnostics, "failure.json"),
      JSON.stringify(
        { error: error.message, temporary, directory, userData, version },
        null,
        2,
      ) + "\n",
    );
    const matches = [
      ...body.matchAll(/Preserved failed stage for diagnostics: (.+)/g),
    ];
    const stage = matches.at(-1)?.[1].trim();
    if (stage && (await fs.stat(stage).catch(() => null))) {
      const packageRoot = path.join(desktop, "dist/win-unpacked");
      const metadata = JSON.parse(
        await fs.readFile(path.join(packageRoot, METADATA), "utf8"),
      );
      const missing = [],
        damaged = [],
        changedBeforePackaging = [];
      for (const f of metadata.files) {
        const installed = path.join(stage, f.path),
          source = path.join(packageRoot, f.path);
        const stat = await fs.stat(installed).catch(() => null);
        if (!stat?.isFile())
          missing.push({ path: f.path, absoluteLength: installed.length });
        else if (stat.size !== f.size || (await hash(installed)) !== f.sha256)
          damaged.push(f.path);
        if ((await hash(source).catch(() => null)) !== f.sha256)
          changedBeforePackaging.push(f.path);
      }
      const inventory = { stage, missing, damaged, changedBeforePackaging };
      console.error("Staging inventory: " + JSON.stringify(inventory));
      await fs.writeFile(
        path.join(diagnostics, "stage-inventory.json"),
        JSON.stringify(inventory, null, 2) + "\n",
      );
    }
    throw error;
  } finally {
    if (lock) lock.kill();
    if (runtime) await runtime.stop();
    if (registered) {
      await uninstall().catch(() => {});
    }
    if (machineRegistered)
      await uninstall(machineDirectory, "allusers").catch(() => {});
    await fs.rm(temporary, {
      recursive: true,
      force: true,
      maxRetries: 8,
      retryDelay: 250,
    });
  }
}
if (require.main === module)
  main().catch((e) => {
    console.error(e.message);
    process.exitCode = 1;
  });
module.exports = { verify, snapshot, main, run, ps };
