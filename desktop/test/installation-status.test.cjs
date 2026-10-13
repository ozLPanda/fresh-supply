const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const os = require("node:os");
const {
  readInstallResult,
  acknowledgeInstallResult,
} = require("../src/installation-status.cjs");

test("post-quit Windows installer failure remains available until user acknowledges it", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "fresh-install-result-"));
  try {
    const folder = path.join(dir, "updates");
    await fs.mkdir(folder);
    const file = path.join(folder, "windows-last-install-result.json");
    await fs.writeFile(
      file,
      "\uFEFF" +
        JSON.stringify({
          schema: 1,
          status: "failed",
          version: "0.1.9",
          message: "Установка отменена в окне Windows.",
        }),
    );
    const result = await readInstallResult({
      userData: dir,
      platform: "win32",
    });
    assert.equal(result.message, "Установка отменена в окне Windows.");
    assert.deepEqual(
      await readInstallResult({ userData: dir, platform: "win32" }),
      result,
    );
    assert.equal(
      await readInstallResult({ userData: dir, platform: "darwin" }),
      null,
    );
    await acknowledgeInstallResult(dir);
    assert.equal(
      await readInstallResult({ userData: dir, platform: "win32" }),
      null,
    );
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test("damaged install results do not prevent startup and cannot supply a path to remove", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "fresh-install-result-"));
  try {
    const folder = path.join(dir, "updates");
    await fs.mkdir(folder);
    const file = path.join(folder, "windows-last-install-result.json");
    const sentinel = path.join(dir, "database-sentinel");
    await fs.writeFile(sentinel, "keep");
    for (const value of [
      "{",
      JSON.stringify({
        schema: 2,
        status: "failed",
        version: "0.1.9",
        path: sentinel,
      }),
      JSON.stringify({
        schema: 1,
        status: "failed",
        version: "bad",
        message: "x",
      }),
    ]) {
      await fs.writeFile(file, value);
      assert.equal(
        await readInstallResult({ userData: dir, platform: "win32" }),
        null,
      );
    }
    await acknowledgeInstallResult(dir);
    assert.equal(await fs.readFile(sentinel, "utf8"), "keep");
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});
