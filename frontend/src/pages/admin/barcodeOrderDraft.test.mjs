import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

const compilerOptions = { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 };
const asModuleUrl = (source) =>
  `data:text/javascript;base64,${Buffer.from(source).toString("base64")}`;
// Use the real quantity parser without importing the JSX field and its browser dependencies.
const quantitySource = await readFile(
  new URL("../../features/orders/OrderQuantityInput.tsx", import.meta.url),
  "utf8",
);
const quantityAst = ts.createSourceFile("quantity.tsx", quantitySource, ts.ScriptTarget.ES2022);
const quantityFunction = quantityAst.statements.find(
  (statement) =>
    ts.isFunctionDeclaration(statement) && statement.name?.text === "normalizeOrderQuantity",
);
const quantityModule = ts.transpileModule(
  `const MIN_ORDER_QUANTITY = 0.001; const MAX_ORDER_QUANTITY = 999; ${quantityFunction.getText(quantityAst)}`,
  { compilerOptions },
).outputText;
const source = await readFile(new URL("./barcodeOrderDraft.ts", import.meta.url), "utf8");
const compiled = ts
  .transpileModule(source, { compilerOptions })
  .outputText.replace(
    '"@/features/orders/OrderQuantityInput"',
    JSON.stringify(asModuleUrl(quantityModule)),
  );
const {
  readBarcodeOrderDraft,
  writeBarcodeOrderDraft,
  clearBarcodeOrderDraft,
  readOrderDraftWorkspace,
  writeOrderDraftEntry,
  removeOrderDraftEntry,
  activateOrderDraftEntry,
} = await import(asModuleUrl(compiled));

function makeStorage() {
  const values = new Map();
  return {
    values,
    get length() {
      return values.size;
    },
    key: (index) => [...values.keys()][index] ?? null,
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: (key) => values.delete(key),
  };
}

const makeDraft = (comment = "Комментарий") => ({
  lines: [
    {
      id: 11,
      sku: "S-11",
      name: "Товар",
      mainImageUrl: null,
      madeToOrder: false,
      measurementUnit: "KG",
      retailPrice: 700,
      wholesalePrice: 600,
      bulkWholesalePrice: 550,
      skoPrice: null,
      quantity: 1.25,
      unitPrice: 580,
    },
  ],
  priceTier: "WHOLESALE",
  orderDate: "2026-10-09",
  selectedPriceLineIds: [11],
  priceAdjustmentOperation: "ADD",
  priceAdjustmentValue: "-20",
  priceAdjustmentOriginalPrices: { 11: 600 },
  priceAdjustmentHistoryByLine: { 11: [{ operation: "ADD", value: -20 }] },
  comment,
  selectedCustomerId: 42,
  regularBuyerId: "11111111-1111-1111-1111-111111111111",
  selectedPendingBinding: { email: null, phone: null, label: "Будущий клиент" },
  assistantImport: {
    sessionId: "session-1",
    revision: 3,
    unresolved: [
      { source: "doc", name: "Неизвестный товар", quantity: 2, unit: "шт", reason: "Не найден" },
    ],
    questions: ["Уточнить товар"],
    reviewed: false,
  },
});
const entry = (id, comment = id) => ({ id, title: `Заказ ${id}`, data: makeDraft(comment) });
const v1Key = (user = 7, mode = "barcode", session) =>
  `company_shop_admin_order_draft_v1_${user}_${mode}${session ? `_assistant_${session}` : ""}`;
const v2Key = (user = 7, mode = "barcode") => `company_shop_admin_order_draft_v2_${user}_${mode}`;
const ids = (workspace) => workspace.drafts.map((draft) => draft.id);

