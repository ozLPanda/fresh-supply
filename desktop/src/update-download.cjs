const fs = require("node:fs/promises");
const path = require("node:path");
const { createHash, timingSafeEqual } = require("node:crypto");
const { constants } = require("node:fs");
const { gunzip } = require("node:zlib");
const { promisify } = require("node:util");
const {
  computeOperations,
  OperationKind,
} = require("electron-updater/out/differentialDownloader/downloadPlanBuilder.js");

const RELEASE_HOSTS = new Set([
  "github.com",
  "release-assets.githubusercontent.com",
  "objects.githubusercontent.com",
  "github-releases.githubusercontent.com",
]);
const DEFAULT_MAX_BYTES = 4 * 1024 ** 3;
const MAX_BLOCKMAP_BYTES = 8 * 1024 ** 2;
const MAX_DECODED_BLOCKMAP_BYTES = 32 * 1024 ** 2;
const MAX_BLOCKS = 250000;
const MAX_RANGE_REQUESTS = 2048;
const IO_BYTES = 256 * 1024;

function updateError(message, code) {
  return Object.assign(new Error(message), { code });
}

function validateDownload({ asset, repository, tag, maxBytes }) {
  const segments = typeof repository === "string" ? repository.split("/") : [];
  if (
    segments.length !== 2 ||
    segments.some((segment) => !/^[A-Za-z0-9][A-Za-z0-9_.-]*$/.test(segment)) ||
    !/^desktop-v\d+\.\d+\.\d+$/.test(tag || "") ||
    !/^[A-Za-z0-9][A-Za-z0-9._-]{0,180}$/.test(asset?.name || "")
  ) {
    throw updateError(
      "Invalid update download source.",
      "UPDATE_SOURCE_INVALID",
    );
  }
  if (!/^sha256:[a-fA-F0-9]{64}$/.test(asset?.digest || "")) {
    throw updateError(
      "The release has no SHA-256 digest.",
      "UPDATE_DIGEST_MISSING",
    );
  }
  if (
    !Number.isSafeInteger(maxBytes) ||
    maxBytes <= 0 ||
    !Number.isSafeInteger(asset.size) ||
    asset.size <= 0 ||
    asset.size > maxBytes
  ) {
    throw updateError("Invalid update file size.", "UPDATE_SIZE_INVALID");
  }
  return `https://github.com/${repository}/releases/download/${tag}/${encodeURIComponent(asset.name)}`;
}

function trustedRedirect(location, current) {
  let target;
  try {
    target = new URL(location, current);
  } catch {
    throw updateError(
      "Invalid release download redirect.",
      "UPDATE_SOURCE_INVALID",
    );
  }
  if (
    target.protocol !== "https:" ||
    !RELEASE_HOSTS.has(target.hostname) ||
    target.username ||
    target.password ||
    (target.port && target.port !== "443") ||
    target.hash
  ) {
    throw updateError(
      "Untrusted release download redirect.",
      "UPDATE_SOURCE_INVALID",
    );
  }
  return target.href;
}

function cancelStream(stream, reason) {
  try {
    // A misbehaving transport must not delay timeout/cancellation cleanup.
    Promise.resolve(stream?.cancel?.(reason)).catch(() => {});
  } catch {
    // Cleanup continues if a transport has already disposed its stream.
  }
}

// Race reads as well as fetch: injected transports must not hang after disposal.
function withAbort(operation, signal) {
  if (signal.aborted) return Promise.reject(signal.reason);
  return new Promise((resolve, reject) => {
    const abort = () => reject(signal.reason);
    signal.addEventListener("abort", abort, { once: true });
    Promise.resolve(operation)
      .then(resolve, reject)
      .finally(() => {
        signal.removeEventListener("abort", abort);
      });
  });
}

/**
 * Download a public release without credentials. Metadata digest and byte count
 * must match before the file becomes available to the platform installer.
 * The caller owns the returned file's private parent directory after success.
 */
