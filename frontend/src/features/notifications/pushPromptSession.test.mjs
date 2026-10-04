import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

const source = await readFile(new URL("./pushPromptSession.ts", import.meta.url), "utf8");
const { outputText } = ts.transpileModule(source, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 },
});
const { createPushPromptSession, pushPromptSession } = await import(
  `data:text/javascript;base64,${Buffer.from(outputText).toString("base64")}`
);

function makeStorage() {
  const values = new Map();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: (key) => values.delete(key),
  };
}

test("app start, checkout and admin orders share one invitation per session", () => {
  const session = createPushPromptSession(makeStorage());
  const triggerResults = ["app-start", "checkout", "admin-orders"].map(() => session.claim(42));
  assert.deepEqual(triggerResults, [true, false, false]);
});

test("a page reload retains the invitation claim for the same signed-in user", () => {
  const storage = makeStorage();
  assert.equal(createPushPromptSession(storage).claim(42), true);
  const afterReload = createPushPromptSession(storage);
  assert.equal(afterReload.claim(42), false);
  assert.equal(afterReload.claim(42), false);
});

test("logout resets both memory and storage so the same user can be invited again", () => {
  const storage = makeStorage();
  const session = createPushPromptSession(storage);
  assert.equal(session.claim(42), true);
  assert.equal(session.claim(42), false);
  session.reset();
  const afterLogoutReload = createPushPromptSession(storage);
  assert.equal(afterLogoutReload.claim(42), true);
  assert.equal(afterLogoutReload.claim(42), false);
  session.reset();
  assert.equal(session.claim(42), true);
  assert.equal(session.claim(42), false);
});

test("a fresh app/tab session can invite a previously invited user", () => {
  assert.equal(createPushPromptSession(makeStorage()).claim(42), true);
  const freshSession = createPushPromptSession(makeStorage());
  assert.equal(freshSession.claim(42), true);
  assert.equal(freshSession.claim(42), false);
});

test("a different signed-in user can receive their own invitation", () => {
  const storage = makeStorage();
  const session = createPushPromptSession(storage);
  assert.equal(session.claim(42), true);
  assert.equal(session.claim(43), true);
  assert.equal(session.claim(43), false);
  assert.equal(createPushPromptSession(storage).claim(43), false);
});

test("persisted user IDs are compared as strings after a reload", () => {
  const storage = makeStorage();
  const originalSetItem = storage.setItem;
  const writtenValues = [];
  storage.setItem = (key, value) => {
    writtenValues.push(value);
    originalSetItem(key, value);
  };
  assert.equal(createPushPromptSession(storage).claim(42), true);
  assert.deepEqual(writtenValues, ["42"]);
  assert.equal(createPushPromptSession(storage).claim(42), false);
  assert.equal(createPushPromptSession(storage).claim(420), true);
});

test("missing storage suppresses repeated invitations in memory and resets on logout", () => {
  const session = createPushPromptSession();
  assert.equal(session.claim(42), true);
  assert.equal(session.claim(42), false);
  session.reset();
  assert.equal(session.claim(42), true);
  assert.equal(session.claim(42), false);
});

for (const failingMethod of ["getItem", "setItem", "removeItem"]) {
  test(`storage ${failingMethod} failure preserves the in-memory invitation limit and logout reset`, () => {
    const storage = makeStorage();
    storage[failingMethod] = () => {
      throw new Error("Storage access denied");
    };
    const session = createPushPromptSession(storage);
    assert.equal(session.claim(42), true);
    assert.equal(session.claim(42), false);
    session.reset();
    assert.equal(session.claim(42), true);
    assert.equal(session.claim(42), false);
    assert.equal(session.claim(43), true);
    assert.equal(session.claim(43), false);
  });
}

test("the exported singleton can operate when browser sessionStorage is unavailable", () => {
  pushPromptSession.reset();
  assert.equal(pushPromptSession.claim(42), true);
  assert.equal(pushPromptSession.claim(42), false);
  pushPromptSession.reset();
  assert.equal(pushPromptSession.claim(42), true);
  pushPromptSession.reset();
});
