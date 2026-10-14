const fs = require("node:fs/promises");
const path = require("node:path");
const { createHash } = require("node:crypto");
const { parseBlockMap } = require("./update-download.cjs");

const MAX_MAP_BYTES = 8 * 1024 ** 2;
const MAX_ARTIFACT_BYTES = 4 * 1024 ** 3;
const DIRECTORY = /^basis-[A-Za-z0-9]+$/;

function metadataAsset(value, maximum) {
  return Boolean(
    /^[A-Za-z0-9][A-Za-z0-9._-]{0,180}$/.test(value?.name || "") &&
    /^sha256:[a-f\d]{64}$/i.test(value?.digest || "") &&
    Number.isSafeInteger(value?.size) &&
    value.size > 0 &&
    value.size <= maximum,
  );
}
function assetRecord(value) {
  return {
    name: value.name,
    size: value.size,
    digest: value.digest.toLowerCase(),
  };
}
async function regular(file, maximum) {
  const info = await fs.lstat(file);
  if (!info.isFile() || info.isSymbolicLink() || info.size > maximum)
    throw new Error("Invalid update cache file.");
  return info;
}
async function readLimited(file, maximum) {
  await regular(file, maximum);
  const handle = await fs.open(file, "r");
  try {
    const buffer = Buffer.alloc(maximum + 1);
    let length = 0;
    while (length <= maximum) {
      const { bytesRead } = await handle.read(
        buffer,
        length,
        buffer.length - length,
        length,
      );
      if (!bytesRead) return buffer.subarray(0, length);
      length += bytesRead;
    }
    throw new Error("Update cache file exceeds its limit.");
  } finally {
    await handle.close();
  }
}