async function downloadFullAsset({
  asset,
  repository,
  tag,
  destinationDirectory,
  fetch: fetchAsset = globalThis.fetch,
  onProgress,
  signal,
  inactivityTimeoutMs = 30000,
  maxBytes = DEFAULT_MAX_BYTES,
}) {
  const source = validateDownload({ asset, repository, tag, maxBytes });
  if (!Number.isSafeInteger(inactivityTimeoutMs) || inactivityTimeoutMs <= 0) {
    throw updateError("Invalid download timeout.", "UPDATE_SOURCE_INVALID");
  }
  if (typeof destinationDirectory !== "string" || !destinationDirectory) {
    throw updateError(
      "Update storage is unavailable.",
      "UPDATE_STORAGE_INVALID",
    );
  }
  const controller = new AbortController();
  const cancel = () =>
    controller.abort(
      signal.reason || updateError("Update cancelled.", "ABORT_ERR"),
    );
  let timer;
  let directory;
  let file;
  let reader;
  const heartbeat = () => {
    clearTimeout(timer);
    timer = setTimeout(
      () =>
        controller.abort(
          updateError("Update download timed out.", "UPDATE_TIMEOUT"),
        ),
      inactivityTimeoutMs,
    );
  };
  if (signal?.aborted) cancel();
  signal?.addEventListener("abort", cancel, { once: true });
  try {
    controller.signal.throwIfAborted();
    await fs.mkdir(path.resolve(destinationDirectory), {
      recursive: true,
      mode: 0o700,
    });
    directory = await fs.mkdtemp(
      path.join(path.resolve(destinationDirectory), "download-"),
    );
    await fs.chmod(directory, 0o700);
    const partial = path.join(directory, `${asset.name}.part`);
    const completed = path.join(directory, asset.name);
    file = await fs.open(partial, "wx", 0o600);
    const digest = createHash("sha256");
    let url = source;
    let response;
    for (let redirects = 0; redirects <= 6; redirects += 1) {
      heartbeat();
      response = await withAbort(
        fetchAsset(url, {
          redirect: "manual",
          headers: {
            Accept: "application/octet-stream",
            "Accept-Encoding": "identity",
          },
          signal: controller.signal,
        }),
        controller.signal,
      );
      if (![301, 302, 303, 307, 308].includes(response.status)) break;
      const location = response.headers.get("location");
      cancelStream(response.body);
      if (!location || redirects === 6) {
        throw updateError(
          "Invalid release download redirects.",
          "UPDATE_SOURCE_INVALID",
        );
      }
      url = trustedRedirect(location, url);
    }
    if (!response.ok || response.status !== 200) {
      cancelStream(response.body);
      throw updateError(
        "Release download is unavailable.",
        "UPDATE_HTTP_ERROR",
      );
    }
    const contentLength = response.headers.get("content-length");
    if (
      contentLength !== null &&
      (!/^\d+$/.test(contentLength) || Number(contentLength) !== asset.size)
    ) {
      cancelStream(response.body);
      throw updateError(
        "Release download size does not match metadata.",
        "UPDATE_SIZE_MISMATCH",
      );
    }
    if (!response.body?.getReader) {
      throw updateError("Release download is empty.", "UPDATE_SIZE_MISMATCH");
    }
    reader = response.body.getReader();
    let transferred = 0;
    onProgress?.({
      mode: "full",
      transferred,
      total: asset.size,
      percent: 0,
      reusedBytes: 0,
      artifactBytes: asset.size,
    });
    while (true) {
      heartbeat();
      const chunk = await withAbort(reader.read(), controller.signal);
      controller.signal.throwIfAborted();
      if (chunk.done) break;
      if (!(chunk.value instanceof Uint8Array)) {
        throw updateError(
          "Invalid release download stream.",
          "UPDATE_SIZE_MISMATCH",
        );
      }
      transferred += chunk.value.byteLength;
      if (transferred > asset.size) {
        throw updateError(
          "Release download exceeds its expected size.",
          "UPDATE_SIZE_MISMATCH",
        );
      }
      digest.update(chunk.value);
      await file.writeFile(chunk.value);
      onProgress?.({
        mode: "full",
        transferred,
        total: asset.size,
        percent: Math.floor((100 * transferred) / asset.size),
        reusedBytes: 0,
        artifactBytes: asset.size,
      });
    }
    if (transferred !== asset.size) {
      throw updateError(
        "Release download is incomplete.",
        "UPDATE_SIZE_MISMATCH",
      );
    }
    if (
      !timingSafeEqual(
        digest.digest(),
        Buffer.from(asset.digest.slice(7), "hex"),
      )
    ) {
      throw updateError(
        "Release download checksum does not match.",
        "UPDATE_CHECKSUM_MISMATCH",
      );
    }
    controller.signal.throwIfAborted();
    await file.sync();
    await file.close();
    file = null;
    await fs.rename(partial, completed);
    controller.signal.throwIfAborted();
    return completed;
  } catch (error) {
    controller.abort(error);
    // Cancellation of a custom/network stream can itself stall; do not wait.
    cancelStream(reader, error);
    await file?.close().catch(() => {});
    if (directory) await fs.rm(directory, { recursive: true, force: true });
    throw error;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", cancel);
    reader?.releaseLock();
  }
}

