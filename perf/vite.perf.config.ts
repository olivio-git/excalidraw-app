import { resolve } from "node:path";
import { defineConfig, mergeConfig } from "vite";
import base from "../vite.config";

/** The app's Vite config, building perf/harness/app.html instead of index.html. */
export default mergeConfig(
  base,
  defineConfig({
    build: {
      outDir: resolve(__dirname, "../dist-perf"),
      emptyOutDir: true,
      rollupOptions: { input: { app: resolve(__dirname, "harness/app.html") } },
    },
  })
);
