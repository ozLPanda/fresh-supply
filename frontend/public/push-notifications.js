self.addEventListener("push", (event) => {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch {
    payload = {};
  }

  const title = payload.title || "Фирма «Актив»";
  const options = {
    body: payload.body || "Поступил новый заказ.",
    icon: "/pwa-192x192.png",
    badge: "/pwa-192x192.png",
    tag: payload.tag || "company-shop-order",
    data: { actionUrl: payload.actionUrl || "/admin/orders" },
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const targetUrl = new URL(event.notification.data?.actionUrl || "/admin/orders", self.location.origin)
    .href;
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clients) => {
      const existing = clients.find((client) => client.url === targetUrl);
      return existing ? existing.focus() : self.clients.openWindow(targetUrl);
    }),
  );
});