async function parseBlockMap(compressed, size) {
  if (
    !Number.isSafeInteger(size) ||
    size <= 0 ||
    !Buffer.isBuffer(compressed) ||
    !compressed.length ||
    compressed.length > MAX_BLOCKMAP_BYTES
  ) {
    throw updateError(
      "Invalid compressed blockmap.",
      "UPDATE_BLOCKMAP_INVALID",
    );
  }
  const decoded = await promisify(gunzip)(compressed, {
    maxOutputLength: MAX_DECODED_BLOCKMAP_BYTES,
  });
  const map = JSON.parse(decoded.toString("utf8"));
  const file = map?.files?.[0];
  if (
    map?.version !== "2" ||
    !Array.isArray(map.files) ||
    map.files.length !== 1 ||
    file?.name !== "file" ||
    file.offset !== 0 ||
    !Array.isArray(file.sizes) ||
    !Array.isArray(file.checksums) ||
    !file.sizes.length ||
    file.sizes.length > MAX_BLOCKS ||
    file.sizes.length !== file.checksums.length
  ) {
    throw updateError("Invalid blockmap structure.", "UPDATE_BLOCKMAP_INVALID");
  }
  let coverage = 0;
  for (let i = 0; i < file.sizes.length; i += 1) {
    const checksum = file.checksums[i];
    if (
      !Number.isSafeInteger(file.sizes[i]) ||
      file.sizes[i] <= 0 ||
      typeof checksum !== "string" ||
      !/^[A-Za-z0-9+/]{24}$/.test(checksum) ||
      Buffer.from(checksum, "base64").length !== 18 ||
      Buffer.from(checksum, "base64").toString("base64") !== checksum
    ) {
      throw updateError("Invalid blockmap block.", "UPDATE_BLOCKMAP_INVALID");
    }
    coverage += file.sizes[i];
    if (!Number.isSafeInteger(coverage) || coverage > size) {
      throw updateError(
        "Blockmap exceeds artifact size.",
        "UPDATE_BLOCKMAP_INVALID",
      );
    }
  }
  if (coverage !== size)
    throw updateError(
      "Incomplete blockmap coverage.",
      "UPDATE_BLOCKMAP_INVALID",
    );
  return map;
}

function coalesceSmallGaps(operations) {
  // Single-range GitHub requests have appreciable latency. Downloading a small
  // unchanged gap is cheaper than opening another request for the next block.
  const result = [];
  let targetOffset = 0;
  for (let i = 0; i < operations.length; i += 1) {
    const op = operations[i];
    const length = op.end - op.start;
    const last = result.at(-1);
    const next = operations[i + 1];
    if (
      op.kind === OperationKind.COPY &&
      length <= 64 * 1024 &&
      last?.kind === OperationKind.DOWNLOAD &&
      last.end === targetOffset &&
      next?.kind === OperationKind.DOWNLOAD &&
      next.start === targetOffset + length
    ) {
      last.end = next.end;
      targetOffset += length + next.end - next.start;
      i += 1;
    } else {
      result.push({ ...op });
      targetOffset += length;
    }
  }
  return result;
}

