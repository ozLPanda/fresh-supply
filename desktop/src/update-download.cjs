const fs = require("node:fs/promises");
const path = require("node:path");
const { createHash, timingSafeEqual } = require("node:crypto");

const RELEASE_HOSTS = new Set([
  "github.com",
  "release-assets.githubusercontent.com",
  "objects.githubusercontent.com",
  "github-releases.githubusercontent.com",
]);
const DEFAULT_MAX_BYTES = 4 * 1024 ** 3;

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
    throw updateError("Invalid update download source.", "UPDATE_SOURCE_INVALID");
  }
  if (!/^sha256:[a-fA-F0-9]{64}$/.test(asset?.digest || "")) {
    throw updateError("The release has no SHA-256 digest.", "UPDATE_DIGEST_MISSING");
  }
  if (
    !Number.isSafeInteger(maxBytes) || maxBytes <= 0 ||
    !Number.isSafeInteger(asset.size) || asset.size <= 0 || asset.size > maxBytes
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
    throw updateError("Invalid release download redirect.", "UPDATE_SOURCE_INVALID");
  }
  if (
    target.protocol !== "https:" || !RELEASE_HOSTS.has(target.hostname) ||
    target.username || target.password || (target.port && target.port !== "443") ||
    target.hash
  ) {
    throw updateError("Untrusted release download redirect.", "UPDATE_SOURCE_INVALID");
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
    Promise.resolve(operation).then(resolve, reject).finally(() => {
      signal.removeEventListener("abort", abort);
    });
  });
}

/**
 * Download a public release without credentials. Metadata digest and byte count
 * must match before the file becomes available to the platform installer.
 * The caller owns the returned file's private parent directory after success.
 */
async function downloadReleaseAsset({
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
    throw updateError("Update storage is unavailable.", "UPDATE_STORAGE_INVALID");
  }
  const controller = new AbortController();
  const cancel = () => controller.abort(signal.reason || updateError("Update cancelled.", "ABORT_ERR"));
  let timer;
  let directory;
  let file;
  let reader;
  const heartbeat = () => {
    clearTimeout(timer);
    timer = setTimeout(() => controller.abort(updateError("Update download timed out.", "UPDATE_TIMEOUT")), inactivityTimeoutMs);
  };
  if (signal?.aborted) cancel();
  signal?.addEventListener("abort", cancel, { once: true });
  try {
    controller.signal.throwIfAborted();
    await fs.mkdir(path.resolve(destinationDirectory), { recursive: true, mode: 0o700 });
    directory = await fs.mkdtemp(path.join(path.resolve(destinationDirectory), "download-"));
    await fs.chmod(directory, 0o700);
    const partial = path.join(directory, `${asset.name}.part`);
    const completed = path.join(directory, asset.name);
    file = await fs.open(partial, "wx", 0o600);
    const digest = createHash("sha256");
    let url = source;
    let response;
    for (let redirects = 0; redirects <= 6; redirects += 1) {
      heartbeat();
      response = await withAbort(fetchAsset(url, {
        redirect: "manual",
        headers: { Accept: "application/octet-stream", "Accept-Encoding": "identity" },
        signal: controller.signal,
      }), controller.signal);
      if (![301, 302, 303, 307, 308].includes(response.status)) break;
      const location = response.headers.get("location");
      cancelStream(response.body);
      if (!location || redirects === 6) {
        throw updateError("Invalid release download redirects.", "UPDATE_SOURCE_INVALID");
      }
      url = trustedRedirect(location, url);
    }
    if (!response.ok || response.status !== 200) {
      cancelStream(response.body);
      throw updateError("Release download is unavailable.", "UPDATE_HTTP_ERROR");
    }
    const contentLength = response.headers.get("content-length");
    if (contentLength !== null && (!/^\d+$/.test(contentLength) || Number(contentLength) !== asset.size)) {
      cancelStream(response.body);
      throw updateError("Release download size does not match metadata.", "UPDATE_SIZE_MISMATCH");
    }
    if (!response.body?.getReader) {
      throw updateError("Release download is empty.", "UPDATE_SIZE_MISMATCH");
    }
    reader = response.body.getReader();
    let transferred = 0;
    onProgress?.({ transferred, total: asset.size, percent: 0 });
    while (true) {
      heartbeat();
      const chunk = await withAbort(reader.read(), controller.signal);
      controller.signal.throwIfAborted();
      if (chunk.done) break;
      if (!(chunk.value instanceof Uint8Array)) {
        throw updateError("Invalid release download stream.", "UPDATE_SIZE_MISMATCH");
      }
      transferred += chunk.value.byteLength;
      if (transferred > asset.size) {
        throw updateError("Release download exceeds its expected size.", "UPDATE_SIZE_MISMATCH");
      }
      digest.update(chunk.value);
      await file.writeFile(chunk.value);
      onProgress?.({ transferred, total: asset.size, percent: Math.floor(100 * transferred / asset.size) });
    }
    if (transferred !== asset.size) {
      throw updateError("Release download is incomplete.", "UPDATE_SIZE_MISMATCH");
    }
    if (!timingSafeEqual(digest.digest(), Buffer.from(asset.digest.slice(7), "hex"))) {
      throw updateError("Release download checksum does not match.", "UPDATE_CHECKSUM_MISMATCH");
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

module.exports = { downloadReleaseAsset };
