import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

// Run with Node's built-in runner; the frontend has no separate test framework.
const source = await readFile(new URL("./pushSubscription.ts", import.meta.url), "utf8");
const { outputText } = ts.transpileModule(source, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 },
});
const { serializePushSubscription, syncPushSubscription, waitForPushWorker } = await import(
  `data:text/javascript;base64,${Buffer.from(outputText).toString("base64")}`
);

const key = "AQID";
const makeSubscription = (bytes = [1, 2, 3]) => ({
  options: { applicationServerKey: Uint8Array.from(bytes).buffer },
  toJSON: () => ({
    endpoint: "https://push.example/device",
    keys: { p256dh: "key", auth: "auth" },
  }),
});

test("invalid subscriptions are rejected instead of reporting connected", () => {
  assert.throws(() => serializePushSubscription({ toJSON: () => ({ endpoint: "endpoint" }) }));
});

test("an existing subscription with the same VAPID key is reused", async () => {
  let calls = 0;
  const manager = {
    getSubscription: async () => makeSubscription(),
    subscribe: () => {
      calls += 1;
      throw new Error("Unexpected resubscription");
    },
  };
  const payload = await syncPushSubscription(manager, key, new AbortController().signal);
  assert.equal(calls, 0);
  assert.equal(payload.endpoint, "https://push.example/device");
});

test("changed VAPID keys remove the old subscription before subscribing", async () => {
  const calls = [];
  const old = makeSubscription([4, 5, 6]);
  old.unsubscribe = async () => {
    calls.push("unsubscribe");
    return true;
  };
  const manager = {
    getSubscription: async () => old,
    subscribe: async ({ applicationServerKey, userVisibleOnly }) => {
      calls.push("subscribe");
      assert.deepEqual([...applicationServerKey], [1, 2, 3]);
      assert.equal(userVisibleOnly, true);
      return makeSubscription();
    },
  };
  await syncPushSubscription(manager, key, new AbortController().signal);
  assert.deepEqual(calls, ["unsubscribe", "subscribe"]);
});

test("a failed unsubscribe does not reuse a subscription with a changed VAPID key", async () => {
  const old = makeSubscription([4, 5, 6]);
  old.unsubscribe = async () => false;
  const manager = {
    getSubscription: async () => old,
    subscribe: async () => {
      throw new Error("Unexpected subscription while previous one remains");
    },
  };
  await assert.rejects(
    syncPushSubscription(manager, key, new AbortController().signal),
    /Не удалось обновить подписку/,
  );
});

test("a cancelled browser subscription finishes before a new sync starts", async () => {
  let release;
  let subscription = null;
  let subscribeCalls = 0;
  const started = Promise.withResolvers();
  const manager = {
    getSubscription: async () => subscription,
    subscribe: () => {
      subscribeCalls += 1;
      started.resolve();
      return new Promise((resolve) => {
        release = () => {
          subscription = makeSubscription();
          resolve(subscription);
        };
      });
    },
  };
  const firstController = new AbortController();
  const first = syncPushSubscription(manager, key, firstController.signal);
  const rejection = assert.rejects(first, { name: "AbortError" });
  await started.promise;
  firstController.abort();
  await rejection;
  const second = syncPushSubscription(manager, key, new AbortController().signal);
  release();
  await second;
  assert.equal(subscribeCalls, 1);
});

test("missing service worker readiness times out instead of hanging", async () => {
  await assert.rejects(
    waitForPushWorker(new Promise(() => {}), new AbortController().signal, 5),
    /Служба уведомлений ещё не готова/,
  );
});

test("service worker wait cancels on user switch or unmount", async () => {
  const controller = new AbortController();
  const wait = waitForPushWorker(new Promise(() => {}), controller.signal);
  controller.abort();
  await assert.rejects(wait, { name: "AbortError" });
});
