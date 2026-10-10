#!/usr/bin/env node
'use strict';
// Maintainer command, never run by end users. Takes pip freeze from the tested
// native runtime and pins wheel hashes for both supported architectures.
const fs = require('node:fs/promises');
const path = require('node:path');
(async () => {
  const freeze = await fs.readFile(process.argv[2], 'utf8');
  const lines = freeze.trim().split('\n').filter(line => !line.toLowerCase().startsWith('colorama=='));
  lines.push('colorama==0.4.6');
  const records = [];
  for (let start = 0; start < lines.length; start += 6) {
    records.push(...await Promise.all(lines.slice(start, start + 6).map(async line => {
      const [name, version] = line.split('==');
      const response = await fetch(`https://pypi.org/pypi/${name}/${version}/json`);
      if (!response.ok) throw new Error(`PyPI metadata unavailable: ${line}`);
      const body = await response.json();
      return { name, version, wheels: body.urls.filter(file => file.packagetype === 'bdist_wheel') };
    })));
  }
  for (const target of ['darwin-arm64', 'win32-x64']) {
    const output = ['# Generated from tested Python 3.11 runtime; hashes pin native and pure wheels.'];
    for (const record of records) {
      if (record.name.toLowerCase() === 'colorama' && target !== 'win32-x64') continue;
      const wheels = record.wheels.filter(file => /-(py3|py2\.py3|cp311|cp3[789]|cp310)-/.test(file.filename) && (
        file.filename.endsWith('-any.whl') ||
        (target === 'darwin-arm64' ? /macosx_[\d_]+_(arm64|universal2)\.whl$/.test(file.filename) : /win_amd64\.whl$/.test(file.filename))
      ) && (/-cp311-/.test(file.filename) || /-(none|abi3)-/.test(file.filename)));
      if (!wheels.length) throw new Error(`No compatible wheels: ${record.name} (${target})`);
      if (record.name.toLowerCase() === 'torch' && target === 'win32-x64') {
        const index = await (await fetch('https://download.pytorch.org/whl/cpu/torch/')).text();
        const match = index.match(/href="([^"\s]*torch-2\.5\.1%2Bcpu-cp311-cp311-win_amd64\.whl)#sha256=([a-f0-9]+)"/i);
        if (!match) throw new Error('Pinned Windows CPU PyTorch wheel unavailable');
        output.push(`torch==2.5.1+cpu \\\n    --hash=sha256:${match[2]}`);
      } else {
        const hashes = [...new Set(wheels.map(file => file.digests.sha256))];
        output.push(`${record.name}==${record.version} \\\n${hashes.map(hash => `    --hash=sha256:${hash}`).join(' \\\n')}`);
      }
    }
    await fs.writeFile(path.join(__dirname, `requirements-${target}.lock`), output.join('\n') + '\n');
    console.log(`Wrote hash-locked ${target} Python wheels`);
  }
})().catch(error => { console.error(error.message); process.exitCode = 1; });
