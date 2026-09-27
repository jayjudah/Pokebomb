/// <reference types="vitest/config" />
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

// GitHub Pages serves the app from /<repo>/, so CI sets BASE_PATH.
const base = process.env.BASE_PATH ?? "/";

export default defineConfig({
  base,
  plugins: [
    react(),
    VitePWA({
      registerType: "autoUpdate",
      includeAssets: ["icon.svg", "icon-192.png", "icon-512.png"],
      manifest: {
        name: "Pokebomb",
        short_name: "Pokebomb",
        description: "Scan your Pokémon cards and find the best meta deck you can build.",
        theme_color: "#14161f",
        background_color: "#14161f",
        display: "standalone",
        start_url: base,
        icons: [
          { src: "icon-192.png", sizes: "192x192", type: "image/png" },
          { src: "icon-512.png", sizes: "512x512", type: "image/png" },
          { src: "icon.svg", sizes: "any", type: "image/svg+xml" },
        ],
      },
      workbox: {
        // meta.json is refreshed daily by CI; always try the network first.
        runtimeCaching: [
          {
            urlPattern: /meta\.json$/,
            handler: "NetworkFirst",
            options: { cacheName: "meta" },
          },
          {
            // Tesseract's engine + English data (~15 MB) load from jsDelivr on
            // first scan; keep them so scanning works offline afterwards.
            urlPattern: /^https:\/\/cdn\.jsdelivr\.net\/npm\/(tesseract|@tesseract)/,
            handler: "CacheFirst",
            options: { cacheName: "ocr-engine", expiration: { maxEntries: 20 } },
          },
          {
            urlPattern: /^https:\/\/api\.tcgdex\.net\//,
            handler: "StaleWhileRevalidate",
            options: { cacheName: "tcgdex-api", expiration: { maxEntries: 500 } },
          },
          {
            urlPattern: /^https:\/\/assets\.tcgdex\.net\//,
            handler: "CacheFirst",
            options: { cacheName: "card-images", expiration: { maxEntries: 3000 } },
          },
        ],
      },
    }),
  ],
  test: {
    include: ["src/**/*.test.ts", "scripts/**/*.test.mjs"],
  },
});
