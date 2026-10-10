#!/usr/bin/env node
'use strict';
// Destructive only within a fresh temporary test directory; no application data.
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const net = require('node:net');
const { spawn } = require('node:child_process');
const runtime = path.resolve(process.argv[2] || path.join(__dirname, '../runtime'));
const manifest = require(path.join(runtime, 'manifest.json'));
const executable = relative => path.join(runtime, relative);
function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: 'inherit', ...options });
    child.on('error', reject);
    child.on('exit', code => code === 0 ? resolve() : reject(new Error(`${command} exited ${code}`)));
  });
}
async function port() {
  const server = net.createServer();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const result = server.address().port;
  await new Promise(resolve => server.close(resolve));
  return result;
}
async function main() {
  if (manifest.platform !== process.platform || manifest.arch !== process.arch) throw new Error('Runtime target differs from this machine');
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'ovoshi-runtime-check-'));
  const data = path.join(temporary, 'postgres');
  const postgresPort = await port();
  let running = false;
  try {
    await run(executable(manifest.java), ['-version']);
    await run(executable(manifest.python), ['-I', '-c', 'import openpyxl, fastapi, uvicorn, torch, sentence_transformers; print("Python dependencies ready")']);
    await run(executable(manifest.postgres.initdb), ['-D', data, '-U', 'runtime_test', '--auth-local=trust', '--auth-host=trust', '--locale=C', '--encoding=UTF8']);
    const serverOptions = `-h 127.0.0.1 -p ${postgresPort}` + (process.platform === 'win32' ? '' : ` -k "${temporary}"`);
    await run(executable(manifest.postgres.pgCtl), ['-D', data, '-l', path.join(temporary, 'postgres.log'), '-o', serverOptions, '-w', 'start']);
    running = true;
    const connection = ['-h', '127.0.0.1', '-p', String(postgresPort), '-U', 'runtime_test', '-d', 'postgres'];
    await run(executable(manifest.postgres.psql), [...connection, '-v', 'ON_ERROR_STOP=1', '-c', "CREATE EXTENSION vector; SELECT '[1,2,3]'::vector <-> '[1,2,4]'::vector;"]);
    await run(executable(manifest.postgres.pgDump), [...connection, '-Fc', '-f', path.join(temporary, 'test.dump')]);
    const check = 'from sentence_transformers import SentenceTransformer; import sys; m=SentenceTransformer(sys.argv[1], device="cpu", local_files_only=True); assert m.get_sentence_embedding_dimension() == 768; v=m.encode(["query: овощи"], normalize_embeddings=True); assert v.shape == (1,768); print("Offline E5 inference ready")';
    await run(executable(manifest.python), ['-I', '-c', check, executable(manifest.model)], {
      cwd: temporary,
      env: { ...process.env, HF_HUB_OFFLINE: '1', TRANSFORMERS_OFFLINE: '1', HF_HOME: path.join(temporary, 'empty-hf-cache'), OMP_NUM_THREADS: '2', TOKENIZERS_PARALLELISM: 'false' },
    });
    console.log('Standalone native runtime checks passed');
  } finally {
    if (running) await run(executable(manifest.postgres.pgCtl), ['-D', data, '-m', 'fast', '-w', 'stop']);
    await fs.rm(temporary, { recursive: true, force: true });
  }
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
