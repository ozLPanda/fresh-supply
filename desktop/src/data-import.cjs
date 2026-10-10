"use strict";
const fs = require("node:fs/promises");
const { createReadStream, createWriteStream } = require("node:fs");
const path = require("node:path");
const net = require("node:net");
const { createHash, randomBytes } = require("node:crypto");
const { Readable, Transform, PassThrough } = require("node:stream");
const { pipeline } = require("node:stream/promises");
const { Client } = require("pg");
const { readJson, writeJson } = require("./runtime.cjs");

const EXCLUDED = new Set([
  "flyway_schema_history",
  "auth_sessions",
  "web_push_subscriptions",
  "external_api_credentials",
  "external_api_credential_permissions",
  "external_api_request_logs",
]);
const EPHEMERAL = new Set([
  "flyway_schema_history",
  "auth_sessions",
  "web_push_subscriptions",
]);
const LIMITS = Object.freeze({
  maxArchive: 4 * 1024 ** 3,
  maxExpanded: 10 * 1024 ** 3,
  maxEntry: 2 * 1024 ** 3 + 128 * 1024,
  maxEntries: 100000,
  maxManifest: 4 * 1024 ** 2,
  maxRow: 64 * 1024 ** 2,
  maxRows: 10000000,
  maxRatio: 1000,
});
const quote = (value) => '"' + value.replace(/"/g, '""') + '"';
const tableSql = (value) => '"public".' + quote(value);
const sha = (value) => createHash("sha256").update(value).digest("hex");
const controlledError = (message) =>
  Object.assign(new Error(message), { userMessage: message });
const fail = (message) => {
  throw controlledError(message);
};
async function exists(file) {
  return fs.access(file).then(
    () => true,
    () => false,
  );
}
async function fileHash(file) {
  const hash = createHash("sha256");
  for await (const part of createReadStream(file)) hash.update(part);
  return hash.digest("hex");
}

function validateSourceUrl(value) {
  if (typeof value !== "string" || value.length > 2048)
    fail("Введите адрес сайта-источника");
  let url;
  try {
    url = new URL(value);
  } catch {
    fail("Некорректный адрес сайта");
  }
  if (
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    !["https:", "http:"].includes(url.protocol)
  )
    fail("Адрес должен быть HTTP/HTTPS без пароля, параметров и фрагмента");
  const host = url.hostname.replace(/^\[|\]$/g, "");
  const ipv4 = net.isIP(host) === 4 ? host.split(".").map(Number) : null;
  const privateAddress =
    host === "localhost" ||
    host === "::1" ||
    (ipv4 &&
      (ipv4[0] === 127 ||
        ipv4[0] === 10 ||
        (ipv4[0] === 192 && ipv4[1] === 168) ||
        (ipv4[0] === 172 && ipv4[1] >= 16 && ipv4[1] <= 31)));
  if (url.protocol === "http:" && !privateAddress)
    fail(
      "Для публичного сайта требуется HTTPS; HTTP допустим только для локального адреса",
    );
  if (url.pathname.includes("\\")) fail("Некорректный путь сайта");
  url.pathname = url.pathname.replace(/\/+$/, "") + "/";
  return url;
}
function safeEntry(name) {
  return (
    typeof name === "string" &&
    name.length <= 512 &&
    !name.includes("\\") &&
    !name.includes("\0") &&
    !name.startsWith("/") &&
    !/^[A-Za-z]:/.test(name) &&
    !name.split("/").some((p) => !p || p === "." || p === "..")
  );
}
function boundedInteger(value, maximum, label) {
  if (!Number.isSafeInteger(value) || value < 0 || value > maximum)
    fail("Некорректный размер копии данных");
  return value;
}
function versionParts(value) {
  if (
    typeof value !== "string" ||
    value.length > 128 ||
    !/^\d+(?:\.\d+)*$/.test(value)
  )
    fail("Некорректная версия схемы");
  return value.split(".").map(BigInt);
}
function compareVersions(left, right) {
  const a = versionParts(left),
    b = versionParts(right);
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    if ((a[i] || 0n) < (b[i] || 0n)) return -1;
    if ((a[i] || 0n) > (b[i] || 0n)) return 1;
  }
  return 0;
}

