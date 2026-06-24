/**
 * OCR provider factory — Sprint OCR-1.
 *
 * Reads OCR_PROVIDER from EnvConfig and returns the appropriate OcrProvider
 * implementation.
 *
 * DEVELOPMENT / TEST
 * ──────────────────
 * When ANTHROPIC_API_KEY is absent (the common local-dev case), a StubOcrProvider
 * is returned.  The stub returns a predictable synthetic invoice so all
 * downstream code paths (repository, service, controller) can be exercised
 * without a real API key.
 *
 * STAGING / PRODUCTION
 * ─────────────────────
 * When NODE_ENV is staging or production and ANTHROPIC_API_KEY is absent,
 * an error is thrown at startup to prevent a misconfigured deployment from
 * silently falling back to stub data.
 */

import type { EnvConfig } from "../../config/index.js";
import type { OcrProvider } from "./OcrProvider.js";
import { ClaudeOcrProvider } from "./ClaudeOcrProvider.js";
import type { OcrInvoiceResult } from "../../types/supplierInvoice.js";

/**
 * Stub provider used in development/test environments when ANTHROPIC_API_KEY
 * is not set.  Returns a deterministic synthetic invoice so the full
 * upload → review → confirm workflow can be exercised without a real API call.
 */
class StubOcrProvider implements OcrProvider {
  extractInvoice(
    _buffer: Buffer,
    _mimeType: string,
    filename: string,
  ): Promise<OcrInvoiceResult> {
    return Promise.resolve({
      provider: "stub",
      supplierName: "Test Supplier Pty Ltd",
      supplierAbn: "12 345 678 901",
      supplierEmail: "accounts@testsupplier.com.au",
      supplierPhone: "02 9000 0000",
      supplierAddress: "1 Test Street, Sydney NSW 2000",
      supplierWebsite: "https://testsupplier.com.au",
      invoiceNumber: "TEST-INV-0001",
      invoiceDate: "2026-06-01",
      dueDate: "2026-07-01",
      subtotalCents: 10_000,
      taxCents: 1_000,
      totalCents: 11_000,
      overallConfidence: 99,
      lines: [
        {
          description: `Stub item from ${filename}`,
          sku: "STUB-SKU-001",
          quantity: 1,
          unitPriceCents: 10_000,
          subtotalCents: 10_000,
          taxRateBasisPoints: 1_000,
          taxCents: 1_000,
          totalCents: 11_000,
          confidence: 99,
        },
      ],
      rawResponse: { stub: true, filename },
    });
  }
}

export function createOcrProvider(config: EnvConfig): OcrProvider {
  const isDeployedEnv =
    config.NODE_ENV === "staging" || config.NODE_ENV === "production";

  if (!config.ANTHROPIC_API_KEY) {
    if (isDeployedEnv) {
      throw new Error(
        `ANTHROPIC_API_KEY is required when OCR_PROVIDER=${config.OCR_PROVIDER} in ${config.NODE_ENV}. ` +
          "Set the environment variable before deploying.",
      );
    }
    // Development / test: fall back to stub so the server starts without a key.
    return new StubOcrProvider();
  }
  return new ClaudeOcrProvider(config.ANTHROPIC_API_KEY, config.OCR_CLAUDE_MODEL);
}
