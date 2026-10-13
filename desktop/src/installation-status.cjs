const fs = require("node:fs/promises");
const path = require("node:path");

function resultFile(userData) {
  return path.join(userData, "updates", "windows-last-install-result.json");
}

async function readInstallResult({ userData, platform = process.platform }) {
  if (platform !== "win32") return null;
  try {
    const value = JSON.parse(
      (await fs.readFile(resultFile(userData), "utf8")).replace(/^\uFEFF/, ""),
    );
    if (
      value.schema !== 1 ||
      !["failed", "success"].includes(value.status) ||
      !/^\d+\.\d+\.\d+$/.test(value.version) ||
      (value.status === "failed" && typeof value.message !== "string")
    )
      return null;
    return {
      status: value.status,
      version: value.version,
      message: String(value.message || "").slice(0, 1400),
    };
  } catch {
    return null;
  }
}

async function acknowledgeInstallResult(userData) {
  await fs.rm(resultFile(userData), { force: true }).catch(() => {});
}

module.exports = { readInstallResult, acknowledgeInstallResult };
