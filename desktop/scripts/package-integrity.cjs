"use strict";
const fs = require("node:fs/promises");
const path = require("node:path");
const { createReadStream } = require("node:fs");
const { createHash } = require("node:crypto");
const METADATA = "resources/package-integrity.json";
async function hash(file) {
  const h = createHash("sha256");
  for await (const chunk of createReadStream(file)) h.update(chunk);
  return h.digest("hex");
}
function requiredPaths(manifest, executable = "fresh-supply.exe") {
  return [
    executable,
    "resources/app.asar",
    "resources/runtime/manifest.json",
    ...[
      manifest.java,
      manifest.python,
      manifest.backend,
      manifest.importer,
      ...Object.values(manifest.postgres),
      "postgres/bin/postgres.exe",
      "python/python311.dll",
      "frontend/index.html",
      "model/model.safetensors",
      "model/config.json",
      "model/modules.json",
      "import-reference.json",
    ].map((p) => "resources/runtime/" + p),
  ];
}
async function buildIntegrity(
  directory,
  version,
  executable = "fresh-supply.exe",
) {
  // A failed re-pack must not leave a prior successful integrity declaration.
  await fs.rm(path.join(directory, METADATA), { force: true });
  const runtime = JSON.parse(
    await fs.readFile(
      path.join(directory, "resources/runtime/manifest.json"),
      "utf8",
    ),
  );
  if (runtime.platform !== "win32" || runtime.arch !== "x64")
    throw Error("Expected Windows x64 runtime");
  const files = [];
  async function walk(relative = "") {
    for (const name of (
      await fs.readdir(path.join(directory, relative))
    ).sort()) {
      const item = relative ? relative + "/" + name : name;
      if (item === METADATA) continue;
      const absolute = path.join(directory, item),
        stat = await fs.lstat(absolute);
      if (stat.isDirectory()) await walk(item);
      else if (stat.isFile())
        files.push({
          path: item,
          size: stat.size,
          sha256: await hash(absolute),
        });
      else throw Error("Windows package contains a non-regular file: " + item);
    }
  }
  await walk();
  const present = new Map(files.map((f) => [f.path, f]));
  for (const p of requiredPaths(runtime, executable))
    if (!present.get(p)?.size) throw Error("Incomplete Windows package: " + p);
  const metadata = {
    schemaVersion: 1,
    platform: "win32",
    arch: "x64",
    version,
    files,
  };
  await fs.writeFile(
    path.join(directory, METADATA),
    JSON.stringify(metadata) + "\n",
  );
  return metadata;
}
// Windows signApp edits version/icon resources even in an unsigned build.
// afterSign runs after those edits; afterPack would hash a stale executable.
async function afterSign(context) {
  if (context.electronPlatformName === "win32")
    await buildIntegrity(
      context.appOutDir,
      context.packager.appInfo.version,
      context.packager.appInfo.productFilename + ".exe",
    );
}
module.exports = afterSign;
Object.assign(module.exports, {
  buildIntegrity,
  requiredPaths,
  hash,
  METADATA,
});