async function downloadDifferentialAsset(options) {
  const {
    asset,
    previous,
    blockmap,
    signal,
    onProgress,
    fetch: fetchAsset = globalThis.fetch,
    inactivityTimeoutMs = 30000,
  } = options;
  const source = validateDownload({
    ...options,
    maxBytes: options.maxBytes ?? DEFAULT_MAX_BYTES,
  });
  if (
    blockmap?.name !== `${asset.name}.blockmap` ||
    !path.isAbsolute(previous?.file || "")
  ) {
    throw updateError(
      "Differential metadata is unavailable.",
      "UPDATE_BLOCKMAP_INVALID",
    );
  }
  // Treat the cached artifact as untrusted input, including its file type.
  validateDownload({
    asset: previous.asset,
    repository: options.repository,
    tag: options.tag,
    maxBytes: options.maxBytes ?? DEFAULT_MAX_BYTES,
  });
  const controller = new AbortController();
  const cancel = () =>
    controller.abort(
      signal.reason || updateError("Update cancelled.", "ABORT_ERR"),
    );
  let timer, oldFile, output, directory, mapFile, reader;
  const heartbeat = () => {
    clearTimeout(timer);
    timer = setTimeout(
      () =>
        controller.abort(
          updateError("Update download timed out.", "UPDATE_TIMEOUT"),
        ),
      inactivityTimeoutMs,
    );
  };
  if (signal?.aborted) cancel();
  signal?.addEventListener("abort", cancel, { once: true });
  try {
    controller.signal.throwIfAborted();
    const oldStat = await fs.lstat(previous.file);
    if (
      !oldStat.isFile() ||
      oldStat.isSymbolicLink() ||
      oldStat.size !== previous.asset.size
    ) {
      throw updateError("Invalid cached artifact.", "UPDATE_CACHE_INVALID");
    }
    oldFile = await fs.open(
      previous.file,
      constants.O_RDONLY | (constants.O_NOFOLLOW || 0),
    );
    const openedStat = await oldFile.stat();
    if (
      !openedStat.isFile() ||
      openedStat.size !== oldStat.size ||
      openedStat.ino !== oldStat.ino ||
      openedStat.dev !== oldStat.dev
    ) {
      throw updateError("Cached artifact changed.", "UPDATE_CACHE_INVALID");
    }
    const buffer = Buffer.allocUnsafe(IO_BYTES);
    const oldDigest = createHash("sha256");
    for (let position = 0; position < previous.asset.size; ) {
      heartbeat();
      const { bytesRead } = await withAbort(
        oldFile.read(
          buffer,
          0,
          Math.min(buffer.length, previous.asset.size - position),
          position,
        ),
        controller.signal,
      );
      if (!bytesRead)
        throw updateError(
          "Cached artifact is incomplete.",
          "UPDATE_CACHE_INVALID",
        );
      oldDigest.update(buffer.subarray(0, bytesRead));
      position += bytesRead;
    }
    if (
      !timingSafeEqual(
        oldDigest.digest(),
        Buffer.from(previous.asset.digest.slice(7), "hex"),
      )
    ) {
      throw updateError(
        "Cached artifact checksum mismatch.",
        "UPDATE_CACHE_INVALID",
      );
    }
    const oldMap = await withAbort(
      parseBlockMap(previous.blockmap, previous.asset.size),
      controller.signal,
    );
    clearTimeout(timer);
    mapFile = await downloadFullAsset({
      ...options,
      asset: blockmap,
      maxBytes: MAX_BLOCKMAP_BYTES,
      signal: controller.signal,
      onProgress: undefined,
    });
    heartbeat();
    const newMapBytes = await fs.readFile(mapFile);
    const newMap = await withAbort(
      parseBlockMap(newMapBytes, asset.size),
      controller.signal,
    );
    options.onBlockmap?.(newMapBytes);
    const operations = coalesceSmallGaps(
      computeOperations(oldMap, newMap, { info() {}, warn() {} }),
    );
    let downloadBytes = 0,
      reusedBytes = 0,
      rangeRequests = 0,
      coverage = 0;
    if (!operations.length || operations.length > MAX_BLOCKS)
      throw updateError(
        "Invalid differential plan.",
        "UPDATE_BLOCKMAP_INVALID",
      );
    for (const op of operations) {
      if (
        ![OperationKind.COPY, OperationKind.DOWNLOAD].includes(op.kind) ||
        !Number.isSafeInteger(op.start) ||
        !Number.isSafeInteger(op.end) ||
        op.start < 0 ||
        op.end <= op.start ||
        op.end >
          (op.kind === OperationKind.COPY ? previous.asset.size : asset.size) ||
        (op.kind === OperationKind.DOWNLOAD && op.start !== coverage)
      ) {
        throw updateError(
          "Invalid differential range.",
          "UPDATE_BLOCKMAP_INVALID",
        );
      }
      const length = op.end - op.start;
      coverage += length;
      if (op.kind === OperationKind.DOWNLOAD) {
        downloadBytes += length;
        rangeRequests += 1;
      } else reusedBytes += length;
    }
    if (
      coverage !== asset.size ||
      rangeRequests > MAX_RANGE_REQUESTS ||
      downloadBytes + blockmap.size > asset.size * 0.9
    ) {
      throw updateError(
        "Differential download has insufficient savings.",
        "UPDATE_DIFFERENTIAL_UNAVAILABLE",
      );
    }
    await fs.mkdir(path.resolve(options.destinationDirectory), {
      recursive: true,
      mode: 0o700,
    });
    directory = await fs.mkdtemp(
      path.join(path.resolve(options.destinationDirectory), "download-"),
    );
    await fs.chmod(directory, 0o700);
    const partial = path.join(directory, `${asset.name}.part`);
    const completed = path.join(directory, asset.name);
    output = await fs.open(partial, "wx", 0o600);
    const digest = createHash("sha256");
    let transferred = 0,
      written = 0;
    const progress = () =>
      onProgress?.({
        mode: "differential",
        transferred,
        total: downloadBytes,
        percent: downloadBytes
          ? Math.floor((100 * transferred) / downloadBytes)
          : written === asset.size
            ? 100
            : 0,
        reusedBytes,
        artifactBytes: asset.size,
      });
    const write = async (chunk) => {
      for (let offset = 0; offset < chunk.length; offset += IO_BYTES) {
        controller.signal.throwIfAborted();
        const piece = chunk.subarray(
          offset,
          Math.min(chunk.length, offset + IO_BYTES),
        );
        written += piece.length;
        if (written > asset.size)
          throw updateError(
            "Differential artifact exceeds expected size.",
            "UPDATE_SIZE_MISMATCH",
          );
        digest.update(piece);
        heartbeat();
        await withAbort(output.writeFile(piece), controller.signal);
        progress();
      }
    };
    progress();
    for (const op of operations) {
      controller.signal.throwIfAborted();
      if (op.kind === OperationKind.COPY) {
        for (let position = op.start; position < op.end; ) {
          heartbeat();
          const { bytesRead } = await withAbort(
            oldFile.read(
              buffer,
              0,
              Math.min(buffer.length, op.end - position),
              position,
            ),
            controller.signal,
          );
          if (!bytesRead)
            throw updateError(
              "Cached artifact is incomplete.",
              "UPDATE_CACHE_INVALID",
            );
          await write(buffer.subarray(0, bytesRead));
          position += bytesRead;
        }
        continue;
      }
      let url = source,
        response;
      for (let redirects = 0; redirects <= 6; redirects += 1) {
        heartbeat();
        response = await withAbort(
          fetchAsset(url, {
            redirect: "manual",
            signal: controller.signal,
            headers: {
              Accept: "application/octet-stream",
              "Accept-Encoding": "identity",
              Range: `bytes=${op.start}-${op.end - 1}`,
            },
          }),
          controller.signal,
        );
        if (![301, 302, 303, 307, 308].includes(response.status)) break;
        const location = response.headers.get("location");
        cancelStream(response.body);
        if (!location || redirects === 6)
          throw updateError(
            "Invalid release redirect.",
            "UPDATE_SOURCE_INVALID",
          );
        url = trustedRedirect(location, url);
      }
      const length = op.end - op.start;
      const contentLength = response.headers.get("content-length");
      const encoding = response.headers.get("content-encoding");
      if (
        response.status !== 206 ||
        response.headers.get("content-range") !==
          `bytes ${op.start}-${op.end - 1}/${asset.size}` ||
        (contentLength !== null &&
          (!/^\d+$/.test(contentLength) || Number(contentLength) !== length)) ||
        (encoding !== null && encoding.toLowerCase() !== "identity") ||
        !response.body?.getReader
      ) {
        cancelStream(response.body);
        throw updateError(
          "Release range download is unavailable.",
          "UPDATE_RANGE_INVALID",
        );
      }
      reader = response.body.getReader();
      let received = 0;
      while (true) {
        heartbeat();
        const chunk = await withAbort(reader.read(), controller.signal);
        controller.signal.throwIfAborted();
        if (chunk.done) break;
        if (
          !(chunk.value instanceof Uint8Array) ||
          received + chunk.value.byteLength > length
        ) {
          throw updateError(
            "Invalid range download size.",
            "UPDATE_SIZE_MISMATCH",
          );
        }
        received += chunk.value.byteLength;
        transferred += chunk.value.byteLength;
        await write(chunk.value);
      }
      if (received !== length)
        throw updateError(
          "Range download is incomplete.",
          "UPDATE_SIZE_MISMATCH",
        );
      reader.releaseLock();
      reader = null;
    }
    if (
      written !== asset.size ||
      !timingSafeEqual(
        digest.digest(),
        Buffer.from(asset.digest.slice(7), "hex"),
      )
    ) {
      throw updateError(
        "Differential artifact checksum mismatch.",
        "UPDATE_CHECKSUM_MISMATCH",
      );
    }
    controller.signal.throwIfAborted();
    await output.sync();
    await output.close();
    output = null;
    await fs.rename(partial, completed);
    controller.signal.throwIfAborted();
    progress();
    return completed;
  } catch (error) {
    controller.abort(error);
    cancelStream(reader, error);
    await output?.close().catch(() => {});
    if (directory) await fs.rm(directory, { recursive: true, force: true });
    throw error;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", cancel);
    reader?.releaseLock();
    await oldFile?.close().catch(() => {});
    if (mapFile)
      await fs.rm(path.dirname(mapFile), { recursive: true, force: true });
  }
}

async function downloadReleaseAsset(options) {
  // Validate mandatory metadata before attempting an optional optimization.
  validateDownload({
    ...options,
    maxBytes: options.maxBytes ?? DEFAULT_MAX_BYTES,
  });
  if (
    !Number.isSafeInteger(options.inactivityTimeoutMs ?? 30000) ||
    (options.inactivityTimeoutMs ?? 30000) <= 0
  ) {
    throw updateError("Invalid download timeout.", "UPDATE_SOURCE_INVALID");
  }
  if (
    typeof options.destinationDirectory !== "string" ||
    !options.destinationDirectory
  ) {
    throw updateError(
      "Update storage is unavailable.",
      "UPDATE_STORAGE_INVALID",
    );
  }
  if (options.blockmap && options.previous) {
    try {
      return await downloadDifferentialAsset(options);
    } catch (error) {
      if (
        options.signal?.aborted ||
        error?.name === "AbortError" ||
        error?.code === "ABORT_ERR"
      )
        throw error;
      // A failed optimization must leave no installer bytes before full retry.
    }
  }
  return downloadFullAsset(options);
}

module.exports = { downloadReleaseAsset, parseBlockMap };
