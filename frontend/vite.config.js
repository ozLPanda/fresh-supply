import path from "node:path";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

const rootDir = process.cwd();

export default defineConfig(({ command, mode }) => {
  const env = { ...loadEnv(mode, rootDir, ""), ...process.env };
  // Server-only target: frontend requests stay same-origin, including cookie auth.
  const apiTarget = env.DEV_API_TARGET || "http://127.0.0.1:8084";
  const proxy = Object.fromEntries(
    ["/api", "/uploads"].map((prefix) => [prefix, { target: apiTarget, changeOrigin: true }]),
  );
  return {
    plugins: [
      react(),
      tailwindcss(),
      VitePWA({
        registerType: "prompt",
        injectRegister: false,
        // A development service worker can cache Vite modules and leave the UI on an old version.
        // Keep PWA updates in production, but let HMR and normal reloads use the current source locally.
        devOptions: {
          enabled: command !== "serve",
        },
        manifest: {
          id: "/",
          name: "Фирма Актив",
          short_name: "Актив",
          description: "Оборудование для отопления и инженерных систем",
          lang: "ru",
          start_url: "/",
          scope: "/",
          display: "standalone",
          orientation: "any",
          theme_color: "#f7f6f4",
          background_color: "#f7f6f4",
          categories: ["business", "shopping"],
          icons: [
            { src: "/pwa-192x192.png", sizes: "192x192", type: "image/png", purpose: "any" },
            { src: "/pwa-512x512.png", sizes: "512x512", type: "image/png", purpose: "any" },
            {
              src: "/pwa-maskable-512x512.png",
              sizes: "512x512",
              type: "image/png",
              purpose: "maskable",
            },
          ],
          shortcuts: [
            { name: "Каталог", short_name: "Каталог", url: "/catalog" },
            { name: "Корзина", short_name: "Корзина", url: "/cart" },
            { name: "Мои заказы", short_name: "Заказы", url: "/orders" },
          ],
        },
        workbox: {
          importScripts: ["/push-notifications.js"],
          cleanupOutdatedCaches: true,
          clientsClaim: true,
          navigateFallback: "/index.html",
          navigateFallbackDenylist: [
            /^\/api(?:\/|$)/,
            /^\/(?:robots\.txt|sitemap(?:-[^/]+)?\.xml)/,
            /^\/(?:product|catalog|categories)(?:\/|$)/,
          ],
          globPatterns: ["**/*.{html,js,css,svg,png,webp,woff2}"],
          // Keep the optional 3D viewer out of the storefront precache.
          globIgnores: [
            "**/pwa-*.png",
            "**/createBoilerScene-*.js",
            "**/createChimneyScene-*.js",
            "**/boilerModel-*.js",
            "**/Kotel3DPage-*",
            "models/**",
          ],
          runtimeCaching: [
            {
              urlPattern: /\/uploads\/.*[?&]v=/,
              handler: "CacheFirst",
              options: {
                cacheName: "ovoshi-help-image-cache-v1",
                cacheableResponse: { statuses: [0, 200] },
                expiration: { maxEntries: 1000 },
              },
            },
          ],
        },
      }),
    ],
    resolve: {
      alias: {
        "@": path.resolve(rootDir, "src"),
      },
    },
    server: {
      // Internal backend request for the matching development HTML shell.
      allowedHosts: ["frontend"],
      host: "0.0.0.0",
      port: Number(env.VITE_DEV_SERVER_PORT || 5175),
      strictPort: true,
      proxy,
    },
    preview: {
      host: "0.0.0.0",
      port: 4175,
      strictPort: true,
      proxy,
    },
  };
});