function validateManifest(manifest, entries, limits = LIMITS) {
  if (
    !manifest ||
    manifest.format !== "ovoshi-help-data-transfer" ||
    manifest.formatVersion !== 1 ||
    !Array.isArray(manifest.tables) ||
    !Array.isArray(manifest.files) ||
    (manifest.sequences !== undefined && !Array.isArray(manifest.sequences))
  )
    fail("Неподдерживаемый формат копии данных");
  versionParts(manifest.schemaVersion);
  if (
    !Number.isFinite(Date.parse(manifest.createdAt)) ||
    manifest.tables.length > 1000 ||
    (manifest.sequences || []).length > 1000
  )
    fail("Некорректное описание копии");
  const declared = new Map(),
    names = new Set(),
    keys = new Set();
  let total = 0;
  for (const table of manifest.tables) {
    if (
      !table ||
      typeof table.name !== "string" ||
      !/^[a-z_][a-z0-9_]*$/.test(table.name) ||
      EXCLUDED.has(table.name) ||
      names.has(table.name)
    )
      fail("Недопустимая или повторяющаяся таблица");
    names.add(table.name);
    if (
      !Array.isArray(table.columns) ||
      !table.columns.length ||
      table.columns.length > 1600 ||
      !/^tables\/[a-zA-Z0-9_-]+\.jsonl$/.test(table.entry)
    )
      fail("Некорректное описание таблицы");
    const columns = new Set();
    for (const column of table.columns) {
      if (
        !column ||
        typeof column.name !== "string" ||
        !/^[a-z_][a-z0-9_]*$/.test(column.name) ||
        columns.has(column.name) ||
        typeof column.type !== "string" ||
        column.type.length > 200
      )
        fail("Некорректное описание столбцов");
      columns.add(column.name);
    }
    boundedInteger(table.rowCount, limits.maxRows, table.name);
    declare(table);
  }
  for (const file of manifest.files) {
    if (
      !file ||
      typeof file.key !== "string" ||
      !file.key.trim() ||
      file.key.length > 4096 ||
      !file.key.isWellFormed() ||
      file.key.includes("\0") ||
      keys.has(file.key) ||
      file.entry !== `files/${sha(file.key)}.object`
    )
      fail("Некорректное описание файла");
    keys.add(file.key);
    declare(file);
  }
  const sequences = new Set();
  for (const sequence of manifest.sequences || []) {
    if (
      !sequence ||
      typeof sequence.name !== "string" ||
      !/^[a-z_][a-z0-9_]*$/.test(sequence.name) ||
      sequences.has(sequence.name) ||
      typeof sequence.lastValue !== "string" ||
      !/^-?\d{1,19}$/.test(sequence.lastValue) ||
      typeof sequence.isCalled !== "boolean" ||
      BigInt(sequence.lastValue) > 9223372036854775807n ||
      BigInt(sequence.lastValue) < -9223372036854775808n
    )
      fail("Некорректное описание счётчика");
    sequences.add(sequence.name);
  }
  function declare(item) {
    if (
      !safeEntry(item.entry) ||
      declared.has(item.entry) ||
      typeof item.sha256 !== "string" ||
      !/^[a-f0-9]{64}$/.test(item.sha256)
    )
      fail("Некорректный файл в манифесте");
    total += boundedInteger(item.size, limits.maxEntry, item.entry);
    if (total > limits.maxExpanded) fail("Копия превышает допустимый объём");
    const entry = entries.get(item.entry);
    if (!entry || entry.uncompressedSize !== item.size)
      fail("Размер файла не совпадает с манифестом");
    declared.set(item.entry, item);
  }
  if (
    entries.size !== declared.size + 1 ||
    [...entries.keys()].some(
      (name) => name !== "manifest.json" && !declared.has(name),
    )
  )
    fail("Копия содержит необъявленные файлы");
  return { declared, total };
}

