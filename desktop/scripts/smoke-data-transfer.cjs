#!/usr/bin/env node
// All source/target databases are created under disposable temporary directories.
const fs = require("node:fs/promises");
const path = require("node:path");
const os = require("node:os");
const assert = require("node:assert/strict");
const { randomBytes, randomUUID } = require("node:crypto");
const { Client } = require("pg");
const { LocalRuntime } = require("../src/runtime.cjs");
const { createDataImporter } = require("../src/data-import.cjs");

async function connection(runtime) {
  const client = new Client({
    host: "127.0.0.1",
    port: runtime.config.postgresPort,
    database: "ovoshi_help",
    user: "ovoshi_help",
    password: runtime.config.databasePassword,
  });
  await client.connect();
  return client;
}
async function main() {
  const root = path.resolve(
    process.argv[2] || path.join(__dirname, "../runtime"),
  );
  const version = require("../package.json").version;
  const temporary = await fs.mkdtemp(
    path.join(os.tmpdir(), "ovoshi-transfer-e2e-"),
  );
  const source = new LocalRuntime({
    root,
    userData: path.join(temporary, "source"),
    version,
  });
  const target = new LocalRuntime({
    root,
    userData: path.join(temporary, "target"),
    version,
  });
  const sourcePassword = randomBytes(24).toString("base64url");
  const targetPassword = randomBytes(24).toString("base64url");
  const sourcePhone = "+70000000001",
    targetPhone = "+70000000002";
  const request = async (runtime, route, { token, ...options } = {}) => {
    const headers = {
      ...(token ? { Authorization: "Bearer " + token } : {}),
      ...options.headers,
    };
    if (typeof options.body === "string")
      headers["Content-Type"] = "application/json";
    const response = await fetch(runtime.url + route, {
      ...options,
      headers,
      signal: AbortSignal.timeout(120000),
    });
    assert.equal(response.ok, true, route + " HTTP " + response.status);
    return response;
  };
  const login = async (runtime, phone, password) => {
    const result = await (
      await request(runtime, "/api/auth/login", {
        method: "POST",
        body: JSON.stringify({ phone, password }),
      })
    ).json();
    assert.ok(result.data.token, "login token");
    return result.data.token;
  };
  let sourceClient, targetClient;
  try {
    await source.start({
      bootstrapPhone: sourcePhone,
      bootstrapPassword: sourcePassword,
    });
    await target.start({
      bootstrapPhone: targetPhone,
      bootstrapPassword: targetPassword,
    });
    const importer = createDataImporter({ runtime: target, version });
    await importer.captureBaseline();
    assert.equal((await importer.inspectEligibility()).eligible, true);
    const token = await login(source, sourcePhone, sourcePassword);
    const category = (
      await (
        await request(source, "/api/categories", {
          token,
          method: "POST",
          body: JSON.stringify({
            nameRu: "Экспорт API",
            nameKk: "API экспорт",
            slug: "api-transfer-fixture",
            active: true,
            sortOrder: 0,
          }),
        })
      ).json()
    ).data;
    const image = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a3ioAAAAASUVORK5CYII=",
      "base64",
    );
    const form = new FormData();
    form.set("file", new Blob([image], { type: "image/png" }), "transfer.png");
    const pictured = (
      await (
        await request(source, `/api/categories/${category.id}/image`, {
          token,
          method: "POST",
          body: form,
        })
      ).json()
    ).data;
    const product = (
      await (
        await request(source, "/api/products", {
          token,
          method: "POST",
          body: JSON.stringify({
            nameRu: "Товар экспорта",
            nameKk: "Экспорт тауары",
            sku: "TRANSFER-FIXTURE",
            price: "123.45",
            wholesalePrice: "120.34",
            categoryId: category.id,
            active: true,
          }),
        })
      ).json()
    ).data;
    sourceClient = await connection(source);
    await sourceClient.query(
      "UPDATE project_settings SET value='37'::jsonb WHERE key='commerce.wholesale.minQuantity'",
    );
    const order = randomUUID(),
      document = randomUUID();
    await sourceClient.query(
      "INSERT INTO orders(id,user_id,status,payment_status,payment_method,fulfillment_type,contact_phone,total,paid_total,order_number_date,daily_number) VALUES($1,1,'NEW','PENDING','ON_RECEIPT','DELIVERY',$2,123.45,0,CURRENT_DATE,1)",
      [order, sourcePhone],
    );
    await sourceClient.query(
      "INSERT INTO order_items(order_id,product_id,sku,name_ru,unit_price,quantity,line_total,confirmed_unit_price,confirmed_line_total) VALUES($1,$2,'TRANSFER-FIXTURE','Товар экспорта',123.45,1,123.45,123.45,123.45)",
      [order, product.id],
    );
    await sourceClient.query(
      "INSERT INTO order_daily_counters(order_number_date,last_daily_number) VALUES(CURRENT_DATE,1)",
    );
    await sourceClient.query(
      "INSERT INTO stock_documents(id,document_number,document_type,status,warehouse_id,source_order_id,created_by_user_id) VALUES($1,'API-TRANSFER-1','OPENING_BALANCE','DRAFT',1,$2,1)",
      [document, order],
    );
    await sourceClient.query(
      "INSERT INTO stock_document_lines(document_id,product_id,quantity,unit_cost) VALUES($1,$2,1.234,123.45)",
      [document, product.id],
    );
    await sourceClient.query(
      "SELECT setval('stock_document_number_seq',777,true)",
    );
    await sourceClient.query("SELECT setval('product_sku_seq',888,true)");
    console.log(
      "Isolated website source contains relational records, exact money, settings and an image",
    );
    await importer.importFromSource({
      url: source.url,
      phone: sourcePhone,
      password: sourcePassword,
    });
    const importedToken = await login(target, sourcePhone, sourcePassword);
    const copied = (
      await (
        await request(target, `/api/categories/${category.id}`, {
          token: importedToken,
        })
      ).json()
    ).data;
    assert.equal(copied.nameRu, category.nameRu);
    const downloaded = await request(target, pictured.imageFilePath, {
      token: importedToken,
    });
    assert.equal(
      Buffer.compare(Buffer.from(await downloaded.arrayBuffer()), image),
      0,
    );
    targetClient = await connection(target);
    assert.equal(
      (
        await targetClient.query(
          "SELECT price::text FROM products WHERE id=$1",
          [product.id],
        )
      ).rows[0].price,
      "123.45",
    );
    assert.equal(
      (
        await targetClient.query(
          "SELECT quantity::text FROM stock_document_lines WHERE document_id=$1",
          [document],
        )
      ).rows[0].quantity,
      "1.234",
    );
    assert.equal(
      (
        await targetClient.query(
          "SELECT source_order_id::text FROM stock_documents WHERE id=$1",
          [document],
        )
      ).rows[0].source_order_id,
      order,
    );
    assert.equal(
      (
        await targetClient.query(
          "SELECT value::text FROM project_settings WHERE key='commerce.wholesale.minQuantity'",
        )
      ).rows[0].value,
      "37",
    );
    assert.equal(
      (
        await targetClient.query(
          "SELECT last_value::text FROM stock_document_number_seq",
        )
      ).rows[0].last_value,
      "777",
    );
    assert.equal(
      (await targetClient.query("SELECT last_value::text FROM product_sku_seq"))
        .rows[0].last_value,
      "888",
    );
    assert.equal((await importer.inspectEligibility()).eligible, false);
    await assert.rejects(
      importer.importFromSource({
        url: source.url,
        phone: sourcePhone,
        password: sourcePassword,
      }),
    );
    assert.equal(
      JSON.parse(
        await fs.readFile(path.join(target.dataDir, "app-state.json"), "utf8"),
      ).importedData,
      true,
    );
    console.log(
      "Whole HTTP export/import passed: source login, money, FK links, settings, sequence counters, files and repeat refusal",
    );
    await targetClient.end();
    targetClient = null;
    await sourceClient.end();
    sourceClient = null;
    await target.stop();
    await target.start();
    await login(target, sourcePhone, sourcePassword);
    console.log(
      "Imported credentials and data persist after native application restart",
    );
  } finally {
    if (sourceClient) await sourceClient.end().catch(() => {});
    if (targetClient) await targetClient.end().catch(() => {});
    await source.stop();
    await target.stop();
    await fs.rm(temporary, { recursive: true, force: true });
  }
}
main().catch((error) => {
  console.error(
    "Isolated website-to-desktop integration failed: " + error.message,
  );
  process.exitCode = 1;
});
