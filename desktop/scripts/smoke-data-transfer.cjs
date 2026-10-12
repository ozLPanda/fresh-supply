#!/usr/bin/env node
// All source/target databases are created under disposable temporary directories.
const fs = require("node:fs/promises");
const path = require("node:path");
const os = require("node:os");
const assert = require("node:assert/strict");
const { createHash, randomBytes, randomUUID } = require("node:crypto");
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
            nameRu: "ОВОЩИ экспорт API",
            nameKk: "КӨКӨНІСТЕР API экспорт",
            slug: "api-transfer-fixture",
            active: true,
            sortOrder: 0,
          }),
        })
      ).json()
    ).data;
    // This unused category will disappear on the source after the first import.
    // A replacement must remove its formerly imported local row as well.
    const removedCategory = (
      await (
        await request(source, "/api/categories", {
          token,
          method: "POST",
          body: JSON.stringify({
            nameRu: "Удаляемая категория сайта",
            nameKk: "Жойылатын санат",
            slug: "removed-on-source-fixture",
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
            nameRu: "КАРТОФЕЛЬ Товар экспорта",
            nameKk: "КАРТОП ӘЛІ Экспорт тауары",
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
    // The portable database uses locale=C on both Windows and macOS. Check
    // actual admin/picker SQL against imported uppercase Cyrillic, not just the
    // Java normalizer or backend health endpoint.
    const verifyImportedBusinessFlows = async (token) => {
      for (const picker of [false, true]) {
        for (const search of [
          "картофель",
          "КартОфЕль",
          "картоп",
          "әлі",
          "овощи",
          "көкөністер",
          "transfer-fixture",
        ]) {
          const query = new URLSearchParams({
            page: "1",
            size: picker ? "50" : "20",
            lexicalOnly: "true",
            search,
            sort: "nameRu",
            direction: "asc",
          });
          if (picker) {
            query.set("active", "true");
            query.set("excludeImportCreated", "true");
          }
          const result = (
            await (
              await request(target, `/api/products?${query}`, { token })
            ).json()
          ).data;
          assert.ok(
            result.items.some((item) => item.id === product.id),
            `Imported ${picker ? "picker" : "catalog"} search ${search}`,
          );
        }
      }
      for (const document of [
        "invoice.pdf",
        "invoice-z2.pdf",
        "payment-invoice.pdf",
        "comparison.pdf",
      ]) {
        const response = await request(
          target,
          `/api/admin/orders/${order}/${document}`,
          { token },
        );
        assert.match(response.headers.get("content-type"), /^application\/pdf/);
        assert.match(response.headers.get("content-disposition"), /^inline;/);
        const pdf = Buffer.from(await response.arrayBuffer());
        assert.equal(
          pdf.subarray(0, 5).toString("ascii"),
          "%PDF-",
          `Imported ${document}`,
        );
        assert.ok(pdf.length > 1000, `Nonempty imported ${document}`);
      }
    };
    await verifyImportedBusinessFlows(importedToken);
    console.log(
      "Imported uppercase Russian/Kazakh catalog and picker search and all order PDF documents passed",
    );
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
    await verifyImportedBusinessFlows(
      await login(target, sourcePhone, sourcePassword),
    );
    console.log(
      "Imported credentials and data persist after native application restart",
    );

    const createCategory = async (runtime, token, slug, nameRu) =>
      (
        await (
          await request(runtime, "/api/categories", {
            token,
            method: "POST",
            body: JSON.stringify({
              nameRu,
              nameKk: nameRu,
              slug,
              active: true,
              sortOrder: 0,
            }),
          })
        ).json()
      ).data;
    const uploadCategoryImage = async (runtime, token, id) => {
      const form = new FormData();
      form.set("file", new Blob([image], { type: "image/png" }), "refresh.png");
      return (
        await (
          await request(runtime, `/api/categories/${id}/image`, {
            token,
            method: "POST",
            body: form,
          })
        ).json()
      ).data;
    };
    const snapshot = async () => {
      const client = await connection(target);
      try {
        const database = {};
        for (const [name, sql] of Object.entries({
          categories:
            "SELECT id::integer,name_ru,slug,image_file_path FROM categories ORDER BY id",
          products:
            "SELECT id::integer,name_ru,sku,price::text,category_id::integer FROM products ORDER BY id",
          orders:
            "SELECT id::text,total::text,daily_number::text FROM orders ORDER BY id",
          items:
            "SELECT order_id::text,product_id::integer,quantity::text,line_total::text FROM order_items ORDER BY order_id,product_id",
          counters:
            "SELECT order_number_date::text,last_daily_number::text FROM order_daily_counters ORDER BY order_number_date",
          productSequence: "SELECT last_value::text FROM product_sku_seq",
          documentSequence:
            "SELECT last_value::text FROM stock_document_number_seq",
          settings:
            "SELECT value::text FROM project_settings WHERE key='commerce.wholesale.minQuantity'",
        }))
          database[name] = (await client.query(sql)).rows;
        const files = [];
        for (const name of (
          await fs.readdir(path.join(target.dataDir, "files"))
        ).sort()) {
          if (!name.endsWith(".object")) continue;
          files.push({
            name,
            digest: createHash("sha256")
              .update(
                await fs.readFile(path.join(target.dataDir, "files", name)),
              )
              .digest("hex"),
          });
        }
        return { database, files };
      } finally {
        await client.end();
      }
    };
    const backups = async () => (await fs.readdir(target.backupsDir)).sort();
    const localToken = await login(target, sourcePhone, sourcePassword);
    const localCategory = await createCategory(
      target,
      localToken,
      "local-only-refresh-fixture",
      "Только локальная категория",
    );
    const localPicture = await uploadCategoryImage(
      target,
      localToken,
      localCategory.id,
    );
    const beforeRefresh = await snapshot();
    const beforeBackups = await backups();
    assert.ok(
      beforeRefresh.database.categories.some(
        (row) => row.slug === localCategory.slug,
      ),
    );
    assert.ok(
      beforeRefresh.database.categories.some(
        (row) => row.id === removedCategory.id,
      ),
    );

    // Website work continues while the desktop holds the old snapshot plus its
    // own local changes. All fixture databases and uploads remain disposable.
    const newCategory = await createCategory(
      source,
      token,
      "source-new-refresh-fixture",
      "Новая категория сайта",
    );
    const newPicture = await uploadCategoryImage(source, token, newCategory.id);
    const newProduct = (
      await (
        await request(source, "/api/products", {
          token,
          method: "POST",
          body: JSON.stringify({
            nameRu: "Новый товар сайта",
            nameKk: "Жаңа тауар",
            sku: "REFRESH-NEW-FIXTURE",
            price: "456.78",
            categoryId: newCategory.id,
            active: true,
          }),
        })
      ).json()
    ).data;
    sourceClient = await connection(source);
    await sourceClient.query(
      "UPDATE products SET name_ru=$1,price=234.56 WHERE id=$2",
      ["КАРТОФЕЛЬ Обновлённый товар", product.id],
    );
    await sourceClient.query("DELETE FROM categories WHERE id=$1", [
      removedCategory.id,
    ]);
    const newOrder = randomUUID();
    await sourceClient.query(
      "INSERT INTO orders(id,user_id,status,payment_status,payment_method,fulfillment_type,contact_phone,total,paid_total,order_number_date,daily_number) VALUES($1,1,'NEW','PENDING','ON_RECEIPT','DELIVERY',$2,456.78,0,CURRENT_DATE,2)",
      [newOrder, sourcePhone],
    );
    await sourceClient.query(
      "INSERT INTO order_items(order_id,product_id,sku,name_ru,unit_price,quantity,line_total,confirmed_unit_price,confirmed_line_total) VALUES($1,$2,'REFRESH-NEW-FIXTURE','Новый товар сайта',456.78,1,456.78,456.78,456.78)",
      [newOrder, newProduct.id],
    );
    await sourceClient.query(
      "UPDATE order_daily_counters SET last_daily_number=2 WHERE order_number_date=CURRENT_DATE",
    );
    await sourceClient.query(
      "UPDATE project_settings SET value='42'::jsonb WHERE key='commerce.wholesale.minQuantity'",
    );
    await sourceClient.query(
      "SELECT setval('stock_document_number_seq',779,true)",
    );
    await sourceClient.query("SELECT setval('product_sku_seq',889,true)");
    await sourceClient.end();
    sourceClient = null;
    const replacement = {
      mode: "replace",
      url: source.url,
      phone: sourcePhone,
      password: sourcePassword,
    };
    let offered = 0;
    const denied = await importer.importFromSource({
      ...replacement,
      confirmReplacement: async (summary) => {
        offered++;
        assert.equal(
          target.started,
          true,
          "Replacement confirmation precedes runtime shutdown",
        );
        assert.ok(summary.tables > 0 && summary.rows > 0 && summary.files > 0);
        assert.deepEqual(
          await backups(),
          beforeBackups,
          "No backup or write before approval",
        );
        return false;
      },
    });
    assert.equal(offered, 1);
    assert.equal(denied.cancelled, true);
    assert.deepEqual(
      await snapshot(),
      beforeRefresh,
      "Declined replacement leaves data and files intact",
    );
    assert.deepEqual(await backups(), beforeBackups);
    for (const invalid of [
      { password: randomBytes(24).toString("base64url") },
      { url: "http://127.0.0.1:1" },
    ]) {
      let invalidConfirmationCalls = 0;
      await assert.rejects(
        importer.importFromSource({
          ...replacement,
          ...invalid,
          confirmReplacement: async () => {
            invalidConfirmationCalls++;
            return false;
          },
        }),
      );
      assert.equal(
        invalidConfirmationCalls,
        0,
        "Invalid source fails before replacement approval",
      );
      assert.deepEqual(
        await snapshot(),
        beforeRefresh,
        "Failed source access preserves local data",
      );
      assert.deepEqual(await backups(), beforeBackups);
      assert.equal(target.started, true);
    }
    console.log(
      "Replacement denial, invalid credentials and unavailable source preserve current local data and files",
    );

    // Fail exactly the first application restart after a fully restored import.
    // The importer must restore the pre-replacement database and uploads and
    // successfully restart the original local application on its second call.
    const originalStart = target.start;
    let failNextStart = true;
    target.start = async function (...args) {
      if (failNextStart) {
        failNextStart = false;
        throw new Error("Injected post-replacement restart failure");
      }
      return originalStart.apply(this, args);
    };
    try {
      await assert.rejects(
        importer.importFromSource({
          ...replacement,
          confirmReplacement: async () => true,
        }),
        /восстановлены из резервной копии/,
      );
    } finally {
      target.start = originalStart;
    }
    assert.equal(failNextStart, false, "Injected restart failure was reached");
    assert.equal(target.started, true);
    assert.deepEqual(
      await snapshot(),
      beforeRefresh,
      "Failed replacement rolls back database and uploaded files",
    );
    assert.equal(
      await fs
        .stat(path.join(target.userData, "data-import-pending.json"))
        .catch(() => null),
      null,
    );
    console.log(
      "Post-replacement restart failure restores the complete previous local snapshot",
    );

    const replaced = await importer.importFromSource({
      ...replacement,
      confirmReplacement: async () => true,
    });
    assert.equal(replaced.imported, true);
    assert.ok(
      replaced.backup,
      "Successful refresh exposes a usable local backup",
    );
    const refreshed = await snapshot();
    assert.ok(
      !refreshed.database.categories.some(
        (row) => row.slug === localCategory.slug,
      ),
    );
    assert.ok(
      !refreshed.database.categories.some(
        (row) => row.id === removedCategory.id,
      ),
    );
    assert.ok(
      refreshed.database.categories.some(
        (row) => row.slug === newCategory.slug,
      ),
    );
    assert.equal(
      refreshed.database.products.find((row) => row.id === product.id).price,
      "234.56",
    );
    assert.equal(
      refreshed.database.products.find((row) => row.id === product.id).name_ru,
      "КАРТОФЕЛЬ Обновлённый товар",
    );
    assert.equal(
      refreshed.database.products.find((row) => row.id === newProduct.id).price,
      "456.78",
    );
    assert.equal(
      refreshed.database.orders.find((row) => row.id === newOrder).daily_number,
      "2",
    );
    assert.equal(
      refreshed.database.items.find((row) => row.order_id === newOrder)
        .product_id,
      newProduct.id,
    );
    assert.equal(refreshed.database.counters[0].last_daily_number, "2");
    assert.equal(refreshed.database.productSequence[0].last_value, "889");
    assert.equal(refreshed.database.documentSequence[0].last_value, "779");
    assert.equal(refreshed.database.settings[0].value, "42");
    const refreshedToken = await login(target, sourcePhone, sourcePassword);
    await verifyImportedBusinessFlows(refreshedToken);
    const newDownloaded = await request(target, newPicture.imageFilePath, {
      token: refreshedToken,
    });
    assert.deepEqual(Buffer.from(await newDownloaded.arrayBuffer()), image);
    const staleDownload = await fetch(target.url + localPicture.imageFilePath, {
      headers: { Authorization: "Bearer " + refreshedToken },
      signal: AbortSignal.timeout(10000),
    });
    assert.equal(
      staleDownload.status,
      404,
      "Files unique to the old local snapshot are removed",
    );
    assert.equal(
      (await importer.inspectEligibility()).eligible,
      false,
      "Initial import remains blocked after refresh",
    );
    console.log(
      "Confirmed refresh replaces changed/deleted/new rows, foreign keys, sequence counters, settings and uploads",
    );

    // The backup offered to the user must really restore their local edits.
    await target.restoreBackup(replaced.backup);
    await target.start();
    assert.deepEqual(
      await snapshot(),
      beforeRefresh,
      "Manual restoration recovers pre-refresh local edits and files",
    );
    const restoredToken = await login(target, sourcePhone, sourcePassword);
    await verifyImportedBusinessFlows(restoredToken);
    const restoredImage = await request(target, localPicture.imageFilePath, {
      token: restoredToken,
    });
    assert.deepEqual(Buffer.from(await restoredImage.arrayBuffer()), image);
    console.log(
      "Pre-refresh backup restores the original local rows, relationships and uploads",
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
