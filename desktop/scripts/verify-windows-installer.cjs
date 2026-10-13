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

function comparableDacl(sddl) {
  // SetAccessControl may mark an unchanged inherited DACL as auto-inherited.
  // Ignore only that header bookkeeping flag. Protection P, request AR and
  // every ACE (including its inheritance flags) remain byte-for-byte checked.
  return sddl.replace(/^D:((?:AI|AR|P)*)(?=\(|$)/, (_, flags) => "D:" + flags.replace(/AI/g, ""));
}

// Test-only, non-inheriting denies: changing an open directory's zero-access
// sharing flags did not reliably deny Rename on the native runner. Save the
// exact original DACL and prove the replacement fixture denies a real rename.
async function denyInstallationRename(directory, privateRoot) {
  assert.equal(process.platform, "win32");
  assert.equal(process.env.GITHUB_ACTIONS, "true");
  assert.equal(process.env.RUNNER_OS, "Windows");
  const root = await fs.realpath(privateRoot), target = await fs.realpath(directory);
  assert.match(path.basename(root), /^(fresh-supply-(?:native-installed|installer-debug)-|fsdiag-)/);
  const relative = path.relative(root, target);
  assert.ok(relative && relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative), "ACL fixture is confined to its disposable test directory");
  const parent = path.dirname(target);
  const environment = { FRESH_SUPPLY_ACL_DIRECTORY: target, FRESH_SUPPLY_ACL_PARENT: parent };
  const saved = JSON.parse(await ps([
    "$ErrorActionPreference='Stop'",
    "$section=[System.Security.AccessControl.AccessControlSections]::Access",
    "@{directory=[System.IO.Directory]::GetAccessControl($env:FRESH_SUPPLY_ACL_DIRECTORY,$section).GetSecurityDescriptorSddlForm($section);parent=[System.IO.Directory]::GetAccessControl($env:FRESH_SUPPLY_ACL_PARENT,$section).GetSecurityDescriptorSddlForm($section)}|ConvertTo-Json -Compress",
  ].join(";"), environment));
  let restored = false;
  const restore = async (actualDirectory = target) => {
    if (restored) return;
    const current = JSON.parse(await ps([
      "$ErrorActionPreference='Stop'",
      "$section=[System.Security.AccessControl.AccessControlSections]::Access",
      "$saved=$env:FRESH_SUPPLY_ACL_SAVED|ConvertFrom-Json",
      "$failures=New-Object 'System.Collections.Generic.List[string]'",
      "foreach($item in @(@{path=$env:FRESH_SUPPLY_ACL_DIRECTORY;sddl=$saved.directory},@{path=$env:FRESH_SUPPLY_ACL_PARENT;sddl=$saved.parent})){try{$acl=New-Object System.Security.AccessControl.DirectorySecurity;$acl.SetSecurityDescriptorSddlForm($item.sddl,$section);[System.IO.Directory]::SetAccessControl($item.path,$acl)}catch{$failures.Add($_.Exception.Message)}}",
      "if($failures.Count){throw ($failures -join '; ')}",
      "@{directory=[System.IO.Directory]::GetAccessControl($env:FRESH_SUPPLY_ACL_DIRECTORY,$section).GetSecurityDescriptorSddlForm($section);parent=[System.IO.Directory]::GetAccessControl($env:FRESH_SUPPLY_ACL_PARENT,$section).GetSecurityDescriptorSddlForm($section)}|ConvertTo-Json -Compress",
    ].join(";"), { ...environment, FRESH_SUPPLY_ACL_DIRECTORY: actualDirectory, FRESH_SUPPLY_ACL_SAVED: JSON.stringify(saved) }));
    for (const key of ["directory", "parent"])
      assert.equal(comparableDacl(current[key]), comparableDacl(saved[key]), "Fixture restores original permissions and inheritance protection: " + key);
    restored = true;
  };
  const probe = path.join(parent, ".fresh-supply-rename-probe-" + randomBytes(12).toString("hex"));
  let renamed = false;
  try {
    await ps([
      "$ErrorActionPreference='Stop'",
      "$section=[System.Security.AccessControl.AccessControlSections]::Access",
      "$sid=[System.Security.Principal.WindowsIdentity]::GetCurrent().User",
      "$none=[System.Security.AccessControl.InheritanceFlags]::None",
      "$propagation=[System.Security.AccessControl.PropagationFlags]::None",
      "$deny=[System.Security.AccessControl.AccessControlType]::Deny",
      "$acl=[System.IO.Directory]::GetAccessControl($env:FRESH_SUPPLY_ACL_DIRECTORY,$section)",
      "$rule=New-Object System.Security.AccessControl.FileSystemAccessRule($sid,[System.Security.AccessControl.FileSystemRights]::Delete,$none,$propagation,$deny)",
      "$acl.AddAccessRule($rule)",
      "[System.IO.Directory]::SetAccessControl($env:FRESH_SUPPLY_ACL_DIRECTORY,$acl)",
      "$acl=[System.IO.Directory]::GetAccessControl($env:FRESH_SUPPLY_ACL_PARENT,$section)",
      "$rule=New-Object System.Security.AccessControl.FileSystemAccessRule($sid,[System.Security.AccessControl.FileSystemRights]::DeleteSubdirectoriesAndFiles,$none,$propagation,$deny)",
      "$acl.AddAccessRule($rule)",
      "[System.IO.Directory]::SetAccessControl($env:FRESH_SUPPLY_ACL_PARENT,$acl)",
    ].join(";"), environment);
    let rejection;
    try { await fs.rename(target, probe); renamed = true; } catch (error) { rejection = error; }
    assert.ok(rejection && ["EPERM", "EACCES"].includes(rejection.code), "Native rename must be denied before testing installer failure");
    console.log("Disposable installation rename denial proved: " + rejection.code);
    return { restore, proof: { code: rejection.code, syscall: rejection.syscall } };
  } catch (error) {
    await restore(renamed ? probe : target);
    if (renamed) await fs.rename(probe, target);
    throw error;
  }
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
  const canonical = async (value) => (await fs.realpath(value)).toLowerCase();
  const normalizeLinks = async (links) => {
    for (const key of ["desktop", "menu", "registered"])
      links[key] = await canonical(links[key]);
    return links;
  };
  const shortcut = async () =>
    normalizeLinks(
      JSON.parse(
        await ps(
          `$ErrorActionPreference='Stop';$s=New-Object -ComObject WScript.Shell;$d=Join-Path $s.SpecialFolders.Item('Desktop') 'fresh-supply.lnk';$m=Join-Path $s.SpecialFolders.Item('Programs') 'fresh-supply.lnk';@{desktop=$s.CreateShortcut($d).TargetPath;menu=$s.CreateShortcut($m).TargetPath;registered=(Get-ItemProperty ('HKCU:\\Software\\'+$env:FRESH_SUPPLY_TEST_GUID)).InstallLocation}|ConvertTo-Json -Compress`,
          env,
        ),
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
    assert.equal(
      links.desktop,
      await canonical(path.join(directory, "fresh-supply.exe")),
    );
    assert.equal(links.menu, links.desktop);
    assert.equal(links.registered, await canonical(directory));
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
    // Expected rejection deliberately preserves a stage for diagnostics, but
    // this successful assertion no longer needs another full runtime on disk.
    const rejectionLog = await fs.readFile(
      path.join(
        process.env.LOCALAPPDATA,
        "fresh-supply-desktop-updater/installation.log",
      ),
      "utf8",
    );
    const rejectedStage = [
      ...rejectionLog.matchAll(/Preserved failed stage for diagnostics: (.+)/g),
    ]
      .at(-1)?.[1]
      .trim();
    if (rejectedStage) {
      const relative = path.relative(temporary, rejectedStage);
      assert.ok(
        relative &&
          !relative.startsWith("..") &&
          !path.isAbsolute(relative) &&
          /^ns[a-z0-9]+\.tmp$/i.test(path.basename(rejectedStage)),
        "Rejected stage belongs to the disposable installer test",
      );
      await fs.rm(rejectedStage, {
        recursive: true,
        force: true,
        maxRetries: 8,
        retryDelay: 250,
      });
    }
    assert.deepEqual(
      await snapshot(directory),
      oldPayload,
      "Wrong SID preserves every old application file",
    );
    assert.deepEqual(await shortcut(), links);
    assert.equal(await fs.readFile(sentinel, "utf8"), "preserve-user-data");
    // Deny actual filesystem rename and prove the fixture before launching the
    // installer. Original private-directory DACLs are restored on every outcome.
    lock = await denyInstallationRename(directory, temporary);
    const rejected = await install(true);
    assert.equal(
      rejected,
      25,
      "Denied installation rename must fail without deleting the old executable",
    );
    await lock.restore();
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
      normalizeLinks(
        JSON.parse(
          await ps(
            `$ErrorActionPreference='Stop';$s=New-Object -ComObject WScript.Shell;$d=Join-Path ([Environment]::GetFolderPath('CommonDesktopDirectory')) 'fresh-supply.lnk';$m=Join-Path ([Environment]::GetFolderPath('CommonPrograms')) 'fresh-supply.lnk';@{desktop=$s.CreateShortcut($d).TargetPath;menu=$s.CreateShortcut($m).TargetPath;registered=(Get-ItemProperty ('HKLM:\\Software\\'+$env:FRESH_SUPPLY_TEST_GUID)).InstallLocation;hasUserRegistration=(Test-Path ('HKCU:\\Software\\'+$env:FRESH_SUPPLY_TEST_GUID))}|ConvertTo-Json -Compress`,
            machineEnvironment,
          ),
        ),
      );
    assert.equal(await machineInstall(), 0, "Actual all-users NSIS install");
    machineRegistered = true;
    await verify(machineDirectory, version);
    const allLinks = await machineLinks();
    assert.equal(
      allLinks.desktop,
      await canonical(path.join(machineDirectory, "fresh-supply.exe")),
    );
    assert.equal(allLinks.menu, allLinks.desktop);
    assert.equal(allLinks.registered, await canonical(machineDirectory));
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
    if (lock) await lock.restore();
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
module.exports = { verify, snapshot, main, run, ps, denyInstallationRename, comparableDacl };
