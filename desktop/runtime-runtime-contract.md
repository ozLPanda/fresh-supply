# Native desktop runtime contract

`node scripts/prepare-runtime.cjs` runs on the target machine, before Electron
packaging. Supported targets: macOS Apple Silicon (`darwin-arm64`) and Windows
Intel/AMD (`win32-x64`). Minimum macOS version: 14. Build requires Node, Java 21 JDK, Maven and internet.
Users need none of these tools and no Docker. Initial preparation downloads a
large model and Python inference dependencies; packaged releases include them.

`runtime/manifest.json` is emitted only after preparation finishes. Schema 1 uses
paths relative to `runtime/`, never build-machine paths:

- `java`: bundled Java 21 launcher (macOS `java/Contents/Home/bin/java`).
- `postgres`: `initdb`, `pgCtl`, `psql`, `pgDump`, `pgRestore` executable paths.
- `python`: portable interpreter (`python/bin/python3` or `python/python.exe`).
- `backend`: Spring Boot executable `backend.jar`.
- `frontend`: existing production React build, served by the local HTTP gateway.
- `importer`: `price-importer/price_importer.py`.
- `embeddingService`: Python service directory; start `python -m uvicorn app:app`
  in this directory, bind only 127.0.0.1, set `MODEL_DIR` to the included model.
- `model`: pinned multilingual E5 base model; dimensions remain 768.
- `versions`: bundled native versions and immutable model revision.

Native sources and SHA256 digests are pinned in `scripts/runtime-sources.json`.
Python wheels, including transitive dependencies, are locked by version and SHA256
in the two platform requirements lockfiles. Windows uses CPU-only PyTorch.
`lock-python.cjs` regenerates the locks from an explicitly tested pip freeze.
The 1.1 GB model is pinned by immutable revision and safetensors SHA256.
PostgreSQL 18.6 lite includes pgvector 0.8.6 and only OS libraries. Its database
major version is an application storage format: future major updates require
explicit pg_upgrade or dump/restore, never replacement of binaries alone.
Java and pip distributions include their upstream license files.
`runtime/licenses` additionally carries PostgreSQL, pgvector, binary bundle and
Python license notices copied from their pinned upstream releases.

Runtime components must run with `HF_HUB_OFFLINE=1`, `TRANSFORMERS_OFFLINE=1`,
`MODEL_DEVICE=cpu`, and either disabled bytecode writes or a cache under userData,
with no download on first launch. Application
data, credentials, database, uploads, logs and backups belong in Electron userData,
outside runtime. Files inside the installed application may be read-only.

Run `node scripts/verify-runtime.cjs` to check Java, Python imports, temporary
PostgreSQL initialization/start/vector extension/backup/stop, and an E5 embedding
with an empty Hugging Face cache and offline flags. The test never reads source
project databases. CI runs this before packaging. Runtime verification is not a
substitute for installing and testing each built OS package.

Backend is launched with `APP_DESKTOP_CONTROL_TOKEN` (a new random secret of at least
32 characters for every launch). The private loopback `POST /__desktop/shutdown`
requires it in `X-Ovoshi-Control` and drains requests before exiting. The token
must never enter the renderer. This is required for graceful Java shutdown on
Windows, where process signals cannot invoke Java's shutdown hooks. Native child
wrappers receive stop commands over IPC and terminate on parent disconnect.

Use `DESKTOP_MAVEN` to supply a Maven executable not on PATH. `--skip-python` and
`--skip-application` are development conveniences for repeating preparation
against previously completed outputs; validation still rejects missing files.

## Additional Windows installer from a Mac

`node scripts/prepare-windows-cross.cjs` prepares `runtime-win32-x64` separately,
without modifying `runtime`. It verifies Windows archive digests, installs exact
Windows wheels using pip's cross-platform `--target` support, and copies the
latest common React/JAR resources. Windows PE architecture and model integrity
are structurally checked. Build-host console scripts and local wheel URL metadata
are removed from the target. The bundled JRE supplies any missing MSVC runtime
DLL beside Python; Python's own runtime DLL versions are preserved.

`node scripts/package-windows-cross.cjs` creates an unsigned NSIS installer in
`dist-win`, using the verified NSIS 1.2.1 toolset's native macOS arm64 compiler.
`--prepackaged` can retry installer compilation against an unchanged
`dist-win/win-unpacked` after a compiler/tool download failure. Signing/resource
editing are disabled for this additional cross-build. Windows CI still runs the
native runtime and application checks before packaging; a cross-build alone
does not establish that the installer runs correctly on Windows.
