export type PushSubscriptionPayload = {
  endpoint: string;
  keys: { p256dh: string; auth: string };
};

export function toApplicationServerKey(value: string): Uint8Array<ArrayBuffer> {
  const padding = "=".repeat((4 - (value.length % 4)) % 4);
  const decoded = atob((value + padding).replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(decoded, (character) => character.charCodeAt(0));
}

export function serializePushSubscription(subscription: PushSubscription): PushSubscriptionPayload {
  const json = subscription.toJSON();
  if (!json.endpoint || !json.keys?.p256dh || !json.keys.auth) {
    throw new Error("Браузер не передал данные подписки. Попробуйте ещё раз.");
  }
  return { endpoint: json.endpoint, keys: { p256dh: json.keys.p256dh, auth: json.keys.auth } };
}

export function waitForPushWorker(
  ready: Promise<ServiceWorkerRegistration>,
  signal: AbortSignal,
  timeoutMs = 8_000,
): Promise<ServiceWorkerRegistration> {
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      clearTimeout(timer);
      signal.removeEventListener("abort", abort);
    };
    const abort = () => {
      cleanup();
      reject(new DOMException("Подключение отменено", "AbortError"));
    };
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error("Служба уведомлений ещё не готова. Обновите страницу и попробуйте снова."));
    }, timeoutMs);
    signal.addEventListener("abort", abort, { once: true });
    if (signal.aborted) abort();
    ready.then(
      (registration) => {
        cleanup();
        resolve(registration);
      },
      (error) => {
        cleanup();
        reject(error);
      },
    );
  });
}

// Browser subscriptions cannot be cancelled. Serialize them across remounts and retries.
let subscriptionQueue: Promise<unknown> = Promise.resolve();

function abortable<T>(task: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    const cleanup = () => signal.removeEventListener("abort", abort);
    const abort = () => {
      cleanup();
      reject(new DOMException("Подключение отменено", "AbortError"));
    };
    signal.addEventListener("abort", abort, { once: true });
    if (signal.aborted) abort();
    task.then(
      (value) => {
        cleanup();
        resolve(value);
      },
      (error) => {
        cleanup();
        reject(error);
      },
    );
  });
}

export function syncPushSubscription(
  manager: PushManager,
  publicKey: string,
  signal: AbortSignal,
): Promise<PushSubscriptionPayload> {
  const task = subscriptionQueue
    .catch(() => undefined)
    .then(async () => {
      signal.throwIfAborted();
      const applicationServerKey = toApplicationServerKey(publicKey);
      let subscription = await manager.getSubscription();
      signal.throwIfAborted();
      if (subscription) {
        const existing = subscription.options.applicationServerKey;
        const bytes = existing ? new Uint8Array(existing) : null;
        const matches =
          bytes?.length === applicationServerKey.length &&
          bytes.every((byte, index) => byte === applicationServerKey[index]);
        if (!matches) {
          const removed = await subscription.unsubscribe();
          signal.throwIfAborted();
          if (!removed) throw new Error("Не удалось обновить подписку. Попробуйте ещё раз.");
          subscription = null;
        }
      }
      if (!subscription) {
        subscription = await manager.subscribe({ userVisibleOnly: true, applicationServerKey });
      }
      signal.throwIfAborted();
      return serializePushSubscription(subscription);
    });
  subscriptionQueue = task;
  return abortable(task, signal);
}