async function openZip(file) {
  const yauzl = require("yauzl");
  return new Promise((resolve, reject) =>
    yauzl.open(
      file,
      {
        lazyEntries: true,
        autoClose: false,
        strictFileNames: true,
        validateEntrySizes: true,
      },
      (error, zip) => (error ? reject(error) : resolve(zip)),
    ),
  );
}
async function zipEntries(zip, limits) {
  const entries = new Map();
  let expanded = 0;
  await new Promise((resolve, reject) => {
    zip.once("error", reject);
    zip.once("end", resolve);
    zip.on("entry", (entry) => {
      try {
        if (
          !safeEntry(entry.fileName) ||
          entries.has(entry.fileName) ||
          entry.generalPurposeBitFlag & 1 ||
          ![0, 8].includes(entry.compressionMethod) ||
          ((entry.externalFileAttributes >>> 16) & 0xf000) === 0xa000
        )
          fail("Недопустимая запись ZIP");
        boundedInteger(entry.uncompressedSize, limits.maxEntry, entry.fileName);
        expanded += entry.uncompressedSize;
        if (
          expanded > limits.maxExpanded ||
          entries.size >= limits.maxEntries ||
          entry.uncompressedSize >
            Math.max(1, entry.compressedSize) * limits.maxRatio
        )
          fail("ZIP превышает допустимые ограничения");
        entries.set(entry.fileName, entry);
        zip.readEntry();
      } catch (error) {
        reject(error);
      }
    });
    zip.readEntry();
  });
  return entries;
}
async function entryStream(zip, entry) {
  return new Promise((resolve, reject) =>
    zip.openReadStream(entry, (error, source) => {
      if (error) return reject(error);
      // yauzl's stored-entry stream has a legacy destroy implementation. A modern
      // PassThrough preserves backpressure and prevents Node async-iterator hangs.
      const stream = new PassThrough();
      source.on("error", (error) => stream.destroy(error));
      stream.on("close", () => {
        if (!source.destroyed && !source.readableEnded) source.destroy();
      });
      source.pipe(stream);
      resolve(stream);
    }),
  );
}
async function streamText(stream, maximum) {
  const chunks = [];
  let size = 0;
  for await (const chunk of stream) {
    size += chunk.length;
    if (size > maximum) fail("Манифест слишком большой");
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString("utf8");
}
function validateModifiedUtf(bytes) {
  for (let index = 0; index < bytes.length; ) {
    const first = bytes[index++];
    if (first <= 0x7f) continue;
    const count =
      (first & 0xe0) === 0xc0 ? 1 : (first & 0xf0) === 0xe0 ? 2 : -1;
    if (count < 0 || index + count > bytes.length)
      fail("Некорректные метаданные сохранённого файла");
    for (let offset = 0; offset < count; offset++)
      if ((bytes[index++] & 0xc0) !== 0x80)
        fail("Некорректные метаданные сохранённого файла");
  }
}
async function stageArchive(
  file,
  directory,
  { limits = LIMITS, onProgress = () => {} } = {},
) {
  const zip = await openZip(file);
  try {
    const entries = await zipEntries(zip, limits);
    const descriptor = entries.get("manifest.json");
    if (!descriptor || descriptor.uncompressedSize > limits.maxManifest)
      fail("Не найден манифест копии");
    let manifest;
    try {
      manifest = JSON.parse(
        await streamText(
          await entryStream(zip, descriptor),
          limits.maxManifest,
        ),
      );
    } catch {
      fail("Некорректный манифест копии");
    }
    const { declared, total } = validateManifest(manifest, entries, limits);
    try {
      const disk = await fs.statfs(directory);
      if (
        Number(disk.bavail) * Number(disk.bsize) <
        total * 2 + 256 * 1024 ** 2
      )
        fail("Недостаточно места для безопасного переноса");
    } catch (error) {
      if (error.code !== "ENOSYS" && error.code !== "ENOTSUP") throw error;
    }
    const staged = new Map();
    let index = 0;
    for (const [name, item] of declared) {
      const destination = path.join(directory, `entry-${index++}`),
        hash = createHash("sha256");
      let bytes = 0;
      const check = new Transform({
        transform(chunk, _encoding, next) {
          bytes += chunk.length;
          hash.update(chunk);
          next(
            bytes > item.size
              ? controlledError("Размер файла превышает манифест")
              : null,
            chunk,
          );
        },
      });
      await pipeline(
        await entryStream(zip, entries.get(name)),
        check,
        createWriteStream(destination, { flags: "wx", mode: 0o600 }),
      );
      if (bytes !== item.size || hash.digest("hex") !== item.sha256)
        fail("Проверка целостности копии не пройдена");
      staged.set(name, destination);
      onProgress(`Проверено файлов: ${index}/${declared.size}`);
    }
    for (const item of manifest.files) {
      const handle = await fs.open(staged.get(item.entry), "r");
      try {
        const header = Buffer.alloc(6);
        if (
          (await handle.read(header, 0, 6, 0)).bytesRead !== 6 ||
          header.toString("ascii", 0, 4) !== "OVO1" ||
          6 + header.readUInt16BE(4) > item.size
        )
          fail("Некорректный формат сохранённого файла");
        const mime = Buffer.alloc(header.readUInt16BE(4));
        if (
          !mime.length ||
          (await handle.read(mime, 0, mime.length, 6)).bytesRead !== mime.length
        )
          fail("Некорректные метаданные сохранённого файла");
        validateModifiedUtf(mime);
      } finally {
        await handle.close();
      }
    }
    return { manifest, staged };
  } finally {
    zip.close();
  }
}

async function downloadSource({
  url,
  phone,
  password,
  destination,
  fetchImpl = fetch,
  limits = LIMITS,
  onProgress = () => {},
}) {
  const base = validateSourceUrl(url);
  let token, actorPhone;
  const endpoint = (suffix) => new URL(suffix, base).href;
  try {
    onProgress("Входим на сайт-источник…");
    const login = await fetchImpl(endpoint("api/auth/login"), {
      method: "POST",
      redirect: "manual",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ phone, password }),
      signal: AbortSignal.timeout(30000),
    });
    if (!login.ok || login.status >= 300)
      fail("Не удалось войти на сайт-источник");
    let payload;
    try {
      payload = JSON.parse(
        await streamText(Readable.fromWeb(login.body), 128 * 1024),
      );
    } catch {
      fail("Некорректный ответ авторизации сайта");
    }
    token = payload?.success && payload.data?.token;
    if (
      typeof token !== "string" ||
      !token ||
      token.length > 4096 ||
      !/^[A-Za-z0-9._~-]+$/.test(token)
    )
      fail("Сайт не предоставил сессию для переноса");
    actorPhone = payload.data?.user?.phone;
    onProgress("Скачиваем согласованную копию данных…");
    const response = await fetchImpl(endpoint("api/data-transfer/export"), {
      redirect: "manual",
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(15 * 60000),
    });
    if (!response.ok || response.status >= 300 || !response.body)
      fail("Сайт не разрешил экспорт данных; проверьте права и версию сайта");
    const contentLength = response.headers.get("content-length");
    if (
      contentLength &&
      (!/^\d+$/.test(contentLength) ||
        Number(contentLength) > limits.maxArchive)
    )
      fail("Копия сайта слишком большая");
    let bytes = 0;
    const bound = new Transform({
      transform(chunk, _encoding, next) {
        bytes += chunk.length;
        next(
          bytes > limits.maxArchive
            ? controlledError("Копия сайта превышает допустимый размер")
            : null,
          chunk,
        );
      },
    });
    await pipeline(
      Readable.fromWeb(response.body),
      bound,
      createWriteStream(destination, { flags: "wx", mode: 0o600 }),
    );
    return { actorPhone };
  } finally {
    password = undefined;
    if (token) {
      try {
        await fetchImpl(endpoint("api/auth/logout"), {
          method: "POST",
          redirect: "manual",
          headers: { Authorization: `Bearer ${token}` },
          signal: AbortSignal.timeout(10000),
        });
      } catch {
        /* best-effort revoke after a network failure; normal path is revoked */
      }
      token = undefined;
    }
  }
}

