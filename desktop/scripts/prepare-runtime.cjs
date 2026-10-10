#!/usr/bin/env node
'use strict';
// Run on the target OS/architecture. Internet/build tools required only here.
const fs = require('node:fs/promises');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { createReadStream } = require('node:fs');
const { spawn } = require('node:child_process');
const sources = require('./runtime-sources.json');
const desktop = path.resolve(__dirname, '..');
const root = path.resolve(desktop, '..');
const runtime = path.join(desktop, 'runtime');
const cache = path.join(desktop, '.cache');
const target = `${process.platform}-${process.arch}`;
const configuration = sources.targets[target];
const windows = process.platform === 'win32';
const executable = name => `${name}${windows ? '.exe' : ''}`;
const pythonRelative = windows ? 'python/python.exe' : 'python/bin/python3';
const javaRelative = windows ? 'java/bin/java.exe' : 'java/Contents/Home/bin/java';
function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: root, stdio: 'inherit', shell: windows && /\.cmd$/i.test(command), ...options });
    child.on('error', reject);
    child.on('exit', code => code === 0 ? resolve() : reject(new Error(`${command} exited ${code}`)));
  });
}
async function digest(file) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest('hex');
}
async function exists(file) { try { await fs.access(file); return true; } catch { return false; } }
async function archive(name, source) {
  const suffix = source.url.endsWith('.zip') ? '.zip' : '.tar.gz';
  const file = path.join(cache, `${name}-${target}${suffix}`);
  if (!(await exists(file)) || await digest(file) !== source.sha256) {
    const partial = `${file}.partial`;
    await run(windows ? 'curl.exe' : 'curl', ['--fail', '--location', '--retry', '4', '--silent', '--show-error', source.url, '--output', partial]);
    if (await digest(partial) !== source.sha256) throw new Error(`${name}: archive SHA256 mismatch`);
    await fs.rename(partial, file);
  }
  const destination = path.join(runtime, name);
  const marker = path.join(destination, '.source-sha256');
  if (await exists(marker) && (await fs.readFile(marker, 'utf8')).trim() === source.sha256) return;
  const staging = path.join(cache, `extract-${name}-${target}`);
  await fs.rm(staging, { recursive: true, force: true });
  await fs.mkdir(staging, { recursive: true });
  // tar.exe bundled with current Windows supports both tar.gz and ZIP.
  await run('tar', ['-xf', file, '-C', staging]);
  const entries = await fs.readdir(staging);
  if (entries.length !== 1) throw new Error(`${name}: unexpected archive root`);
  await fs.rm(destination, { recursive: true, force: true });
  await fs.rename(path.join(staging, entries[0]), destination);
  await fs.writeFile(marker, `${source.sha256}\n`);
}
async function application() {
  // Clear web deployment API addresses; the desktop server proxies /api locally.
  const npm = windows ? 'npm.cmd' : 'npm';
  const viteEnvironment = { ...process.env, VITE_API_BASE_URL: '', VITE_API_URL: '', VITE_DESKTOP_MODE: 'true' };
  await run(npm, ['ci'], { cwd: path.join(root, 'frontend') });
  await run(npm, ['run', 'build'], { cwd: path.join(root, 'frontend'), env: viteEnvironment });
  const maven = process.env.DESKTOP_MAVEN || (windows ? 'mvn.cmd' : 'mvn');
  await run(maven, ['-B', '-DskipTests', 'package'], { cwd: path.join(root, 'backend') });
  await fs.copyFile(path.join(root, 'backend/target/company-shop-backend-0.1.0.jar'), path.join(runtime, 'backend.jar'));
  for (const [source, destination] of [['frontend/dist', 'frontend'], ['backend/price-importer', 'price-importer'], ['embedding-service', 'embedding-service']]) {
    await fs.rm(path.join(runtime, destination), { recursive: true, force: true });
    await fs.cp(path.join(root, source), path.join(runtime, destination), {
      recursive: true,
      filter: file => !['__pycache__', '.venv', '.env', 'node_modules'].includes(path.basename(file)),
    });
  }
}
async function main() {
  if (!configuration) throw new Error(`Unsupported build target: ${target}. Supported: ${Object.keys(sources.targets).join(', ')}`);
  await fs.mkdir(runtime, { recursive: true });
  await fs.mkdir(cache, { recursive: true });
  await fs.cp(path.join(desktop, 'licenses'), path.join(runtime, 'licenses'), { recursive: true });
  // Never leave an apparently complete manifest after a failed build.
  await fs.rm(path.join(runtime, 'manifest.json'), { force: true });
  for (const name of ['postgres', 'java', 'python']) await archive(name, configuration[name]);
  // Bundled MSVC runtime removes a separate VC++ installer prerequisite.
  if (windows) for (const dll of ['msvcp140.dll', 'vcruntime140.dll', 'vcruntime140_1.dll']) {
    const destination = path.join(runtime, 'python', dll);
    if (!(await exists(destination))) await fs.copyFile(path.join(runtime, 'java/bin', dll), destination);
  }
  const python = path.join(runtime, pythonRelative);
  if (!process.argv.includes('--skip-python')) {
    const pipArgs = ['-m', 'pip', 'install', '--disable-pip-version-check', '--only-binary=:all:', '--require-hashes', '-r', path.join(__dirname, `requirements-${target}.lock`)];
    if (windows) pipArgs.push('--extra-index-url', 'https://download.pytorch.org/whl/cpu');
    await run(python, pipArgs);
    await run(python, [path.join(__dirname, 'prepare-model.py'), path.join(runtime, 'model')], {
      env: { ...process.env, HF_HOME: path.join(cache, 'huggingface') },
    });
  }
  if (!process.argv.includes('--skip-application')) await application();
  const manifest = {
    schemaVersion: 1, platform: process.platform, arch: process.arch,
    java: javaRelative, python: pythonRelative, backend: 'backend.jar', frontend: 'frontend',
    importer: 'price-importer/price_importer.py', embeddingService: 'embedding-service', model: 'model',
    postgres: Object.fromEntries([['initdb', 'initdb'], ['pgCtl', 'pg_ctl'], ['psql', 'psql'], ['pgDump', 'pg_dump'], ['pgRestore', 'pg_restore']].map(([key, name]) => [key, `postgres/bin/${executable(name)}`])),
    versions: { java: sources.javaVersion, python: '3.11.17', postgres: sources.postgresVersion, pgvector: sources.pgvectorVersion, modelRevision: sources.model.revision },
  };
  for (const entry of [manifest.java, manifest.python, manifest.backend, manifest.frontend, manifest.importer, manifest.embeddingService, 'model/model.safetensors', 'model/config.json', 'model/modules.json', ...Object.values(manifest.postgres)]) {
    if (!(await exists(path.join(runtime, entry)))) throw new Error(`Runtime is incomplete: ${entry}`);
  }
  if (await digest(path.join(runtime, 'model/model.safetensors')) !== sources.model.sha256) throw new Error('Pinned model SHA256 mismatch');
  await fs.writeFile(path.join(runtime, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
  await run(process.execPath, [path.join(__dirname, 'build-import-reference.cjs'), runtime]);
  console.log(`Standalone runtime prepared: ${runtime}`);
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
