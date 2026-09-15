import "@testing-library/jest-dom/vitest";
import { configure } from "@testing-library/react";

// The default asyncUtilTimeout of 1000 ms is too tight when the full test
// suite runs in parallel (40 worker threads, heavy module loading). Tests that
// wait for navigation + component mount — such as the CatalogueImportPage
// cancel-flow test — can exceed 1 s under load. 5 s is ample and safe; it
// does not mask genuine regressions because slow pages/navigations are a real
// UX problem we'd catch in manual or E2E testing.
configure({ asyncUtilTimeout: 5000 });
