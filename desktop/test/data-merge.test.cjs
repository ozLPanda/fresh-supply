const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const os = require("node:os");
const { createHash, randomUUID } = require("node:crypto");
const {
  timestampMicros,
  canonicalKey,
  chooseAction,
  preserveWalletTransactionProjection,
  chooseAggregateChildAction,
  provesLegacyIdentity,
  resolveCompositeIdentity,
  financialWarehousePair,
  readSyncRows,
  prepareMergedFiles,
  rewriteFileReferences,
  instantText,
  rewriteDocumentSnapshot,
} = require("../src/data-merge.cjs");

test("comparison retains microseconds lost by JavaScript Date and understands timezone offsets", () => {
  const early = timestampMicros("2026-10-13 09:45:12.123456+00");
  assert.equal(timestampMicros("2026-10-13T09:45:12.123457Z") - early, 1n);
  assert.equal(timestampMicros("2026-10-13 15:45:12.123456+06"), early);
  assert.equal(timestampMicros(early.toString()), early);
  assert.equal(timestampMicros("infinity"), null);
  assert.equal(
    instantText("2026-10-13 09:45:12.123456+00"),
    "2026-10-13T09:45:12.123456Z",
  );
});

test("newest record wins, equal/unknown disagreements preserve local, and child clocks can change an unchanged header", () => {
  const row = { id: "1", name: "same" };
  assert.equal(
    chooseAction(
      { modifiedAt: "101", deleted: false },
      { modifiedAt: "100", deleted: false },
      row,
      row,
    ),
    "update",
  );
  assert.equal(
    chooseAction(
      { modifiedAt: "100", deleted: false },
      { modifiedAt: "101", deleted: false },
      { name: "source" },
      { name: "local" },
    ),
    "keep",
  );
  assert.equal(
    chooseAction(
      { modifiedAt: "100", deleted: false },
      { modifiedAt: "100", deleted: false },
      { name: "source" },
      { name: "local" },
    ),
    "conflict-equal-clock",
  );
  assert.equal(
    chooseAction(
      { modifiedAt: null, deleted: false },
      { modifiedAt: null, deleted: false },
      { name: "source" },
      { name: "local" },
    ),
    "conflict-unknown-clock",
  );
  assert.equal(
    chooseAction(
      { modifiedAt: null, deleted: false },
      null,
      { name: "source" },
      undefined,
    ),
    "insert",
  );
  assert.equal(
    chooseAction(
      { modifiedAt: "101", deleted: true },
      { modifiedAt: "100", deleted: false },
      undefined,
      row,
    ),
    "delete",
  );
  assert.equal(
    chooseAction(
      { modifiedAt: "101", deleted: true },
      null,
      undefined,
      undefined,
    ),
    "keep",
  );
});

test("v2 copied child with a shared UID and no local mutation accepts a newly tracked source edit", () => {
  const uid = randomUUID();
  const local = {
    uid,
    modifiedAt: null,
    observedAt: null,
    deleted: false,
    generation: 1,
  };
  const source = {
    uid,
    modifiedAt: "1234567890123456",
    observedAt: "1234567890123456",
    deleted: false,
    generation: 2,
  };
  assert.equal(
    chooseAction(source, local, { quantity: "2" }, { quantity: "1" }),
    "update",
  );
  assert.equal(
    chooseAction({ ...source, deleted: true }, local, undefined, {
      quantity: "1",
    }),
    "delete",
  );
  assert.equal(
    chooseAction(
      { ...source, uid: randomUUID() },
      local,
      { quantity: "2" },
      { quantity: "1" },
    ),
    "conflict-unknown-clock",
  );
});

