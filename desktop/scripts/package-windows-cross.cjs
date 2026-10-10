#!/usr/bin/env node
'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const { spawn } = require('node:child_process');
(async () => {
  const desktop = path.resolve(__dirname, '..');
  const runtime = path.join(desktop, 'runtime-win32-x64');
  const manifest = JSON.parse(await fs.readFile(path.join(runtime, 'manifest.json'), 'utf8'));
  if (manifest.platform !== 'win32' || manifest.arch !== 'x64') throw new Error('Windows runtime has not been prepared');
  const pkg = JSON.parse(await fs.readFile(path.join(desktop, 'package.json'), 'utf8'));
  const directory = path.join(desktop, '.cache', 'windows-cross');
  await fs.mkdir(directory, { recursive: true });
  const configFile = path.join(directory, 'electron-builder.json');
  const configuration = {
    ...pkg.build, extends: null,
    directories: { ...pkg.build.directories, output: path.join(desktop, 'dist-win') },
    extraResources: [{ from: runtime, to: 'runtime', filter: ['**/*'] }],
    forceCodeSigning: false,
    // Current NSIS bundle provides a native arm64 macOS compiler.
    toolsets: { ...pkg.build.toolsets, nsis: '1.2.1' },
    win: { ...pkg.build.win, signAndEditExecutable: false, signExecutable: false, target: [{ target: 'nsis', arch: ['x64'] }] },
  };
  await fs.writeFile(configFile, JSON.stringify(configuration, null, 2) + '\n');
  await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [path.join(desktop, 'node_modules/electron-builder/out/cli/cli.js'), '--win', 'nsis', '--x64', '--publish', 'never', '--config', configFile,
      ...(process.argv.includes('--prepackaged') ? ['--prepackaged', path.join(desktop, 'dist-win/win-unpacked')] : [])], {
      cwd: desktop, stdio: 'inherit', env: { ...process.env, CSC_IDENTITY_AUTO_DISCOVERY: 'false' },
    });
    child.on('error', reject);
    child.on('exit', code => code === 0 ? resolve() : reject(new Error(`Windows cross packaging exited ${code}`)));
  });
  console.log('Windows installer built; native Windows installation checks remain required');
})().catch(error => { console.error(error.message); process.exitCode = 1; });
