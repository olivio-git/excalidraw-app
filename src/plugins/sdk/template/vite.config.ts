import { defineConfig } from "vite";

export default defineConfig({
  build: {
    lib: {
      entry: "src/index.ts",
      formats: ["es"],
      fileName: "index",
    },
    // Genera sourcemaps para facilitar el debugging
    sourcemap: true,
    // No minificar para que sea inspeccionable
    minify: false,
    rollupOptions: {
      // React viene de la app host — no bundlear
      external: ["react", "react-dom"],
    },
  },
});
