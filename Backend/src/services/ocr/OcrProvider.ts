/**
 * OCR provider abstraction — Sprint OCR-1.
 *
 * OcrProvider is the single interface that all OCR implementations must satisfy.
 * The active provider is selected at startup via createOcrProvider() in
 * ocrProviderFactory.ts.  Swapping the provider (e.g. Claude → OpenAI) requires
 * only a new implementation file and a factory entry — no service or controller
 * changes needed.
 */

import type { OcrInvoiceResult } from "../../types/supplierInvoice.js";

export interface OcrProvider {
  /**
   * Extract structured invoice data from a file buffer.
   *
   * @param buffer     Raw file bytes from multer memory upload.
   * @param mimeType   MIME type: 'application/pdf', 'image/png', 'image/jpeg'.
   * @param filename   Original filename (used in prompts and audit logs).
   * @returns          Structured extraction result with all monetary values
   *                   as integer CENTS (AUD) and confidence scores 0–100.
   */
  extractInvoice(
    buffer: Buffer,
    mimeType: string,
    filename: string,
  ): Promise<OcrInvoiceResult>;
}
