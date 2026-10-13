#!/usr/bin/env node
// Uses only disposable, newly created source/target databases. Never user data.
const fs = require("node:fs/promises");
const path = require("node:path");
const os = require("node:os");
const assert = require("node:assert/strict");
const { randomBytes, randomUUID } = require("node:crypto");
const { Client } = require("pg");
const { LocalRuntime } = require("../src/runtime.cjs");
const { createDataImporter } = require("../src/data-import.cjs");

async function connect(runtime) {
  const client = new Client({
    host: "127.0.0.1",
    port: runtime.config.postgresPort,
    user: "ovoshi_help",
    database: "ovoshi_help",
    password: runtime.config.databasePassword,
  });
  await client.connect();
  return client;
}
const originalQuery = Client.prototype.query;
Client.prototype.query = function (...args) {
  const result = originalQuery.apply(this, args);
  if (result && typeof result.catch === "function")
    return result.catch((error) => {
      console.error(
        "Isolated SQL failure",
        error.code || "",
        error.constraint || "",
        String(
          typeof args[0] === "string" ? args[0] : args[0]?.text || "",
        ).slice(0, 220),
      );
      throw error;
    });
  return result;
};
async function main() {
  const root = path.resolve(
    process.argv[2] || path.join(__dirname, "../runtime"),
  );
  const temporary = await fs.mkdtemp(
    path.join(os.tmpdir(), "fresh-supply-merge-e2e-"),
  );
  const version = require("../package.json").version;
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
  const phone = "+70000000009",
    password = randomBytes(24).toString("base64url");
  let a, b;
  try {
    console.log("Starting isolated website runtime");
    await source.start({ bootstrapPhone: phone, bootstrapPassword: password });
    console.log("Starting isolated desktop runtime");
    await target.start({
      bootstrapPhone: "+70000000008",
      bootstrapPassword: randomBytes(24).toString("base64url"),
    });
    const api = async (runtime, route, token, body) => {
      const response = await fetch(runtime.url + route, {
        method: body === undefined ? "GET" : "POST",
        headers: {
          ...(token ? { Authorization: "Bearer " + token } : {}),
          ...(body === undefined ? {} : { "Content-Type": "application/json" }),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        signal: AbortSignal.timeout(120000),
      });
      assert.equal(response.ok, true, route + " HTTP " + response.status);
      return (await response.json()).data;
    };
    const login = async (runtime) =>
      (await api(runtime, "/api/auth/login", null, { phone, password })).token;
    const receipt = async (
      runtime,
      token,
      productId,
      quantity,
      cost,
      type = "RECEIPT",
    ) => {
      const draft = await api(
        runtime,
        "/api/admin/warehouse/documents",
        token,
        {
          type,
          warehouseId: 1,
          reference: "Merge isolated fixture",
          lines: [
            {
              productId: Number(productId),
              quantity: String(quantity),
              unitCost: String(cost),
            },
          ],
        },
      );
      const posted = await api(
        runtime,
        "/api/admin/warehouse/documents/" + draft.id + "/post",
        token,
        {},
      );
      assert.equal(posted.status, "POSTED");
      return posted.id;
    };
    const importer = createDataImporter({ runtime: target, version });
    const progress = (message) => {
      if (
        !/^(Проверено файлов|Перенос данных продолжается|Объединяем)/.test(
          message,
        )
      )
        console.log(message);
    };
    await importer.captureBaseline();
    a = await connect(source);
    // Give the shared owner a known clock before copying its memberships.
    await a.query(
      "UPDATE users SET name='Shared merge administrator' WHERE id=1",
    );
    const createOrder = async (c, id, num, comment) =>
      c.query(
        "INSERT INTO orders(id,user_id,status,payment_status,payment_method,fulfillment_type,contact_phone,total,paid_total,order_number_date,daily_number,comment) VALUES($1,1,'NEW','PENDING','ON_RECEIPT','DELIVERY',$2,0,0,CURRENT_DATE,$3,$4)",
        [id, phone, num, comment],
      );
    const remoteWins = randomUUID(),
      localWins = randomUUID(),
      localOnly = randomUUID(),
      remoteOnly = randomUUID(),
      childOnly = randomUUID(),
      sourceRevision = randomUUID();
    await createOrder(a, remoteWins, 1, "original source");
    await createOrder(a, localWins, 2, "original local");
    await createOrder(a, childOnly, 3, "CHILD ROOT");
    await a.query(
      "INSERT INTO order_daily_counters(order_number_date,last_daily_number) VALUES(CURRENT_DATE,3)",
    );
    const category = (
      await a.query(
        "INSERT INTO categories(name_ru,name_kk,slug,active,sort_order) VALUES('Общий','Ортақ','shared-merge',true,0) RETURNING id::text",
      )
    ).rows[0];
    const sharedProduct = (
      await a.query(
        "INSERT INTO products(sku,name_ru,name_kk,price,wholesale_price,category_id,active) VALUES('MERGE-SHARED','Общий товар','Тауар',1,1,$1,true) RETURNING id::text",
        [category.id],
      )
    ).rows[0];
    for (const orderId of [remoteWins, localWins]) {
      await a.query(
        "INSERT INTO order_items(order_id,product_id,sku,name_ru,unit_price,quantity,line_total,confirmed_unit_price,confirmed_line_total) VALUES($1,$2,'MERGE-SHARED','Общий товар',1,1,1,1,1)",
        [orderId, sharedProduct.id],
      );
      await a.query("UPDATE orders SET total=1 WHERE id=$1", [orderId]);
    }
    const child = (
      await a.query(
        "INSERT INTO order_items(order_id,product_id,sku,name_ru,unit_price,quantity,line_total,confirmed_unit_price,confirmed_line_total) VALUES($1,$2,'MERGE-SHARED','Общий товар',1,1,1,1,1) RETURNING id::text",
        [childOnly, sharedProduct.id],
      )
    ).rows[0];
    await a.query("UPDATE orders SET total=1 WHERE id=$1", [childOnly]);
    await a.query(
      "UPDATE sync_rows SET modified_at=NULL,observed_at=NULL WHERE table_name='order_items' AND pk=jsonb_build_object('id',$1::text)",
      [child.id],
    );
    const sourceToken = await login(source);
    await receipt(
      source,
      sourceToken,
      sharedProduct.id,
      5,
      10,
      "OPENING_BALANCE",
    );
    console.log("Initial v2 import begins");
    await importer.importFromSource({
      url: source.url,
      phone,
      password,
      onProgress: progress,
    });
    console.log("Initial v2 import passed");
    b = await connect(target);
    const recreatedRole = (
      await a.query(
        "SELECT role_id::text FROM user_roles WHERE user_id=1 ORDER BY role_id LIMIT 1",
      )
    ).rows[0].role_id;
    // Force the live incarnation to sort before its historical deletion in
    // JSONL. Archive order must never decide which membership survives.
    await a.query("DELETE FROM user_roles WHERE user_id=1 AND role_id=$1", [
      recreatedRole,
    ]);
    await a.query("INSERT INTO user_roles(user_id,role_id) VALUES(1,$1)", [
      recreatedRole,
    ]);
    await a.query(
      "UPDATE sync_rows SET uid='00000000-0000-0000-0000-000000000001'::uuid WHERE table_name='user_roles' AND pk=jsonb_build_object('user_id','1','role_id',$1::text) AND NOT deleted",
      [recreatedRole],
    );
    const newUser = async (client, name, number) =>
      (
        await client.query(
          "INSERT INTO users(name,email,phone,password_hash,active) SELECT $1::text,$1::text||'@isolated.invalid',$2,password_hash,true FROM users WHERE id=1 RETURNING id::text",
          [name, number],
        )
      ).rows[0].id;
    const localUser = await newUser(b, "local-user", "+70000000006");
    const sourceUser = await newUser(a, "source-user", "+70000000007");
    assert.equal(
      localUser,
      sourceUser,
      "independent user numeric ID collision",
    );
    for (const [client, userId] of [
      [b, localUser],
      [a, sourceUser],
    ])
      await client.query(
        "INSERT INTO user_roles(user_id,role_id) SELECT $1,role_id FROM user_roles WHERE user_id=1 ORDER BY role_id LIMIT 1",
        [userId],
      );
    const localGrantUid = (
      await b.query(
        "SELECT uid::text FROM sync_rows WHERE table_name='user_roles' AND pk=jsonb_build_object('user_id',$1::text,'role_id',(SELECT role_id::text FROM user_roles WHERE user_id=$1::bigint LIMIT 1)) AND NOT deleted",
        [localUser],
      )
    ).rows[0].uid;
    await createOrder(b, localOnly, 4, "LOCAL ONLY");
    await b.query(
      "UPDATE order_daily_counters SET last_daily_number=4 WHERE order_number_date=CURRENT_DATE",
    );
    // A later root edit decides the whole order, even if the other side has
    // a newer individual child. Mixing that child with the winning total is unsafe.
    await a.query(
      "UPDATE order_items SET quantity=2,line_total=2,confirmed_line_total=2 WHERE order_id=$1",
      [localWins],
    );
    await a.query("UPDATE orders SET total=2 WHERE id=$1", [localWins]);
    await a.query(
      "UPDATE orders SET comment='site first',updated_at=clock_timestamp() WHERE id=$1",
      [localWins],
    );
    await b.query(
      "UPDATE orders SET comment='LOCAL NEWER',updated_at=clock_timestamp() WHERE id=$1",
      [localWins],
    );
    await b.query(
      "UPDATE order_items SET quantity=3,line_total=3,confirmed_line_total=3 WHERE order_id=$1",
      [remoteWins],
    );
    await b.query("UPDATE orders SET total=3 WHERE id=$1", [remoteWins]);
    await b.query(
      "UPDATE orders SET comment='local first',updated_at=clock_timestamp() WHERE id=$1",
      [remoteWins],
    );
    await a.query(
      "UPDATE orders SET comment='SITE NEWER',updated_at=clock_timestamp() WHERE id=$1",
      [remoteWins],
    );
    // Independent integer sequences produce the same PK for different new records.
    const localCategory = (
      await b.query(
        "INSERT INTO categories(name_ru,name_kk,slug,active,sort_order) VALUES('Локальный','Жергілікті','local-only-merge',true,0) RETURNING id::text",
      )
    ).rows[0];
    const remoteCategory = (
      await a.query(
        "INSERT INTO categories(name_ru,name_kk,slug,active,sort_order) VALUES('Сайт новый','Сайт жаңа','remote-only-merge',true,0) RETURNING id::text",
      )
    ).rows[0];
    assert.equal(
      localCategory.id,
      remoteCategory.id,
      "actual independent numeric-ID collision",
    );
    await a.query(
      "INSERT INTO products(sku,name_ru,name_kk,price,wholesale_price,category_id,active) VALUES('MERGE-NEW','Сайтовый товар','Тауар',12.34,11.00,$1,true)",
      [remoteCategory.id],
    );
    await createOrder(a, remoteOnly, 4, "REMOTE ONLY");
    await a.query(
      "UPDATE order_daily_counters SET last_daily_number=4 WHERE order_number_date=CURRENT_DATE",
    );
    await b.query(
      "INSERT INTO products(sku,name_ru,name_kk,price,wholesale_price,category_id,active) VALUES('MERGE-LOCAL','Локальный товар','Тауар',7.89,7.00,$1,true)",
      [localCategory.id],
    );
    await b.query(
      "INSERT INTO order_items(order_id,product_id,sku,name_ru,unit_price,quantity,line_total,confirmed_unit_price,confirmed_line_total) SELECT $1,id,sku,name_ru,1,1,1,1,1 FROM products WHERE sku='MERGE-LOCAL'",
      [localOnly],
    );
    await a.query(
      "INSERT INTO order_items(order_id,product_id,sku,name_ru,unit_price,quantity,line_total,confirmed_unit_price,confirmed_line_total) SELECT $1,id,sku,name_ru,1,1,1,1,1 FROM products WHERE sku='MERGE-NEW'",
      [remoteOnly],
    );
    await b.query("UPDATE orders SET total=1 WHERE id=$1", [localOnly]);
    await a.query("UPDATE orders SET total=1 WHERE id=$1", [remoteOnly]);
    await a.query(
      "UPDATE order_items SET name_ru='Изменённая позиция сайта' WHERE id=$1",
      [child.id],
    );
    const localReceipt = await receipt(
      target,
      await login(target),
      sharedProduct.id,
      2,
      12,
    );
    const sourceReceipt = await receipt(
      source,
      sourceToken,
      sharedProduct.id,
      3,
      13,
    );
    await a.query(
      "INSERT INTO stock_ledger_revisions(id,replay_id,movement_id,before_quantity,after_quantity,before_unit_cost,after_unit_cost) SELECT $1,$2,id,quantity,quantity,unit_cost,unit_cost FROM stock_movements WHERE document_id=$3 LIMIT 1",
      [sourceRevision, randomUUID(), sourceReceipt],
    );
    const credit = async (client, amount, note) => {
      await client.query("BEGIN");
      try {
        const wallet = (
          await client.query(
            "UPDATE wallets SET balance=balance+$1::numeric WHERE user_id=1 RETURNING id,balance::text",
            [amount],
          )
        ).rows[0];
        await client.query(
          "INSERT INTO wallet_transactions(wallet_id,type,amount,balance_after,actor_user_id,comment,created_at) VALUES($1,'CREDIT',$2,$3,1,$4,clock_timestamp())",
          [wallet.id, amount, wallet.balance, note],
        );
        await client.query("COMMIT");
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      }
    };
    await credit(b, "50.00", "LOCAL CREDIT");
    await credit(a, "100.00", "SOURCE CREDIT");
    await a.query(
      "UPDATE users SET name='Newer site administrator' WHERE id=1",
    );
    await b.end();
    b = null;
    const result = await importer.importFromSource({
      url: source.url,
      phone,
      password,
      mode: "merge",
      onProgress: progress,
    });
    assert.equal(result.imported, true);
    b = await connect(target);
    assert.equal(
      (
        await b.query(
          "SELECT count(*)::int n FROM user_roles WHERE user_id=1 AND role_id=$1",
          [recreatedRole],
        )
      ).rows[0].n,
      1,
      "a recreated site grant survives its old tombstone regardless of UID order",
    );
    assert.equal(
      (
        await b.query(
          "SELECT count(*)::int n FROM sync_rows WHERE table_name='user_roles' AND pk=jsonb_build_object('user_id','1','role_id',$1::text) AND NOT deleted",
          [recreatedRole],
        )
      ).rows[0].n,
      1,
      "recreated membership retains one active local identity",
    );
    const orders = (await b.query("SELECT id::text,comment FROM orders")).rows;
    const comments = new Map(orders.map((row) => [row.id, row.comment]));
    const remappedUser = (
      await b.query("SELECT id::text FROM users WHERE name='source-user'")
    ).rows[0]?.id;
    assert.ok(remappedUser, "new source user with colliding ID added");
    assert.notEqual(remappedUser, localUser);
    assert.equal(
      (
        await b.query(
          "SELECT count(*)::int n FROM user_roles WHERE user_id=ANY($1::bigint[])",
          [[localUser, remappedUser]],
        )
      ).rows[0].n,
      2,
      "both independently created users keep their role links",
    );
    assert.equal(
      (
        await b.query(
          "SELECT pk->>'user_id' AS user_id FROM sync_rows WHERE uid=$1::uuid AND NOT deleted",
          [localGrantUid],
        )
      ).rows[0].user_id,
      localUser,
      "FK remap does not steal the old composite grant UID",
    );
    assert.notEqual(
      (
        await b.query(
          "SELECT uid::text FROM sync_rows WHERE table_name='user_roles' AND pk->>'user_id'=$1 AND NOT deleted",
          [remappedUser],
        )
      ).rows[0].uid,
      localGrantUid,
      "new remapped composite grant has its own UID",
    );
    assert.equal(
      comments.get(localOnly),
      "LOCAL ONLY",
      "local-only order retained",
    );
    assert.equal(
      comments.get(remoteWins),
      "SITE NEWER",
      "newer website order applied",
    );
    assert.equal(
      comments.get(localWins),
      "LOCAL NEWER",
      "newer desktop order retained",
    );
    for (const orderId of [remoteWins, localWins]) {
      const coherent = (
        await b.query(
          "SELECT o.total::text,i.quantity::text,i.line_total::text FROM orders o JOIN order_items i ON i.order_id=o.id WHERE o.id=$1",
          [orderId],
        )
      ).rows[0];
      assert.equal(Number(coherent.total), 1, "winning order total retained");
      assert.equal(
        Number(coherent.quantity),
        1,
        "winning order composition retained",
      );
      assert.equal(
        Number(coherent.line_total),
        1,
        "winning item amount matches total",
      );
    }
    assert.equal(
      comments.get(remoteOnly),
      "REMOTE ONLY",
      "new source order added despite daily-number collision",
    );
    assert.equal(
      (
        await b.query("SELECT name_ru FROM order_items WHERE order_id=$1", [
          childOnly,
        ])
      ).rows[0].name_ru,
      "Изменённая позиция сайта",
      "child-only modification advances unchanged order header",
    );
    assert.equal(
      (
        await b.query(
          "SELECT count(*)::int n FROM products WHERE sku IN ('MERGE-LOCAL','MERGE-NEW')",
        )
      ).rows[0].n,
      2,
      "both colliding product IDs preserved",
    );
    assert.equal(
      (
        await b.query(
          "SELECT p.sku FROM order_items i JOIN products p ON p.id=i.product_id WHERE i.order_id=$1",
          [remoteOnly],
        )
      ).rows[0].sku,
      "MERGE-NEW",
      "new order item collision remaps product FK",
    );
    assert.equal(
      (
        await b.query(
          "SELECT p.sku FROM order_items i JOIN products p ON p.id=i.product_id WHERE i.order_id=$1",
          [localOnly],
        )
      ).rows[0].sku,
      "MERGE-LOCAL",
      "local-only order item remains linked to its own product",
    );
    const categories = (
      await b.query(
        "SELECT id::text,slug FROM categories WHERE slug IN ('local-only-merge','remote-only-merge')",
      )
    ).rows;
    assert.equal(
      categories.length,
      2,
      "both colliding-ID categories preserved",
    );
    assert.notEqual(categories[0].id, categories[1].id);
    const linked = (
      await b.query(
        "SELECT c.slug FROM products p JOIN categories c ON c.id=p.category_id WHERE p.sku='MERGE-NEW'",
      )
    ).rows;
    assert.equal(
      linked[0].slug,
      "remote-only-merge",
      "new product FK remapped to source category",
    );
    assert.equal(
      (
        await b.query(
          "SELECT count(*)::int n FROM stock_documents WHERE id=ANY($1::uuid[]) AND status='POSTED'",
          [[localReceipt, sourceReceipt]],
        )
      ).rows[0].n,
      2,
      "source and local posted receipts retained: " +
        JSON.stringify(result.merge?.conflicts),
    );
    assert.equal(
      Number(
        (
          await b.query(
            "SELECT SUM(remaining_quantity)::text n FROM stock_cost_layers WHERE warehouse_id=1 AND product_id=$1",
            [sharedProduct.id],
          )
        ).rows[0].n,
      ),
      10,
      "FIFO rebuilt from both receipt histories",
    );
    assert.equal(
      (
        await b.query(
          "SELECT d.id::text FROM stock_ledger_revisions r JOIN stock_movements m ON m.id=r.movement_id JOIN stock_documents d ON d.id=m.document_id WHERE r.id=$1",
          [sourceRevision],
        )
      ).rows[0]?.id,
      sourceReceipt,
      "source warehouse audit revision resolves its approved movement pair",
    );
    const balances = await api(
      target,
      "/api/admin/warehouse/balances",
      await login(target),
    );
    assert.equal(
      balances.find((row) => String(row.productId) === sharedProduct.id).onHand,
      10,
      "actual warehouse API shows combined stock",
    );
    assert.equal(
      (await b.query("SELECT balance::text FROM wallets WHERE user_id=1"))
        .rows[0].balance,
      "150.00",
      "merged ledger preserves both credits",
    );
    assert.equal(
      (await b.query("SELECT count(*)::int n FROM wallet_transactions")).rows[0]
        .n,
      2,
      "no credit is lost through numeric PK collision",
    );
    assert.equal(
      (await a.query("SELECT balance::text FROM wallets WHERE user_id=1"))
        .rows[0].balance,
      "100.00",
      "source untouched",
    );
    await b.end();
    b = null;
    await a.query("DELETE FROM order_items WHERE id=$1", [child.id]);
    await a.query("UPDATE orders SET total=0 WHERE id=$1", [childOnly]);
    const repeated = await importer.importFromSource({
      url: source.url,
      phone,
      password,
      mode: "merge",
      onProgress: progress,
    });
    assert.equal(repeated.merge?.inserted, 0, "repeat is idempotent");
    b = await connect(target);
    assert.equal(
      (await b.query("SELECT count(*)::int n FROM orders")).rows[0].n,
      5,
    );
    assert.equal(
      (
        await a.query("SELECT count(*)::int n FROM orders WHERE id=$1", [
          localOnly,
        ])
      ).rows[0].n,
      0,
      "no desktop writes to source",
    );
    assert.equal(
      (
        await b.query(
          "SELECT count(*)::int n FROM order_items WHERE order_id=$1",
          [childOnly],
        )
      ).rows[0].n,
      0,
      "explicit newer tombstone removes owned child only",
    );
    assert.ok(result.backup, "pre-merge backup saved");
    // A later import must compare immutable journal facts, not derived balance_after
    // values previously recomputed from both copies.
    await b.end();
    b = null;
    await credit(a, "25.00", "SOURCE CREDIT AFTER CHECKPOINT");
    const incremental = await importer.importFromSource({
      url: source.url,
      phone,
      password,
      mode: "merge",
      onProgress: progress,
    });
    b = await connect(target);
    assert.equal(
      (await b.query("SELECT balance::text FROM wallets WHERE user_id=1"))
        .rows[0].balance,
      "175.00",
      "later source credit joins the previously reconciled journal: " +
        JSON.stringify(incremental.merge?.conflicts),
    );
    assert.equal(
      (await b.query("SELECT count(*)::int n FROM wallet_transactions")).rows[0]
        .n,
      3,
      "incremental update preserves both old credits and adds one new credit",
    );
    // Exercise a failure after SQL/files and backend restart, while the pending
    // recovery journal still protects the old local copy. A wrong native secret
    // is rejected by the real reconciliation endpoint without any writes.
    await b.end();
    b = null;
    await credit(a, "10.00", "SOURCE CREDIT FOR ROLLBACK");
    const originalStart = target.start.bind(target);
    let rejectFirstReconciliation = true;
    target.start = async (...args) => {
      const started = await originalStart(...args);
      if (rejectFirstReconciliation) {
        rejectFirstReconciliation = false;
        target.controlToken = "isolated-fixture-invalid-control-token";
      }
      return started;
    };
    try {
      await assert.rejects(async () => {
        const unexpected = await importer.importFromSource({
          url: source.url,
          phone,
          password,
          mode: "merge",
          onProgress: progress,
        });
        console.log(
          "Unexpected isolated reconciliation result",
          JSON.stringify(unexpected.merge),
        );
      }, /Локальные данные восстановлены из резервной копии/);
    } finally {
      target.start = originalStart;
    }
    b = await connect(target);
    assert.equal(
      (await b.query("SELECT balance::text FROM wallets WHERE user_id=1"))
        .rows[0].balance,
      "175.00",
      "failed post-restart reconciliation restores the old balance",
    );
    assert.equal(
      (await b.query("SELECT count(*)::int n FROM wallet_transactions")).rows[0]
        .n,
      3,
      "failed merge restores the exact previous financial journal",
    );
    assert.equal(
      (await b.query("SELECT count(*)::int n FROM orders")).rows[0].n,
      5,
      "failed merge preserves local-only orders",
    );
    await assert.rejects(
      fs.access(path.join(target.userData, "data-import-pending.json")),
      { code: "ENOENT" },
      "successful recovery clears the pending journal",
    );
    console.log(
      "Native one-way merge passed: coherent winning orders, local-only records, colliding IDs, remapped FK, unique numbers, wallet 150 then 175, FIFO stock 10, idempotence and post-restart rollback.",
    );
  } catch (error) {
    for (const runtime of [source, target]) {
      const log = await fs
        .readFile(path.join(runtime.logsDir, "backend.log"), "utf8")
        .catch(() => "");
      const diagnostics = log
        .split(/\r?\n/)
        .filter(
          (line) =>
            /ERROR|Caused by:|Exception:/.test(line) &&
            !/password|token|secret|authorization/i.test(line),
        )
        .slice(-8);
      if (diagnostics.length)
        console.error(
          "Isolated backend diagnostics:\n" + diagnostics.join("\n"),
        );
    }
    throw error;
  } finally {
    if (a) await a.end().catch(() => {});
    if (b) await b.end().catch(() => {});
    await target.stop();
    await source.stop();
    await fs.rm(temporary, { recursive: true, force: true });
  }
}
if (require.main === module)
  main().catch((error) => {
    console.error(error.userMessage || error.message);
    process.exitCode = 1;
  });
module.exports = { main };
