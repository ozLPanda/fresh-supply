import assert from "node:assert/strict";
import { test } from "node:test";
import { reorderWarehouseDocumentLine as move } from "./warehouseDocumentLineOrder.ts";

const rows = () => [
  { localId: "a", quantity: 3, unitPrice: 120, sourceDocumentId: "receipt-1" },
  { localId: "b", quantity: 0, unitCost: 75 },
  { localId: "c", quantity: 1.25, unitPrice: 90 },
];
const ids = (lines) => lines.map((line) => line.localId);

test("arrows move to both edges without modifying row values or the original array", () => {
  const original = rows();
  const down = move(original, "a", "b", "after", false);
  assert.deepEqual(ids(down), ["b", "a", "c"]);
  assert.deepEqual(ids(move(down, "a", "c", "after", false)), ["b", "c", "a"]);
  assert.deepEqual(ids(move(original, "c", "a", "before", false)), ["c", "a", "b"]);
  assert.deepEqual(ids(original), ["a", "b", "c"]);
  assert.equal(down[1], original[0]);
  assert.equal(down[0], original[1]);
});

test("drag inserts before the target in either direction", () => {
  assert.deepEqual(ids(move(rows(), "a", "c", "before", false)), ["b", "a", "c"]);
  assert.deepEqual(ids(move(rows(), "c", "b", "before", false)), ["a", "c", "b"]);
});

test("stale targets, self drops, and empty documents are safe no-ops", () => {
  const original = rows();
  assert.equal(move(original, "a", "a", "before", false), original);
  assert.equal(move(original, "deleted", "a", "before", false), original);
  assert.equal(move(original, "a", "deleted", "after", false), original);
  assert.deepEqual(move([], "a", "b", "before", false), []);
});

test("price group order, membership and ungrouped slots survive reordering", () => {
  const original = [
    { localId: "a", productGroupName: "Трубы" },
    { localId: "x", productGroupName: null },
    { localId: "b", productGroupName: " Трубы " },
    { localId: "y", productGroupName: "" },
    { localId: "c", productGroupName: "Краны" },
  ];
  assert.deepEqual(ids(move(original, "a", "b", "after", true)), ["b", "x", "a", "y", "c"]);
  assert.deepEqual(ids(move(original, "y", "x", "before", true)), ["a", "y", "b", "x", "c"]);
  assert.equal(move(original, "a", "c", "before", true), original);
});