test("migrates default and every assistant draft without losing independent order fields", () => {
  const storage = (globalThis.localStorage = makeStorage());
  writeBarcodeOrderDraft(7, "barcode", makeDraft("default"));
  writeBarcodeOrderDraft(7, "barcode", makeDraft("assistant a"), "a");
  writeBarcodeOrderDraft(7, "barcode", makeDraft("assistant b"), "b");
  const workspace = readOrderDraftWorkspace(7, "barcode");
  assert.deepEqual(ids(workspace), ["legacy-default", "legacy-assistant-a", "legacy-assistant-b"]);
  assert.equal(workspace.activeId, "legacy-default");
  for (const migrated of workspace.drafts) {
    const { savedAt, ...restored } = migrated.data;
    assert.deepEqual(restored, makeDraft(restored.comment));
    assert.ok(Number.isFinite(Date.parse(savedAt)));
  }
  assert.equal(workspace.drafts[1].assistantSessionId, "a");
  assert.equal(storage.getItem(v1Key()), null);
  assert.equal(storage.getItem(v1Key(7, "barcode", "a")), null);
  assert.deepEqual(readOrderDraftWorkspace(7, "barcode"), workspace);
});

test("user and creation mode have isolated workspaces and legacy migrations", () => {
  globalThis.localStorage = makeStorage();
  writeBarcodeOrderDraft(7, "selection", makeDraft("selection"));
  writeBarcodeOrderDraft(8, "barcode", makeDraft("other user"));
  assert.equal(writeOrderDraftEntry(7, "barcode", entry("own")), true);
  assert.deepEqual(ids(readOrderDraftWorkspace(7, "barcode")), ["own"]);
  assert.equal(readOrderDraftWorkspace(7, "selection").drafts[0].data.comment, "selection");
  assert.equal(readOrderDraftWorkspace(8, "barcode").drafts[0].data.comment, "other user");
  assert.equal(readOrderDraftWorkspace(8, "selection").drafts.length, 0);
});

test("upserts use fresh storage and never replace other entries with an old page snapshot", () => {
  globalThis.localStorage = makeStorage();
  writeOrderDraftEntry(7, "barcode", entry("a"));
  const stale = readOrderDraftWorkspace(7, "barcode").drafts[0];
  writeOrderDraftEntry(7, "barcode", entry("b"));
  writeOrderDraftEntry(7, "barcode", { ...stale, data: makeDraft("updated a") });
  const workspace = readOrderDraftWorkspace(7, "barcode");
  assert.deepEqual(ids(workspace), ["a", "b"]);
  assert.equal(workspace.drafts[0].data.comment, "updated a");
  assert.equal(workspace.drafts[1].data.comment, "b");
  assert.ok(Number.isFinite(Date.parse(workspace.drafts[0].data.savedAt)));
});

test("activating persists only selection and removing the active entry picks a neighbor", () => {
  globalThis.localStorage = makeStorage();
  for (const id of ["a", "b", "c"]) writeOrderDraftEntry(7, "barcode", entry(id));
  const before = readOrderDraftWorkspace(7, "barcode");
  assert.equal(activateOrderDraftEntry(7, "barcode", "b"), true);
  assert.deepEqual(readOrderDraftWorkspace(7, "barcode").drafts, before.drafts);
  assert.equal(readOrderDraftWorkspace(7, "barcode").activeId, "b");
  assert.equal(removeOrderDraftEntry(7, "barcode", "a"), true);
  assert.equal(readOrderDraftWorkspace(7, "barcode").activeId, "b");
  assert.equal(removeOrderDraftEntry(7, "barcode", "b"), true);
  assert.equal(readOrderDraftWorkspace(7, "barcode").activeId, "c");
  assert.equal(removeOrderDraftEntry(7, "barcode", "c"), true);
  assert.deepEqual(readOrderDraftWorkspace(7, "barcode"), {
    version: 2,
    drafts: [],
    activeId: null,
  });
  assert.equal(activateOrderDraftEntry(7, "barcode", "missing"), false);
  assert.equal(removeOrderDraftEntry(7, "barcode", "missing"), true);
});

