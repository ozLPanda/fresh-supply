'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const execute = promisify(execFile);
const root = path.resolve(process.argv[2] || path.join(__dirname, '../runtime'));
const machMagic = new Set(['feedface', 'feedfacf', 'cefaedfe', 'cffaedfe', 'cafebabe', 'bebafeca']);
async function walk(directory) {
  const files = [];
  for (const item of await fs.readdir(directory, { withFileTypes: true })) {
    const file = path.join(directory, item.name);
    if (item.isDirectory()) files.push(...await walk(file));
    else if (item.isFile()) files.push(file);
  }
  return files;
}
(async () => {
  if (process.platform !== 'darwin') { console.log('Mach-O dependency audit is macOS-only'); return; }
  let count = 0;
  for (const file of await walk(root)) {
    const handle = await fs.open(file, 'r');
    const magic = Buffer.alloc(4);
    await handle.read(magic, 0, 4, 0);
    await handle.close();
    if (!machMagic.has(magic.toString('hex'))) continue;
    const { stdout } = await execute('otool', ['-L', file]);
    const identityOutput = await execute('otool', ['-D', file]);
    const identities = new Set(identityOutput.stdout.split('\n').map(line => line.trim()).filter(line => line && !line.endsWith(':')));
    const dependencies = stdout.split('\n').filter(line => line.startsWith('\t')).map(line => line.trim().split(' (')[0]);
    for (const library of dependencies) {
      // LC_ID_DYLIB is a library identifier, not a loaded dependency.
      if (identities.has(library)) continue;
      if (library.startsWith('/') && !library.startsWith('/usr/lib/') && !library.startsWith('/System/Library/')) throw new Error(`Nonportable dependency in ${path.relative(root, file)}: ${library}`);
    }
    count++;
  }
  console.log(`Audited ${count} native Mach-O binaries: OS or relative libraries only`);
})().catch(error => { console.error(error.message); process.exitCode = 1; });