test("approved common wallet events compare immutable facts without conflicting on reconciled prefix balances", () => {
  const sourceRow = {
    id: "2",
    wallet_id: "1",
    type: "CREDIT",
    amount: "100.00",
    balance_after: "100.00",
    comment: "original",
  };
  const localRow = { ...sourceRow, balance_after: "150.00" };
  const clock = { modifiedAt: "100", deleted: false };
  const normalized = preserveWalletTransactionProjection(
    sourceRow,
    localRow,
    true,
  );
  assert.equal(chooseAction(clock, clock, normalized, localRow), "unchanged");
  assert.equal(sourceRow.balance_after, "100.00");
  assert.equal(normalized.balance_after, "150.00");
  const nextProjection = preserveWalletTransactionProjection(
    sourceRow,
    { ...localRow, balance_after: "175.00" },
    true,
  );
  assert.equal(nextProjection.balance_after, "175.00");
  assert.equal(
    preserveWalletTransactionProjection(sourceRow, localRow, false),
    sourceRow,
  );
  assert.equal(
    preserveWalletTransactionProjection(sourceRow, undefined, true),
    sourceRow,
  );
  assert.equal(
    preserveWalletTransactionProjection(
      sourceRow,
      { ...localRow, wallet_id: "9" },
      true,
    ),
    sourceRow,
  );
  const changedComment = preserveWalletTransactionProjection(
    { ...sourceRow, comment: "updated" },
    localRow,
    true,
  );
  assert.equal(
    chooseAction(clock, clock, changedComment, localRow),
    "conflict-equal-clock",
  );
  assert.equal(
    chooseAction(
      { ...clock, modifiedAt: "101" },
      clock,
      changedComment,
      localRow,
    ),
    "update",
  );
  assert.equal(changedComment.comment, "updated");
  assert.equal(changedComment.balance_after, "150.00");
});

test("tracked aggregate winner replaces ordinary mapped members instead of mixing headers and local quantities", () => {
  const key = { id: randomUUID() };
  const root = {
    source: { table: "orders", modifiedAt: "25" },
    local: { modifiedAt: "24" },
    targetKey: key,
  };
  const source = { table: "order_items", modifiedAt: "10", deleted: false };
  const local = {
    modifiedAt: "24",
    deleted: false,
    aggregate: { table: "orders", key },
  };
  const sourceRow = { quantity: "2" },
    localRow = { quantity: "3" };
  const retained = chooseAction(source, local, sourceRow, localRow);
  assert.equal(retained, "keep");
  assert.equal(
    chooseAggregateChildAction(
      root,
      source,
      local,
      sourceRow,
      localRow,
      retained,
    ),
    "update",
  );
  assert.equal(
    chooseAggregateChildAction(
      root,
      { ...source, deleted: true },
      local,
      undefined,
      localRow,
      "keep",
    ),
    "delete",
  );
  assert.equal(
    chooseAggregateChildAction(
      root,
      source,
      local,
      sourceRow,
      localRow,
      "conflict-equal-clock",
    ),
    "update",
  );
  assert.equal(
    chooseAggregateChildAction(
      { ...root, local: { modifiedAt: "26" } },
      source,
      local,
      sourceRow,
      localRow,
      retained,
    ),
    "keep",
  );
  assert.equal(
    chooseAggregateChildAction(
      { ...root, local: { modifiedAt: null, observedAt: "24" } },
      source,
      local,
      sourceRow,
      localRow,
      retained,
    ),
    "keep",
  );
  assert.equal(
    chooseAggregateChildAction(
      root,
      source,
      { ...local, aggregate: { table: "orders", key: { id: randomUUID() } } },
      sourceRow,
      localRow,
      retained,
    ),
    "conflict-aggregate-owner",
  );
  for (const table of [
    "wallet_transactions",
    "stock_movements",
    "stock_cost_layers",
    "stock_document_versions",
    "product_search_embeddings",
  ])
    assert.equal(
      chooseAggregateChildAction(
        root,
        { ...source, table },
        local,
        sourceRow,
        localRow,
        retained,
      ),
      "keep",
    );
});

test("legacy matching never treats a colliding number or article as proof of identity", () => {
  const key = { id: "9007199254740993" };
  assert.equal(
    provesLegacyIdentity(
      ["id"],
      key,
      { created_at: "2026-10-13 09:00:00+00" },
      { created_at: "2026-10-13 09:00:00.000001+00" },
    ),
    false,
  );
  assert.equal(
    provesLegacyIdentity(["id"], key, { sku: "same" }, { sku: "same" }),
    false,
  );
  assert.equal(
    provesLegacyIdentity(
      ["id"],
      key,
      { created_at: "2026-10-13 09:00:00+00" },
      { created_at: "2026-10-13T09:00:00Z" },
    ),
    true,
  );
  assert.equal(
    provesLegacyIdentity(
      ["id"],
      { id: randomUUID() },
      { id: "source" },
      { id: "local" },
    ),
    true,
  );
  assert.equal(
    canonicalKey({ role_id: "2", user_id: "9007199254740993" }),
    "{" + '"role_id":"2","user_id":"9007199254740993"' + "}",
  );
  assert.throws(() => canonicalKey({ id: 9007199254740993 }), /Некорректный/);
});

