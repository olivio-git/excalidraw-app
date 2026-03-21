import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { viteStaticCopy } from "vite-plugin-static-copy";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    viteStaticCopy({
      targets: [
        {
          src: "node_modules/@excalidraw/excalidraw/dist/prod/fonts",
          dest: "excalidraw-assets",
        },
      ],
    }),
  ],
  resolve: {
    alias: {
      "@": "/src",
    },
  },
  server: {
    host: "0.0.0.0",
    port: 5174,
  },
  build: {
    target: "esnext",
    minify: "esbuild",
    cssMinify: true,
    rollupOptions: {
      output: {
        manualChunks: {
          "react-vendor": ["react", "react-dom", "react-router", "react-router-dom"],
        },
      },
    },
    chunkSizeWarningLimit: 1000,
  },
  clearScreen: false,
  envPrefix: ["VITE_", "TAURI_"],
  test: {
    globals: true,
    environment: "jsdom",
    setupFiles: ["src/test/setup.ts"],
    coverage: {
      provider: "v8",
      reporter: ["text", "json", "html"],
    },
  },
});