test("quota failure keeps every legacy source, returns recoverable data and reports mutations failed", () => {
  const storage = (globalThis.localStorage = makeStorage());
  writeBarcodeOrderDraft(7, "barcode", makeDraft(), "a");
  const original = storage.getItem(v1Key(7, "barcode", "a"));
  const setItem = storage.setItem;
  storage.setItem = () => {
    throw new Error("Quota exceeded");
  };
  assert.equal(readOrderDraftWorkspace(7, "barcode").drafts.length, 1);
  assert.equal(storage.getItem(v1Key(7, "barcode", "a")), original);
  assert.equal(storage.getItem(v2Key()), null);
  assert.equal(writeOrderDraftEntry(7, "barcode", entry("new")), false);
  assert.equal(removeOrderDraftEntry(7, "barcode", "legacy-assistant-a"), false);
  assert.equal(activateOrderDraftEntry(7, "barcode", "legacy-assistant-a"), false);
  storage.setItem = setItem;
  assert.equal(readOrderDraftWorkspace(7, "barcode").drafts.length, 1);
  assert.equal(storage.getItem(v1Key(7, "barcode", "a")), null);
});

test("failed legacy cleanup never resurrects a removed migrated order", () => {
  const storage = (globalThis.localStorage = makeStorage());
  writeBarcodeOrderDraft(7, "barcode", makeDraft());
  storage.removeItem = () => {
    throw new Error("Removal blocked");
  };
  assert.equal(readOrderDraftWorkspace(7, "barcode").drafts.length, 1);
  assert.equal(removeOrderDraftEntry(7, "barcode", "legacy-default"), true);
  assert.equal(readOrderDraftWorkspace(7, "barcode").drafts.length, 0);
  assert.ok(storage.getItem(v1Key()));
});

test("denied read access reports failure without overwriting unreadable existing storage", () => {
  const storage = (globalThis.localStorage = makeStorage());
  writeOrderDraftEntry(7, "barcode", entry("old"));
  const raw = storage.values.get(v2Key());
  storage.getItem = () => {
    throw new Error("Access denied");
  };
  assert.equal(writeOrderDraftEntry(7, "barcode", entry("new")), false);
  assert.equal(removeOrderDraftEntry(7, "barcode", "old"), false);
  assert.equal(activateOrderDraftEntry(7, "barcode", "old"), false);
  assert.deepEqual(readOrderDraftWorkspace(7, "barcode"), {
    version: 2,
    drafts: [],
    activeId: null,
  });
  assert.equal(storage.values.get(v2Key()), raw);
});

test("corrupt JSON, invalid entries and stale active IDs are parsed safely", () => {
  const storage = (globalThis.localStorage = makeStorage());
  storage.setItem(v2Key(), "{broken");
  assert.equal(readOrderDraftWorkspace(7, "barcode").drafts.length, 0);
  storage.setItem(
    v2Key(),
    JSON.stringify({
      version: 2,
      activeId: "missing",
      drafts: [
        null,
        entry("good"),
        entry("good", "duplicate"),
        { ...entry("bad"), title: " " },
        { ...entry("bad-data"), data: { ...makeDraft(), priceTier: "UNKNOWN" } },
        { ...entry("bad-session"), assistantSessionId: 123 },
      ],
    }),
  );
  const workspace = readOrderDraftWorkspace(7, "barcode");
  assert.deepEqual(ids(workspace), ["good"]);
  assert.equal(workspace.activeId, "good");
  assert.equal(writeOrderDraftEntry(7, "barcode", { ...entry("invalid"), id: " " }), false);
  storage.setItem(v1Key(7, "barcode", "corrupt"), "not-json");
  readOrderDraftWorkspace(7, "barcode");
  assert.equal(storage.getItem(v1Key(7, "barcode", "corrupt")), "not-json");
});

test("legacy read/write/clear API remains compatible", () => {
  globalThis.localStorage = makeStorage();
  writeBarcodeOrderDraft(7, "barcode", makeDraft(), "legacy");
  assert.equal(readBarcodeOrderDraft(7, "barcode", "legacy").comment, "Комментарий");
  clearBarcodeOrderDraft(7, "barcode", "legacy");
  assert.equal(readBarcodeOrderDraft(7, "barcode", "legacy"), null);
});

test("removal is idempotent and still reports denied writes", () => {
  const storage = (globalThis.localStorage = makeStorage());
  assert.equal(removeOrderDraftEntry(7, "barcode", "unsaved"), true);
  assert.equal(readOrderDraftWorkspace(7, "barcode").drafts.length, 0);
  storage.setItem = () => {
    throw new Error("denied");
  };
  assert.equal(removeOrderDraftEntry(7, "barcode", "unsaved"), false);
});
