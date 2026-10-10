#!/usr/bin/env node
// Real native integration test. Uses a new disposable database, never user data.
const fs = require("node:fs/promises");
const path = require("node:path");
const os = require("node:os");
const { randomBytes } = require("node:crypto");
const assert = require("node:assert/strict");
const { LocalRuntime, run } = require("../src/runtime.cjs");
const { Client } = require("pg");

async function main() {
  const userData = await fs.mkdtemp(
    path.join(os.tmpdir(), "ovoshi-app-smoke-"),
  );
  const root = path.resolve(
    process.argv[2] || path.join(__dirname, "../runtime"),
  );
  const runtime = new LocalRuntime({ root, userData, version: "0.1.0" });
  let activeRuntime = runtime;
  const password = randomBytes(24).toString("base64url");
  const phone = "+70000000000";
  let cookie;
  const request = async (route, options = {}) => {
    const headers = {
      Origin: activeRuntime.url,
      ...(cookie ? { Cookie: cookie } : {}),
      ...options.headers,
    };
    if (typeof options.body === "string")
      headers["Content-Type"] = "application/json";
    const response = await fetch(activeRuntime.url + route, {
      ...options,
      headers,
      signal: AbortSignal.timeout(60000),
    });
    if (route === "/api/auth/login" && response.ok)
      cookie = response.headers.get("set-cookie")?.split(";")[0];
    assert.equal(response.ok, true, `${route} status ${response.status}`);
    return response;
  };
  const login = async () => {
    const response = await request("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({ phone, password }),
    });
    assert.equal((await response.json()).success, true, "admin login");
    assert.ok(cookie, "same-origin session cookie");
  };
  try {
    await runtime.start({ bootstrapPassword: password, bootstrapPhone: phone });
    console.log("Native backend, PostgreSQL and offline embeddings ready");
    await login();
    const me = await (await request("/api/auth/me")).json();
    assert.equal(me.data.adminAccess, true);
    // Check protected admin UI only after authenticating this session.
    const html = await (await request("/admin")).text();
    assert.ok(html.includes('<div id="root">'), "admin frontend shell");
    const category = (
      await (
        await request("/api/categories", {
          method: "POST",
          body: JSON.stringify({
            nameRu: "Тест локальной сборки",
            nameKk: "Жергілікті тексеру",
            slug: "desktop-smoke-test",
            active: true,
            sortOrder: 0,
          }),
        })
      ).json()
    ).data;
    assert.ok(category.id, "create category");
    const image = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a3ioAAAAASUVORK5CYII=",
      "base64",
    );
    const body = new FormData();
    body.set(
      "file",
      new Blob([image], { type: "image/png" }),
      "desktop-test.png",
    );
    const uploaded = (
      await (
        await request(`/api/categories/${category.id}/image`, {
          method: "POST",
          body,
        })
      ).json()
    ).data;
    assert.ok(uploaded.imageFilePath, "image path");
    const downloaded = await request(uploaded.imageFilePath);
    assert.equal(
      Buffer.compare(Buffer.from(await downloaded.arrayBuffer()), image),
      0,
      "file roundtrip",
    );
    console.log(
      "Admin cookie login, category creation and native file roundtrip passed",
    );
    const backup = await runtime.backup("smoke");
    await runtime.start();
    await login();
    const preserved = (
      await (await request(`/api/categories/${category.id}`)).json()
    ).data;
    assert.equal(preserved.nameRu, "Тест локальной сборки");
    await request(`/api/categories/${category.id}`, {
      method: "PUT",
      body: JSON.stringify({ ...preserved, nameRu: "После копии" }),
    });
    await runtime.restoreBackup(backup);
    await runtime.start();
    await login();
    assert.equal(
      (await (await request(`/api/categories/${category.id}`)).json()).data
        .nameRu,
      "Тест локальной сборки",
    );
    console.log(
      "Restart persistence and consistent database/file backup restore passed",
    );
    // Build test-only backend packages with one real schema upgrade and one
    // intentionally failing migration. Never replace the installed runtime JAR.
    await runtime.stop();
    const upgradedJar = path.join(userData, "backend-upgraded.jar");
    const failedJar = path.join(userData, "backend-failed.jar");
    const addMigration = [
      "import sys, zipfile",
      "with zipfile.ZipFile(sys.argv[1]) as src, zipfile.ZipFile(sys.argv[2], 'w') as dst:",
      "    for item in src.infolist(): dst.writestr(item, src.read(item.filename))",
      "    dst.writestr('BOOT-INF/classes/db/migration/' + sys.argv[3], sys.argv[4])",
    ].join("\n");
    await run(runtime.component("python"), [
      "-c",
      addMigration,
      runtime.component("backend"),
      upgradedJar,
      "V9000__desktop_upgrade_smoke.sql",
      "ALTER TABLE categories ADD COLUMN desktop_smoke_marker integer NOT NULL DEFAULT 1;",
    ]);
    await run(runtime.component("python"), [
      "-c",
      addMigration,
      upgradedJar,
      failedJar,
      "V9001__desktop_failed_smoke.sql",
      "UPDATE categories SET name_ru = 'failed migration'; SELECT missing_desktop_smoke_function();",
    ]);
    const useJar = (instance, jar) => {
      const original = instance.component.bind(instance);
      instance.component = (key) => (key === "backend" ? jar : original(key));
    };
    const columnExists = async (instance) => {
      const client = new Client({
        host: "127.0.0.1",
        port: instance.config.postgresPort,
        user: "ovoshi_help",
        password: instance.config.databasePassword,
        database: "ovoshi_help",
      });
      try {
        await client.connect();
        return (
          (
            await client.query(
              "SELECT 1 FROM information_schema.columns WHERE table_name='categories' AND column_name='desktop_smoke_marker'",
            )
          ).rowCount === 1
        );
      } finally {
        await client.end();
      }
    };
    const upgraded = new LocalRuntime({ root, userData, version: "0.1.1" });
    useJar(upgraded, upgradedJar);
    try {
      await upgraded.start();
      activeRuntime = upgraded;
      await login();
      assert.equal(
        await columnExists(upgraded),
        true,
        "real migration applied",
      );
      assert.equal(
        JSON.parse(
          await fs.readFile(
            path.join(upgraded.dataDir, "app-state.json"),
            "utf8",
          ),
        ).version,
        "0.1.1",
      );
      assert.ok(
        (await fs.readdir(upgraded.backupsDir)).some((name) =>
          name.includes("before-upgrade"),
        ),
      );
      console.log(
        "Real schema upgrade preserves data and creates pre-migration backup",
      );
    } finally {
      await upgraded.stop();
    }
    const broken = new LocalRuntime({ root, userData, version: "0.1.2" });
    useJar(broken, failedJar);
    try {
      await assert.rejects(
        broken.start(),
        /Данные восстановлены/,
        "failed migration restores snapshot",
      );
    } finally {
      await broken.stop();
    }
    const recovered = new LocalRuntime({ root, userData, version: "0.1.1" });
    useJar(recovered, upgradedJar);
    try {
      await recovered.start();
      activeRuntime = recovered;
      await login();
      assert.equal(
        (await (await request(`/api/categories/${category.id}`)).json()).data
          .nameRu,
        "Тест локальной сборки",
      );
      assert.equal(
        await columnExists(recovered),
        true,
        "previous migrated schema restored",
      );
      assert.equal(
        JSON.parse(
          await fs.readFile(
            path.join(recovered.dataDir, "app-state.json"),
            "utf8",
          ),
        ).version,
        "0.1.1",
      );
      console.log(
        "Failed real migration restores database, files and previous version checkpoint",
      );
    } finally {
      await recovered.stop();
    }
  } finally {
    await runtime.stop();
    await fs.rm(userData, { recursive: true, force: true });
  }
}
main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
