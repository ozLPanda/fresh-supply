"use strict";
const fs = require("node:fs/promises");
const { createReadStream } = require("node:fs");
const path = require("node:path");
const { createHash, randomUUID } = require("node:crypto");
const { createInterface } = require("node:readline");

const UUID = /^[a-f\d]{8}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{12}$/i;
const quote = (name) => '"' + name.replaceAll('"', '""') + '"';
const tableSql = (name) => '"public".' + quote(name);
const keyString = (table, key) => table + ":" + canonicalKey(key);
const FINANCIAL_TABLES = new Set([
  "wallets",
  "wallet_transactions",
  "stock_movements",
  "stock_cost_layers",
  "stock_reservations",
  "stock_ledger_revisions",
  "warehouse_price_baselines",
]);
const SEMANTIC_KEYS = {
  permissions: "code",
  roles: "code",
  warehouses: "code",
  project_settings: "key",
};
const DERIVED_TABLES = new Set([
  "product_search_embeddings",
  "category_search_embeddings",
  "order_daily_counters",
]);

function failure(message) {
  return Object.assign(new Error(message), { userMessage: message });
}
function canonicalKey(key) {
  if (
    !key ||
    typeof key !== "object" ||
    Array.isArray(key) ||
    !Object.keys(key).length
  )
    throw failure("Некорректный идентификатор строки для объединения.");
  const sorted = {};
  for (const name of Object.keys(key).sort()) {
    if (
      !/^[a-z_][a-z\d_]*$/.test(name) ||
      typeof key[name] !== "string" ||
      !key[name].isWellFormed()
    )
      throw failure("Некорректный идентификатор строки для объединения.");
    sorted[name] = key[name];
  }
  return JSON.stringify(sorted);
}

/** Preserve PostgreSQL microseconds; JS Date is used only for whole seconds. */
function timestampMicros(value) {
  if (value === null || value === undefined) return null;
  if (typeof value !== "string") return null;
  if (/^-?\d{1,19}$/.test(value)) return BigInt(value);
  const match =
    /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2})(?:\.(\d{1,6}))?(Z|[+-]\d{2}(?::?\d{2})?)$/.exec(
      value,
    );
  if (!match) return null;
  let zone = match[4];
  if (/^[+-]\d{2}$/.test(zone)) zone += ":00";
  if (/^[+-]\d{4}$/.test(zone)) zone = zone.slice(0, 3) + ":" + zone.slice(3);
  const seconds = Date.parse(match[1] + "T" + match[2] + zone);
  if (!Number.isFinite(seconds)) return null;
  return BigInt(seconds) * 1000n + BigInt((match[3] || "").padEnd(6, "0"));
}

function effectiveClock(record, row) {
  return (
    timestampMicros(record?.modifiedAt) ??
    timestampMicros(record?.observedAt) ??
    timestampMicros(row?.updated_at)
  );
}
function sameRows(left, right) {
  if (!left || !right) return left === right;
  const columns = Object.keys(left).sort();
  return (
    columns.length === Object.keys(right).length &&
    columns.every((column) => left[column] === right[column])
  );
}
function preserveWalletTransactionProjection(sourceRow, localRow, approved) {
  if (
    !approved ||
    !sourceRow ||
    !localRow ||
    sourceRow.wallet_id !== localRow.wallet_id
  )
    return sourceRow;
  // Preflight has proved the immutable event. balance_after belongs to the
  // reconciled union, so the website's original prefix is not a competing edit.
  return { ...sourceRow, balance_after: localRow.balance_after };
}
function chooseAction(source, local, sourceRow, localRow) {
  if (!local) return source.deleted ? "keep" : "insert";
  if (source.deleted && local.deleted) return "unchanged";
  const sourceClock = effectiveClock(source, sourceRow),
    localClock = effectiveClock(local, localRow);
  // A common UID was copied with v2. NULL tracking clocks then prove that the
  // local row has never been edited since that copy; numeric legacy aliases do not.
  if (
    source.uid &&
    source.uid === local.uid &&
    !local.deleted &&
    local.modifiedAt === null &&
    timestampMicros(local.observedAt) === null &&
    source.modifiedAt !== null &&
    sourceClock !== null
  )
    return source.deleted ? "delete" : "update";
  if (sourceClock !== null && localClock !== null && sourceClock > localClock)
    return source.deleted ? "delete" : "update";
  if (sourceClock !== null && localClock !== null && sourceClock < localClock)
    return "keep";
  if (!source.deleted && !local.deleted && sameRows(sourceRow, localRow))
    return "unchanged";
  if (sourceClock === null || localClock === null)
    return "conflict-unknown-clock";
  if (sourceClock === localClock) return "conflict-equal-clock";
  return source.deleted ? "delete" : "update";
}
const INDEPENDENT_CHILD_TABLES = new Set([
  ...FINANCIAL_TABLES,
  ...DERIVED_TABLES,
  "stock_document_versions",
]);

/** A tracked owner clock describes the whole ordinary aggregate snapshot. */
function chooseAggregateChildAction(
  root,
  source,
  local,
  sourceRow,
  localRow,
  action,
) {
  if (!root?.local || !local || INDEPENDENT_CHILD_TABLES.has(source.table))
    return action;
  const sourceClock = timestampMicros(root.source.modifiedAt),
    localClock = timestampMicros(root.local.modifiedAt);
  // Historical observedAt is useful for root LWW, but cannot prove that every
  // owned member participated in that clock. Never manufacture that guarantee.
  if (sourceClock === null || localClock === null || sourceClock <= localClock)
    return action;
  if (
    !local.aggregate ||
    local.aggregate.table !== root.source.table ||
    canonicalKey(local.aggregate.key) !== canonicalKey(root.targetKey)
  )
    return "conflict-aggregate-owner";
  if (source.deleted) return local.deleted ? "unchanged" : "delete";
  return localRow ? "update" : "insert";
}
function provesLegacyIdentity(primaryColumns, sourceKey, sourceRow, localRow) {
  if (!sourceRow || !localRow) return false;
  if (
    primaryColumns.length === 1 &&
    UUID.test(sourceKey[primaryColumns[0]] || "")
  )
    return true;
  return Boolean(
    sourceRow.created_at &&
    localRow.created_at &&
    timestampMicros(sourceRow.created_at) !== null &&
    timestampMicros(sourceRow.created_at) ===
      timestampMicros(localRow.created_at),
  );
}
function resolveCompositeIdentity(plan, key, localRow, identity) {
  const movedIdentity = Boolean(
    !localRow &&
    !identity &&
    plan.local &&
    (plan.local.uid === plan.source.uid || plan.aliasedIdentity) &&
    canonicalKey(plan.local.key) !== canonicalKey(key),
  );
  const local =
    identity ||
    (localRow
      ? {
          uid: randomUUID(),
          table: plan.source.table,
          key,
          deleted: false,
          modifiedAt: null,
          observedAt: localRow.updated_at || null,
          generation: 1,
        }
      : undefined);
  return {
    targetKey: key,
    local,
    localUid: local?.uid || plan.source.uid,
    localExists: Boolean(localRow),
    movedIdentity,
  };
}
function financialWarehousePair(table, row, movement, resolveId) {
  if (table === "stock_ledger_revisions") {
    if (!row?.movement_id || !movement || movement.id !== row.movement_id)
      return null;
    row = movement;
  }
  if (!row?.warehouse_id || !row?.product_id) return null;
  const warehouse = resolveId("warehouses", row.warehouse_id),
    product = resolveId("products", row.product_id);
  return warehouse && product ? warehouse + ":" + product : null;
}
function laterIncarnation(candidate, previous) {
  if (
    candidate.source.uid === previous.source.uid ||
    canonicalKey(candidate.source.key) !== canonicalKey(previous.source.key)
  )
    return false;
  const newer = timestampMicros(candidate.source.modifiedAt),
    older = timestampMicros(previous.source.modifiedAt);
  return (
    (candidate.source.generation > previous.source.generation &&
      (newer === null || older === null || newer >= older)) ||
    (newer !== null &&
      older !== null &&
      newer > older &&
      candidate.source.generation >= previous.source.generation)
  );
}
function resolveSourceLifecycles(plans) {
  const groups = new Map(),
    obsolete = new Set(),
    ambiguous = new Set();
  for (const plan of plans) {
    if (!plan.targetKey || plan.conflict) continue;
    const key = keyString(plan.source.table, plan.targetKey);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(plan);
  }
  for (const group of groups.values()) {
    if (group.length < 2 || !group.some((p) => p.source.deleted)) continue;
    const active = group.filter((p) => !p.source.deleted);
    const winner =
      active.length === 1
        ? active[0]
        : active.length
          ? null
          : group.find((candidate) =>
              group.every(
                (other) =>
                  other === candidate || laterIncarnation(candidate, other),
              ),
            );
    if (
      winner &&
      group.every(
        (other) =>
          other === winner ||
          (other.source.deleted && laterIncarnation(winner, other)),
      )
    )
      group.filter((p) => p !== winner).forEach((p) => obsolete.add(p));
    else group.forEach((p) => ambiguous.add(p));
  }
  return { obsolete, ambiguous };
}
function provenDeletedReference(plans, table, key) {
  return plans.find(
    (p) =>
      p.source.table === table &&
      p.source.deleted &&
      p.localExists &&
      p.local &&
      canonicalKey(p.source.key) === canonicalKey(key),
  );
}

