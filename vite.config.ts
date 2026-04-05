import { defineConfig } from "vite";
import { resolve } from "path";
import { readFile, writeFile } from "fs/promises";

export default defineConfig({
  root: "src",
  base: "./",

  resolve: {
    alias: {
      "@core": resolve(__dirname, "src/core"),
      "@modules": resolve(__dirname, "src/modules"),
      "@styles": resolve(__dirname, "src/styles"),
    },
  },

  build: {
    outDir: "../dist",
    emptyOutDir: true,
    target: "es2022",
    chunkSizeWarningLimit: 900,
    rollupOptions: {
      input: {
        main: resolve(__dirname, "src/fide.html"),
        admin: resolve(__dirname, "src/admin/admin.html"),
      },
      output: {
        manualChunks: {
          pocketbase: ["pocketbase"],
          exceljs: ["exceljs"],
        },
      },
    },
  },

  server: {
    port: 3000,
    open: "/fide.html",
  },
});