async function databaseMetadata(client) {
  const tables = (
    await client.query(
      `SELECT c.relname AS name FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind IN ('r','p') AND NOT c.relispartition ORDER BY c.relname`,
    )
  ).rows;
  const columns = (
    await client.query(
      `SELECT c.relname AS table_name,a.attname AS name,format_type(a.atttypid,a.atttypmod) AS type,a.attnotnull AS required,a.attgenerated AS generated,a.attidentity AS identity,pg_get_expr(d.adbin,d.adrelid) AS default_value FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace JOIN pg_attribute a ON a.attrelid=c.oid LEFT JOIN pg_attrdef d ON d.adrelid=c.oid AND d.adnum=a.attnum WHERE n.nspname='public' AND c.relkind IN ('r','p') AND NOT c.relispartition AND a.attnum>0 AND NOT a.attisdropped ORDER BY c.relname,a.attnum`,
    )
  ).rows;
  const constraints = (
    await client.query(
      `SELECT c.relname AS table_name,k.conname AS name,k.condeferrable AS deferrable,k.condeferred AS deferred,pg_get_constraintdef(k.oid) AS definition FROM pg_constraint k JOIN pg_class c ON c.oid=k.conrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND k.contype='f' AND NOT c.relispartition ORDER BY c.relname,k.conname`,
    )
  ).rows;
  const sequences = (
    await client.query(
      `SELECT c.relname AS name FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind='S' ORDER BY c.relname`,
    )
  ).rows;
  const schema = (
    await client.query(
      `SELECT version FROM public.flyway_schema_history WHERE success AND version IS NOT NULL ORDER BY installed_rank DESC LIMIT 1`,
    )
  ).rows[0]?.version;
  versionParts(schema);
  return {
    tables: tables.map((t) => ({
      name: t.name,
      columns: columns.filter((c) => c.table_name === t.name),
    })),
    constraints,
    sequences,
    schemaVersion: schema,
  };
}
async function fingerprint(client, runtime, expectedCounts) {
  await client.query("SET TIME ZONE 'UTC'");
  const metadata = await databaseMetadata(client),
    hash = createHash("sha256");
  hash.update(JSON.stringify(metadata));
  const rowCounts = {};
  for (const table of metadata.tables.filter((t) => !EPHEMERAL.has(t.name))) {
    hash.update(table.name);
    const count = (
      await client.query(
        `SELECT count(*)::text AS count FROM ${tableSql(table.name)}`,
      )
    ).rows[0].count;
    rowCounts[table.name] = count;
    if (expectedCounts && count !== expectedCounts[table.name])
      return { changed: true };
    const expression = table.columns
      .map((c) => `${quote(c.name)}::text`)
      .join(",");
    // Cursor avoids putting a mature data set in Node memory when refusing import.
    await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    try {
      await client.query(
        `DECLARE import_fingerprint NO SCROLL CURSOR FOR SELECT jsonb_build_array(${expression})::text AS value FROM ${tableSql(table.name)} ORDER BY jsonb_build_array(${expression})::text COLLATE "C"`,
      );
      while (true) {
        const rows = (await client.query("FETCH 500 FROM import_fingerprint"))
          .rows;
        if (!rows.length) break;
        for (const row of rows) hash.update(row.value + "\n");
      }
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK").catch(() => {});
      throw error;
    }
  }
  const files = path.join(runtime.dataDir, "files");
  if (await exists(files))
    for (const name of (await fs.readdir(files)).sort()) {
      const target = path.join(files, name),
        stat = await fs.lstat(target);
      if (!stat.isFile() || stat.isSymbolicLink())
        fail("Локальное хранилище содержит неподдерживаемую запись");
      hash.update(name);
      hash.update(await fileHash(target));
    }
  for (const name of ["integrations.json"]) {
    const file = path.join(runtime.dataDir, name);
    hash.update(name);
    hash.update((await exists(file)) ? await fileHash(file) : "absent");
  }
  return {
    digest: hash.digest("hex"),
    schemaVersion: metadata.schemaVersion,
    rowCounts,
  };
}
function compatibleSchema(manifest, metadata) {
  if (compareVersions(manifest.schemaVersion, metadata.schemaVersion) > 0)
    fail("Схема сайта новее приложения; сначала обновите приложение");
  const local = new Map(metadata.tables.map((t) => [t.name, t]));
  for (const table of manifest.tables) {
    const target = local.get(table.name);
    if (!target || EXCLUDED.has(table.name))
      fail("Копия содержит неизвестную таблицу");
    const columns = new Map(target.columns.map((c) => [c.name, c]));
    for (const source of table.columns) {
      const column = columns.get(source.name);
      if (!column || column.generated || source.type !== column.type)
        fail("Столбцы копии несовместимы с приложением");
    }
    for (const column of target.columns)
      if (
        !table.columns.some((c) => c.name === column.name) &&
        column.required &&
        !column.default_value &&
        !column.identity &&
        !column.generated
      )
        fail("В копии отсутствует обязательный столбец");
  }
  if (compareVersions(manifest.schemaVersion, metadata.schemaVersion) === 0) {
    for (const table of manifest.tables) {
      const target = local.get(table.name);
      if (target.columns.length !== table.columns.length)
        fail("В копии отсутствуют столбцы существующей схемы");
    }
  }
  const sequences = new Set(metadata.sequences.map((s) => s.name));
  for (const sequence of manifest.sequences || [])
    if (!sequences.has(sequence.name))
      fail("Копия содержит неизвестный счётчик");
  const importedSequences = new Set(
    (manifest.sequences || []).map((s) => s.name),
  );
  for (const name of sequences)
    if (!importedSequences.has(name))
      fail("В копии отсутствуют счётчики документов; обновите сайт-источник");
  const sourceTables = new Set(manifest.tables.map((t) => t.name));
  // Exact-schema exports must be complete: an omitted table must not silently
  // erase accounts, settings or business documents.
  for (const table of metadata.tables)
    if (!EXCLUDED.has(table.name) && !sourceTables.has(table.name))
      fail("Копия содержит неполный набор таблиц");
}
async function* rowsFromFile(file, columns, count, limits) {
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let pending = "",
    found = 0;
  function parse(line) {
    if (Buffer.byteLength(line) > limits.maxRow)
      fail("Строка копии слишком большая");
    let row;
    try {
      row = JSON.parse(line);
    } catch {
      fail("Некорректная строка данных");
    }
    if (
      !Array.isArray(row) ||
      row.length !== columns ||
      row.some(
        (value) =>
          value !== null &&
          (typeof value !== "string" || !value.isWellFormed()),
      )
    )
      fail("Некорректные значения строки данных");
    if (++found > count) fail("Число строк превышает манифест");
    return row;
  }
  for await (const part of createReadStream(file)) {
    pending += decoder.decode(part, { stream: true });
    let newline;
    while ((newline = pending.indexOf("\n")) >= 0) {
      const line = pending.slice(0, newline).replace(/\r$/, "");
      pending = pending.slice(newline + 1);
      yield parse(line);
    }
    if (Buffer.byteLength(pending) > limits.maxRow)
      fail("Строка копии слишком большая");
  }
  pending += decoder.decode();
  if (pending) yield parse(pending);
  if (found !== count) fail("Число строк не совпадает с манифестом");
}
async function validateRowsAndFiles(archive, actorPhone, limits = LIMITS) {
  const fileColumns = {
    categories: "image_file_path",
    product_images: "file_path",
    review_images: "file_path",
    procurement_files: "file_path",
  };
  const files = new Map(archive.manifest.files.map((file) => [file.key, file]));
  const payloads = new Map();
  let foundActor = !actorPhone;
  for (const table of archive.manifest.tables) {
    const index = (name) => table.columns.findIndex((c) => c.name === name);
    const fileIndex = index(fileColumns[table.name]);
    for await (const row of rowsFromFile(
      archive.staged.get(table.entry),
      table.columns.length,
      table.rowCount,
      limits,
    )) {
      if (
        actorPhone &&
        table.name === "users" &&
        row[index("phone")] === actorPhone &&
        ["t", "true"].includes(row[index("active")]) &&
        row[index("deleted_at")] === null &&
        row[index("password_hash")]
      )
        foundActor = true;
      if (fileIndex < 0 || !row[fileIndex]?.startsWith("/uploads/")) continue;
      const key = row[fileIndex].slice(1),
        object = files.get(key);
      if (!object)
        fail("В копии отсутствует файл, на который ссылаются данные");
      let payload = payloads.get(key);
      if (!payload) {
        const file = archive.staged.get(object.entry),
          header = Buffer.alloc(6),
          handle = await fs.open(file, "r");
        try {
          await handle.read(header, 0, 6, 0);
        } finally {
          await handle.close();
        }
        const start = 6 + header.readUInt16BE(4),
          digest = createHash("sha256");
        for await (const part of createReadStream(file, { start }))
          digest.update(part);
        payload = { hash: digest.digest("hex"), size: object.size - start };
        payloads.set(key, payload);
      }
      const expectedHash =
        row[
          index(
            table.name === "categories" ? "image_content_hash" : "content_hash",
          )
        ];
      if (
        expectedHash !== undefined &&
        expectedHash !== null &&
        expectedHash.toLowerCase() !== payload.hash
      )
        fail("Содержимое файла не совпадает с данными сайта");
      const expectedSize = row[index("file_size")];
      if (
        expectedSize !== undefined &&
        expectedSize !== null &&
        (!/^\d+$/.test(expectedSize) ||
          BigInt(expectedSize) !== BigInt(payload.size))
      )
        fail("Размер файла не совпадает с данными сайта");
    }
  }
  if (!foundActor) fail("Копия не содержит активную учётную запись источника");
}
async function restoreDatabase(
  client,
  archive,
  metadata,
  limits = LIMITS,
  onProgress = () => {},
) {
  compatibleSchema(archive.manifest, metadata);
  const tables = metadata.tables.filter(
    (t) => t.name !== "flyway_schema_history",
  );
  await client.query("BEGIN");
  try {
    await client.query("SET LOCAL TIME ZONE 'UTC'");
    for (const constraint of metadata.constraints)
      await client.query(
        `ALTER TABLE ${tableSql(constraint.table_name)} ALTER CONSTRAINT ${quote(constraint.name)} DEFERRABLE INITIALLY DEFERRED`,
      );
    await client.query("SET CONSTRAINTS ALL DEFERRED");
    await client.query(
      `TRUNCATE TABLE ${tables.map((t) => tableSql(t.name)).join(",")} RESTART IDENTITY`,
    );
    const local = new Map(metadata.tables.map((t) => [t.name, t]));
    for (const table of archive.manifest.tables) {
      const columns = new Map(
        local.get(table.name).columns.map((c) => [c.name, c]),
      );
      const fields = table.columns.map((c) => quote(c.name)).join(",");
      const maxBatch = Math.max(
        1,
        Math.min(100, Math.floor(60000 / table.columns.length)),
      );
      let batch = [],
        batchBytes = 0;
      const flush = async () => {
        if (!batch.length) return;
        const values = batch.flat();
        const argumentsSql = batch
          .map(
            (_, row) =>
              "(" +
              table.columns
                .map(
                  (c, i) =>
                    `$${row * table.columns.length + i + 1}::${columns.get(c.name).type}`,
                )
                .join(",") +
              ")",
          )
          .join(",");
        await client.query(
          `INSERT INTO ${tableSql(table.name)} (${fields}) OVERRIDING SYSTEM VALUE VALUES ${argumentsSql}`,
          values,
        );
        batch = [];
        batchBytes = 0;
      };
      for await (const row of rowsFromFile(
        archive.staged.get(table.entry),
        table.columns.length,
        table.rowCount,
        limits,
      )) {
        batch.push(row);
        batchBytes += Buffer.byteLength(JSON.stringify(row));
        if (batch.length >= maxBatch || batchBytes >= 4 * 1024 ** 2)
          await flush();
      }
      await flush();
      onProgress("Перенос данных продолжается…");
    }
    await client.query("SET CONSTRAINTS ALL IMMEDIATE");
    for (const constraint of metadata.constraints)
      await client.query(
        `ALTER TABLE ${tableSql(constraint.table_name)} ALTER CONSTRAINT ${quote(constraint.name)} ${constraint.deferrable ? `DEFERRABLE INITIALLY ${constraint.deferred ? "DEFERRED" : "IMMEDIATE"}` : "NOT DEFERRABLE INITIALLY IMMEDIATE"}`,
      );
    for (const sequence of archive.manifest.sequences || [])
      await client.query(
        "SELECT pg_catalog.setval($1::regclass,$2::bigint,$3::boolean)",
        [
          `public.${quote(sequence.name)}`,
          sequence.lastValue,
          sequence.isCalled,
        ],
      );
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  }
}