test("composite grants bind to remapped owner identity without stealing the equal raw-key local grant", () => {
  const oldGrant = {
    uid: randomUUID(),
    table: "user_roles",
    key: { user_id: "2", role_id: "1" },
    modifiedAt: "24",
    deleted: false,
  };
  const source = {
    uid: randomUUID(),
    table: "user_roles",
    key: { user_id: "2", role_id: "1" },
    modifiedAt: "10",
    deleted: false,
  };
  const plan = {
    source,
    local: oldGrant,
    localUid: oldGrant.uid,
    localExists: true,
  };
  const key = { user_id: "3", role_id: "1" };
  const resolved = resolveCompositeIdentity(plan, key, undefined, undefined);
  assert.equal(resolved.local, undefined);
  assert.equal(resolved.localUid, source.uid);
  assert.equal(resolved.localExists, false);
  assert.equal(resolved.movedIdentity, false);
  assert.equal(chooseAction(source, resolved.local, key, undefined), "insert");
  assert.equal(oldGrant.key.user_id, "2");
  const actualGrant = { ...oldGrant, uid: randomUUID(), key };
  const rebound = resolveCompositeIdentity(plan, key, key, actualGrant);
  assert.equal(rebound.local, actualGrant);
  assert.equal(rebound.localUid, actualGrant.uid);
  const tombstone = { ...actualGrant, deleted: true, modifiedAt: "30" };
  const removed = resolveCompositeIdentity(plan, key, undefined, tombstone);
  assert.equal(removed.local, tombstone);
  assert.equal(chooseAction(source, removed.local, key, undefined), "keep");
  const moved = resolveCompositeIdentity(
    { ...plan, source: { ...source, uid: oldGrant.uid } },
    key,
    undefined,
    undefined,
  );
  assert.equal(moved.movedIdentity, true);
  assert.equal(moved.local, undefined);
  const movedAlias = resolveCompositeIdentity(
    { ...plan, aliasedIdentity: true },
    key,
    undefined,
    undefined,
  );
  assert.equal(movedAlias.movedIdentity, true);
});

test("warehouse audit revisions require the approved pair of their actual immutable movement", () => {
  const movement = { id: randomUUID(), warehouse_id: "1", product_id: "2" };
  const revision = { id: randomUUID(), movement_id: movement.id };
  const resolve = (table, id) =>
    table === "warehouses" && id === "1"
      ? "3"
      : table === "products" && id === "2"
        ? "4"
        : null;
  assert.equal(
    financialWarehousePair(
      "stock_ledger_revisions",
      revision,
      movement,
      resolve,
    ),
    "3:4",
  );
  assert.equal(
    financialWarehousePair("stock_movements", movement, null, resolve),
    "3:4",
  );
  assert.equal(
    financialWarehousePair("stock_ledger_revisions", revision, null, resolve),
    null,
  );
  assert.equal(
    financialWarehousePair(
      "stock_ledger_revisions",
      revision,
      { ...movement, id: randomUUID() },
      resolve,
    ),
    null,
  );
  assert.equal(
    financialWarehousePair(
      "stock_ledger_revisions",
      revision,
      movement,
      () => null,
    ),
    null,
  );
});