// This is the last verified downloaded artifact, not the installed application
// or a database backup. Any compatible checked artifact can supply matching
// blocks; the reconstructed target still has to match GitHub's complete digest.
function createUpdateCache({ directory, repository, platform, arch }) {
  const parent = path.resolve(directory);
  const root = path.join(parent, "verified-bases");
  const pointer = path.join(root, "current.json");
  const suffix = { win32: "win", darwin: "mac" }[platform];
  const extension = { win32: "exe", darwin: "zip" }[platform];
  function compatible(record) {
    if (
      record?.schemaVersion !== 1 ||
      record.repository !== repository ||
      record.platform !== platform ||
      record.arch !== arch ||
      !DIRECTORY.test(record.directory || "") ||
      !/^desktop-v\d+\.\d+\.\d+$/.test(record.tag || "") ||
      !metadataAsset(record.asset, MAX_ARTIFACT_BYTES) ||
      !metadataAsset(record.blockmapAsset, MAX_MAP_BYTES) ||
      record.blockmapAsset.name !== record.asset.name + ".blockmap"
    )
      return false;
    const version = record.tag.slice("desktop-v".length);
    return ["fresh-supply", "OvoshiHelp"].some((prefix) =>
      [arch, ...(platform === "darwin" ? ["universal"] : [])].some(
        (architecture) =>
          record.asset.name ===
          `${prefix}-${version}-${suffix}-${architecture}.${extension}`,
      ),
    );
  }
  async function directories(create) {
    if (create) await fs.mkdir(parent, { recursive: true, mode: 0o700 });
    for (const candidate of [parent, root]) {
      if (create && candidate === root)
        await fs.mkdir(root, { mode: 0o700 }).catch((error) => {
          if (error.code !== "EEXIST") throw error;
        });
      const info = await fs.lstat(candidate);
      if (!info.isDirectory() || info.isSymbolicLink())
        throw new Error("Invalid update cache directory.");
    }
  }
  async function readRecord() {
    const record = JSON.parse(
      (await readLimited(pointer, 16 * 1024)).toString("utf8"),
    );
    if (!compatible(record)) throw new Error("Incompatible update cache.");
    const folder = path.join(root, record.directory);
    const info = await fs.lstat(folder);
    if (!info.isDirectory() || info.isSymbolicLink())
      throw new Error("Invalid update basis directory.");
    return record;
  }
  async function load({ signal } = {}) {
    signal?.throwIfAborted();
    try {
      await directories(false);
      const record = await readRecord();
      const folder = path.join(root, record.directory);
      const file = path.join(folder, "artifact");
      const info = await regular(file, MAX_ARTIFACT_BYTES);
      if (info.size !== record.asset.size)
        throw new Error("Invalid update basis size.");
      const blockmap = await readLimited(
        path.join(folder, "map.gz"),
        MAX_MAP_BYTES,
      );
      if (
        blockmap.length !== record.blockmapAsset.size ||
        createHash("sha256").update(blockmap).digest("hex") !==
          record.blockmapAsset.digest.slice(7)
      )
        throw new Error("Invalid cached blockmap digest.");
      await parseBlockMap(blockmap, record.asset.size);
      signal?.throwIfAborted();
      // The transport verifies the entire basis digest immediately before use.
      return { file, asset: record.asset, blockmap };
    } catch (error) {
      if (signal?.aborted) throw signal.reason || error;
      return null;
    }
  }
  async function save({ file, asset, blockmapAsset, blockmap, tag, signal }) {
    signal?.throwIfAborted();
    let folder,
      temporaryPointer,
      committed = false;
    try {
      if (
        !Buffer.isBuffer(blockmap) ||
        !metadataAsset(blockmapAsset, MAX_MAP_BYTES) ||
        blockmap.length !== blockmapAsset.size ||
        createHash("sha256").update(blockmap).digest("hex") !==
          blockmapAsset.digest.slice(7).toLowerCase()
      )
        throw new Error("Invalid verified blockmap.");
      const record = {
        schemaVersion: 1,
        repository,
        platform,
        arch,
        directory: "basis-pending",
        tag,
        asset: assetRecord(asset),
        blockmapAsset: assetRecord(blockmapAsset),
      };
      if (!compatible(record))
        throw new Error("Invalid update cache metadata.");
      await parseBlockMap(blockmap, asset.size);
      if ((await regular(file, MAX_ARTIFACT_BYTES)).size !== asset.size)
        throw new Error("Invalid verified artifact size.");
      await directories(true);
      let previous;
      try {
        previous = await readRecord();
      } catch {
        /* No trusted previous pointer. */
      }
      signal?.throwIfAborted();
      folder = await fs.mkdtemp(path.join(root, "basis-"));
      record.directory = path.basename(folder);
      // Normally both paths are on the same volume. Retaining a hard link avoids
      // another gigabyte copy; cleanup of the installer's private path is safe.
      try {
        await fs.link(file, path.join(folder, "artifact"));
      } catch {
        await fs.copyFile(
          file,
          path.join(folder, "artifact"),
          fs.constants.COPYFILE_EXCL,
        );
      }
      signal?.throwIfAborted();
      await fs.writeFile(path.join(folder, "map.gz"), blockmap, {
        flag: "wx",
        mode: 0o600,
      });
      temporaryPointer = path.join(
        root,
        `pointer-${path.basename(folder)}.tmp`,
      );
      await fs.writeFile(temporaryPointer, JSON.stringify(record), {
        flag: "wx",
        mode: 0o600,
      });
      signal?.throwIfAborted();
      await fs.rename(temporaryPointer, pointer);
      committed = true;
      // Only remove the exact prior valid entry. Unknown directories are never
      // swept recursively, and cleanup failure cannot invalidate this pointer.
      if (previous && previous.directory !== record.directory)
        await fs
          .rm(path.join(root, previous.directory), {
            recursive: true,
            force: true,
          })
          .catch(() => {});
      return true;
    } catch (error) {
      if (signal?.aborted) throw signal.reason || error;
      return false; // Cache is an optimization; a verified full install can proceed.
    } finally {
      if (temporaryPointer)
        await fs.rm(temporaryPointer, { force: true }).catch(() => {});
      if (folder && !committed)
        await fs.rm(folder, { recursive: true, force: true }).catch(() => {});
    }
  }
  return { load, save };
}

module.exports = { createUpdateCache, MAX_MAP_BYTES };