function createDataImporter({
  runtime,
  version,
  fetchImpl = fetch,
  clientFactory,
  limits = LIMITS,
}) {
  const baselineFile = path.join(runtime.dataDir, "data-import-baseline.json");
  let busy = false;
  const connection = async () => {
    const client = clientFactory
      ? clientFactory()
      : new Client({
          host: "127.0.0.1",
          port: runtime.config.postgresPort,
          user: "ovoshi_help",
          password: runtime.config.databasePassword,
          database: "ovoshi_help",
        });
    await client.connect();
    return client;
  };
  async function verifyPristine(client) {
    return require("./import-eligibility.cjs").verifyPristineReference(
      client,
      path.join(runtime.root, "import-reference.json"),
      path.join(runtime.dataDir, "files"),
    );
  }
  async function inspectEligibility() {
    let baseline = await readJson(baselineFile, null);
    if (
      baseline &&
      (!baseline.pristine ||
        baseline.formatVersion !== 1 ||
        typeof baseline.digest !== "string")
    )
      return {
        eligible: false,
        reason:
          "Перенос доступен только в новую локальную базу без собственных данных",
      };
    const client = await connection();
    try {
      if (!baseline) {
        const verified = await verifyPristine(client);
        if (!verified.eligible) return verified;
        baseline = {
          formatVersion: 1,
          pristine: true,
          version,
          ...(await fingerprint(client, runtime)),
        };
        await writeJson(baselineFile, baseline);
      }
      const current = await fingerprint(client, runtime, baseline.rowCounts);
      return !current.changed && current.digest === baseline.digest
        ? { eligible: true }
        : {
            eligible: false,
            reason:
              "В приложении уже изменены данные или настройки. Перенос не заменит их",
          };
    } finally {
      await client.end();
    }
  }
  async function captureBaseline({ trustedFreshSetup = false } = {}) {
    if (await exists(baselineFile)) return;
    const client = await connection();
    try {
      if (!trustedFreshSetup && !(await verifyPristine(client)).eligible)
        fail("Нельзя объявить существующую базу пустой");
      const value = await fingerprint(client, runtime);
      await writeJson(baselineFile, {
        formatVersion: 1,
        pristine: true,
        version,
        ...value,
      });
    } finally {
      await client.end();
    }
  }
  async function importFromSource({
    url,
    phone,
    password,
    onProgress = () => {},
  }) {
    if (busy) fail("Перенос уже выполняется");
    busy = true;
    let directory,
      backup,
      modified = false;
    const progressCallback = onProgress;
    const notify = (message) => {
      try {
        progressCallback(message);
      } catch {
        /* closed UI */
      }
    };
    onProgress = notify;
    try {
      validateSourceUrl(url);
      if (
        typeof phone !== "string" ||
        typeof password !== "string" ||
        phone.length > 64 ||
        password.length < 8 ||
        password.length > 100
      )
        fail("Введите телефон и пароль сайта");
      const eligibility = await inspectEligibility();
      if (!eligibility.eligible) fail(eligibility.reason);
      directory = await fs.mkdtemp(
        path.join(runtime.userData, "data-transfer-"),
      );
      await fs.chmod(directory, 0o700);
      const downloaded = await downloadSource({
        url,
        phone,
        password,
        destination: path.join(directory, "source.zip"),
        fetchImpl,
        limits,
        onProgress,
      });
      password = undefined;
      const archive = await stageArchive(
        path.join(directory, "source.zip"),
        directory,
        { limits, onProgress },
      );
      if (typeof downloaded.actorPhone !== "string" || !downloaded.actorPhone)
        fail("Сайт не предоставил данные учётной записи для проверки копии");
      await validateRowsAndFiles(archive, downloaded.actorPhone, limits);
      let client = await connection();
      try {
        compatibleSchema(archive.manifest, await databaseMetadata(client));
      } finally {
        await client.end();
      }
      await runtime.pauseBackend();
      const pausedEligibility = await inspectEligibility();
      if (!pausedEligibility.eligible) fail(pausedEligibility.reason);
      onProgress("Сохраняем резервную копию новой локальной базы…");
      backup = await runtime.backup("before-data-import");
      await writeJson(path.join(runtime.userData, "data-import-pending.json"), {
        schemaVersion: 1,
        backup,
        workspace: directory,
      });
      const journalHandle = await fs.open(
        path.join(runtime.userData, "data-import-pending.json"),
        "r",
      );
      try {
        await journalHandle.sync();
      } finally {
        await journalHandle.close();
      }
      modified = true;
      await runtime.resumeDatabase();
      client = await connection();
      try {
        modified = true;
        await restoreDatabase(
          client,
          archive,
          await databaseMetadata(client),
          limits,
          onProgress,
        );
      } finally {
        await client.end();
      }
      await runtime.stop();
      const files = path.join(directory, "files");
      await fs.mkdir(files);
      for (const item of archive.manifest.files)
        await fs.copyFile(
          archive.staged.get(item.entry),
          path.join(files, sha(item.key) + ".object"),
        );
      const previousFiles = path.join(runtime.dataDir, "files-before-import");
      await fs.rename(path.join(runtime.dataDir, "files"), previousFiles);
      await fs.rename(files, path.join(runtime.dataDir, "files"));
      await fs.rm(previousFiles, { recursive: true, force: true });
      await writeJson(baselineFile, {
        formatVersion: 1,
        pristine: false,
        importedAt: new Date().toISOString(),
      });
      const appState = await readJson(
        path.join(runtime.dataDir, "app-state.json"),
        {},
      );
      await writeJson(path.join(runtime.dataDir, "app-state.json"), {
        ...appState,
        importedData: true,
      });
      onProgress("Запускаем приложение с перенесёнными данными…");
      await runtime.start();
      await fs.rm(path.join(runtime.userData, "data-import-pending.json"), {
        force: true,
      });
      return {
        imported: true,
        tables: archive.manifest.tables.length,
        files: archive.manifest.files.length,
        backup,
      };
    } catch (error) {
      if (backup && modified) {
        await runtime.stop();
        if (directory) {
          await fs.rm(directory, { recursive: true, force: true });
          directory = null;
        }
        try {
          await runtime.restoreBackup(backup);
          await runtime.start();
          await fs.rm(path.join(runtime.userData, "data-import-pending.json"), {
            force: true,
          });
        } catch {
          fail(
            "Перенос прерван. Резервная копия сохранена; требуется восстановить локальные данные перед запуском",
          );
        }
        fail(
          "Перенос не завершён. Локальные данные восстановлены из резервной копии",
        );
      }
      if (!runtime.started) await runtime.start().catch(() => {});
      throw error;
    } finally {
      password = undefined;
      if (directory) await fs.rm(directory, { recursive: true, force: true });
      busy = false;
    }
  }
  async function recoverPendingImport() {
    const journalFile = path.join(runtime.userData, "data-import-pending.json");
    const journal = await readJson(journalFile, null);
    if (!journal) return false;
    if (
      journal.schemaVersion !== 1 ||
      typeof journal.backup !== "string" ||
      !path
        .resolve(journal.backup)
        .startsWith(path.resolve(runtime.backupsDir) + path.sep)
    )
      fail(
        "Не найдена безопасная копия для восстановления прерванного переноса",
      );
    await runtime.recoverInterruptedRestore();
    await runtime.loadManifest();
    await runtime.ensureDatabaseStopped();
    await runtime.stop();
    if (
      typeof journal.workspace === "string" &&
      path.dirname(path.resolve(journal.workspace)) ===
        path.resolve(runtime.userData) &&
      path.basename(journal.workspace).startsWith("data-transfer-")
    )
      await fs.rm(journal.workspace, { recursive: true, force: true });
    await runtime.restoreBackup(journal.backup);
    await fs.rm(journalFile, { force: true });
    return true;
  }
  return {
    captureBaseline,
    inspectEligibility,
    importFromSource,
    recoverPendingImport,
  };
}
module.exports = {
  createDataImporter,
  validateSourceUrl,
  validateManifest,
  compareVersions,
  stageArchive,
  downloadSource,
  databaseMetadata,
  compatibleSchema,
  rowsFromFile,
  restoreDatabase,
  validateRowsAndFiles,
  fingerprint,
  LIMITS,
  EXCLUDED,
};
