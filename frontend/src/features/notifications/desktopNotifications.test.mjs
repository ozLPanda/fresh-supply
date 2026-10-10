import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

const source = await readFile(new URL("./desktopNotifications.ts", import.meta.url), "utf8");
const { outputText } = ts.transpileModule(source, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 },
});
const { createDesktopNotificationTracker, internalNotificationTarget } = await import(
  `data:text/javascript;base64,${Buffer.from(outputText).toString("base64")}`
);

test("first response establishes baseline without historical notification flood", () => {
  const tracker = createDesktopNotificationTracker();
  assert.deepEqual(
    tracker.observe(
      [
        { id: 1, read: false },
        { id: 2, read: true },
      ],
      42,
    ),
    [],
  );
  assert.deepEqual(
    tracker.observe(
      [
        { id: 3, read: false },
        { id: 1, read: false },
      ],
      42,
    ),
    [{ id: 3, read: false }],
  );
  assert.deepEqual(tracker.observe([{ id: 3, read: false }], 42), []);
});

test("read items and IDs returning after a paginated window are not replayed", () => {
  const tracker = createDesktopNotificationTracker();
  tracker.observe([{ id: 1, read: false }], 42);
  assert.deepEqual(tracker.observe([{ id: 2, read: true }], 42), []);
  assert.deepEqual(
    tracker.observe(
      [
        { id: 1, read: false },
        { id: 2, read: false },
      ],
      42,
    ),
    [],
  );
});

test("changing account establishes a separate history baseline", () => {
  const tracker = createDesktopNotificationTracker();
  tracker.observe([{ id: 1, read: false }], 42);
  assert.deepEqual(tracker.observe([{ id: 2, read: false }], 43), []);
  assert.deepEqual(
    tracker.observe(
      [
        { id: 3, read: false },
        { id: 2, read: false },
      ],
      43,
    ),
    [{ id: 3, read: false }],
  );
});

test("native alert targets retain internal order routes and filters", () => {
  assert.equal(
    internalNotificationTarget("/admin/orders/abc?status=NEW#details"),
    "/admin/orders/abc?status=NEW#details",
  );
  assert.equal(internalNotificationTarget("/orders/abc"), "/orders/abc");
});

test("native alert targets reject external, relative and browser-normalized host paths", () => {
  for (const target of [
    undefined,
    "https://evil.example",
    "//evil.example",
    "/\\evil.example",
    "javascript:alert(1)",
    "admin/orders/1",
    "/\nevil.example",
  ]) {
    assert.equal(internalNotificationTarget(target), undefined);
  }
});