test("history remaps only WarehouseService typed references and retains exact bigint and decimal JSON tokens", () => {
  const json =
    '{"warehouseId":9007199254740993,"priceOperationValue":0.1234567890123456789,"lines":[{"productId":9007199254740995,"quantity":1.234567890123456789,"unitCost":10.075000,"sourceDocumentId":null}],"purchaseAllocations":[]}';
  const rewritten = rewriteDocumentSnapshot(json, (table, key) =>
    table === "warehouses"
      ? "9007199254740999"
      : table === "products"
        ? "9007199254740997"
        : key.id,
  );
  assert.ok(rewritten.includes('"warehouseId":9007199254740999'));
  assert.ok(rewritten.includes('"productId":9007199254740997'));
  assert.ok(rewritten.includes('"priceOperationValue":0.1234567890123456789'));
  assert.ok(rewritten.includes('"quantity":1.234567890123456789'));
  assert.ok(rewritten.includes('"unitCost":10.075000'));
  assert.equal(
    rewriteDocumentSnapshot(json, (_table, key) => key.id),
    json,
  );
  assert.throws(() => rewriteDocumentSnapshot(json, () => null), /сопоставить/);
});

test("v2 identities enforce metadata completeness and bounds before local writes", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "merge-meta-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const file = path.join(root, "rows.jsonl");
  const row = {
    table: "orders",
    uid: randomUUID(),
    key: { id: randomUUID() },
    modifiedAt: "1000001",
    observedAt: null,
    deleted: false,
    generation: 1,
  };
  const archive = {
    manifest: {
      formatVersion: 2,
      sync: {
        instanceId: randomUUID(),
        entry: "sync/rows.jsonl",
        rowCount: 1,
        size: 1000,
      },
    },
    staged: new Map([["sync/rows.jsonl", file]]),
  };
  await fs.writeFile(file, JSON.stringify(row) + "\n");
  assert.equal((await readSyncRows(archive))[0].modifiedAt, "1000001");
  await assert.rejects(
    readSyncRows({ ...archive, manifest: { formatVersion: 1 } }),
    /обновите/,
  );
  await assert.rejects(readSyncRows(archive, 0), /объём/);
  for (const change of [
    { generation: 0 },
    { uid: "not-uuid" },
    { modifiedAt: "1.1" },
    { key: { id: 1 } },
  ]) {
    await fs.writeFile(file, JSON.stringify({ ...row, ...change }) + "\n");
    await assert.rejects(readSyncRows(archive));
  }
  await fs.writeFile(
    file,
    JSON.stringify(row) + "\n" + JSON.stringify(row) + "\n",
  );
  await assert.rejects(readSyncRows(archive), /Повреждены/);
});

test("file union preserves local-only data and aliases conflicting keys without replacing retained objects", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "merge-files-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const old = path.join(root, "old"),
    union = path.join(root, "union");
  await fs.mkdir(old);
  const digest = (value) => createHash("sha256").update(value).digest("hex");
  const key = "uploads/photo.png",
    existing = digest(key) + ".object";
  await fs.writeFile(path.join(old, existing), "old-photo");
  await fs.writeFile(
    path.join(old, digest("uploads/local-only.png") + ".object"),
    "local-only",
  );
  const source = path.join(root, "source.object");
  await fs.writeFile(source, "new-photo");
  const archive = {
    manifest: {
      sync: { instanceId: randomUUID() },
      files: [
        { key, entry: "files/photo.object", sha256: digest("new-photo") },
      ],
    },
    staged: new Map([["files/photo.object", source]]),
  };
  const keys = await prepareMergedFiles({
    archive,
    currentDirectory: old,
    destination: union,
  });
  assert.notEqual(keys.get(key), key);
  assert.equal(
    await fs.readFile(path.join(union, existing), "utf8"),
    "old-photo",
  );
  assert.equal(
    await fs.readFile(
      path.join(union, digest(keys.get(key)) + ".object"),
      "utf8",
    ),
    "new-photo",
  );
  assert.equal(
    await fs.readFile(
      path.join(union, digest("uploads/local-only.png") + ".object"),
      "utf8",
    ),
    "local-only",
  );
  assert.equal(
    rewriteFileReferences(
      "product_images",
      { file_path: "/uploads/photo.png" },
      keys,
    ).file_path,
    "/" + keys.get(key),
  );
  const again = path.join(root, "again");
  const repeated = await prepareMergedFiles({
    archive,
    currentDirectory: union,
    destination: again,
  });
  assert.equal(repeated.get(key), keys.get(key));
  assert.equal((await fs.readdir(again)).length, 3);
});
