// This path was previously used by vite-plugin-pwa in development.
// Existing local registrations fetch it during an update check, unregister themselves,
// and return control to the Vite dev server instead of serving stale modules.
self.addEventListener("install", () => self.skipWaiting());

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      await self.registration.unregister();
      const clients = await self.clients.matchAll({ type: "window" });
      await Promise.all(clients.map((client) => client.navigate(client.url)));
    })(),
  );
});
