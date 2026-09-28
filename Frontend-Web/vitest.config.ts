import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
  test: {
    globals: true,
    environment: "jsdom",
    setupFiles: ["./tests/setup.ts"],
    // 30 s per test: full-suite JSDOM concurrency on Windows can add 15–20 s of
    // scheduling overhead to tests that take 2–3 s in isolation (confirmed by
    // isolation vs full-suite diagnosis, Sep 2026).  30 s is the minimum that
    // keeps heavy tests (PilotResetPage, CatalogueImportPage) consistently
    // green without masking genuine regressions.
    testTimeout: 30000,
  },
});