async function readSyncRows(archive, maximumRows = 250_000) {
  const sync = archive.manifest.sync;
  if (
    archive.manifest.formatVersion !== 2 ||
    !UUID.test(sync?.instanceId || "") ||
    !archive.staged.has(sync?.entry)
  )
    throw failure(
      "Для объединения обновите бэкенд сайта: необходим экспорт версии 2.",
    );
  if (sync.rowCount > maximumRows || sync.size > 128 * 1024 ** 2)
    throw failure("Копия превышает допустимый объём метаданных объединения.");
  const result = [],
    seen = new Set(),
    active = new Set();
  const input = createReadStream(archive.staged.get(sync.entry));
  const lines = createInterface({ input, crlfDelay: Infinity });
  try {
    for await (const line of lines) {
      if (!line || Buffer.byteLength(line) > 1024 * 1024)
        throw failure("Повреждены метаданные объединения.");
      let item;
      try {
        item = JSON.parse(line);
      } catch {
        throw failure("Повреждены метаданные объединения.");
      }
      if (
        !item ||
        !/^[a-z_][a-z\d_]*$/.test(item.table || "") ||
        item.table.startsWith("sync_") ||
        !UUID.test(item.uid || "") ||
        seen.has(item.uid) ||
        typeof item.deleted !== "boolean" ||
        !Number.isSafeInteger(item.generation) ||
        item.generation < 1 ||
        (item.modifiedAt !== null &&
          !/^-?\d{1,19}$/.test(item.modifiedAt || "")) ||
        (item.observedAt != null && !/^-?\d{1,19}$/.test(item.observedAt))
      )
        throw failure("Повреждены метаданные объединения.");
      const key = keyString(item.table, item.key);
      if (!item.deleted && active.has(key))
        throw failure("Повторяющиеся строки в метаданных объединения.");
      seen.add(item.uid);
      if (!item.deleted) active.add(key);
      if (item.aggregate) {
        if (!/^[a-z_][a-z\d_]*$/.test(item.aggregate.table || ""))
          throw failure("Некорректная группа объединения.");
        canonicalKey(item.aggregate.key);
      }
      result.push(item);
      if (result.length > maximumRows)
        throw failure("Слишком много строк для объединения.");
    }
  } finally {
    lines.close();
    input.destroy();
  }
  if (result.length !== sync.rowCount)
    throw failure("Число метаданных не совпадает с архивом.");
  return result;
}

async function hashFile(file) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest("hex");
}

/** Stage a union, preserving every old object and using immutable aliases on collisions. */
async function prepareMergedFiles({ archive, currentDirectory, destination }) {
  await fs.mkdir(destination, { recursive: true });
  if ((await fs.readdir(destination)).length)
    throw failure("Каталог подготовки объединения уже содержит файлы.");
  for (const name of await fs.readdir(currentDirectory)) {
    const stat = await fs.lstat(path.join(currentDirectory, name));
    if (!stat.isFile() || stat.isSymbolicLink())
      throw failure("Локальное хранилище содержит неподдерживаемый файл.");
  }
  await fs.cp(currentDirectory, destination, { recursive: true, force: false });
  const keys = new Map();
  for (const item of archive.manifest.files) {
    const source = archive.staged.get(item.entry);
    let key = item.key;
    const filename = (value) =>
      createHash("sha256").update(value).digest("hex") + ".object";
    let target = path.join(destination, filename(key));
    try {
      if ((await hashFile(target)) !== item.sha256) {
        const digest = createHash("sha256")
          .update(
            archive.manifest.sync.instanceId + "\0" + key + "\0" + item.sha256,
          )
          .digest("hex");
        key =
          "uploads/merged/" +
          digest +
          "-" +
          path.posix.basename(key).slice(-180);
        target = path.join(destination, filename(key));
        try {
          if ((await hashFile(target)) !== item.sha256)
            throw failure("Конфликт файлов объединения.");
        } catch (error) {
          if (error.code !== "ENOENT") throw error;
          await fs.copyFile(source, target);
        }
      }
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
      await fs.copyFile(source, target);
    }
    keys.set(item.key, key);
  }
  return keys;
}

function rewriteFileReferences(table, row, keys) {
  const field = {
    categories: "image_file_path",
    product_images: "file_path",
    review_images: "file_path",
    procurement_files: "file_path",
  }[table];
  if (!field || !row[field]?.startsWith("/uploads/")) return row;
  const key = keys.get(row[field].slice(1));
  return key ? { ...row, [field]: "/" + key } : row;
}

function instantText(value) {
  if (typeof value !== "string" || timestampMicros(value) === null)
    throw failure("Некорректное время финансовой операции.");
  return value
    .replace(" ", "T")
    .replace(/\+00(?::?00)?$/, "Z")
    .replace(/([+-]\d{2})$/, "$1:00");
}

function rewriteDocumentSnapshot(text, resolve) {
  if (typeof JSON.rawJSON !== "function")
    throw failure(
      "Для точного переноса истории необходима новая версия приложения.",
    );
  let value;
  try {
    value = JSON.parse(text, (_key, item, context) =>
      typeof item === "number" ? JSON.rawJSON(context.source) : item,
    );
  } catch {
    throw failure("Некорректная история складского документа.");
  }
  if (!value || Array.isArray(value) || typeof value !== "object")
    throw failure("Некорректная история складского документа.");
  let changed = false;
  function field(object, name, table) {
    const old = object[name];
    if (old == null) return;
    const token = JSON.isRawJSON(old)
      ? old.rawJSON
      : typeof old === "string"
        ? old
        : null;
    if (token === null || (!UUID.test(token) && !/^\d+$/.test(token)))
      throw failure("Не удалось сопоставить историю складского документа.");
    const target = resolve(table, { id: token });
    if (!target)
      throw failure("Не удалось сопоставить историю складского документа.");
    if (target !== token) {
      object[name] = JSON.isRawJSON(old) ? JSON.rawJSON(target) : target;
      changed = true;
    }
  }
  field(value, "warehouseId", "warehouses");
  field(value, "counterpartyId", "warehouse_counterparties");
  field(value, "priceSettingGroupId", "price_setting_groups");
  field(value, "priceSourceDocumentId", "stock_documents");
  for (const line of value.lines || []) {
    field(line, "productId", "products");
    field(line, "sourceDocumentId", "stock_documents");
  }
  for (const allocation of value.purchaseAllocations || []) {
    field(allocation, "productId", "products");
    field(allocation, "sourceDocumentId", "stock_documents");
  }
  return changed ? JSON.stringify(value) : text;
}

