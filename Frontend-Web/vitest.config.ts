import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
  test: {
    globals: true,
    environment: "jsdom",
    setupFiles: ["./tests/setup.ts"],
    // 15 s per test to handle full-suite JSDOM parallelism on slow hosts.
    testTimeout: 15000,
  },
});
