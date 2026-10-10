#!/usr/bin/env node
'use strict';
// Additional artifact only: native Windows CI remains the runtime acceptance test.
// Does not touch the tested macOS runtime directory.
const fs = require('node:fs/promises');
const { createReadStream } = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { spawn } = require('node:child_process');
const { pathToFileURL } = require('node:url');
const sources = require('./runtime-sources.json');
const desktop = path.resolve(__dirname, '..');
const macRuntime = path.join(desktop, 'runtime');
const output = path.join(desktop, 'runtime-win32-x64');
const cache = path.join(desktop, '.cache', 'windows-cross');
function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: 'inherit', ...options });
    child.on('error', reject);
    child.on('exit', code => code === 0 ? resolve() : reject(new Error(`${command} exited ${code}`)));
  });
}
async function exists(file) { try { await fs.access(file); return true; } catch { return false; } }
async function hash(file) {
  const value = createHash('sha256');
  for await (const chunk of createReadStream(file)) value.update(chunk);
  return value.digest('hex');
}
async function archive(name) {
  const source = sources.targets['win32-x64'][name];
  const suffix = source.url.endsWith('.zip') ? '.zip' : '.tar.gz';
  const file = path.join(cache, name + suffix);
  if (!(await exists(file)) || await hash(file) !== source.sha256) {
    const partial = file + '.partial';
    console.log(`Downloading Windows ${name}`);
    await run('curl', ['--fail', '--location', '--retry', '4', '--silent', '--show-error', source.url, '--output', partial]);
    if (await hash(partial) !== source.sha256) throw new Error(`${name}: archive SHA256 mismatch`);
    await fs.rename(partial, file);
  }
  const destination = path.join(output, name);
  const marker = path.join(destination, '.source-sha256');
  if (await exists(marker) && (await fs.readFile(marker, 'utf8')).trim() === source.sha256) return;
  const staging = path.join(cache, `extract-${name}`);
  await fs.rm(staging, { recursive: true, force: true });
  await fs.mkdir(staging, { recursive: true });
  await run('tar', ['-xf', file, '-C', staging]);
  const entries = await fs.readdir(staging);
  if (entries.length !== 1) throw new Error(`${name}: unexpected archive root`);
  await fs.rm(destination, { recursive: true, force: true });
  await fs.rename(path.join(staging, entries[0]), destination);
  await fs.writeFile(marker, source.sha256 + '\n');
}
async function main() {
  if (process.platform !== 'darwin') throw new Error('This helper cross-prepares Windows on macOS; use prepare-runtime.cjs on Windows');
  await fs.mkdir(cache, { recursive: true });
  await fs.mkdir(output, { recursive: true });
  await fs.rm(path.join(output, 'manifest.json'), { force: true });
  await Promise.all(['java', 'postgres', 'python'].map(archive));
  for (const dll of ['msvcp140.dll', 'vcruntime140.dll', 'vcruntime140_1.dll']) {
    const destination = path.join(output, 'python', dll);
    if (!(await exists(destination))) await fs.copyFile(path.join(output, 'java/bin', dll), destination);
  }
  if (!process.argv.includes('--skip-python')) {
    const sitePackages = path.join(output, 'python/Lib/site-packages');
    const lock = path.join(__dirname, 'requirements-win32-x64.lock');
    const lockHash = await hash(lock);
    const cpu = sources.windowsCpuTorch;
    const wheelDirectory = path.join(cache, 'wheels');
    await fs.mkdir(wheelDirectory, { recursive: true });
    const cpuWheel = path.join(wheelDirectory, decodeURIComponent(path.basename(cpu.url)));
    if (!(await exists(cpuWheel)) || await hash(cpuWheel) !== cpu.sha256) {
      await run('curl', ['--fail', '--location', '--retry', '4', '--silent', '--show-error', cpu.url, '--output', cpuWheel + '.partial']);
      if (await hash(cpuWheel + '.partial') !== cpu.sha256) throw new Error('Windows CPU torch SHA256 mismatch');
      await fs.rename(cpuWheel + '.partial', cpuWheel);
    }
    const crossLock = path.join(cache, 'requirements-cross.lock');
    const lockText = await fs.readFile(lock, 'utf8');
    const expectedRequirement = `torch==${cpu.version}`;
    if (!lockText.includes(expectedRequirement)) throw new Error('Cross CPU torch source differs from Python lock');
    await fs.writeFile(crossLock, lockText.replace(expectedRequirement, `torch @ ${pathToFileURL(cpuWheel).href}`));
    const marker = path.join(sitePackages, '.ovoshi-wheel-lock');
    if (!(await exists(marker)) || (await fs.readFile(marker, 'utf8')).trim() !== lockHash) {
      const stagedPackages = path.join(cache, 'site-packages');
      await fs.rm(stagedPackages, { recursive: true, force: true });
      await run(path.join(macRuntime, 'python/bin/python3'), [
        '-m', 'pip', 'install', '--target', stagedPackages,
        '--platform', 'win_amd64', '--python-version', '311', '--implementation', 'cp', '--abi', 'cp311',
        '--only-binary=:all:', '--ignore-installed', '--require-hashes', '--no-compile', '--disable-pip-version-check',
        ...(process.argv.includes('--offline-wheels') ? ['--no-index'] : []), '--find-links', wheelDirectory, '-r', crossLock,
      ], { env: { ...process.env, PIP_CACHE_DIR: path.join(cache, 'pip') } });
      // Runtime uses python.exe -m uvicorn, so discard host-generated console
      // scripts whose shebang would point at this Mac's build interpreter.
      await fs.rm(path.join(stagedPackages, 'bin'), { recursive: true, force: true });
      for (const entry of await fs.readdir(stagedPackages)) {
        if (entry.endsWith('.dist-info')) await fs.rm(path.join(stagedPackages, entry, 'direct_url.json'), { force: true });
      }
      // pip performs wheel .data relocation; no hand-unzipping binary wheels.
      await fs.mkdir(sitePackages, { recursive: true });
      await fs.cp(stagedPackages, sitePackages, { recursive: true });
      await fs.writeFile(marker, lockHash + '\n');
    }
  }
  await fs.rm(path.join(output, 'python/Lib/site-packages/bin'), { recursive: true, force: true });
  const installedPackages = path.join(output, 'python/Lib/site-packages');
  for (const entry of await fs.readdir(installedPackages)) if (entry.endsWith('.dist-info')) {
    await fs.rm(path.join(installedPackages, entry, 'direct_url.json'), { force: true });
  }
  if (process.argv.includes('--native-only')) { console.log('Windows native components staged; common application resources still required'); return; }
  for (const name of ['model', 'licenses', 'frontend', 'price-importer', 'embedding-service']) {
    const destination = path.join(output, name);
    await fs.rm(destination, { recursive: true, force: true });
    const source = name === 'frontend' ? path.resolve(desktop, '../frontend/dist') : path.join(macRuntime, name);
    await fs.cp(source, destination, { recursive: true });
  }
  await fs.copyFile(path.resolve(desktop, '../backend/target/company-shop-backend-0.1.0.jar'), path.join(output, 'backend.jar'));
  await fs.copyFile(path.join(macRuntime, 'import-reference.json'), path.join(output, 'import-reference.json'));
  const manifest = {
    schemaVersion: 1, platform: 'win32', arch: 'x64', java: 'java/bin/java.exe', python: 'python/python.exe',
    backend: 'backend.jar', frontend: 'frontend', importer: 'price-importer/price_importer.py',
    embeddingService: 'embedding-service', model: 'model',
    postgres: { initdb: 'postgres/bin/initdb.exe', pgCtl: 'postgres/bin/pg_ctl.exe', psql: 'postgres/bin/psql.exe', pgDump: 'postgres/bin/pg_dump.exe', pgRestore: 'postgres/bin/pg_restore.exe' },
    versions: { java: sources.javaVersion, python: '3.11.17', postgres: sources.postgresVersion, pgvector: sources.pgvectorVersion, modelRevision: sources.model.revision },
  };
  for (const relative of [manifest.java, manifest.python, manifest.backend, manifest.frontend + '/index.html', manifest.importer, 'model/model.safetensors', ...Object.values(manifest.postgres),
    'python/Lib/site-packages/torch/__init__.py', 'python/Lib/site-packages/fastapi/__init__.py', 'python/Lib/site-packages/sentence_transformers/__init__.py']) {
    if (!(await exists(path.join(output, relative)))) throw new Error(`Windows runtime incomplete: ${relative}`);
  }
  if (await hash(path.join(output, 'model/model.safetensors')) !== sources.model.sha256) throw new Error('Model SHA256 mismatch');
  for (const relative of [manifest.java, manifest.python, manifest.postgres.initdb, manifest.postgres.pgCtl]) {
    const handle = await fs.open(path.join(output, relative), 'r');
    const bytes = Buffer.alloc(64);
    await handle.read(bytes, 0, 64, 0);
    const coff = Buffer.alloc(6);
    await handle.read(coff, 0, 6, bytes.readUInt32LE(60));
    await handle.close();
    if (bytes.toString('ascii', 0, 2) !== 'MZ' || coff.toString('ascii', 0, 4) !== 'PE\0\0' || coff.readUInt16LE(4) !== 0x8664) throw new Error(`Not a Windows x64 PE executable: ${relative}`);
  }
  await fs.writeFile(path.join(output, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
  await fs.writeFile(path.join(output, 'CROSS_BUILD_NOTICE.txt'), 'Prepared on macOS using verified Windows archives and wheels. Native Windows startup, installation and data-preservation tests are required before stable release.\n');
  console.log(`Windows x64 runtime structurally checked: ${output}`);
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