async function controlRequest(runtime, action, body) {
  const endpoint = new URL("/__desktop/data-merge/" + action, runtime.url);
  if (
    !["127.0.0.1", "localhost", "[::1]"].includes(endpoint.hostname) ||
    !runtime.controlToken
  )
    throw failure("Локальная сверка объединения недоступна.");
  const response = await fetch(endpoint, {
    method: "POST",
    redirect: "error",
    headers: {
      "Content-Type": "application/json",
      "X-Ovoshi-Control": runtime.controlToken,
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(120000),
  });
  if (!response.ok)
    throw failure(
      "Локальная сверка объединения не пройдена. Данные сохранены.",
    );
  return response.json();
}

async function prepareFinancialMerge({
  client,
  archive,
  runtime,
  rowsFromFile,
  limits,
}) {
  const sync = await readSyncRows(archive),
    byKey = new Map();
  for (const row of sync) {
    const key = keyString(row.table, row.key);
    if (!byKey.has(key) || !row.deleted) byKey.set(key, row);
  }
  const sourceRows = new Map();
  for (const name of [
    "wallets",
    "wallet_transactions",
    "users",
    "orders",
    "warehouses",
    "products",
    "stock_documents",
    "stock_document_lines",
    "stock_movements",
    "stock_cost_layers",
    "stock_reservations",
    "stock_document_versions",
  ]) {
    const table = archive.manifest.tables.find((t) => t.name === name);
    const values = [];
    if (table)
      for await (const cells of rowsFromFile(
        archive.staged.get(table.entry),
        table.columns.length,
        table.rowCount,
        limits,
      ))
        values.push(
          Object.fromEntries(
            table.columns.map((column, i) => [column.name, cells[i]]),
          ),
        );
    sourceRows.set(name, values);
  }
  const hasAliases = Boolean(
    (
      await client.query(
        "SELECT to_regclass('public.sync_import_aliases') AS name",
      )
    ).rows[0].name,
  );
  async function knownIdentity(table, sourceRow, includeDeleted = false) {
    const meta = byKey.get(keyString(table, { id: sourceRow.id }));
    if (!meta) return null;
    let local = (
      await client.query(
        "SELECT uid,pk FROM public.sync_rows WHERE table_name=$1 AND uid=$2::uuid" +
          (includeDeleted ? "" : " AND NOT deleted"),
        [table, meta.uid],
      )
    ).rows[0];
    if (!local && hasAliases)
      local = (
        await client.query(
          "SELECT local_uid AS uid,target_pk AS pk FROM public.sync_import_aliases WHERE source_instance=$1::uuid AND source_uid=$2::uuid AND table_name=$3",
          [archive.manifest.sync.instanceId, meta.uid, table],
        )
      ).rows[0];
    if (!local && sourceRow.created_at) {
      const candidate = (
        await client.query(
          `SELECT created_at::text FROM ${tableSql(table)} WHERE id=$1`,
          [sourceRow.id],
        )
      ).rows[0];
      if (
        candidate &&
        timestampMicros(candidate.created_at) ===
          timestampMicros(sourceRow.created_at)
      )
        local = (
          await client.query(
            "SELECT uid,pk FROM public.sync_rows WHERE table_name=$1 AND pk=$2::jsonb AND NOT deleted",
            [table, canonicalKey({ id: sourceRow.id })],
          )
        ).rows[0];
    }
    return local;
  }
  const wallets = [];
  for (const row of sourceRows.get("wallets")) {
    const meta = byKey.get(keyString("wallets", { id: row.id }));
    let local = await knownIdentity("wallets", row);
    if (!local) {
      const user = sourceRows.get("users").find((u) => u.id === row.user_id);
      const userIdentity = user ? await knownIdentity("users", user) : null;
      if (userIdentity)
        local = (
          await client.query(
            `SELECT s.uid,s.pk FROM public.wallets w JOIN public.sync_rows s ON s.table_name='wallets' AND s.pk=jsonb_build_object('id',w.id::text) AND NOT s.deleted WHERE w.user_id=$1::bigint`,
            [userIdentity.pk.id],
          )
        ).rows[0];
    }
    if (!local || !meta) continue;
    const transactions = [];
    for (const event of sourceRows
      .get("wallet_transactions")
      .filter((t) => t.wallet_id === row.id)) {
      const eventMeta = byKey.get(
        keyString("wallet_transactions", { id: event.id }),
      );
      if (!eventMeta)
        throw failure("Не найдена идентичность финансовой операции.");
      const existing = await knownIdentity("wallet_transactions", event);
      transactions.push({
        uid: existing?.uid || eventMeta.uid,
        id: event.id,
        type: event.type,
        amount: event.amount,
        balanceAfter: event.balance_after,
        orderId: event.order_id,
        createdAt: instantText(event.created_at),
      });
    }
    wallets.push({
      walletId: local.pk.id,
      source: {
        uid: local.uid,
        balance: row.balance,
        transactionCount: transactions.length,
        complete: true,
        deletedTransactionUids: sync
          .filter(
            (r) =>
              r.table === "wallet_transactions" &&
              r.deleted &&
              r.aggregate?.table === "wallets" &&
              r.aggregate.key.id === row.id,
          )
          .map((r) => r.uid),
        transactions,
      },
    });
  }
  const incomingOrders = [];
  for (const order of sourceRows.get("orders")) {
    if (
      !(
        await client.query("SELECT id FROM public.orders WHERE id=$1::uuid", [
          order.id,
        ])
      ).rowCount
    )
      incomingOrders.push({
        id: order.id,
        orderNumberDate: order.order_number_date,
        dailyNumber: order.daily_number,
      });
  }
  const mappings = new Map();
  for (const name of ["warehouses", "products"]) {
    let allocated = BigInt(
      (
        await client.query(
          `SELECT COALESCE(max(id),0)::text AS value FROM ${tableSql(name)}`,
        )
      ).rows[0].value,
    );
    for (const row of sourceRows.get(name))
      if (BigInt(row.id) > allocated) allocated = BigInt(row.id);
    for (const row of sourceRows
      .get(name)
      .sort((a, b) =>
        canonicalKey({ id: a.id }).localeCompare(
          canonicalKey({ id: b.id }),
          "en",
        ),
      )) {
      let identity = await knownIdentity(name, row),
        target;
      if (!identity && name === "warehouses") {
        const semantic = (
          await client.query(
            "SELECT id::text FROM public.warehouses WHERE code=$1",
            [row.code],
          )
        ).rows[0];
        if (semantic) identity = { pk: semantic };
      }
      if (identity) target = identity.pk.id;
      else {
        const occupied = (
          await client.query(
            `SELECT id FROM ${tableSql(name)} WHERE id=$1::bigint`,
            [row.id],
          )
        ).rowCount;
        target = occupied ? (++allocated).toString() : row.id;
      }
      mappings.set(keyString(name, { id: row.id }), target);
    }
  }
  const pairs = new Map();
  for (const movement of sourceRows.get("stock_movements")) {
    const warehouseId = mappings.get(
        keyString("warehouses", { id: movement.warehouse_id }),
      ),
      productId = mappings.get(
        keyString("products", { id: movement.product_id }),
      );
    if (!warehouseId || !productId) continue;
    let complete = movement.original_quantity != null;
    const same = (
      await client.query(
        `SELECT ${["id", "warehouse_id", "product_id", "document_id", "source_line_id", "movement_type", "reverses_movement_id", "original_quantity", "original_unit_cost", "inventory_quantity", "allow_stock_shortage", "occurred_at", "created_at"].map((c) => quote(c) + "::text AS " + quote(c)).join(",")} FROM public.stock_movements WHERE id=$1::uuid`,
        [movement.id],
      )
    ).rows[0];
    if (same) {
      const incomingFacts = {
        ...movement,
        warehouse_id: warehouseId,
        product_id: productId,
      };
      if (incomingFacts.source_line_id != null) {
        const line = await knownIdentity(
          "stock_document_lines",
          { id: incomingFacts.source_line_id },
          true,
        );
        if (line) incomingFacts.source_line_id = line.pk.id;
      }
      for (const field of [
        "warehouse_id",
        "product_id",
        "document_id",
        "source_line_id",
        "movement_type",
        "reverses_movement_id",
        "original_quantity",
        "original_unit_cost",
        "inventory_quantity",
      ])
        if (same[field] !== incomingFacts[field]) complete = false;
      if (
        ["t", "true", "1"].includes(same.allow_stock_shortage) !==
        ["t", "true", "1"].includes(incomingFacts.allow_stock_shortage)
      )
        complete = false;
      for (const field of ["occurred_at", "created_at"])
        if (
          timestampMicros(same[field]) !== timestampMicros(incomingFacts[field])
        )
          complete = false;
    }
    // The full ZIP and per-row identities prove source completeness; an explicit
    // movement tombstone or ambiguous changed canonical fact requires holding it.
    if (
      sync.some(
        (r) =>
          r.table === "stock_movements" &&
          r.deleted &&
          r.aggregate?.table === "stock_documents" &&
          r.aggregate.key.id === movement.document_id,
      )
    )
      complete = false;
    const id = warehouseId + ":" + productId,
      prior = pairs.get(id);
    pairs.set(id, {
      warehouseId,
      productId,
      complete: complete && prior?.complete !== false,
    });
  }
  if (!wallets.length && !incomingOrders.length && !pairs.size)
    return { wallets: [], warehouses: [], orderNumbers: [] };
  return controlRequest(runtime, "preflight", {
    wallets,
    warehouses: [...pairs.values()],
    incomingOrders,
  });
}

async function mergeCatalog(client, metadata) {
  const { rows: constraints } = await client.query(`
    SELECT c.relname AS table_name,k.contype,k.conname,
      ARRAY(SELECT a.attname::text FROM unnest(k.conkey) WITH ORDINALITY p(num,ord)
        JOIN pg_attribute a ON a.attrelid=k.conrelid AND a.attnum=p.num ORDER BY p.ord) AS columns,
      r.relname AS referenced_table,
      ARRAY(SELECT a.attname::text FROM unnest(k.confkey) WITH ORDINALITY p(num,ord)
        JOIN pg_attribute a ON a.attrelid=k.confrelid AND a.attnum=p.num ORDER BY p.ord) AS referenced_columns
    FROM pg_constraint k JOIN pg_class c ON c.oid=k.conrelid
    JOIN pg_namespace n ON n.oid=c.relnamespace LEFT JOIN pg_class r ON r.oid=k.confrelid
    WHERE n.nspname='public' AND k.contype IN ('p','u','f') AND NOT c.relispartition`);
  const indexes = (
    await client.query(`SELECT c.relname AS table_name,ic.relname AS conname,
    array_agg(a.attname::text ORDER BY p.ord) AS columns,pg_get_expr(i.indpred,i.indrelid) AS predicate
    FROM pg_index i JOIN pg_class c ON c.oid=i.indrelid JOIN pg_class ic ON ic.oid=i.indexrelid
    JOIN pg_namespace n ON n.oid=c.relnamespace CROSS JOIN LATERAL unnest(i.indkey) WITH ORDINALITY p(num,ord)
    LEFT JOIN pg_attribute a ON a.attrelid=c.oid AND a.attnum=p.num
    WHERE n.nspname='public' AND i.indisunique AND NOT i.indisprimary AND p.ord<=i.indnkeyatts
    GROUP BY c.relname,ic.relname,i.indpred,i.indrelid,i.indnkeyatts
    HAVING count(a.attname)=i.indnkeyatts`)
  ).rows;
  return new Map(
    metadata.tables
      .filter((table) => !table.name.startsWith("sync_"))
      .map((table) => [
        table.name,
        {
          ...table,
          primary:
            constraints.find(
              (c) => c.table_name === table.name && c.contype === "p",
            )?.columns || [],
          unique: indexes.filter((c) => c.table_name === table.name),
          foreign: constraints.filter(
            (c) => c.table_name === table.name && c.contype === "f",
          ),
        },
      ]),
  );
}

async function selectRow(client, table, key, relation = tableSql(table.name)) {
  if (
    Object.keys(key).sort().join("\0") !== [...table.primary].sort().join("\0")
  )
    throw failure("Идентификатор строки не соответствует локальной схеме.");
  const byColumn = new Map(
    table.columns.map((column) => [column.name, column]),
  );
  const projection = table.columns
    .map((column) => quote(column.name) + "::text AS " + quote(column.name))
    .join(",");
  const predicate = table.primary
    .map(
      (column, index) =>
        `${quote(column)}=$${index + 1}::${byColumn.get(column).type}`,
    )
    .join(" AND ");
  return (
    await client.query(
      `SELECT ${projection} FROM ${relation} WHERE ${predicate}`,
      table.primary.map((column) => key[column]),
    )
  ).rows[0];
}

async function stageTables(client, archive, catalog, rowsFromFile, limits) {
  const relations = new Map();
  let index = 0;
  for (const table of archive.manifest.tables) {
    const local = catalog.get(table.name);
    if (!local?.primary.length)
      throw failure(
        "Таблица не поддерживает безопасное объединение: " + table.name,
      );
    const relation = quote("merge_source_" + index++);
    await client.query(
      `CREATE TEMP TABLE ${relation} (LIKE ${tableSql(table.name)} INCLUDING DEFAULTS) ON COMMIT DROP`,
    );
    await client.query(
      `ALTER TABLE ${relation} ADD PRIMARY KEY (${local.primary.map(quote).join(",")})`,
    );
    relations.set(table.name, relation);
    const types = new Map(local.columns.map((c) => [c.name, c.type]));
    let batch = [],
      bytes = 0;
    const flush = async () => {
      if (!batch.length) return;
      const values = batch
        .map(
          (row, r) =>
            "(" +
            table.columns
              .map(
                (column, c) =>
                  `$${r * table.columns.length + c + 1}::${types.get(column.name)}`,
              )
              .join(",") +
            ")",
        )
        .join(",");
      await client.query(
        `INSERT INTO ${relation} (${table.columns.map((c) => quote(c.name)).join(",")}) VALUES ${values}`,
        batch.flat(),
      );
      batch = [];
      bytes = 0;
    };
    for await (const row of rowsFromFile(
      archive.staged.get(table.entry),
      table.columns.length,
      table.rowCount,
      limits,
    )) {
      batch.push(row);
      bytes += Buffer.byteLength(JSON.stringify(row));
      if (
        batch.length >=
          Math.min(100, Math.floor(60000 / table.columns.length)) ||
        bytes >= 4 * 1024 ** 2
      )
        await flush();
    }
    await flush();
  }
  return relations;
}

function localMetadata(row) {
  return {
    uid: row.uid,
    table: row.table_name,
    key: row.pk,
    modifiedAt: row.modified_us,
    observedAt: row.observed_us,
    deleted: row.deleted,
    generation: Number(row.generation),
    ...(row.aggregate_table
      ? { aggregate: { table: row.aggregate_table, key: row.aggregate_pk } }
      : {}),
  };
}

/** Merge trusted typed staging rows. No absent source row is interpreted as deletion. */
async function mergeDatabase(
  client,
  archive,
  metadata,
  {
    limits,
    rowsFromFile,
    fileKeys = new Map(),
    onProgress = () => {},
    reconciliation = {},
  } = {},
) {
  const incoming = await readSyncRows(archive);
  incoming.sort(
    (a, b) =>
      a.table.localeCompare(b.table, "en") ||
      (a.table === "wallet_transactions"
        ? BigInt(a.key.id) < BigInt(b.key.id)
          ? -1
          : BigInt(a.key.id) > BigInt(b.key.id)
            ? 1
            : 0
        : canonicalKey(a.key).localeCompare(canonicalKey(b.key), "en")),
  );
  const catalog = await mergeCatalog(client, metadata);
  const sourceInstance = archive.manifest.sync.instanceId;
  const report = {
    inserted: 0,
    updated: 0,
    deleted: 0,
    unchanged: 0,
    keptLocal: 0,
    uncertainClockUsed: 0,
    renumberedOrders: 0,
    renumberedDocuments: 0,
    conflicts: [],
    conflictCount: 0,
  };
  const conflict = (plan, reason) => {
    if (plan.conflict) return;
    plan.conflict = reason;
    plan.action = "keep";
    report.conflictCount++;
    if (report.conflicts.length < 5000)
      report.conflicts.push({
        table: plan.source.table,
        key: plan.source.key,
        reason,
      });
  };
  const approvedWallets = new Set(
    (reconciliation.wallets || [])
      .filter((w) => w.allowed)
      .map((w) => String(w.walletId)),
  );
  const approvedNumbers = new Map(
    (reconciliation.orderNumbers || []).map((o) => [
      o.id,
      String(o.dailyNumber),
    ]),
  );
  const approvedPairs = new Set(
    (reconciliation.warehouses || [])
      .filter((p) => p.allowed)
      .map((p) => p.warehouseId + ":" + p.productId),
  );
  report.appliedWalletIds = [];
  report.appliedOrderIds = [];
  report.appliedWarehousePairs = [];
  await client.query("BEGIN");
  try {
    await client.query("SET LOCAL TIME ZONE 'UTC'");
    await client.query("SET LOCAL ovoshi.sync_tracking='off'");
    const exists = (
      await client.query(
        "SELECT to_regprocedure('public.sync_seed(text,uuid,jsonb,text,boolean,bigint,text,jsonb,text)') AS seed",
      )
    ).rows[0]?.seed;
    if (!exists)
      throw failure("Локальная база ещё не поддерживает объединение данных.");
    await client.query(`CREATE TABLE IF NOT EXISTS public.sync_import_aliases (
      source_instance uuid NOT NULL, source_uid uuid NOT NULL, table_name text NOT NULL,
      local_uid uuid NOT NULL, target_pk jsonb NOT NULL, row_overrides jsonb NOT NULL DEFAULT '{}',
      PRIMARY KEY (source_instance,source_uid))`);
    const relations = await stageTables(
      client,
      archive,
      catalog,
      rowsFromFile,
      limits,
    );
    const syncRows = (
      await client.query(`SELECT *,
      (extract(epoch from modified_at)*1000000)::numeric(30,0)::text AS modified_us,
      (extract(epoch from observed_at)*1000000)::numeric(30,0)::text AS observed_us FROM public.sync_rows`)
    ).rows.map(localMetadata);
    const localByUid = new Map(syncRows.map((r) => [r.uid, r]));
    const walletsNeedingUnion = new Set(
      (reconciliation.wallets || [])
        .filter(
          (w) =>
            w.allowed && w.transactionUids.some((uid) => !localByUid.has(uid)),
        )
        .map((w) => String(w.walletId)),
    );
    const localByKey = new Map();
    for (const row of syncRows) {
      const key = keyString(row.table, row.key),
        old = localByKey.get(key);
      if (!old || !row.deleted || effectiveClock(row) > effectiveClock(old))
        localByKey.set(key, row);
    }
    const aliases = new Map(
      (
        await client.query(
          "SELECT * FROM public.sync_import_aliases WHERE source_instance=$1::uuid",
          [sourceInstance],
        )
      ).rows.map((row) => [row.source_uid, row]),
    );
    const plans = [],
      bySourceKey = new Map(),
      allocated = new Map(),
      reserved = new Set();
    const counters = new Map();
    for (const source of incoming) {
      const table = catalog.get(source.table);
      if (!table || !relations.has(source.table))
        throw failure("Метаданные ссылаются на отсутствующую таблицу.");
      const sourceRow = source.deleted
        ? undefined
        : await selectRow(
            client,
            table,
            source.key,
            relations.get(source.table),
          );
      if (!source.deleted && !sourceRow)
        throw failure("Метаданные не соответствуют данным сайта.");
      let local = localByUid.get(source.uid),
        alias = aliases.get(source.uid),
        targetKey = local?.key || alias?.target_pk;
      if (local && local.table !== source.table)
        throw failure("Идентификатор записи использован другой таблицей.");
      if (!local && alias) {
        if (alias.table_name !== source.table)
          throw failure("Нарушено сопоставление источника данных.");
        local = localByUid.get(alias.local_uid);
      }
      let localRow = targetKey
        ? await selectRow(client, table, targetKey)
        : undefined;
      if (!targetKey) {
        const candidateRow = await selectRow(client, table, source.key);
        const candidateMetadata = localByKey.get(
          keyString(source.table, source.key),
        );
        const uuidIdentity =
          table.primary.length === 1 &&
          UUID.test(source.key[table.primary[0]] || "");
        if (
          (uuidIdentity && candidateMetadata) ||
          provesLegacyIdentity(
            table.primary,
            source.key,
            sourceRow,
            candidateRow,
          ) ||
          (source.aggregate &&
            candidateRow &&
            sameRows(sourceRow, candidateRow))
        ) {
          targetKey = source.key;
          localRow = candidateRow;
          local = candidateMetadata;
        } else if (sourceRow && SEMANTIC_KEYS[source.table]) {
          const column = SEMANTIC_KEYS[source.table];
          const candidate = (
            await client.query(
              `SELECT ${table.primary.map((c) => quote(c) + "::text AS " + quote(c)).join(",")} FROM ${tableSql(source.table)} WHERE ${quote(column)}=$1`,
              [sourceRow[column]],
            )
          ).rows[0];
          if (candidate) {
            targetKey = candidate;
            localRow = await selectRow(client, table, candidate);
            local = localByKey.get(keyString(source.table, candidate));
          }
        }
        if (
          !targetKey &&
          sourceRow &&
          source.table === "stock_cost_layers" &&
          sourceRow.source_movement_id
        ) {
          const candidate = (
            await client.query(
              "SELECT id::text FROM public.stock_cost_layers WHERE source_movement_id=$1::uuid",
              [sourceRow.source_movement_id],
            )
          ).rows[0];
          if (candidate) {
            targetKey = candidate;
            localRow = await selectRow(client, table, candidate);
            local = localByKey.get(keyString(source.table, candidate));
          }
        }
        if (!targetKey && sourceRow && source.table === "wallets") {
          const owner = bySourceKey.get(
            keyString("users", { id: sourceRow.user_id }),
          );
          if (owner?.localExists) {
            const candidate = (
              await client.query(
                "SELECT id::text FROM public.wallets WHERE user_id=$1::bigint",
                [owner.targetKey.id],
              )
            ).rows[0];
            if (candidate) {
              targetKey = candidate;
              localRow = await selectRow(client, table, candidate);
              local = localByKey.get(keyString("wallets", candidate));
            }
          }
        }
        if (!targetKey) {
          targetKey = { ...source.key };
          const occupied =
            candidateRow || reserved.has(keyString(source.table, targetKey));
          if (
            (occupied || source.table === "wallet_transactions") &&
            !source.deleted &&
            table.primary.length === 1 &&
            /^(?:bigint|integer|smallint)$/.test(
              table.columns.find((c) => c.name === table.primary[0])?.type,
            )
          ) {
            const column = table.primary[0];
            if (!allocated.has(source.table)) {
              const maximum = (
                await client.query(
                  `SELECT GREATEST(COALESCE((SELECT max(${quote(column)}) FROM ${tableSql(source.table)}),0),COALESCE((SELECT max(${quote(column)}) FROM ${relations.get(source.table)}),0))::text AS value`,
                )
              ).rows[0].value;
              allocated.set(source.table, BigInt(maximum));
            }
            const next = allocated.get(source.table) + 1n;
            allocated.set(source.table, next);
            targetKey[column] = next.toString();
          } else if (
            occupied &&
            !source.deleted &&
            !table.foreign.some((f) =>
              f.columns.some((column) => table.primary.includes(column)),
            )
          ) {
            const pending = {
              source,
              table,
              targetKey,
              localUid: source.uid,
              action: "keep",
            };
            conflict(pending, "identity-collision");
            plans.push(pending);
            bySourceKey.set(keyString(source.table, source.key), pending);
            continue;
          }
        }
      }
      if (localRow && !local)
        local = {
          uid: randomUUID(),
          table: source.table,
          key: targetKey,
          deleted: false,
          modifiedAt: null,
          observedAt: localRow.updated_at || null,
          generation: 1,
        };
      const plan = {
        source,
        table,
        targetKey,
        local,
        localUid: local?.uid || alias?.local_uid || source.uid,
        localExists: Boolean(localRow),
        overrides: alias?.row_overrides || {},
        aliasedIdentity: Boolean(alias),
        action: "pending",
      };
      if (
        source.table === "orders" &&
        approvedNumbers.has(source.key.id) &&
        !localRow
      ) {
        plan.overrides.daily_number = approvedNumbers.get(source.key.id);
        if (plan.overrides.daily_number !== sourceRow.daily_number)
          report.renumberedOrders++;
      }
      if (source.deleted && !source.aggregate) plan.action = "keep";
      plans.push(plan);
      reserved.add(keyString(source.table, targetKey));
      if (!source.deleted)
        bySourceKey.set(keyString(source.table, source.key), plan);
    }
    // Every live business row needs exactly one identity before any local write.
    for (const table of archive.manifest.tables) {
      if (
        incoming.filter((entry) => entry.table === table.name && !entry.deleted)
          .length !== table.rowCount
      )
        throw failure(
          "Архив не содержит идентификаторы всех строк: " + table.name,
        );
    }
    function remapRow(plan, row) {
      const rewritten = { ...row, ...plan.targetKey, ...plan.overrides };
      for (const foreign of plan.table.foreign) {
        if (foreign.columns.some((column) => row[column] === null)) continue;
        const sourceKey = Object.fromEntries(
          foreign.referenced_columns.map((column, i) => [
            column,
            row[foreign.columns[i]],
          ]),
        );
        const referenced =
          bySourceKey.get(keyString(foreign.referenced_table, sourceKey)) ||
          (plan.source.deleted
            ? provenDeletedReference(plans, foreign.referenced_table, sourceKey)
            : null);
        if (!referenced)
          throw Object.assign(
            failure("Не найдена ссылка исходной строки: " + plan.source.table),
            { mergeReason: "deleted-reference-remapping-required" },
          );
        foreign.columns.forEach((column, i) => {
          rewritten[column] =
            referenced.targetKey[foreign.referenced_columns[i]];
        });
      }
      if (
        plan.source.table === "stock_movements" &&
        row.source_line_id !== null &&
        row.source_line_id !== undefined
      ) {
        const line =
          bySourceKey.get(
            keyString("stock_document_lines", { id: row.source_line_id }),
          ) ||
          plans.find(
            (p) =>
              p.source.table === "stock_document_lines" &&
              p.source.key.id === row.source_line_id &&
              p.local,
          );
        if (!line) throw failure("Не найдена строка складского движения.");
        rewritten.source_line_id = line.targetKey.id;
      }
      if (plan.source.table === "stock_document_versions" && row.snapshot_json)
        rewritten.snapshot_json = rewriteDocumentSnapshot(
          row.snapshot_json,
          (table, key) => {
            const record =
              bySourceKey.get(keyString(table, key)) ||
              plans.find(
                (p) =>
                  p.source.table === table &&
                  canonicalKey(p.source.key) === canonicalKey(key) &&
                  p.local,
              );
            return record?.targetKey.id || (UUID.test(key.id) ? key.id : null);
          },
        );
      return rewriteFileReferences(plan.source.table, rewritten, fileKeys);
    }
    const orderWallets = new Map(),
      documentPairs = new Map();
    for (const plan of plans) {
      if (
        plan.source.deleted ||
        ![
          "wallet_transactions",
          "stock_movements",
          "stock_document_lines",
        ].includes(plan.source.table)
      )
        continue;
      const raw = await selectRow(
        client,
        plan.table,
        plan.source.key,
        relations.get(plan.source.table),
      );
      if (plan.source.table === "wallet_transactions" && raw.order_id) {
        const owner = bySourceKey.get(
          keyString("wallets", { id: raw.wallet_id }),
        );
        const ids = orderWallets.get(raw.order_id) || new Set();
        if (owner) ids.add(owner.targetKey.id);
        orderWallets.set(raw.order_id, ids);
      }
      if (plan.source.table === "stock_movements") {
        const warehouse = bySourceKey.get(
            keyString("warehouses", { id: raw.warehouse_id }),
          ),
          product = bySourceKey.get(
            keyString("products", { id: raw.product_id }),
          );
        const pairs = documentPairs.get(raw.document_id) || new Set();
        if (warehouse && product)
          pairs.add(warehouse.targetKey.id + ":" + product.targetKey.id);
        documentPairs.set(raw.document_id, pairs);
      }
    }
    // Composite relation identities are the referenced local identities, not
    // source numeric IDs. An alias alone must never seed metadata under an old key.
    for (const plan of plans) {
      if (
        !plan.table.foreign.some((foreign) =>
          foreign.columns.some((column) => plan.table.primary.includes(column)),
        )
      )
        continue;
      if (
        plan.source.deleted &&
        plan.source.aggregate &&
        !bySourceKey.has(
          keyString(plan.source.aggregate.table, plan.source.aggregate.key),
        )
      ) {
        plan.action = "keep";
        continue;
      }
      const sourceRow = plan.source.deleted
        ? plan.source.key
        : await selectRow(
            client,
            plan.table,
            plan.source.key,
            relations.get(plan.source.table),
          );
      let rewritten;
      try {
        rewritten = remapRow(plan, sourceRow);
      } catch (error) {
        if (plan.source.deleted && error.mergeReason) {
          conflict(plan, error.mergeReason);
          continue;
        }
        throw error;
      }
      const key = Object.fromEntries(
        plan.table.primary.map((column) => [column, rewritten[column]]),
      );
      {
        const localRow = await selectRow(client, plan.table, key);
        const identity = localByKey.get(keyString(plan.source.table, key));
        Object.assign(
          plan,
          resolveCompositeIdentity(plan, key, localRow, identity),
        );
        if (plan.movedIdentity) {
          conflict(plan, "composite-identity-move");
          continue;
        }
        if (localRow) {
          if (plan.conflict === "identity-collision") {
            plan.conflict = undefined;
            plan.action = "pending";
          }
        }
      }
    }
    // Source JSONL order is not lifecycle order. Old tombstones must not delete
    // a later incarnation occupying the same final physical relation slot.
    const lifecycles = resolveSourceLifecycles(plans);
    for (const plan of lifecycles.obsolete) {
      plan.action = "keep";
      plan.suppressedTombstone = true;
    }
    for (const plan of lifecycles.ambiguous)
      conflict(plan, "ambiguous-row-lifecycle");
    // Resolve all identities first: FK rewrites cannot depend on archive table order.
    for (const plan of plans) {
      if (plan.conflict || plan.action === "keep") continue;
      if (DERIVED_TABLES.has(plan.source.table)) {
        plan.action = "keep";
        continue;
      }
      if (plan.source.table === "stock_cost_layers" && plan.source.deleted) {
        plan.action = "keep";
        continue;
      }
      if (FINANCIAL_TABLES.has(plan.source.table)) {
        const raw = plan.source.deleted
          ? null
          : await selectRow(
              client,
              plan.table,
              plan.source.key,
              relations.get(plan.source.table),
            );
        const wallet =
          plan.source.table === "wallets"
            ? plan
            : plan.source.table === "wallet_transactions" && raw
              ? bySourceKey.get(keyString("wallets", { id: raw.wallet_id }))
              : null;
        const movementPlan =
          raw && plan.source.table === "stock_ledger_revisions"
            ? bySourceKey.get(
                keyString("stock_movements", { id: raw.movement_id }),
              )
            : null;
        const movement =
          movementPlan && !movementPlan.source.deleted
            ? await selectRow(
                client,
                movementPlan.table,
                movementPlan.source.key,
                relations.get("stock_movements"),
              )
            : null;
        const pair = financialWarehousePair(
          plan.source.table,
          raw,
          movement,
          (table, id) =>
            bySourceKey.get(keyString(table, { id }))?.targetKey.id,
        );
        plan.financialPair = pair;
        if (
          !(wallet && approvedWallets.has(wallet.targetKey.id)) &&
          !(pair && approvedPairs.has(pair))
        ) {
          conflict(plan, "financial-reconciliation-required");
          continue;
        }
      }
      let sourceRow;
      try {
        sourceRow = plan.source.deleted
          ? undefined
          : remapRow(
              plan,
              await selectRow(
                client,
                plan.table,
                plan.source.key,
                relations.get(plan.source.table),
              ),
            );
      } catch (error) {
        if (plan.source.table === "stock_document_versions") {
          conflict(plan, "historical-snapshot-remapping-required");
          continue;
        }
        throw error;
      }
      const localRow = await selectRow(client, plan.table, plan.targetKey);
      if (sourceRow && plan.source.table === "orders" && !localRow) {
        const duplicate = (
          await client.query(
            "SELECT id::text FROM public.orders WHERE order_number_date=$1::date AND daily_number=$2::bigint",
            [sourceRow.order_number_date, sourceRow.daily_number],
          )
        ).rows[0];
        if (duplicate) {
          const day = sourceRow.order_number_date;
          if (!counters.has(day)) {
            const largest = (
              await client.query(
                `SELECT GREATEST(COALESCE((SELECT max(daily_number) FROM public.orders WHERE order_number_date=$1::date),0),COALESCE((SELECT last_daily_number FROM public.order_daily_counters WHERE order_number_date=$1::date),0),COALESCE((SELECT max(daily_number) FROM ${relations.get("orders")} WHERE order_number_date=$1::date),0))::text AS value`,
                [day],
              )
            ).rows[0].value;
            counters.set(day, BigInt(largest));
          }
          const next = counters.get(day) + 1n;
          counters.set(day, next);
          plan.overrides = { ...plan.overrides, daily_number: next.toString() };
          sourceRow.daily_number = next.toString();
          report.renumberedOrders++;
        }
      }
      if (
        sourceRow &&
        plan.source.table === "stock_documents" &&
        !localRow &&
        /^СКЛ-\d+$/.test(sourceRow.document_number || "")
      ) {
        const duplicate = (
          await client.query(
            "SELECT id FROM public.stock_documents WHERE document_number=$1",
            [sourceRow.document_number],
          )
        ).rows[0];
        if (duplicate) {
          let next, number;
          const width = sourceRow.document_number.slice(4).length;
          do {
            next = (
              await client.query(
                "SELECT nextval('public.stock_document_number_seq')::text AS value",
              )
            ).rows[0].value;
            number = "СКЛ-" + next.padStart(width, "0");
          } while (
            (
              await client.query(
                "SELECT id FROM public.stock_documents WHERE document_number=$1",
                [number],
              )
            ).rowCount ||
            plans.some((p) => p.overrides.document_number === number)
          );
          plan.overrides.document_number = number;
          sourceRow.document_number = number;
          report.renumberedDocuments++;
        }
      }
      if (
        sourceRow &&
        plan.source.table === "stock_document_versions" &&
        !localRow
      ) {
        const duplicate = (
          await client.query(
            "SELECT id FROM public.stock_document_versions WHERE document_id=$1::uuid AND version_number=$2::integer",
            [sourceRow.document_id, sourceRow.version_number],
          )
        ).rows[0];
        if (duplicate) {
          const counterKey = "document-version:" + sourceRow.document_id;
          if (!counters.has(counterKey)) {
            const maximum = (
              await client.query(
                `SELECT GREATEST(COALESCE((SELECT max(version_number) FROM public.stock_document_versions WHERE document_id=$1::uuid),0),COALESCE((SELECT max(version_number) FROM ${relations.get("stock_document_versions")} WHERE document_id=$1::uuid),0))::text AS value`,
                [sourceRow.document_id],
              )
            ).rows[0].value;
            counters.set(counterKey, BigInt(maximum));
          }
          const next = counters.get(counterKey) + 1n;
          counters.set(counterKey, next);
          if (next > 2147483647n) {
            conflict(plan, "document-history-counter-exhausted");
            continue;
          }
          plan.overrides.version_number = next.toString();
          sourceRow.version_number = next.toString();
        }
      }
      let approvedWallet = false;
      if (plan.source.table === "wallets") {
        approvedWallet = approvedWallets.has(plan.targetKey.id);
        if (approvedWallet && sourceRow && localRow) {
          plan.overrides.balance = localRow.balance;
          plan.overrides.updated_at = localRow.updated_at;
          sourceRow = {
            ...sourceRow,
            balance: localRow.balance,
            updated_at: localRow.updated_at,
          };
        }
      }
      if (plan.source.table === "wallet_transactions" && sourceRow) {
        approvedWallet = approvedWallets.has(sourceRow.wallet_id);
        sourceRow = preserveWalletTransactionProjection(
          sourceRow,
          localRow,
          approvedWallet,
        );
        if (
          approvedWallet &&
          localRow &&
          sourceRow.wallet_id === localRow.wallet_id
        )
          plan.overrides.balance_after = localRow.balance_after;
      }
      plan.action = chooseAction(plan.source, plan.local, sourceRow, localRow);
      if (plan.source.aggregate) {
        const root = bySourceKey.get(
          keyString(plan.source.aggregate.table, plan.source.aggregate.key),
        );
        plan.action = chooseAggregateChildAction(
          root,
          plan.source,
          plan.local,
          sourceRow,
          localRow,
          plan.action,
        );
        plan.retainsDifferentChild = Boolean(
          plan.local &&
          (plan.source.deleted !== plan.local.deleted ||
            (!plan.source.deleted && !sameRows(sourceRow, localRow))),
        );
      }
      if (plan.action.startsWith("conflict-"))
        conflict(plan, plan.action.slice(9));
      if (plan.action === "delete" && (!plan.local || !plan.source.aggregate))
        plan.action = "keep";
      const approvedWarehouse = Boolean(
        sourceRow &&
        (plan.financialPair
          ? approvedPairs.has(plan.financialPair)
          : sourceRow.warehouse_id &&
            sourceRow.product_id &&
            approvedPairs.has(
              sourceRow.warehouse_id + ":" + sourceRow.product_id,
            )),
      );
      if (
        approvedWallet &&
        plan.source.table === "wallets" &&
        !plan.source.deleted
      ) {
        plan.action = walletsNeedingUnion.has(plan.targetKey.id)
          ? "update"
          : "unchanged";
        plan.conflict = undefined;
        // Reconciliation owns the derived balance, not an independent LWW.
        if (localRow)
          plan.overrides = {
            ...plan.overrides,
            balance: localRow.balance,
            updated_at: localRow.updated_at,
          };
      }
      if (["insert", "update", "delete"].includes(plan.action)) {
        if (
          FINANCIAL_TABLES.has(plan.source.table) &&
          !approvedWallet &&
          !approvedWarehouse
        )
          conflict(plan, "financial-reconciliation-required");
        if (
          plan.source.table === "orders" &&
          !sourceRow?.created_by_user_id &&
          !localRow?.created_by_user_id &&
          ((sourceRow?.paid_total && Number(sourceRow.paid_total) !== 0) ||
            (localRow?.paid_total && Number(localRow.paid_total) !== 0)) &&
          (sourceRow?.payment_method === "BALANCE" ||
            localRow?.payment_method === "BALANCE") &&
          !(
            orderWallets.get(plan.source.key.id)?.size &&
            [...orderWallets.get(plan.source.key.id)].every((id) =>
              approvedWallets.has(id),
            )
          )
        )
          conflict(plan, "financial-order-reconciliation-required");
        if (
          plan.source.table === "stock_documents" &&
          (sourceRow?.status !== "DRAFT" ||
            (localRow && localRow.status !== "DRAFT")) &&
          !(
            sourceRow &&
            ["PRICE_SETTING", "PURCHASE_ORDER"].includes(
              sourceRow.document_type,
            ) &&
            !documentPairs.get(plan.source.key.id)?.size
          ) &&
          !(
            documentPairs.get(plan.source.key.id)?.size &&
            [...documentPairs.get(plan.source.key.id)].every((pair) =>
              approvedPairs.has(pair),
            )
          )
        )
          conflict(plan, "posted-document-reconciliation-required");
      }
      if (["insert", "update"].includes(plan.action)) {
        for (const constraint of plan.table.unique) {
          if (constraint.columns.some((column) => sourceRow[column] == null))
            continue;
          if (
            constraint.predicate &&
            !(
              await client.query(
                `SELECT (${constraint.predicate}) AS enabled FROM jsonb_populate_record(NULL::${tableSql(plan.source.table)},$1::jsonb)`,
                [JSON.stringify(sourceRow)],
              )
            ).rows[0].enabled
          )
            continue;
          const types = new Map(
            plan.table.columns.map((c) => [c.name, c.type]),
          );
          const where = constraint.columns
            .map(
              (column, i) => `${quote(column)}=$${i + 1}::${types.get(column)}`,
            )
            .join(" AND ");
          const other = (
            await client.query(
              `SELECT ${plan.table.primary.map((c) => quote(c) + "::text AS " + quote(c)).join(",")} FROM ${tableSql(plan.source.table)} WHERE ${constraint.predicate ? "(" + constraint.predicate + ") AND " : ""}${where}`,
              constraint.columns.map((column) => sourceRow[column]),
            )
          ).rows[0];
          if (other && canonicalKey(other) !== canonicalKey(plan.targetKey)) {
            conflict(plan, "unique-value-conflict:" + constraint.conname);
            break;
          }
        }
      }
    }
    const rootOf = (plan) =>
      plan.source.aggregate
        ? bySourceKey.get(
            keyString(plan.source.aggregate.table, plan.source.aggregate.key),
          )
        : plan;
    // A source header cannot surround a different retained local member when
    // legacy clocks do not prove a whole-snapshot winner.
    for (const child of plans) {
      if (
        !child.source.aggregate ||
        !child.retainsDifferentChild ||
        child.action !== "keep" ||
        INDEPENDENT_CHILD_TABLES.has(child.source.table)
      )
        continue;
      const root = rootOf(child);
      if (root && ["insert", "update"].includes(root.action))
        conflict(root, "retained-different-child:" + child.source.table);
    }
    // Unknown local-only children make replacing the aggregate unsafe (totals, memberships).
    for (const root of plans.filter(
      (plan) =>
        !plan.source.aggregate && ["insert", "update"].includes(plan.action),
    )) {
      const importedChildren = new Set(
        plans
          .filter((plan) => rootOf(plan) === root)
          .map((plan) => plan.localUid),
      );
      if (
        root.source.table === "wallets" &&
        approvedWallets.has(root.targetKey.id)
      )
        continue;
      if (
        syncRows.some(
          (local) =>
            !local.deleted &&
            !DERIVED_TABLES.has(local.table) &&
            ![
              "stock_cost_layers",
              "stock_document_versions",
              "stock_ledger_revisions",
            ].includes(local.table) &&
            local.aggregate?.table === root.source.table &&
            canonicalKey(local.aggregate.key) ===
              canonicalKey(root.targetKey) &&
            !importedChildren.has(local.uid),
        )
      )
        conflict(root, "unmapped-local-child");
    }
    let changed = true;
    while (changed) {
      changed = false;
      for (const plan of plans) {
        if (!["insert", "update", "delete"].includes(plan.action)) continue;
        const root = rootOf(plan);
        if (
          !root ||
          (root !== plan &&
            !["insert", "update"].includes(root.action) &&
            !(
              (plan.source.table === "stock_document_versions" ||
                (plan.source.table === "stock_ledger_revisions" &&
                  approvedPairs.has(plan.financialPair))) &&
              root.localExists &&
              !root.conflict
            ))
        ) {
          plan.action = "keep";
          changed = true;
          continue;
        }
        if (root !== plan && plan.conflict) {
          conflict(root, "conflicting-child");
          changed = true;
          continue;
        }
        const sourceRow = plan.source.deleted
          ? null
          : await selectRow(
              client,
              plan.table,
              plan.source.key,
              relations.get(plan.source.table),
            );
        for (const foreign of plan.table.foreign) {
          if (
            !sourceRow ||
            foreign.columns.some((column) => sourceRow[column] === null)
          )
            continue;
          const reference = bySourceKey.get(
            keyString(
              foreign.referenced_table,
              Object.fromEntries(
                foreign.referenced_columns.map((column, i) => [
                  column,
                  sourceRow[foreign.columns[i]],
                ]),
              ),
            ),
          );
          if (
            reference &&
            !reference.localExists &&
            !["insert", "update"].includes(reference.action)
          ) {
            conflict(root, "unresolved-reference:" + foreign.referenced_table);
            plan.action = "keep";
            changed = true;
            break;
          }
        }
      }
      for (const child of plans.filter(
        (p) =>
          p.source.aggregate &&
          p.conflict &&
          !DERIVED_TABLES.has(p.source.table),
      )) {
        const root = rootOf(child);
        if (root && ["insert", "update"].includes(root.action)) {
          conflict(root, "conflicting-child:" + child.source.table);
          changed = true;
        }
      }
    }
    for (const constraint of metadata.constraints.filter(
      (c) => !c.table_name.startsWith("sync_"),
    ))
      await client.query(
        `ALTER TABLE ${tableSql(constraint.table_name)} ALTER CONSTRAINT ${quote(constraint.name)} DEFERRABLE INITIALLY DEFERRED`,
      );
    await client.query("SET CONSTRAINTS ALL DEFERRED");
    for (const plan of plans) {
      const predicate = plan.table.primary
        .map(
          (column, i) =>
            `${quote(column)}=$${i + 1}::${plan.table.columns.find((c) => c.name === column).type}`,
        )
        .join(" AND ");
      if (["insert", "update"].includes(plan.action)) {
        const row = remapRow(
          plan,
          await selectRow(
            client,
            plan.table,
            plan.source.key,
            relations.get(plan.source.table),
          ),
        );
        const columns = archive.manifest.tables
          .find((t) => t.name === plan.source.table)
          .columns.filter(
            (c) =>
              !plan.table.columns.find((local) => local.name === c.name)
                .generated,
          );
        const values = columns.map((c) => row[c.name]);
        const args = columns.map(
          (c, i) =>
            `$${i + 1}::${plan.table.columns.find((local) => local.name === c.name).type}`,
        );
        const updates = columns
          .filter((c) => !plan.table.primary.includes(c.name))
          .map((c) => `${quote(c.name)}=EXCLUDED.${quote(c.name)}`)
          .join(",");
        await client.query(
          `INSERT INTO ${tableSql(plan.source.table)} (${columns.map((c) => quote(c.name)).join(",")}) OVERRIDING SYSTEM VALUE VALUES (${args.join(",")}) ON CONFLICT (${plan.table.primary.map(quote).join(",")}) ${updates ? "DO UPDATE SET " + updates : "DO NOTHING"}`,
          values,
        );
        report[plan.action === "insert" ? "inserted" : "updated"]++;
        if (
          plan.source.table === "wallets" &&
          approvedWallets.has(plan.targetKey.id)
        )
          report.appliedWalletIds.push(plan.targetKey.id);
        if (plan.source.table === "orders" && plan.action === "insert")
          report.appliedOrderIds.push(plan.targetKey.id);
        if (plan.source.table === "stock_movements") {
          const pair = {
            warehouseId: row.warehouse_id,
            productId: row.product_id,
            complete: true,
          };
          if (
            !report.appliedWarehousePairs.some(
              (p) =>
                p.warehouseId === pair.warehouseId &&
                p.productId === pair.productId,
            )
          )
            report.appliedWarehousePairs.push(pair);
        }
      } else if (plan.action === "delete") {
        await client.query(
          `DELETE FROM ${tableSql(plan.source.table)} WHERE ${predicate}`,
          plan.table.primary.map((column) => plan.targetKey[column]),
        );
        report.deleted++;
      } else if (plan.action === "unchanged") report.unchanged++;
      else report.keptLocal++;
      if (plan.local || ["insert", "update", "delete"].includes(plan.action)) {
        const aggregate = plan.source.aggregate ? rootOf(plan) : null;
        if (["insert", "update", "delete"].includes(plan.action)) {
          await client.query(
            "SELECT public.sync_seed($1,$2::uuid,$3::jsonb,$4,$5,$6::bigint,$7,$8::jsonb,$9)",
            [
              plan.source.table,
              plan.localUid,
              canonicalKey(plan.targetKey),
              plan.source.modifiedAt,
              plan.action === "delete",
              String(
                Math.max(plan.source.generation, plan.local?.generation || 1),
              ),
              aggregate?.source.table || null,
              aggregate ? canonicalKey(aggregate.targetKey) : null,
              plan.source.observedAt || null,
            ],
          );
          if (
            plan.local &&
            (plan.source.modifiedAt === null || plan.local.modifiedAt === null)
          )
            report.uncertainClockUsed++;
        }
        await client.query(
          `INSERT INTO public.sync_import_aliases(source_instance,source_uid,table_name,local_uid,target_pk,row_overrides) VALUES($1::uuid,$2::uuid,$3,$4::uuid,$5::jsonb,$6::jsonb) ON CONFLICT(source_instance,source_uid) DO UPDATE SET local_uid=EXCLUDED.local_uid,target_pk=EXCLUDED.target_pk,row_overrides=EXCLUDED.row_overrides`,
          [
            sourceInstance,
            plan.source.uid,
            plan.source.table,
            plan.localUid,
            canonicalKey(plan.targetKey),
            JSON.stringify(plan.overrides),
          ],
        );
      }
      if (
        (report.inserted +
          report.updated +
          report.keptLocal +
          report.unchanged +
          report.deleted) %
          100 ===
        0
      )
        onProgress("Объединяем данные сайта с локальными…");
    }
    await client.query("SET CONSTRAINTS ALL IMMEDIATE");
    for (const constraint of metadata.constraints.filter(
      (c) => !c.table_name.startsWith("sync_"),
    ))
      await client.query(
        `ALTER TABLE ${tableSql(constraint.table_name)} ALTER CONSTRAINT ${quote(constraint.name)} ${constraint.deferrable ? `DEFERRABLE INITIALLY ${constraint.deferred ? "DEFERRED" : "IMMEDIATE"}` : "NOT DEFERRABLE INITIALLY IMMEDIATE"}`,
      );
    if (catalog.has("orders"))
      await client.query(
        `INSERT INTO public.order_daily_counters(order_number_date,last_daily_number) SELECT order_number_date,max(daily_number) FROM public.orders GROUP BY order_number_date ON CONFLICT(order_number_date) DO UPDATE SET last_daily_number=GREATEST(order_daily_counters.last_daily_number,EXCLUDED.last_daily_number)`,
      );
    // Existing sequences, source counters and final remapped PKs can only move forward.
    for (const sequence of archive.manifest.sequences || []) {
      const current = (
        await client.query(
          `SELECT last_value::text,is_called FROM ${tableSql(sequence.name)}`,
        )
      ).rows[0];
      let maximum =
        BigInt(current.last_value) > BigInt(sequence.lastValue)
          ? BigInt(current.last_value)
          : BigInt(sequence.lastValue);
      let called = current.is_called || sequence.isCalled;
      for (const table of catalog.values()) {
        if (
          table.primary.length !== 1 ||
          !/^(?:bigint|integer|smallint)$/.test(
            table.columns.find((c) => c.name === table.primary[0])?.type,
          )
        )
          continue;
        const owner = (
          await client.query("SELECT pg_get_serial_sequence($1,$2) AS name", [
            "public." + quote(table.name),
            table.primary[0],
          ])
        ).rows[0].name;
        if (
          owner !== "public." + sequence.name &&
          owner !== "public." + quote(sequence.name)
        )
          continue;
        const last = (
          await client.query(
            `SELECT max(${quote(table.primary[0])})::text AS value FROM ${tableSql(table.name)}`,
          )
        ).rows[0].value;
        if (last != null && BigInt(last) >= maximum) {
          maximum = BigInt(last);
          called = true;
        }
      }
      await client.query("SELECT setval($1::regclass,$2::bigint,$3::boolean)", [
        "public." + quote(sequence.name),
        maximum.toString(),
        called,
      ]);
    }
    await client.query("COMMIT");
    report.conflictsTruncated = report.conflictCount > report.conflicts.length;
    return report;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  }
}

module.exports = {
  canonicalKey,
  timestampMicros,
  effectiveClock,
  sameRows,
  preserveWalletTransactionProjection,
  chooseAction,
  chooseAggregateChildAction,
  provesLegacyIdentity,
  resolveCompositeIdentity,
  financialWarehousePair,
  resolveSourceLifecycles,
  provenDeletedReference,
  readSyncRows,
  prepareMergedFiles,
  rewriteFileReferences,
  FINANCIAL_TABLES,
  SEMANTIC_KEYS,
  DERIVED_TABLES,
  mergeDatabase,
  mergeCatalog,
  selectRow,
  prepareFinancialMerge,
  controlRequest,
  instantText,
  rewriteDocumentSnapshot,
};
