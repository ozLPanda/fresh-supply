#!/usr/bin/env node
"use strict";
// Real NSIS + pinned standalone Python, without a model/backend download.
// This builds and executes only a disposable diagnostic package on Windows CI.
const fs = require("node:fs/promises");
const path = require("node:path");
const os = require("node:os");
const assert = require("node:assert/strict");
const { run, ps } = require("./verify-windows-installer.cjs");
const {
  buildIntegrity,
  hash,
  requiredPaths,
} = require("./package-integrity.cjs");
const { main: patchNsis } = require("./prepare-windows-installer.cjs");
const sources = require("./runtime-sources.json");
async function main() {
  if (
    process.platform !== "win32" ||
    process.env.GITHUB_ACTIONS !== "true" ||
    process.env.RUNNER_OS !== "Windows"
  )
    throw Error(
      "Diagnostic installer runs only on an isolated Windows GitHub runner",
    );
  const desktop = path.resolve(__dirname, ".."),
    pkg = require("../package.json"),
    cache = path.join(desktop, ".cache", "installer-debug");
  await fs.mkdir(cache, { recursive: true });
  const archive = path.join(cache, "python.tar.gz"),
    source = sources.targets["win32-x64"].python;
  if ((await hash(archive).catch(() => null)) !== source.sha256) {
    const r = await run("curl.exe", [
      "--fail",
      "--location",
      "--retry",
      "3",
      source.url,
      "--output",
      archive,
    ]);
    assert.equal(r.code, 0, r.stderr);
    assert.equal(await hash(archive), source.sha256);
  }
  const payload = path.join(cache, "payload"),
    runtime = path.join(payload, "resources/runtime"),
    out = path.join(cache, "dist");
  await fs.rm(payload, { recursive: true, force: true });
  await fs.mkdir(runtime, { recursive: true });
  const extract = await run("tar.exe", ["-xf", archive, "-C", runtime]);
  assert.equal(extract.code, 0, extract.stderr);
  const manifest = {
    platform: "win32",
    arch: "x64",
    python: "python/python.exe",
    java: "java/bin/java.exe",
    backend: "backend.jar",
    importer: "price-importer/price_importer.py",
    postgres: {
      initdb: "postgres/bin/initdb.exe",
      pgCtl: "postgres/bin/pg_ctl.exe",
      psql: "postgres/bin/psql.exe",
      pgDump: "postgres/bin/pg_dump.exe",
      pgRestore: "postgres/bin/pg_restore.exe",
    },
  };
  for (const file of requiredPaths(manifest)) {
    const target = path.join(payload, file);
    if (await fs.stat(target).catch(() => null)) continue;
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, "diagnostic-file-" + file);
  }
  await fs.copyFile(
    path.join(runtime, "python/python.exe"),
    path.join(payload, "fresh-supply.exe"),
  );
  await fs.writeFile(
    path.join(runtime, "manifest.json"),
    JSON.stringify(manifest),
  );
  // A real package contains header/training-module paths near this length.
  const longRelative =
    "resources/runtime/python/Lib/site-packages/torch/include/ATen/ops/" +
    "long_native_function_name_".repeat(4) +
    "compositeexplicitautograd_dispatch.h";
  await fs.mkdir(path.dirname(path.join(payload, longRelative)), {
    recursive: true,
  });
  await fs.writeFile(
    path.join(payload, longRelative),
    "long-path-integrity-sentinel",
  );
  const metadata = await buildIntegrity(payload, pkg.version);
  await patchNsis();
  const configuration = {
    ...pkg.build,
    extends: null,
    afterSign: undefined,
    afterPack: undefined,
    directories: { output: out },
    nsis: {
      ...pkg.build.nsis,
      include: path.join(desktop, "installer/windows-install.nsh"),
    },
    win: {
      ...pkg.build.win,
      signAndEditExecutable: false,
      signExecutable: false,
      target: [{ target: "nsis", arch: ["x64"] }],
    },
  };
  const config = path.join(cache, "electron-builder.json");
  await fs.writeFile(config, JSON.stringify(configuration));
  const built = await run(process.execPath, [
    path.join(desktop, "node_modules/electron-builder/out/cli/cli.js"),
    "--win",
    "nsis",
    "--x64",
    "--publish",
    "never",
    "--projectDir",
    desktop,
    "--prepackaged",
    payload,
    "--config",
    config,
  ]);
  console.log(built.stdout);
  assert.equal(built.code, 0, built.stderr);
  const installer = path.join(out, `fresh-supply-${pkg.version}-win-x64.exe`),
    log = path.join(
      process.env.LOCALAPPDATA,
      "fresh-supply-desktop-updater/installation.log",
    );
  const temporary = await fs.mkdtemp(
    path.join(os.tmpdir(), "fresh-supply-installer-debug-"),
  );
  const shortParent=path.join(process.env.SystemDrive+'\\','fsdiag-'+path.basename(temporary).slice(-6));
  await fs.mkdir(shortParent);
  const cases = [
    {
      name: "short",
      directory: path.join(shortParent,'app'),
    },
    {
      name: "long",
      directory: path.join(
        temporary,
        "New parent with spaces",
        "Second level",
        "Fresh installed app",
      ),
    },
  ];
  const results = [];
  try {
    assert.equal(
      await ps(
        "Write-Output ((Test-Path 'HKCU:\\Software\\977d56cb-bf9d-5e99-8e00-f5d825fc9966') -or (Test-Path 'HKLM:\\Software\\977d56cb-bf9d-5e99-8e00-f5d825fc9966'))",
      ),
      "False",
      "Diagnostic VM must have no fresh-supply installation",
    );
    for (const item of cases) {
      const parent=path.dirname(item.directory),before=new Set(await fs.readdir(parent).catch(()=>[]));
      const output = await ps(
        "$ErrorActionPreference='Stop';$p=New-Object System.Diagnostics.ProcessStartInfo;$p.FileName=$env:FRESH_SUPPLY_DEBUG_INSTALLER;$p.Arguments='/S /currentuser /D='+$env:FRESH_SUPPLY_DEBUG_DIRECTORY;$p.UseShellExecute=$false;$c=[System.Diagnostics.Process]::Start($p);$c.WaitForExit();Write-Output $c.ExitCode",
        {
          FRESH_SUPPLY_DEBUG_INSTALLER: installer,
          FRESH_SUPPLY_DEBUG_DIRECTORY: item.directory,
          FRESH_SUPPLY_INSTALLER_KEEP_FAILED_STAGE: "1",
        },
      );
      const code = Number(output.split(/\r?\n/).at(-1)),
        body = await fs.readFile(log, "utf8").catch(() => "(log absent)");
      const stage = /Preserved failed stage for diagnostics: (.+)/g;
      let match, last;
      while ((match = stage.exec(body))) last = match[1].trim();
      if(code!==0 && !last) {
        const candidates=(await fs.readdir(parent).catch(()=>[])).filter(name=>!before.has(name)&&/^ns[a-z0-9]+\.tmp$/i.test(name));
        for(const name of candidates) {
          const candidate=path.join(parent,name);
          const stat=await fs.lstat(candidate).catch(()=>null);
          if(!stat?.isDirectory()||stat.isSymbolicLink())continue;
          const stageMetadata=JSON.parse(await fs.readFile(path.join(candidate,'resources/package-integrity.json'),'utf8').catch(()=>'null'));
          if(stageMetadata?.version===pkg.version && stageMetadata.files?.length===metadata.files.length){last=candidate;break;}
        }
      }
      const root = code === 0 ? item.directory : last;
      const missing = [],
        damaged = [];
      if (root)
        for (const f of metadata.files) {
          const file = path.join(root, f.path),
            stat = await fs.stat(file).catch(() => null);
          if (!stat?.isFile())
            missing.push({ path: f.path, absoluteLength: file.length });
          else if (stat.size !== f.size || (await hash(file)) !== f.sha256)
            damaged.push(f.path);
        }
      const result = {
        ...item,
        code,
        stage: last,
        missing,
        damaged,
        log: body,
      };
      results.push(result);
      console.log(JSON.stringify(result, null, 2));
      await fs.writeFile(
        path.join(cache, item.name + "-result.json"),
        JSON.stringify(result, null, 2) + "\n",
      );
      if (code === 0)
        await ps(
          "$p=New-Object System.Diagnostics.ProcessStartInfo;$p.FileName=Join-Path $env:FRESH_SUPPLY_DEBUG_DIRECTORY 'Uninstall fresh-supply.exe';$p.Arguments='/S /currentuser /KEEP_APP_DATA _?='+$env:FRESH_SUPPLY_DEBUG_DIRECTORY;$p.UseShellExecute=$false;$c=[System.Diagnostics.Process]::Start($p);$c.WaitForExit()",
          { FRESH_SUPPLY_DEBUG_DIRECTORY: item.directory },
        );
      if (last)
        await fs.rm(last, {
          recursive: true,
          force: true,
          maxRetries: 8,
          retryDelay: 250,
        });
      await fs.rm(item.directory, {
        recursive: true,
        force: true,
        maxRetries: 8,
        retryDelay: 250,
      });
    }
  } finally {
    await fs.rm(shortParent,{recursive:true,force:true,maxRetries:8,retryDelay:250});
    await fs.rm(temporary, {
      recursive: true,
      force: true,
      maxRetries: 8,
      retryDelay: 250,
    });
  }
  // Collect both outcomes before failing, so the diagnostic artifact proves
  // whether depth matters or a common launch/validation problem affects both.
  assert.ok(
    results.every((r) => r.code === 0),
    "One or more actual diagnostic installations failed; inspect installer-debug/*-result.json",
  );
}
if (require.main === module)
  main().catch((e) => {
    console.error(e.message);
    process.exitCode = 1;
  });
module.exports = { main };
