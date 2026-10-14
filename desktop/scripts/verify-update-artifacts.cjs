"use strict";
const fs = require("node:fs/promises");
const path = require("node:path");
const { parseBlockMap } = require("../src/update-download.cjs");

const MAX_BLOCKMAP_BYTES = 8 * 1024 ** 2;

// Metadata validation is part of packaging, without launching an installer.
// Legacy aliases and DMGs are not the primary automatic-update artifacts.
async function verifyUpdateArtifacts({
  directory = path.join(__dirname, "../dist"),
  version = require("../package.json").version,
} = {}) {
  if (!/^\d+\.\d+\.\d+$/.test(version || ""))
    throw new Error("Invalid desktop artifact version");
  const root = path.resolve(directory);
  const prefix = `fresh-supply-${version}-`;
  const artifacts = (await fs.readdir(root))
    .filter((name) => name.startsWith(prefix) && /\.(exe|zip)$/.test(name))
    .sort();
  if (!artifacts.length)
    throw new Error("No primary automatic-update artifacts found");
  const verified = [];
  for (const name of artifacts) {
    const artifact = await fs.lstat(path.join(root, name));
    if (
      !artifact.isFile() ||
      !Number.isSafeInteger(artifact.size) ||
      artifact.size <= 0
    )
      throw new Error(`Invalid automatic-update artifact: ${name}`);
    const mapName = `${name}.blockmap`;
    let blockmap;
    try {
      blockmap = await fs.lstat(path.join(root, mapName));
    } catch (error) {
      if (error.code === "ENOENT")
        throw new Error(`Missing automatic-update blockmap: ${mapName}`);
      throw error;
    }
    if (
      !blockmap.isFile() ||
      blockmap.size <= 0 ||
      blockmap.size > MAX_BLOCKMAP_BYTES
    )
      throw new Error(`Invalid automatic-update blockmap: ${mapName}`);
    try {
      await parseBlockMap(
        await fs.readFile(path.join(root, mapName)),
        artifact.size,
      );
    } catch (cause) {
      throw new Error(`Invalid automatic-update blockmap: ${mapName}`, {
        cause,
      });
    }
    verified.push({ name, blockmap: mapName, size: artifact.size });
  }
  return verified;
}

if (require.main === module) {
  verifyUpdateArtifacts({ directory: process.argv[2] || undefined })
    .then((verified) =>
      console.log(`Verified ${verified.length} automatic-update blockmaps.`),
    )
    .catch((error) => {
      console.error(error.message);
      process.exitCode = 1;
    });
}
module.exports = { verifyUpdateArtifacts };
