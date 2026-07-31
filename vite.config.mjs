import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  base: "./",
  build: {
    outDir: "dist/client",
  },
  optimizeDeps: {
    include: ["react", "react-dom/client"],
  },
  server: {
    host: "0.0.0.0",
    allowedHosts: ["terminal.local"],
    warmup: {
      clientFiles: ["./src/main.jsx"],
    },
  },
  test: {
    environment: "jsdom",
    exclude: ["tests/sites-worker.test.mjs", "node_modules/**", "dist/**"],
    globals: true,
    setupFiles: "./tests/vitest.setup.mjs",
  },
  plugins: [react()],
});
